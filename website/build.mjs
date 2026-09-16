#!/usr/bin/env node
/**
 * Baut die statische Notely-Website nach website/dist.
 *
 * Datenquellen:
 *   - GitHub Releases API  -> Installer, Grösse, SHA-256, Datum
 *   - CHANGELOG.md         -> Änderungen je Version, Roadmap
 *
 * Aufruf:
 *   node website/build.mjs                            # holt Releases live (GITHUB_TOKEN empfohlen)
 *   RELEASES_JSON=pfad.json node website/build.mjs    # Releases aus Datei (offline/Test)
 *
 * Umgebungsvariablen:
 *   GITHUB_REPOSITORY  owner/repo            (Standard: swisswest/Notely)
 *   GITHUB_TOKEN       Token für die API      (optional lokal, in CI gesetzt)
 *   SITE_URL           öffentliche Basis-URL  (Standard: https://<owner>.github.io/<repo>/)
 *   STRICT=1           Build bricht ab, wenn die API nicht erreichbar ist (CI)
 *
 * Keine Abhängigkeiten, Node >= 20.
 */
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'website', 'src');
const OUT = join(ROOT, 'website', 'dist');

const REPO = process.env.GITHUB_REPOSITORY || 'swisswest/Notely';
const [OWNER, NAME] = REPO.split('/');
const SITE_URL = (process.env.SITE_URL || `https://${OWNER.toLowerCase()}.github.io/${NAME}/`).replace(/\/?$/, '/');
const BASE_PATH = new URL(SITE_URL).pathname; // z. B. "/Notely/" oder "/" bei eigener Domain
const GH = `https://github.com/${REPO}`;
const STRICT = process.env.STRICT === '1';
const INSTALLER = /-setup\.exe$/i;

// ---------------------------------------------------------------- Helpers
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function inlineMd(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `@@C${codes.push(c) - 1}@@`);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>');
  return s.replace(/@@C(\d+)@@/g, (_, i) => `<code>${codes[i]}</code>`);
}

function parseSemver(v) {
  const m = String(v).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/);
  return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] || '' } : { n: [0, 0, 0], pre: String(v) };
}
function semverCmp(a, b) {
  const pa = parseSemver(a), pb = parseSemver(b);
  for (let i = 0; i < 3; i++) if (pa.n[i] !== pb.n[i]) return pa.n[i] - pb.n[i];
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  return pa.pre.localeCompare(pb.pre, 'en', { numeric: true });
}
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDate = (d) =>
  d ? new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' }).format(new Date(d)) : '';
const isoDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const slug = (v) => 'v' + String(v).replace(/[^\w.-]/g, '');

// ---------------------------------------------------------------- Changelog
function parseChangelog(md) {
  const versions = [];
  let roadmap = [];
  let cur = null, sec = null, inItem = false;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^##\s+\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/))) {
      inItem = false;
      cur = /^\d+\.\d+\.\d+/.test(m[1]) ? { version: m[1], date: m[2] || null, sections: [] } : { unreleased: true, sections: [] };
      if (!cur.unreleased) versions.push(cur);
      sec = null;
      continue;
    }
    if (!cur) continue;
    if ((m = line.match(/^###\s+(.+)/))) {
      inItem = false;
      sec = { title: m[1].trim(), items: [] };
      if (cur.unreleased) { if (/geplant|roadmap/i.test(sec.title)) roadmap = sec.items; }
      else cur.sections.push(sec);
      continue;
    }
    if (/^\[[^\]]+\]:\s/.test(line)) { inItem = false; continue; }
    if (!sec) continue;
    if ((m = line.match(/^[-*]\s+(.*)/))) { sec.items.push(m[1]); inItem = true; continue; }
    if (inItem && /^\s{2,}\S/.test(raw)) { sec.items[sec.items.length - 1] += ' ' + line.trim(); continue; }
    if (!line.trim()) inItem = false;
  }
  return { versions, roadmap };
}

const KIND = [
  [/hinzugef|added/i, 'added'],
  [/behoben|fixed/i, 'fixed'],
  [/geändert|changed|verbessert/i, 'changed'],
  [/sicherheit|security/i, 'security'],
];
const kindOf = (t) => (KIND.find(([r]) => r.test(t)) || [null, 'other'])[1];

// ---------------------------------------------------------------- Releases
async function loadReleases() {
  if (process.env.RELEASES_JSON) return JSON.parse(await readFile(process.env.RELEASES_JSON, 'utf8'));
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'notely-website-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const all = [];
  try {
    for (let page = 1; page < 20; page++) {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, { headers });
      if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const batch = await res.json();
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  } catch (err) {
    if (STRICT) throw err;
    console.warn(`! Releases nicht abrufbar (${err.message}) – Seite wird ohne Downloads gebaut.`);
    return [];
  }
}

