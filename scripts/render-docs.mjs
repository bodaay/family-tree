// Renders the design document (English and Arabic) to PDF with the system's
// Chrome, so the PDFs can be rebuilt from the repo with nothing to install:
//   node scripts/render-docs.mjs
//   CHROME=/path/to/chrome node scripts/render-docs.mjs
//
// The documents load the app's own fonts from public/fonts, so they render the
// same offline. The version in each PDF's name comes from the document itself
// (<meta name="doc-version">). Older PDFs are kept as history.
//
// How: serve docs/design and public/fonts on 127.0.0.1 only, start headless
// Chrome, and ask it over the DevTools protocol (Node's built-in WebSocket) to
// print each page once its fonts have loaded. If poppler's pdffonts is
// installed, the result is checked for Type 3 fonts (outlines instead of real,
// searchable fonts).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/design');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DOCS = [
  { html: 'docs/design/design-document.html', pdf: v => `FamilyTree-Design-Document-v${v}.pdf` },
  { html: 'docs/design/design-document-ar.html', pdf: v => `FamilyTree-Design-Document-v${v}-ar.pdf` },
];
// Only these folders are served, and only to this machine.
const SERVED = ['docs/design/', 'public/fonts/'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

function serve() {
  const server = http.createServer(async (req, res) => {
    const rel = path.posix.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '');
    if (!SERVED.some(dir => rel.startsWith(dir)) || rel.includes('..')) return res.writeHead(404).end();
    try {
      const body = await fs.readFile(path.join(ROOT, rel));
      res.writeHead(200, { 'content-type': TYPES[path.extname(rel)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function startChrome(profile) {
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--mute-audio', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((resolve, reject) => {
    let err = '';
    chrome.on('error', e => reject(new Error(`cannot start Chrome at ${CHROME}: ${e.message}`)));
    chrome.stderr.on('data', d => {
      err += d;
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve({ chrome, ws: m[1] });
    });
    chrome.on('exit', code => reject(new Error(`Chrome exited (${code}): ${err.slice(-500)}`)));
  });
}

/** A minimal DevTools-protocol client: send(method, params, session) → result. */
function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.message} ${msg.error.data ?? ''}`)) : resolve(msg.result);
    } else if (msg.method) {
      for (const w of [...waiters]) if (w.method === msg.method && w.session === msg.sessionId) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg.params);
      }
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const once = (method, session) => new Promise(resolve => waiters.push({ method, session, resolve }));
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({ send, once, close: () => ws.close() });
    ws.onerror = () => reject(new Error('cannot reach Chrome over DevTools'));
  });
}

async function render(cdp, url, tagged = true) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, s);
  const loaded = cdp.once('Page.loadEventFired', s);
  await cdp.send('Page.navigate', { url }, s);
  // a load that never reports (seen now and then on a first run) is an error, not a wait forever
  await Promise.race([loaded, new Promise((_, reject) => setTimeout(() => reject(new Error(`${url}: the page did not finish loading`)), 60000))]);
  // every font the page uses must be loaded before printing
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: `document.fonts.ready.then(() => ({
      version: document.querySelector('meta[name="doc-version"]')?.content ?? null,
      failed: [...document.fonts].filter(f => f.status === 'error').map(f => f.family + ' ' + f.weight),
    }))`,
    awaitPromise: true,
    returnByValue: true,
  }, s);
  const { version, failed } = result.value;
  if (!version) throw new Error(`${url}: no <meta name="doc-version">`);
  if (failed.length) throw new Error(`${url}: fonts failed to load: ${failed.join(', ')}`);
  const { data } = await cdp.send('Page.printToPDF', {
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    generateTaggedPDF: tagged,
    generateDocumentOutline: true,
  }, s);
  await cdp.send('Target.closeTarget', { targetId });
  return { version, pdf: Buffer.from(data, 'base64') };
}

function checkFonts(file) {
  const r = spawnSync('pdffonts', [file], { encoding: 'utf8' });
  if (r.error) return 'pdffonts not installed: fonts not checked';
  const type3 = r.stdout.split('\n').filter(l => /\bType 3\b/.test(l));
  if (type3.length) throw new Error(`${path.basename(file)} has Type 3 fonts:\n${type3.join('\n')}`);
  return 'fonts embedded, no Type 3';
}

// nothing here should take minutes: stop rather than hang (the caller can run it again)
setTimeout(() => {
  console.error('render-docs: timed out');
  try {
    chrome?.kill('SIGKILL');
  } catch {}
  process.exit(1);
}, Number(process.env.RENDER_TIMEOUT_MS ?? 900000)).unref();

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
let chrome;
// Chrome's tagged printing (the PDF's structure, for screen readers) now and then
// never returns on a long right-to-left document, depending on where pages
// break. Give it a few minutes; then start Chrome again and print that document
// without tags, and say so.
const TAGGED_LIMIT = Number(process.env.RENDER_TAGGED_MS ?? 180000);
const profiles = [];
async function launch() {
  // a profile of its own each time: a Chrome just killed may still hold the last one
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'render-docs-'));
  profiles.push(dir);
  const started = await startChrome(dir);
  chrome = started.chrome;
  return connect(started.ws);
}
try {
  let cdp = await launch();
  for (const doc of DOCS) {
    let out, note = '';
    try {
      out = await Promise.race([render(cdp, base + doc.html), new Promise((_, reject) => setTimeout(() => reject(new Error('stalled')), TAGGED_LIMIT))]);
    } catch (e) {
      if (e.message !== 'stalled') throw e;
      chrome.kill('SIGKILL');
      cdp.close();
      cdp = await launch();
      out = await render(cdp, base + doc.html, false);
      note = '; untagged: Chrome stalled printing it tagged';
    }
    const { version, pdf } = out;
    const file = path.join(OUT, doc.pdf(version));
    await fs.writeFile(file, pdf);
    console.log(`${path.relative(ROOT, file)}  (${Math.round(pdf.length / 1024)} KB; ${checkFonts(file)}${note})`);
  }
  await cdp.send('Browser.close').catch(() => {});
  cdp.close();
} finally {
  chrome?.kill();
  server.close();
  await new Promise(r => setTimeout(r, 500));
  for (const dir of profiles) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
}
