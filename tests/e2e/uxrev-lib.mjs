// Helpers for the uxrev-*.mjs walkthroughs (UX review of feat/integration).
//   node uxrev-<name>.mjs <BASE url> <admin-link file> <shots dir> <WxH> <light|dark>
// Screenshots never show an invite or recovery QR code or link: every shot
// hides .qr and blanks any text or input holding #join= or #restore=.
// Links and keys are used, never printed.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [BASE_ARG, LINKFILE, SHOTS_ARG, VIEW = '412x915', SCHEME = 'light'] = process.argv.slice(2);
if (!BASE_ARG || !LINKFILE || !SHOTS_ARG) {
  console.log('usage: node <script> <BASE url> <admin-link file> <shots dir> [WxH] [light|dark]');
  process.exit(2);
}
export const base = BASE_ARG.replace(/\/+$/, '');
const raw = fs.readFileSync(LINKFILE, 'utf8').split('\n').find(l => /^https?:\/\/localhost[:/]/.test(l.trim()) && l.includes('#join='));
if (!raw) {
  console.log('FAIL no admin link in the given file');
  process.exit(2);
}
export const adminLink = base + raw.trim().slice(raw.trim().indexOf('/#join='));
export const fid = adminLink.match(/join=([a-z0-9]+)\./)[1];
export const [W, H] = VIEW.split('x').map(Number);
export const scheme = SCHEME;
export const tag = `${W}-${SCHEME}`;
export const SHOTS = SHOTS_ARG + '/' + tag;
fs.mkdirSync(SHOTS, { recursive: true });

export const wait = ms => new Promise(r => setTimeout(r, ms));
export const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
export const errs = [];
export const dialogs = [];
export const notes = [];
let failed = 0;
const redact = s => String(s).replace(/#(join|restore)=\S+/g, '#$1=…');

export function check(ok, what, detail = '') {
  console.log((ok ? 'PASS ' : 'FAIL ') + what + (detail && !ok ? ' (' + redact(detail) + ')' : ''));
  if (!ok) failed++;
  return ok;
}
export function note(what) {
  notes.push(what);
  console.log('NOTE ' + redact(what));
}

export async function until(fn, ms = 15000, step = 300) {
  const end = Date.now() + ms;
  for (;;) {
    let v;
    try {
      v = await fn();
    } catch {
      v = null;
    }
    if (v || Date.now() > end) return v;
    await wait(step);
  }
}

/** A phone: its own browser context; `auth` adds a platform authenticator with PRF (Face ID). */
export async function phone(name, link, { auth = false, view } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await setup(page, name, view);
  if (auth) {
    const cdp = await page.createCDPSession();
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
    });
    page.cdp = cdp;
    page.authenticatorId = authenticatorId;
  }
  if (link) {
    await page.goto(link, { waitUntil: 'networkidle0' });
    await settle(page);
  }
  return page;
}
async function setup(page, name, view) {
  const [w, h] = view ?? [W, H];
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: SCHEME }]);
  page.label = name;
  page.on('pageerror', e => errs.push(name + ': ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' <- ')));
  page.on('console', m => {
    if (m.type() === 'error') errs.push(name + ': ' + m.text());
  });
  page.on('dialog', d => {
    dialogs.push({ who: name, msg: d.message() });
    console.log(`DIALOG [${name}] ${d.type()}: ${redact(d.message())}`);
    d.accept();
  });
  await page.evaluateOnNewDocument(() => {
    window.__copied = null;
    window.__shared = null;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied = t; } }, configurable: true });
    navigator.canShare = () => true;
    navigator.share = async d => { window.__shared = d.files?.[0] ? { name: d.files[0].name } : d; };
  });
}
/** Opens the app again in the same context (storage kept). */
export async function reopen(old, name) {
  const ctx = old.browserContext();
  const cdp = old.cdp, aid = old.authenticatorId;
  await old.close();
  const page = await ctx.newPage();
  await setup(page, name ?? old.label);
  if (aid) {
    // the virtual authenticator lives on the old page's session: add a fresh one with the same credentials
    page.cdp = cdp;
    page.authenticatorId = aid;
  }
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  await settle(page);
  return page;
}

export const settle = async p => {
  await until(() => p.evaluate(() => !document.querySelector('.wl-mark.spin')), 20000);
  await wait(600);
};

