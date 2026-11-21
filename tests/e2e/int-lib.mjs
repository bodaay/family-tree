// Shared helpers for the int-*.mjs scripts (the integration branch). Every script:
//   node int-<name>.mjs <BASE url> <admin-link file>
// Prints PASS/FAIL lines and exits non-zero on any failure, page error or
// console error. Links and keys are used, never printed.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [BASE_ARG, LINKFILE] = process.argv.slice(2);
if (!BASE_ARG || !LINKFILE) {
  console.log('usage: node <script> <BASE url> <admin-link file>');
  process.exit(2);
}
export const base = BASE_ARG.replace(/\/+$/, '');
const raw = fs.readFileSync(LINKFILE, 'utf8').split('\n').find(l => /^https?:\/\//.test(l.trim()) && l.includes('#join='));
if (!raw) {
  console.log('FAIL no admin link in the given file');
  process.exit(2);
}
export const adminLink = base + raw.trim().slice(raw.trim().indexOf('/#join='));
export const fid = adminLink.match(/join=([a-z0-9]+)\./)[1];

export const wait = ms => new Promise(r => setTimeout(r, ms));
export const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const errs = [];
let failed = 0;

export function check(ok, what, detail = '') {
  console.log((ok ? 'PASS ' : 'FAIL ') + what + (detail && !ok ? ' (' + detail + ')' : ''));
  if (!ok) failed++;
  return ok;
}

export async function until(fn, ms = 15000, step = 400) {
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

/** A phone: its own browser context (storage, device key). */
export async function phone(name, link) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errs.push(name + ': ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' <- ')));
  page.on('console', m => {
    if (m.type() === 'error') errs.push(name + ': ' + m.text());
  });
  page.on('dialog', d => d.accept());
  await page.goto(link, { waitUntil: 'networkidle0' });
  await wait(1800);
  return page;
}

/** Clicks the first element under `sel` whose text includes `text`. */
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
  if (!ok) console.log('  (not found: ' + text + ')');
  await wait(pause);
  return ok;
}

export const tab = (p, label) => click(p, label, '.tab');

/** Types into the open search and clicks the first result whose text includes `has` (or the first one). */
export async function pick(p, q, has = '') {
  await p.type('.sfield input', q, { delay: 10 });
  await wait(600);
  const who = await p.evaluate(y => {
    const r = [...document.querySelectorAll('.results .prow')].find(e => !y || e.innerText.includes(y));
    r?.click();
    return r ? r.querySelector('b').innerText.split('\n')[0].trim() : null;
  }, has);
  await wait(1500);
  return who;
}

/** The personal link of the invite this phone made last, built from its storage. */
export const lastLink = p =>
  p.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('ft-family'));
    const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid));
    return `${location.origin}/#join=${m.fid}.${m.key}.i${Object.values(inv).pop()}`;
  });

/** The family's people count on the home screen. */
export const people = p => p.evaluate(() => Number((document.querySelector('.top .sub b')?.innerText ?? '').replace(/[^\d]/g, '')));

/** A phone whose access ended: the screen says so and the family key is gone. */
export const ended = p => p.evaluate(() => !!document.querySelector('.join h2')?.innerText.includes('انتهى دخولك') && !localStorage.getItem('ft-family'));

/** The log as the server stores it. */
export const serverLog = async () => (await (await fetch(`${base}/api/f/${fid}/log?after=-1`)).json()).entries;
export const keyVersions = async () => new Set((await serverLog()).map(e => e.kid)).size;

export async function finish() {
  check(errs.length === 0, 'no page or console errors', errs.join('\n  '));
  await browser.close();
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