function normalizeRelease(r) {
  const asset = (r.assets || []).find((a) => INSTALLER.test(a.name));
  return {
    version: String(r.tag_name).replace(/^v/, ''),
    tag: r.tag_name,
    url: r.html_url,
    publishedAt: r.published_at,
    prerelease: !!r.prerelease,
    asset: asset
      ? {
          name: asset.name,
          url: asset.browser_download_url,
          size: asset.size,
          sha256: typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice(7) : null,
        }
      : null,
  };
}

// ---------------------------------------------------------------- Icons (eigene Stroke-Icons, 16er-Raster)
const I = (d, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const icon = {
  download: (s) => I('<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>', s),
  windows: (s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1.5 3.2 6.8 2.5v5H1.5zM7.6 2.4 14.5 1.5v6H7.6zM1.5 8.3h5.3v5.2l-5.3-.7zM7.6 8.3h6.9v6.2l-6.9-.9z"/></svg>`,
  github: (s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`,
  arrow: (s) => I('<path d="M3 8h10M9 4l4 4-4 4"/>', s),
  note: (s) => I('<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3M5.5 8h5M5.5 11h3.5"/>', s),
  checkCircle: (s) => I('<circle cx="8" cy="8" r="6.5"/><path d="M5.2 8.2 7.2 10.2 10.8 6"/>', s),
  sparkle: (s) => I('<path d="M8 1.5c.4 3.3 1.9 5 6.5 6.5-4.6 1.5-6.1 3.2-6.5 6.5-.4-3.3-1.9-5-6.5-6.5C6.1 6.5 7.6 4.8 8 1.5z"/>', s),
  bell: (s) => I('<path d="M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11zM6.5 14a1.5 1.5 0 0 0 3 0"/>', s),
  bolt: (s) => I('<path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z"/>', s),
  moon: (s) => I('<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"/>', s),
  trash: (s) => I('<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/>', s),
  tray: (s) => I('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M1.5 9.5h3.5l1 1.5h4l1-1.5h3.5"/>', s),
  shield: (s) => I('<path d="M8 1.5 2.5 3.5v4c0 3.3 2.3 5.9 5.5 7 3.2-1.1 5.5-3.7 5.5-7v-4z"/>', s),
  file: (s) => I('<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/>', s),
  copy: (s) => I('<rect x="5.5" y="5.5" width="9" height="9" rx="1.5"/><path d="M10.5 5.5v-3a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3"/>', s),
  warn: (s) => I('<path d="M8 1.8 15 14H1z"/><path d="M8 6.5v3M8 11.8h.01"/>', s),
  search: (s) => I('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>', s),
  inbox: (s) => I('<path d="M1.5 9.5 3.5 3h9l2 6.5V13h-13z"/><path d="M1.5 9.5H5l1 1.5h4l1-1.5h3.5"/>', s),
  sun: (s) => I('<circle cx="8" cy="8" r="3"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1"/>', s),
  list: (s) => I('<path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01"/>', s),
  clock: (s) => I('<circle cx="8" cy="8" r="6.5"/><path d="M8 4.5V8l2.5 1.5"/>', s),
};

// ---------------------------------------------------------------- Layout
let BUILD_ID = '';
let LATEST_TAG = null;

function layout({ title, description, path = '', body, base = './', active = '', extraHead = '', noindex = false }) {
  const canonical = SITE_URL + path;
  return `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(canonical)}">`}
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1114" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Notely">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(SITE_URL)}assets/icon.png">
<meta name="twitter:card" content="summary">
<link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="${base}assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="${base}assets/apple-touch-icon.png">
<link rel="alternate" type="application/atom+xml" title="Notely Releases" href="${GH}/releases.atom">
<link rel="stylesheet" href="${base}assets/styles.css?v=${BUILD_ID}">
${extraHead}
</head>
<body>
<a class="skip" href="#main">Zum Inhalt springen</a>
<header class="header" data-header>
  <div class="container header__inner">
    <a class="brand" href="${base}"><img src="${base}assets/icon.png" alt="" width="26" height="26">Notely</a>
    <nav class="nav" aria-label="Hauptnavigation">
      <a href="${base}#funktionen">Funktionen</a>
      <a href="${base}#sicherheit">Sicherheit</a>
      <a href="${base}#installation">Installation</a>
      <a href="${base}versionen/"${active === 'versionen' ? ' aria-current="page"' : ''}>Versionen</a>
    </nav>
    <div class="header__actions">
      <a class="icon-link" href="${GH}" aria-label="Notely auf GitHub" rel="noopener">${icon.github(18)}</a>
      <a class="btn btn--primary btn--sm" href="${base}download/">${icon.download(14)}Download</a>
    </div>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="footer">
  <div class="container footer__inner">
    <div>
      <a class="brand" href="${base}"><img src="${base}assets/icon.png" alt="" width="22" height="22">Notely</a>
      <small>Open Source unter MIT-Lizenz · Westcon</small>
    </div>
    <nav class="footer__links" aria-label="Fusszeile">
      <a href="${base}versionen/">Alle Versionen</a>
      <a href="${GH}/blob/main/CHANGELOG.md" rel="noopener">Changelog</a>
      <a href="${GH}/blob/main/SECURITY.md" rel="noopener">Sicherheit</a>
      <a href="${GH}/issues" rel="noopener">Fehler melden</a>
      <a href="${GH}" rel="noopener">GitHub</a>
    </nav>
  </div>
</footer>
<script>window.NOTELY=${JSON.stringify({ repo: REPO, latest: LATEST_TAG })};</script>
<script src="${base}assets/app.js?v=${BUILD_ID}" defer></script>
</body>
</html>
`;
}

function downloadButton(latest, { size = 'lg', label = 'Für Windows herunterladen' } = {}) {
  if (!latest) {
    return `<a class="btn btn--primary btn--${size}" href="${GH}/releases" rel="noopener">${icon.windows(16)}Releases auf GitHub</a>`;
  }
  return `<a class="btn btn--primary btn--${size}" href="${esc(latest.asset.url)}" data-dl-latest>${icon.windows(16)}${esc(label)}</a>`;
}

// ---------------------------------------------------------------- Startseite
function renderHome({ latest, roadmap }) {
  const meta = latest
    ? `<span data-latest-version>Version ${esc(latest.version)}</span><span data-latest-size>${fmtSize(latest.asset.size)}</span><span>Windows 11 · x64</span><span>Kostenlos &amp; Open Source</span>`
    : `<span>Windows 11 · x64</span><span>Kostenlos &amp; Open Source</span>`;

  const features = [
    ['note', 'Notizen, wie du denkst', 'Ordner, frei benennbare Labels und Volltextsuche. Die Originalnotiz bleibt immer erhalten – auch wenn die Analyse fehlschlägt.'],
    ['sparkle', 'Claude-Analyse', 'Structured Output statt Freitext. Erkennt Claude keine konkrete Handlung, entsteht auch keine Aufgabe.'],
    ['list', 'Aufgaben im Griff', 'Heute, Morgen, Diese Woche, Überfällig. Mehrfachauswahl und Massenaktionen: verschieben, erledigen, löschen.'],
    ['bell', 'Native Erinnerungen', 'Windows-Benachrichtigungen mit einstellbarer Vorlaufzeit und Snooze – ohne Dubletten, auch nach einem Neustart.'],
    ['bolt', 'Schnellerfassung', 'Systemweit mit <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>N</kbd>: tippen, Enter, weiterarbeiten.'],
    ['clock', 'Tagesabschluss', 'Am Abend zeigt Notely, was offen blieb. Abhaken oder mit einem Klick auf morgen schieben.'],
    ['trash', 'Papierkorb &amp; Sicherung', '30 Tage Schonfrist für Gelöschtes, tägliche automatische Sicherung, Markdown-Import und -Export.'],
    ['tray', 'Läuft im Hintergrund', 'Tray-Icon, Autostart und Start im Hintergrund. Schliessen heisst nicht beenden.'],
    ['moon', 'Hell, dunkel, Tastatur', 'Dark und Light Mode. Jede Aktion erreichbar über die Befehlspalette <kbd>Strg</kbd> <kbd>K</kbd>.'],
  ];

  const security = [
    ['API-Key im Windows Credential Manager', 'Nie im Code, nie in der Datenbank, nie im Log, nie im Frontend.'],
    ['Claude-Antworten gelten als nicht vertrauenswürdig', 'Struktur, Datum, Uhrzeit, Confidence und Textlänge werden validiert. Claude schreibt nie direkt in die Datenbank.'],
    ['Daten bleiben lokal', 'SQLite unter %APPDATA%. Nur der Text der analysierten Notiz geht an die Anthropic-API – sonst nichts.'],
    ['Minimale Angriffsfläche', 'Strikte CSP, keine Shell-Ausführung, kein freier Dateisystemzugriff, SQL ausschliesslich mit Parameter-Binding.'],
  ];

  const keys = [
    [['Ctrl', 'Alt', 'N'], 'Schnellerfassung, systemweit'],
    [['Strg', 'K'], 'Befehlspalette und Suche'],
    [['Strg', 'N'], 'Neue Notiz'],
    [['Strg', 'T'], 'Neue Aufgabe'],
    [['Strg', '1…4'], 'Heute, Inbox, Tasks, Notizen'],
    [['Strg', ','], 'Einstellungen'],
  ];

  const faq = [
    ['Was kostet Notely?', 'Nichts. Notely ist Open Source unter MIT-Lizenz. Für die Aufgabenerkennung nutzt du deinen eigenen Claude API-Key und bezahlst Anthropic direkt nach Verbrauch – Notely zeigt dir Analysen und Tokens pro Tag und Monat an.'],
    ['Funktioniert Notely ohne API-Key?', 'Ja. Notizen, Aufgaben, Erinnerungen, Suche und Sicherung funktionieren vollständig. Nur die automatische Analyse von Notizen zu Aufgaben braucht einen Key.'],
    ['Warum warnt Windows beim Installieren?', 'Der Installer ist derzeit nicht code-signiert. SmartScreen zeigt deshalb „Unbekannter Herausgeber". Klicke auf <em>Weitere Informationen</em> → <em>Trotzdem ausführen</em>. Die SHA-256-Prüfsumme jeder Datei findest du auf der <a href="versionen/">Versionsseite</a>. Code-Signing steht auf der Roadmap.'],
    ['Brauche ich Adminrechte?', 'Nein. Notely installiert sich ins Benutzerprofil.'],
    ['Wie aktualisiere ich?', 'Neuen Installer herunterladen und ausführen – er ersetzt die installierte Version, deine Daten bleiben erhalten. Automatische Updates sind in Planung.'],
    ['Wo liegen meine Daten?', 'Ausschliesslich lokal unter <code>%APPDATA%\\Notely</code>, die Logdatei unter <code>%LOCALAPPDATA%\\Notely\\logs</code>. Kein Konto, keine Cloud, keine Telemetrie.'],
  ];

  const body = `
<section class="hero">
  <div class="container">
    ${latest ? `<a class="eyebrow" href="versionen/#${slug(latest.version)}" data-latest-eyebrow><span class="pill">Neu</span><span data-latest-label>Version ${esc(latest.version)} ist verfügbar</span> ${icon.arrow(12)}</a>` : ''}
    <h1>Notizen schreiben. <span>Claude macht Aufgaben daraus.</span></h1>
    <p class="hero__lead">Notely ist eine schnelle, native Windows-App für freie Notizen. Was nach Handlung klingt, wird zur Aufgabe mit Datum, Uhrzeit und Erinnerung – aufgelöst gegen deine eigenen Tageszeiten.</p>
    <div class="hero__cta">
      ${downloadButton(latest)}
      <a class="btn btn--secondary btn--lg" href="versionen/">Alle Versionen</a>
    </div>
    <p class="hero__meta">${meta}</p>

    <figure class="shot" aria-label="Notely: links eine Notiz, rechts die daraus abgeleiteten Aufgaben">
      <div class="window">
        <div class="window__bar">
          <div class="window__title"><img src="assets/icon.png" alt="">Notely</div>
          <div class="window__ctrl" aria-hidden="true">
            <i><svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor"/></svg></i>
            <i><svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg></i>
            <i><svg width="10" height="10" viewBox="0 0 10 10"><path d="m0 0 10 10M10 0 0 10" stroke="currentColor"/></svg></i>
          </div>
        </div>
        <div class="window__body">
          <aside class="m-side" aria-hidden="true">
            <div class="m-search">${icon.search(13)}Suchen<kbd>Strg K</kbd></div>
            <ul class="m-nav">
              <li>${icon.sun(15)}Heute<b>4</b></li>
              <li>${icon.inbox(15)}Inbox<b>2</b></li>
              <li>${icon.list(15)}Tasks<b>11</b></li>
              <li class="on">${icon.note(15)}Notizen</li>
            </ul>
            <div class="m-label">Labels</div>
            <ul class="m-nav">
              <li><span class="dot" style="background:#2563eb"></span>Projekt Atlas</li>
              <li><span class="dot" style="background:#1f7a4d"></span>Privat</li>
              <li><span class="dot" style="background:#a4650b"></span>Einkauf</li>
            </ul>
          </aside>
          <div class="m-note">
            <div class="m-note__meta">Arbeit · Heute, 09:14</div>
            <h3>Planung Migration</h3>
            <p>Gespräch mit dem Team war gut. <mark>Morgen Mittag</mark> die Datenbankmigration vorbereiten und <mark>am Abend</mark> Nico informieren. Offene Frage: brauchen wir ein Wartungsfenster?</p>
            <div class="m-note__foot">
              <span class="m-btn">${icon.sparkle(12)}Analysieren</span>
              <span class="m-hint">2 Aufgaben erkannt</span>
            </div>
          </div>
          <div class="m-tasks">
            <div class="m-tasks__head"><h4>Aufgaben</h4><span>Aus dieser Notiz</span></div>
            <div class="m-group">Morgen</div>
            <div class="m-task new"><span class="m-check"></span><div><div class="m-task__t">Datenbankmigration vorbereiten</div><div class="m-task__s"><span class="m-chip m-chip--accent">Mittag</span>12:00</div></div></div>
            <div class="m-task new"><span class="m-check"></span><div><div class="m-task__t">Nico informieren</div><div class="m-task__s"><span class="m-chip m-chip--accent">Abend</span>18:00</div></div></div>
            <div class="m-group">Heute</div>
            <div class="m-task"><span class="m-check"></span><div><div class="m-task__t">Angebot an Kunde senden</div><div class="m-task__s"><span class="m-chip">Nachmittag</span>15:00</div></div></div>
            <div class="m-task done"><span class="m-check"><svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2.5"><path d="M3 8.5 6.5 12 13 4.5"/></svg></span><div><div class="m-task__t">Standup vorbereiten</div><div class="m-task__s">09:00</div></div></div>
          </div>
        </div>
      </div>
      <div class="m-toast" aria-hidden="true">
        <img src="assets/icon.png" alt="">
        <div><small>Notely · jetzt</small><div>Nico informieren</div><p>Fällig um 18:00 · in 15 Minuten</p></div>
      </div>
    </figure>
  </div>
</section>

<div class="container">
  <div class="facts-wrap">
    <div class="facts">
      <div class="fact"><strong>Tauri 2 &amp; Rust</strong><span>Kein mitgeliefertes Chromium</span></div>
      <div class="fact"><strong>Schneller Start</strong><span>Wenig Arbeitsspeicher</span></div>
      <div class="fact"><strong>100&nbsp;% lokal</strong><span>Kein Konto, keine Telemetrie</span></div>
      <div class="fact"><strong>Keine Adminrechte</strong><span>Installation ins Benutzerprofil</span></div>
    </div>
  </div>
</div>

<section class="section" id="so-funktionierts">
  <div class="container">
    <div class="section__head">
      <p class="kicker">So funktioniert's</p>
      <h2>Du schreibst wie immer. Notely erkennt, was zu tun ist.</h2>
      <p>„Mittag" und „Abend" sind nicht einprogrammiert. Du definierst deine Tageszeiten selbst – ändert sich dein Abend auf 18:30, gilt das ab der nächsten Analyse.</p>
    </div>
    <div class="flow">
      <div class="card">
        <div class="card__step"><span>01</span><span>Notiz</span></div>
        <h3>Frei schreiben</h3>
        <p>Kein Formular, keine Syntax.</p>
        <div class="card__demo quote">Morgen Mittag Datenbankmigration vorbereiten und am Abend Nico informieren.</div>
      </div>
      <div class="flow__arrow">${icon.arrow(20)}</div>
      <div class="card">
        <div class="card__step"><span>02</span><span>Deine Tageszeiten</span></div>
        <h3>Deterministisch auflösen</h3>
        <p>Claude liefert Datum und Tageszeit-Schlüssel. Die Uhrzeit setzt Notely.</p>
        <div class="card__demo">
          <dl class="kv">
            <dt>Morgen</dt><dd>08:00</dd>
            <dt>Mittag</dt><dd class="hl">12:00</dd>
            <dt>Nachmittag</dt><dd>15:00</dd>
            <dt>Abend</dt><dd class="hl">18:00</dd>
          </dl>
        </div>
      </div>
      <div class="flow__arrow">${icon.arrow(20)}</div>
      <div class="card">
        <div class="card__step"><span>03</span><span>Aufgaben</span></div>
        <h3>Erinnert werden</h3>
        <p>Validiert, dedupliziert, mit Windows-Benachrichtigung.</p>
        <div class="card__demo">
          <div class="mini-task"><span class="m-check"></span><div>Datenbankmigration vorbereiten<small>Morgen, 12:00</small></div></div>
          <div class="mini-task"><span class="m-check"></span><div>Nico informieren<small>Morgen, 18:00</small></div></div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section" id="funktionen">
  <div class="container">
    <div class="section__head">
      <p class="kicker">Funktionen</p>
      <h2>Alles, was eine Aufgaben-App braucht. Nichts, was sie langsam macht.</h2>
    </div>
    <div class="grid">
      ${features.map(([ic, t, d]) => `<article class="feature"><div class="feature__icon">${icon[ic](16)}</div><h3>${t}</h3><p>${d}</p></article>`).join('\n      ')}
    </div>
  </div>
</section>

<section class="section" id="sicherheit">
  <div class="container split">
    <div class="section__head">
      <p class="kicker">Sicherheit &amp; Datenschutz</p>
      <h2>Deine Notizen gehören dir. Das ist Architektur, kein Versprechen.</h2>
      <p>Die Datenbank ist nur aus Rust erreichbar, das Frontend kennt ausschliesslich typisierte Befehle. Der Quellcode ist offen – prüf es selbst.</p>
      <p style="margin-top:24px"><a class="btn btn--secondary" href="${GH}/blob/main/SECURITY.md" rel="noopener">${icon.shield(15)}Sicherheitsrichtlinie</a></p>
    </div>
    <ul class="checklist">
      ${security.map(([t, d]) => `<li>${icon.checkCircle(18)}<div><strong>${t}</strong><span>${d}</span></div></li>`).join('\n      ')}
    </ul>
  </div>
</section>

<section class="section" id="tastatur">
  <div class="container split">
    <div class="section__head">
      <p class="kicker">Tastatur zuerst</p>
      <h2>Ohne Maus schneller.</h2>
      <p>Jede Ansicht, jede Aktion, jede Suche liegt eine Tastenkombination entfernt. Die Befehlspalette findet Notizen und Aufgaben gleichzeitig.</p>
    </div>
    <ul class="keys">
      ${keys.map(([k, d]) => `<li><span>${d}</span><span class="combo">${k.map((x) => `<kbd>${esc(x)}</kbd>`).join('')}</span></li>`).join('\n      ')}
    </ul>
  </div>
</section>

<section class="section" id="installation">
  <div class="container">
    <div class="section__head">
      <p class="kicker">Installation</p>
      <h2>In einer Minute startklar.</h2>
    </div>
    <ol class="steps">
      <li class="step"><h3>Installer laden</h3><p>${latest ? `<em data-latest-name>${esc(latest.asset.name)}</em>` : 'Den aktuellen Installer'} herunterladen – der Button liefert immer die neueste stabile Version.</p></li>
      <li class="step"><h3>Ausführen</h3><p>Installation ins Benutzerprofil, ohne Adminrechte. Installer auf Deutsch und Englisch.</p></li>
      <li class="step"><h3>API-Key hinterlegen</h3><p>Optional: eigenen Key von <a href="https://console.anthropic.com" rel="noopener" style="color:var(--accent)">console.anthropic.com</a> in den Einstellungen eintragen.</p></li>
    </ol>
    <div class="note">${icon.warn(16)}<p><strong>Hinweis zu SmartScreen:</strong> Der Installer ist noch nicht signiert. Windows meldet deshalb „Unbekannter Herausgeber" – <em>Weitere Informationen</em> → <em>Trotzdem ausführen</em>. Prüfsummen stehen auf der <a href="versionen/" style="color:var(--accent)">Versionsseite</a>.</p></div>
  </div>
</section>

${roadmap.length ? `<section class="section" id="roadmap">
  <div class="container">
    <div class="section__head">
      <p class="kicker">Roadmap</p>
      <h2>Als Nächstes.</h2>
    </div>
    <ul class="roadmap">
      ${roadmap.map((r) => `<li>${inlineMd(r)}</li>`).join('\n      ')}
    </ul>
  </div>
</section>` : ''}

<section class="section" id="faq">
  <div class="container">
    <div class="section__head">
      <p class="kicker">Häufige Fragen</p>
      <h2>Gut zu wissen.</h2>
    </div>
    <div class="faq">
      ${faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('\n      ')}
    </div>
  </div>
</section>

<section class="section section--last">
  <div class="container">
    <div class="cta">
      <img src="assets/icon.png" alt="" width="64" height="64">
      <h2>Weniger verwalten. Mehr erledigen.</h2>
      <p>Kostenlos, Open Source und in einer Minute installiert.</p>
      <div class="hero__cta">
        ${downloadButton(latest)}
        <a class="btn btn--secondary btn--lg" href="${GH}" rel="noopener">${icon.github(16)}Quellcode</a>
      </div>
      <p class="hero__meta">${latest ? `<span data-latest-version>Version ${esc(latest.version)}</span><span data-latest-date>${fmtDate(latest.publishedAt)}</span>` : ''}<span>Windows 11 · x64</span></p>
    </div>
  </div>
</section>`;

  return layout({
    title: 'Notely – Notizen schreiben. Claude macht Aufgaben daraus.',
    description: 'Native Windows-App für Notizen, aus denen Claude automatisch Aufgaben mit Datum, Uhrzeit und Erinnerung ableitet. Kostenlos und Open Source.',
    body,
  });
}

// ---------------------------------------------------------------- Versionsseite
function renderVersions({ entries, latest }) {
  const sectionsHtml = (sections) => {
    const filled = sections.filter((s) => s.items.length);
    if (!filled.length) return '<div class="changes"><ul><li>Keine Änderungsnotizen hinterlegt.</li></ul></div>';
    return `<div class="changes">${filled
      .map((s) => `<div><h3 data-kind="${kindOf(s.title)}">${esc(s.title)}</h3><ul>${s.items.map((i) => `<li>${inlineMd(i)}</li>`).join('')}</ul></div>`)
      .join('')}</div>`;
  };

  const items = entries
    .map((e) => {
      const isLatest = latest && e.version === latest.version;
      const date = e.release?.publishedAt || e.date;
      const a = e.release?.asset;
      const badges = [
        isLatest ? '<span class="badge badge--latest">Aktuell</span>' : '',
        e.release?.prerelease ? '<span class="badge badge--pre">Vorabversion</span>' : '',
      ].join('');
      const asset = a
        ? `<div class="asset">
          <div class="asset__icon">${icon.windows(16)}</div>
          <div class="asset__main">
            <div class="asset__name">${esc(a.name)}</div>
            <div class="asset__meta"><span>${fmtSize(a.size)}</span><span>Windows x64</span>${
              a.sha256 ? `<button class="hash" type="button" data-copy="${esc(a.sha256)}" title="SHA-256 kopieren: ${esc(a.sha256)}">${icon.copy(12)}<span>SHA-256 ${esc(a.sha256.slice(0, 16))}…</span></button>` : ''
            }</div>
          </div>
          <a class="btn ${isLatest ? 'btn--primary' : 'btn--secondary'}" href="${esc(a.url)}">${icon.download(15)}Herunterladen</a>
        </div>`
        : `<div class="asset asset--none"><div class="asset__icon">${icon.file(16)}</div><div class="asset__main">Für diese Version wurde kein Installer veröffentlicht.</div></div>`;
      return `<article class="release" id="${slug(e.version)}">
        <div class="release__head">
          <h2><a href="#${slug(e.version)}">${esc(e.version)}</a></h2>${badges}
          ${date ? `<time class="release__date" datetime="${isoDate(date)}">${fmtDate(date)}</time>` : ''}
        </div>
        ${asset}
        ${sectionsHtml(e.sections)}
        ${e.release ? `<div class="release__links"><a href="${esc(e.release.url)}" rel="noopener">Release auf GitHub →</a></div>` : ''}
      </article>`;
    })
    .join('\n');

  const toc = entries
    .map((e) => `<a href="#${slug(e.version)}" data-toc="${slug(e.version)}">${esc(e.version)}${latest && e.version === latest.version ? '<small>aktuell</small>' : ''}</a>`)
    .join('');

  const body = `
<section class="page-head">
  <div class="container">
    <p class="kicker">Versionen</p>
    <h1>Alle Versionen von Notely</h1>
    <p>Jede Version mit Installer, SHA-256-Prüfsumme und Änderungen. Für den Alltag empfiehlt sich immer die aktuelle Version.</p>
    <div class="page-head__actions">
      ${latest ? `<a class="btn btn--primary" href="${esc(latest.asset.url)}">${icon.windows(15)}Aktuelle Version ${esc(latest.version)} laden</a>` : ''}
      <a class="btn btn--secondary" href="${GH}/releases.atom" rel="noopener">Release-Feed abonnieren</a>
    </div>
  </div>
</section>
<div class="container rel-layout">
  <nav class="toc" aria-label="Versionen"><div class="toc__label">Versionen</div>${toc}</nav>
  <div>${entries.length ? items : '<div class="empty">Noch keine Versionen veröffentlicht.</div>'}</div>
</div>`;

  return layout({
    title: 'Alle Versionen – Notely',
    description: 'Alle Versionen von Notely für Windows mit Installer, SHA-256-Prüfsumme und Änderungsprotokoll.',
    path: 'versionen/',
    base: '../',
    active: 'versionen',
    body,
  });
}

// ---------------------------------------------------------------- /download/ (permanenter Link auf die neueste Version)
function renderDownload({ latest }) {
  const target = latest ? latest.asset.url : `${GH}/releases`;
  const body = `
<section class="center-page">
  <div>
    <img src="../assets/icon.png" alt="" width="72" height="72">
    <h1>${latest ? `Notely ${esc(latest.version)} wird geladen` : 'Weiter zu den Releases'}</h1>
    <p><span class="spinner" aria-hidden="true"></span>${latest ? `${esc(latest.asset.name)} · ${fmtSize(latest.asset.size)}` : 'Einen Moment …'}</p>
    <a class="btn btn--primary btn--lg" href="${esc(target)}" data-dl-latest data-autostart>${icon.download(16)}Download startet nicht? Hier klicken</a>
    <p style="margin-top:20px;font-size:14px"><a href="../" style="color:var(--accent)">Startseite</a> · <a href="../versionen/" style="color:var(--accent)">Alle Versionen</a></p>
  </div>
</section>`;
  return layout({
    title: 'Download – Notely',
    description: 'Lädt automatisch die neueste Version von Notely für Windows.',
    path: 'download/',
    base: '../',
    body,
    noindex: true,
    extraHead: `<noscript><meta http-equiv="refresh" content="0;url=${esc(target)}"></noscript>`,
  });
}

function render404() {
  const body = `
<section class="center-page">
  <div>
    <img src="${BASE_PATH}assets/icon.png" alt="" width="72" height="72">
    <h1>Seite nicht gefunden</h1>
    <p>Diese Adresse existiert nicht oder nicht mehr.</p>
    <a class="btn btn--secondary btn--lg" href="${BASE_PATH}">Zur Startseite</a>
  </div>
</section>`;
  // GitHub Pages liefert 404.html unter beliebigen Pfaden aus -> absolute Basis
  return layout({ title: 'Nicht gefunden – Notely', description: 'Seite nicht gefunden.', body, base: BASE_PATH, noindex: true });
}

// ---------------------------------------------------------------- Main
async function main() {
  const changelogPath = join(ROOT, 'CHANGELOG.md');
  const { versions, roadmap } = existsSync(changelogPath)
    ? parseChangelog(await readFile(changelogPath, 'utf8'))
    : { versions: [], roadmap: [] };
  const releases = (await loadReleases()).filter((r) => !r.draft).map(normalizeRelease);

  const byVersion = new Map();
  for (const v of versions) byVersion.set(v.version, { version: v.version, date: v.date, sections: v.sections, release: null });
  for (const r of releases) {
    const e = byVersion.get(r.version) || { version: r.version, date: null, sections: [], release: null };
    e.release = r;
    byVersion.set(r.version, e);
  }
  const entries = [...byVersion.values()].sort((a, b) => semverCmp(b.version, a.version));
  const latest = releases.filter((r) => !r.prerelease && r.asset).sort((a, b) => semverCmp(b.version, a.version))[0] || null;
  LATEST_TAG = latest?.tag || null;
  BUILD_ID = Date.now().toString(36);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'assets'), { recursive: true });
  await cp(SRC, join(OUT, 'assets'), { recursive: true });

  const write = async (p, c) => {
    await mkdir(dirname(join(OUT, p)), { recursive: true });
    await writeFile(join(OUT, p), c);
  };
  await write('index.html', renderHome({ latest, roadmap }));
  await write('versionen/index.html', renderVersions({ entries, latest }));
  await write('download/index.html', renderDownload({ latest }));
  await write('404.html', render404());
  await write('.nojekyll', '');

  // Maschinenlesbar – z. B. für eine Update-Prüfung in der App oder winget-Manifeste
  const latestJson = latest && {
    version: latest.version,
    publishedAt: latest.publishedAt,
    name: latest.asset.name,
    url: latest.asset.url,
    size: latest.asset.size,
    sha256: latest.asset.sha256,
  };
  await write('latest.json', JSON.stringify(latestJson, null, 2) + '\n');
  await write(
    'releases.json',
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        latest: latestJson,
        releases: entries.map((e) => ({
          version: e.version,
          date: e.release?.publishedAt || e.date,
          prerelease: !!e.release?.prerelease,
          name: e.release?.asset?.name || null,
          url: e.release?.asset?.url || null,
          size: e.release?.asset?.size || null,
          sha256: e.release?.asset?.sha256 || null,
        })),
      },
      null,
      2,
    ) + '\n',
  );
  await write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`);
  await write(
    'sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['', 'versionen/']
      .map((p) => `  <url><loc>${SITE_URL}${p}</loc></url>`)
      .join('\n')}\n</urlset>\n`,
  );

  console.log(`Website gebaut: ${entries.length} Versionen, aktuell: ${latest ? latest.version : '-'} -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
