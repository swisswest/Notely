**
 * Erzeugt die `latest.json`, die der Tauri-Updater abfragt.
 *
 * Tauri legt beim Release-Build ein signiertes Archiv und die zugehoerige
 * `.sig`-Datei ab, baut den Update-Katalog aber nicht selbst. Genau das macht
 * dieses Skript - und nichts weiter.
 *
 * Aufruf nach `tauri build`:
 *   node scripts/make-latest-json.mjs
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLE_DIR = join('src-tauri', 'target', 'release', 'bundle', 'nsis');
const OUTPUT = join('src-tauri', 'target', 'release', 'bundle', 'latest.json');
const PLATFORM = 'windows-x86_64';

function fail(message) {
  console.error(`latest.json: ${message}`);
  process.exit(1);
}

function version() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (!pkg.version) fail('package.json hat keine version');
  return pkg.version;
}

/** Besitzer/Repository, damit die URL auch in einem Fork stimmt. */
function repository() {
  return process.env.GITHUB_REPOSITORY || 'swisswest/Notely';
}

/**
 * Sucht das Artefakt, auf das `latest.json` zeigt.
 *
 * Tauri 2 signiert den NSIS-Installer direkt und legt die `.sig` daneben.
 * Nur mit `createUpdaterArtifacts: "v1Compatible"` entsteht zusaetzlich das
 * alte `.nsis.zip`. Beide Formen werden akzeptiert, das ZIP hat Vorrang,
 * weil aeltere Clients nur damit umgehen koennen.
 */
function findArtifact() {
  let entries;
  try {
    entries = readdirSync(BUNDLE_DIR);
  } catch {
    fail(`${BUNDLE_DIR} existiert nicht - wurde ueberhaupt gebaut?`);
  }

  const candidates = [
    entries.find((name) => name.endsWith('.nsis.zip')),
    entries.find((name) => name.endsWith('-setup.exe')),
  ].filter(Boolean);

  for (const artifact of candidates) {
    if (entries.includes(`${artifact}.sig`)) {
      return { artifact, signature: `${artifact}.sig` };
    }
  }

  // Die Verzeichnisliste mitgeben - sonst raet man beim naechsten Mal wieder.
  fail(
    `kein signiertes Artefakt in ${BUNDLE_DIR}.\n` +
      `Gefunden: ${entries.join(', ') || '(leer)'}\n` +
      'Ohne .sig-Datei fehlt createUpdaterArtifacts oder der private Schluessel.',
  );
}

/** Holt den Abschnitt der aktuellen Version aus dem Changelog. */
function notes(target) {
  let changelog;
  try {
    changelog = readFileSync('CHANGELOG.md', 'utf8');
  } catch {
    return '';
  }

  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${target}]`));
  if (start === -1) return '';

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

const target = version();
const { artifact, signature } = findArtifact();

const catalog = {
  version: target,
  notes: notes(target),
  pub_date: new Date().toISOString(),
  platforms: {
    [PLATFORM]: {
      signature: readFileSync(join(BUNDLE_DIR, signature), 'utf8').trim(),
      url: `https://github.com/${repository()}/releases/download/v${target}/${artifact}`,
    },
  },
};

writeFileSync(OUTPUT, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`latest.json: ${target} -> ${artifact}`);