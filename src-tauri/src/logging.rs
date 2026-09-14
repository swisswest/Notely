use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
const REDACTED: &str = "[redacted]";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn label(self) -> &'static str {
        match self {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }
}

struct Logger {
    file: Mutex<Option<File>>,
    path: PathBuf,
}

static LOGGER: OnceLock<Logger> = OnceLock::new();

pub fn init(log_dir: &Path) {
    if LOGGER.get().is_some() {
        return;
    }
    let _ = fs::create_dir_all(log_dir);
    let path = log_dir.join("notely.log");
    rotate_if_needed(&path);
    let file = OpenOptions::new().create(true).append(true).open(&path).ok();
    let _ = LOGGER.set(Logger {
        file: Mutex::new(file),
        path,
    });
}

fn rotate_if_needed(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() > MAX_LOG_BYTES {
            let _ = fs::rename(path, path.with_extension("log.old"));
        }
    }
}

/// Entfernt Secrets aus einem Logtext. Alles was wie ein Anthropic-Key
/// aussieht wird ersetzt, unabhängig davon wo es im Text steht.
pub fn redact(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(index) = rest.find("sk-") {
        out.push_str(&rest[..index]);
        out.push_str(REDACTED);
        let tail = &rest[index..];
        let end = tail
            .char_indices()
            .find(|(_, c)| !(c.is_ascii_alphanumeric() || *c == '-' || *c == '_'))
            .map(|(i, _)| i)
            .unwrap_or(tail.len());
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}

pub fn log(level: Level, target: &str, message: &str) {
    let line = format!(
        "{} {:<5} [{}] {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
        level.label(),
        target,
        redact(message)
    );

    if cfg!(debug_assertions) {
        print!("{line}");
    }

    let Some(logger) = LOGGER.get() else {
        return;
    };
    let Ok(mut guard) = logger.file.lock() else {
        return;
    };
    if let Some(file) = guard.as_mut() {
        if file.write_all(line.as_bytes()).is_err() {
            *guard = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&logger.path)
                .ok();
        }
    }
}

pub fn info(target: &str, message: impl AsRef<str>) {
    log(Level::Info, target, message.as_ref());
}

pub fn warn(target: &str, message: impl AsRef<str>) {
    log(Level::Warn, target, message.as_ref());
}

pub fn error(target: &str, message: impl AsRef<str>) {
    log(Level::Error, target, message.as_ref());
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn redacts_anthropic_style_keys() {
        let input = "request failed with key sk-ant-api03-ABCdef_123 in header";
        let output = redact(input);
        assert!(!output.contains("ABCdef"));
        assert!(output.contains("[redacted]"));
        assert!(output.starts_with("request failed with key "));
        assert!(output.ends_with(" in header"));
    }

    #[test]
    fn keeps_plain_text_untouched() {
        assert_eq!(redact("kein secret hier"), "kein secret hier");
    }
}
