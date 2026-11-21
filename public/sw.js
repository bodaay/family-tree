// The app's own files kept on the phone, so it opens with no connection. The
// page itself is fetched fresh whenever the site can be reached (a new version
// shows at once) and kept for when it cannot; the scripts, styles and fonts it
// names never change under the same name, so they are served from the phone.
// Nothing of the family passes through here: /api is never touched, and the
// family log the phone keeps is the app's own, sealed (src/data/logcache.ts).
const CACHE = 'ft-app-1';
const PAGE = '/';

// the first visit loads its files before this takes over: fetch the page and what it names now
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    fetch(PAGE, { cache: 'no-store' })
      .then(res => (res.ok ? keepPage(res) : null))
      .catch(() => null),
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** The files a page or a stylesheet names: scripts and styles, and the fonts the styles use. */
const named = text => new Set([...text.matchAll(/["'(](\/(?:assets|fonts)\/[^"')?#]+)/g)].map(m => m[1]));

/** Fetched once and kept, unless already kept. */
async function fetchKept(cache, path) {
  if (await cache.match(path)) return;
  const res = await fetch(path);
  if (res.ok) await cache.put(path, res);
}

/**
 * Keeps this version of the page with every file it needs (the fonts its styles
 * name too), and drops the scripts and styles of versions before the last two.
 */
async function keepPage(res) {
  const cache = await caches.open(CACHE);
  const old = await cache.match(PAGE);
  const html = await res.clone().text();
  await cache.put(PAGE, res);
  const files = named(html);
  for (const f of [...files]) {
    await fetchKept(cache, f).catch(() => {});
    if (f.endsWith('.css')) {
      const css = await cache.match(f);
      if (css) for (const x of named(await css.text())) await fetchKept(cache, x).catch(() => {});
    }
  }
  const keep = new Set(files);
  if (old) for (const f of named(await old.text())) keep.add(f);
  for (const req of await cache.keys()) {
    const p = new URL(req.url).pathname;
    if (p.startsWith('/assets/') && !keep.has(p)) await cache.delete(req);
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate' || url.pathname === PAGE) {
    // the page: fresh when the site answers, the kept one when it does not
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) e.waitUntil(keepPage(res.clone()));
          return res;
        })
        .catch(() => caches.match(PAGE).then(r => r ?? Response.error())),
    );
    return;
  }
  if (/^\/(assets|fonts)\//.test(url.pathname)) {
    // never changes under the same name: from the phone, or fetched once and kept
    e.respondWith(
      caches.match(req).then(
        hit =>
          hit ??
          fetch(req).then(res => {
            if (res.ok) {
              const copy = res.clone();
              e.waitUntil(caches.open(CACHE).then(c => c.put(req, copy)));
            }
            return res;
          }),
      ),
    );
    return;
  }
  // icons and the manifest: fresh when possible, kept for when not
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then(c => c.put(req, copy)));
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r ?? Response.error())),
  );
});