export async function click(p, text, sel = 'button', pause = 700) {
  const ok = await p.evaluate(
    (t, s) => {
      const b = [...document.querySelectorAll(s)].find(e => e.textContent.includes(t));
      b?.click();
      return !!b;
    },
    text,
    sel,
  );
  if (!ok) console.log(`  (not found on ${p.label}: ${text} in ${sel})`);
  await wait(pause);
  return ok;
}
export const tab = (p, label) => click(p, label, '.tab');
export const has = (p, sel, t = '') => p.evaluate((s, t) => [...document.querySelectorAll(s)].some(e => e.textContent.includes(t)), sel, t);
export const text = (p, sel) => p.evaluate(s => document.querySelector(s)?.innerText ?? '', sel);

/** Scrolls the open page (or sheet) to the heading or element with this text. */
export async function scrollTo(p, t, sel = 'h3, .permh, .q, b') {
  const ok = await p.evaluate((t, sel) => {
    const el = [...document.querySelectorAll(sel)].find(x => x.textContent.includes(t) && x.offsetParent);
    el?.scrollIntoView({ block: 'start' });
    return !!el;
  }, t, sel);
  await wait(350);
  return ok;
}

/** Hides QR codes and blanks invite or recovery links before a screenshot. */
async function redactPage(p) {
  await p.evaluate(() => {
    for (const q of document.querySelectorAll('.qr, .modal.invite svg')) q.style.visibility = 'hidden';
    const bad = /#(join|restore)=/;
    for (const i of document.querySelectorAll('input, textarea')) if (bad.test(i.value)) i.value = '••••';
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (bad.test(n.nodeValue)) n.nodeValue = '••••';
  });
}

/** A screenshot of what the phone shows now, plus layout checks. */
export async function shot(p, file, { at, sel } = {}) {
  if (at) await scrollTo(p, at, sel);
  await redactPage(p);
  await wait(150);
  await p.screenshot({ path: `${SHOTS}/${file}.png` });
  const issues = await layoutIssues(p);
  for (const i of issues) note(`[${tag}] ${file}: ${i}`);
  return issues;
}

/** Text cut off, sticking out of the screen, horizontal scroll, Latin words on screen. */
export function layoutIssues(p) {
  return p.evaluate(() => {
    const out = [];
    const vw = innerWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push('page scrolls sideways: ' + document.documentElement.scrollWidth);
    const vis = e => {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && r.bottom > 0 && r.top < innerHeight;
    };
    const inScroller = e => {
      for (let a = e.parentElement; a; a = a.parentElement) {
        const st = getComputedStyle(a);
        if ((st.overflowX === 'auto' || st.overflowX === 'scroll') && a.scrollWidth > a.clientWidth + 1) return true;
      }
      return false;
    };
    const label = e => (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').join('.') : e.tagName.toLowerCase()) + ' «' + (e.innerText || e.value || '').replace(/\s+/g, ' ').slice(0, 60) + '»';
    for (const e of document.querySelectorAll('body *')) {
      if (!vis(e) || e.closest('canvas, svg')) continue;
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      // sticks out of the screen sideways (not inside a sideways scroller)
      if ((r.right > vw + 2 || r.left < -2) && !inScroller(e) && e.children.length === 0 && (e.innerText || '').trim()) out.push('off-screen ' + Math.round(r.left) + '..' + Math.round(r.right) + ' ' + label(e));
      // text clipped by its own box without an ellipsis
      if (e.children.length === 0 && (e.innerText || '').trim() && (st.overflow === 'hidden' || st.overflowX === 'hidden' || st.overflow === 'clip') && st.textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 2) out.push('clipped ' + label(e));
    }
    // Latin words on screen (English leaking into the Arabic UI)
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const latin = new Set();
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement;
      if (!el || !vis(el) || el.closest('pre, .mono, [dir=ltr], style, script')) continue;
      for (const m of n.nodeValue.match(/[A-Za-z][A-Za-z ]{1,}/g) ?? []) latin.add(m.trim());
    }
    const ok = new Set(['Face ID', 'Chrome', 'Android', 'Safari', 'iPhone', 'Brave', 'Mac', 'Linux', 'Windows', 'Mohammed', 'Chrome · Android', 'ID']);
    const left = [...latin].filter(x => x && !ok.has(x));
    if (left.length) out.push('latin text: ' + left.join(' | '));
    return [...new Set(out)].slice(0, 12);
  });
}

