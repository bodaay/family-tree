// Shared helpers for the lock-*.mjs scripts (not a test itself): phones as
// separate browser contexts, an optional virtual authenticator (Face ID),
// PASS/FAIL reporting. Every script: node lock-<name>.mjs <BASE url> <admin-link file>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

export const BASE = (process.argv[2] ?? 'http://localhost:5182').replace(/\/+$/, '');
const linkFile = process.argv[3];
if (!linkFile) {
  console.log('usage: node <script> <BASE url> <admin-link file>');
  process.exit(2);
}
// the admin link is a secret: it is used, never printed
const raw = fs.readFileSync(linkFile, 'utf8').split('\n').find(l => /^https?:\/\/localhost[:/]/.test(l) && l.includes('#join='));
if (!raw) {
  console.log('FAIL no admin link in the given file');
  process.exit(2);
}
export const adminLink = BASE + raw.slice(raw.indexOf('/#join='));

export const wait = ms => new Promise(r => setTimeout(r, ms));
export const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const errs = [];
let failed = 0;

export function check(ok, what, detail = '') {
  console.log((ok ? 'PASS ' : 'FAIL ') + what + (detail && !ok ? ' (' + detail + ')' : ''));
  if (!ok) failed++;
  return ok;
}

/** A phone: its own browser context; `auth` adds a platform authenticator with Face ID (and PRF unless prf: false). */
export async function phone(name, link, auth = null) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errs.push(name + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(name + ': ' + m.text()); });
  page.on('dialog', d => d.accept());
  // copying and sharing: keep what the app hands over, so the script can use it
  await page.evaluateOnNewDocument(() => {
    window.__copied = null;
    window.__shared = null;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied = t; } }, configurable: true });
    navigator.canShare = () => true;
    navigator.share = async d => { window.__shared = d.files?.[0] ? { name: d.files[0].name, type: d.files[0].type, size: d.files[0].size } : d; };
  });
  if (auth?.late) {
    // a passkey that gives its PRF secret only when used, on a phone that allows one prompt per tap
    await page.evaluateOnNewDocument(() => {
      let gets = 0;
      const secret = new Uint8Array(32).fill(7).buffer;
      navigator.credentials.create = async () => ({ rawId: new Uint8Array([9, 8, 7, 6]).buffer, getClientExtensionResults: () => ({ prf: { enabled: true } }) });
      navigator.credentials.get = async () => {
        if (gets++ === 0) throw new DOMException('needs a fresh tap', 'NotAllowedError');
        return { getClientExtensionResults: () => ({ prf: { results: { first: secret } } }) };
      };
    });
  } else if (auth) {
    const cdp = await page.createCDPSession();
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
        isUserVerified: true, hasPrf: auth.prf !== false, automaticPresenceSimulation: true,
      },
    });
    page.cdp = cdp;
    page.authenticatorId = authenticatorId;
  }
  if (link) {
    await page.goto(link, { waitUntil: 'networkidle0' });
    await wait(1500);
  }
  return page;
}

export const click = async (p, text, sel = 'button') => {
  const ok = await p.evaluate((t, s) => {
    const b = [...document.querySelectorAll(s)].find(e => e.textContent.includes(t));
    b?.click();
    return !!b;
  }, text, sel);
  if (!ok) console.log('  (not found: ' + text + ')');
  await wait(700);
  return ok;
};
export const pick = async (p, q, year) => {
  await p.type('.sfield input', q, { delay: 10 });
  await wait(500);
  await p.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => !y || e.innerText.includes(y)).click(), year);
  await wait(1500);
};
export const text = (p, sel) => p.evaluate(s => document.querySelector(s)?.innerText ?? '', sel);
/** Who this phone is, as أنا shows it: the name and the start of the nasab. */
export const meName = p => p.evaluate(() => document.querySelector(':is(.page.me, .page.admin) .card .prow b')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
/** The members list rows (root admin) for exactly this person, as text. */
export const memberRows = (p, who) => p.evaluate(n => [...document.querySelectorAll(':is(.page.me, .page.admin) .prow')]
  .filter(e => e.querySelector('.pt b')?.innerText.replace(/\s+/g, ' ').trim() === n)
  .map(e => e.innerText.replace(/\s+/g, ' ')), who);
export const openMe = async p => { await click(p, 'أنا', '.tab'); await wait(300); };
export const openAdmin = async p => { const t = await p.evaluate(() => [...document.querySelectorAll('.tab')].some(e => e.textContent.includes('الإدارة'))); await click(p, t ? 'الإدارة' : 'أنا', '.tab'); await wait(300); };
/** The newest saved invite as a link (only while this phone's storage is not locked). */
export const lastInvite = p => p.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('ft-family'));
  const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid));
  return `${location.origin}/#join=${m.fid}.${m.key}.i${Object.values(inv).pop()}`;
});
/** Every value in this phone's storage, joined: to look for secrets in plain text. */
export const storageDump = p => p.evaluate(() => Object.keys(localStorage).map(k => k + '=' + localStorage.getItem(k)).join('\n'));

/** Runs the test body, then reports; any thrown error is a failure. */
export async function run(body) {
  try {
    await body();
  } catch (e) {
    check(false, 'script ran to the end', (e?.message ?? String(e)).replace(/#(join|restore)=\S+/g, '#$1=…'));
  }
  check(errs.length === 0, 'no page or console errors', errs.join(' | '));
  await browser.close().catch(() => {});
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
}
