// Notely Website – progressive Verbesserungen. Die Seite funktioniert vollständig ohne JavaScript.
(function () {
  'use strict';
  var cfg = window.NOTELY || {};

  // Header-Linie beim Scrollen
  var header = document.querySelector('[data-header]');
  if (header) {
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // In die Zwischenablage kopieren. Der Bestaetigungstext kommt aus
  // data-copied, damit derselbe Knopf fuer Pruefsummen und Feed-Adresse taugt.
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('[data-copy]');
    if (!btn || !navigator.clipboard) return;
    navigator.clipboard.writeText(btn.getAttribute('data-copy')).then(function () {
      var label = btn.querySelector('span');
      var prev = label ? label.textContent : '';
      var done = btn.getAttribute('data-copied') || 'Kopiert';
      btn.classList.add('copied');
      if (label) label.textContent = done;
      setTimeout(function () { btn.classList.remove('copied'); if (label) label.textContent = prev; }, 1600);
    });
  });

  // Aktive Version im Inhaltsverzeichnis
  var tocLinks = document.querySelectorAll('[data-toc]');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute('data-toc')] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        tocLinks.forEach(function (a) { a.classList.remove('is-active'); });
        var a = map[e.target.id];
        if (a) a.classList.add('is-active');
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    document.querySelectorAll('.release[id]').forEach(function (el) { io.observe(el); });
  }

  // Aktualität: Die Seite wird bei jedem Release neu gebaut. Falls der Deploy noch läuft,
  // prüft der Browser die GitHub-API und übernimmt eine neuere Version sofort.
  var autostart = document.querySelector('[data-autostart]');
  var CACHE_KEY = 'notely-latest-v1';

  function formatSize(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }

  function apply(rel) {
    if (!rel || rel.tag === cfg.latest) return false;
    var v = rel.tag.replace(/^v/, '');
    document.querySelectorAll('[data-dl-latest]').forEach(function (a) { a.href = rel.url; });
    document.querySelectorAll('[data-latest-version]').forEach(function (el) { el.textContent = 'Version ' + v; });
    document.querySelectorAll('[data-latest-size]').forEach(function (el) { el.textContent = formatSize(rel.size); });
    document.querySelectorAll('[data-latest-name]').forEach(function (el) { el.textContent = rel.name; });
    document.querySelectorAll('[data-latest-label]').forEach(function (el) { el.textContent = 'Version ' + v + ' ist verfügbar'; });
    return true;
  }

  function fromApi(data) {
    if (!data || data.draft || data.prerelease) return null;
    var asset = (data.assets || []).filter(function (a) { return /-setup\.exe$/i.test(a.name); })[0];
    return asset ? { tag: data.tag_name, url: asset.browser_download_url, size: asset.size, name: asset.name } : null;
  }

  function readCache() {
    try {
      var c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      return c && Date.now() - c.t < 10 * 60 * 1000 ? c : null;
    } catch (e) { return null; }
  }
  function writeCache(rel) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), rel: rel })); } catch (e) { /* egal */ }
  }

  function go() {
    if (!autostart) return;
    window.location.replace(autostart.href);
  }

  function check() {
    var cached = readCache();
    if (cached) { apply(cached.rel); return go(); }
    if (!cfg.repo || !window.fetch) return go();

    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; go(); } }, 1500);
    fetch('https://api.github.com/repos/' + cfg.repo + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var rel = fromApi(data);
        writeCache(rel);
        if (done) { apply(rel); return; }
        done = true; clearTimeout(timer);
        apply(rel);
        go();
      })
      .catch(function () { if (!done) { done = true; clearTimeout(timer); go(); } });
  }

  check();
})();
