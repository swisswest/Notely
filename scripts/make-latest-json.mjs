/**
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

function findArchive() {
  let entries;
  try {
    entries = readdirSync(BUNDLE_DIR);
  } catch {
    fail(`${BUNDLE_DIR} existiert nicht - wurde mit createUpdaterArtifacts gebaut?`);
  }

  const archive = entries.find((name) => name.endsWith('.nsis.zip'));
  if (!archive) fail(`kein .nsis.zip in ${BUNDLE_DIR}`);

  const signature = `${archive}.sig`;
  if (!entries.includes(signature)) {
    fail(`${signature} fehlt - ohne Signatur verweigert der Updater die Installation`);
  }

  return { archive, signature };
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
const { archive, signature } = findArchive();

const catalog = {
  version: target,
  notes: notes(target),
  pub_date: new Date().toISOString(),
  platforms: {
    [PLATFORM]: {
      signature: readFileSync(join(BUNDLE_DIR, signature), 'utf8').trim(),
      url: `https://github.com/${repository()}/releases/download/v${target}/${archive}`,
    },
  },
};

writeFileSync(OUTPUT, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`latest.json: ${target} -> ${archive}`);