/** Time from a tap until `ready` holds (ms). */
export async function timed(p, act, ready, ms = 20000) {
  const t0 = Date.now();
  await act();
  await until(() => p.evaluate(ready), ms, 50);
  return Date.now() - t0;
}

/** Frames while dragging the canvas: average and worst gaps (ms). */
export async function dragFrames(p, sel = 'canvas') {
  await p.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = t => {
      window.__frames.push(t - last);
      last = t;
      if (window.__frames.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const box = await p.evaluate(s => {
    const c = [...document.querySelectorAll(s)].find(x => x.offsetParent);
    const r = c?.getBoundingClientRect();
    return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  if (box) {
    await p.mouse.move(box.x, box.y);
    await p.mouse.down();
    for (let i = 0; i < 40; i++) {
      await p.mouse.move(box.x + Math.sin(i / 5) * 120, box.y + Math.cos(i / 7) * 80);
      await wait(16);
    }
    await p.mouse.up();
  }
  await wait(1500);
  return p.evaluate(() => {
    const f = window.__frames.slice(2);
    const avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
    const worst = Math.max(...f);
    const long = f.filter(x => x > 50).length;
    return { n: f.length, avg: Math.round(avg * 10) / 10, worst: Math.round(worst), long };
  });
}

/** Picks a search result (the first not in `skip`, or the one whose text includes `row`). */
export async function pickRow(p, q, { row, skip = [] } = {}) {
  await until(() => p.evaluate(() => !!document.querySelector('.sfield input')), 5000);
  await p.type('.sfield input', q, { delay: 10 });
  await wait(700);
  const who = await p.evaluate((row, sk) => {
    const r = [...document.querySelectorAll('.results .prow')].find(e => (!row || e.innerText.includes(row)) && !sk.includes(e.querySelector('b')?.innerText.trim()));
    r?.click();
    return r?.querySelector('b')?.innerText.trim() ?? null;
  }, row, skip);
  await wait(1300);
  return who;
}

/** The link on the open invite sheet, through its own copy button; closes the sheet. */
export async function copyLink(p) {
  await until(() => p.evaluate(() => !!document.querySelector('.modal.invite')));
  await p.evaluate(() => { window.__copied = null; });
  await click(p, 'نسخ الرابط', '.modal.invite button');
  const link = await p.evaluate(() => window.__copied);
  await click(p, 'إغلاق', '.mhead button');
  return link;
}

export async function closeProfile(p) {
  for (let i = 0; i < 4; i++) {
    const open = await p.evaluate(() => {
      const b = document.querySelector('.page.profile .navbtns .round');
      b?.click();
      return !!b;
    });
    if (!open) break;
    await wait(400);
  }
}

/** Opens a person's profile through search; `row` picks the result whose text includes it. */
export async function openProfile(p, q, row) {
  await closeProfile(p);
  await tab(p, 'الشجرة');
  await p.evaluate(() => document.querySelector('.home .search')?.click());
  await wait(500);
  const who = await pickRow(p, q, { row });
  if (!who) return false;
  await click(p, 'الملف الكامل', '.sheet button', 1000);
  return p.evaluate(() => !!document.querySelector('.page.profile'));
}

/** Types into the first input matching `sel`, replacing what is there. */
export async function typeIn(p, sel, t) {
  const found = await p.evaluate(s => {
    const i = [...document.querySelectorAll(s)].find(x => x.offsetParent);
    if (i) { i.focus(); i.select(); }
    return !!i;
  }, sel);
  if (!found) return false;
  await p.keyboard.press('Backspace');
  await p.keyboard.type(t, { delay: 8 });
  await wait(250);
  return true;
}

export async function typeYear(p, label, t) {
  const found = await p.evaluate(l => {
    const f = [...document.querySelectorAll('.addsheet .fld')].find(x => x.querySelector('small').textContent.includes(l));
    const i = f?.querySelector('input');
    if (i) { i.focus(); i.select(); }
    return !!i;
  }, label);
  if (!found) return false;
  await p.keyboard.press('Backspace');
  await p.keyboard.type(t, { delay: 8 });
  await wait(250);
  return true;
}

export async function finish() {
  check(errs.length === 0, 'no page or console errors', errs.join('\n  '));
  await browser.close();
  console.log(`NOTES ${notes.length}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
}

export async function run(fn) {
  try {
    await fn();
  } catch (e) {
    check(false, 'script ran to the end', String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '));
  }
  await finish();
}
