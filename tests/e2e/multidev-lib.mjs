// Shared helpers for the multidev-*.mjs scripts (feat/multidevice): several
// phones as browser contexts, the members' «أجهزتي» section, and entries forged
// outside the app with the worktree's own log code. Every script:
//   node multidev-<name>.mjs <BASE url> <admin-link file>
// Prints PASS/FAIL lines and exits non-zero on any failure, page error or
// console error. Links and keys are used, never printed.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [BASE_ARG, LINKFILE] = process.argv.slice(2);
if (!BASE_ARG || !LINKFILE) {
  console.log('usage: node <script> <BASE url> <admin-link file>');
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
// the worktree whose app is under test: its log code builds the forged entries
const repo = process.env.FT_REPO ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const K$ = await import(path.join(repo, 'src/core/keyring.ts'));
export const L$ = await import(path.join(repo, 'src/core/log.ts'));
export const C$ = await import(path.join(repo, 'src/core/crypto.ts'));
export const D$ = await import(path.join(repo, 'src/data/devices.ts'));

export const wait = ms => new Promise(r => setTimeout(r, ms));
export const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const errs = [];
let failed = 0;
/** Every dialog the app asked, newest last (all are accepted). */
export const dialogs = [];

export function check(ok, what, detail = '') {
  console.log((ok ? 'PASS ' : 'FAIL ') + what + (detail && !ok ? ' (' + String(detail).replace(/#(join|restore)=\S+/g, '#$1=…') + ')' : ''));
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

/** A phone: its own browser context (storage, device key). Copy and share hand over what the app gives. */
export async function phone(name, link) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errs.push(name + ': ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' <- ')));
  page.on('console', m => {
    if (m.type() === 'error') errs.push(name + ': ' + m.text());
  });
  page.on('dialog', d => {
    dialogs.push(d.message());
    d.accept();
  });
  await page.evaluateOnNewDocument(() => {
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied = t; } }, configurable: true });
  });
  if (link) {
    await page.goto(link, { waitUntil: 'networkidle0' });
    await settle(page);
  }
  page.label = name;
  return page;
}
/** Closes a phone's app (its storage stays), to open it again later with reopen(). */
export async function closeApp(p) {
  const ctx = p.browserContext();
  await p.close();
  return ctx;
}
/** Opens the app again on a phone whose app was closed: what it does on its own when it opens. */
export async function reopen(ctx, name) {
  const page = await ctx.newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errs.push(name + ': ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errs.push(name + ': ' + m.text());
  });
  page.on('dialog', d => {
    dialogs.push(d.message());
    d.accept();
  });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await until(() => page.evaluate(() => !!document.querySelector('.tabs') || !!document.querySelector('.join h2')), 30000);
  await settle(page);
  return page;
}
/** Who this phone is, as أنا shows it. */
export const meName = async p => {
  await tab(p, 'أنا');
  return p.evaluate(() => document.querySelector(':is(.page.me, .page.admin) .card .prow b')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
};
/** This phone's person id (its saved preferences). */
export const meId = p => p.evaluate(f => JSON.parse(localStorage.getItem('ft-prefs:' + f) ?? '{}').me ?? null, fid);
/** The root admin opens someone's profile from the members list (tapping their name). */
export async function openProfile(A, who) {
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  const ok = await A.evaluate(n => {
    const b = [...document.querySelectorAll(':is(.page.me, .page.admin) .prow')].find(e => e.querySelector('.pt b')?.innerText.replace(/\s+/g, ' ').trim() === n)?.querySelector('button.pt');
    b?.click();
    return !!b;
  }, who);
  await wait(1200);
  return ok;
}
/** The open profile's «الصلاحيات»: the phone status and the rows of its devices card. */
export const perm = p => p.evaluate(() => {
  const sec = document.querySelector('.page.profile section.perms');
  if (!sec) return null;
  const phoneRow = [...sec.querySelectorAll('.permstat .srow')].find(r => r.querySelector('span')?.firstChild?.textContent.trim() === 'الهاتف');
  return { phone: phoneRow?.querySelector('b')?.innerText.trim() ?? null, rows: [...sec.querySelectorAll('.permphone .prow')].map(r => r.innerText.replace(/\s+/g, ' ').trim()) };
});
/** Taps a button in the open profile's devices card, in the row whose text includes `row`. */
export const permButton = (p, row, label, nth = 0) => p.evaluate((row, label, nth) => {
  const r = [...document.querySelectorAll('.page.profile section.perms .permphone .prow')].filter(e => e.innerText.includes(row))[nth];
  const b = r && (r.tagName === 'BUTTON' && !label ? r : [...r.querySelectorAll('button')].find(x => x.textContent.includes(label) || x.getAttribute('aria-label') === label));
  b?.click();
  return !!b;
}, row, label, nth);
export const settle = async p => {
  await until(() => p.evaluate(() => !document.querySelector('.wl-mark.spin')));
  await wait(700);
};

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
export const ready = p => p.evaluate(() => !!document.querySelector('nav.tabs') && !document.querySelector('.join'));
export const ended = p => p.evaluate(() => !!document.querySelector('.join h2')?.innerText.includes('انتهى دخولك') && !localStorage.getItem('ft-family'));
/** The family's people count on the tree tab. */
export const people = async p => {
  if (!(await p.evaluate(() => !!document.querySelector('.top .sub b')))) await tab(p, 'الشجرة');
  return Number(((await p.evaluate(() => document.querySelector('.top .sub b')?.innerText)) ?? '').replace(/[^\d]/g, ''));
};
export const text = (p, sel) => p.evaluate(s => document.querySelector(s)?.innerText ?? '', sel);
export const store = (p, k) => p.evaluate(k => JSON.parse(localStorage.getItem(k) ?? 'null'), k);

export const fetchLog = async () => (await (await fetch(`${base}/api/f/${fid}/log?after=-1`)).json()).entries;
export const keyVersions = async () => new Set((await fetchLog()).map(e => e.kid)).size;

/** Picks a search result whose name is not in `skip`; returns the name line. */
export async function pickRow(p, q, skip = []) {
  await p.type('.sfield input', q, { delay: 10 });
  await wait(600);
  const who = await p.evaluate(sk => {
    const r = [...document.querySelectorAll('.results .prow')].find(e => !sk.includes(e.querySelector('b').innerText.trim()));
    r?.click();
    return r?.querySelector('b').innerText.trim();
  }, skip);
  await wait(1500);
  return who;
}

/** The link on the open invite sheet, through its own copy button; closes the sheet. */
export async function copyLink(p) {
  await until(() => p.evaluate(() => !!document.querySelector('.modal.invite')));
  await p.evaluate(() => { window.__copied = null; });
  await click(p, 'نسخ الرابط');
  const link = await p.evaluate(() => window.__copied);
  await click(p, 'إغلاق', '.mhead button');
  return link;
}

/** The root admin invites someone from the members screen. */
export async function invite(A, q, skip) {
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  const who = await pickRow(A, q, skip);
  return { who, link: await copyLink(A) };
}

/** A phone opens an invite and says «نعم، أنا». */
export async function join(name, link) {
  const p = await phone(name, link);
  await click(p, 'نعم، أنا');
  await until(() => ready(p));
  await settle(p);
  return p;
}

export async function addChild(p, name, direct) {
  await tab(p, 'الشجرة');
  await p.evaluate(() => document.querySelector('.fab').click());
  await wait(600);
  await click(p, 'ابن', '.bigchoice button');
  await click(p, 'التالي');
  await p.type('.bigin', name, { delay: 10 });
  await click(p, 'التالي');
  await maybe(p, 'متابعة', '.modal button');
  await click(p, 'التالي');
  await click(p, direct ? 'إضافة إلى الشجرة' : 'إرسال للاعتماد');
  await maybe(p, 'متابعة', '.modal button');
  await wait(1500);
}
/** Clicks it if it is there (a duplicate-name question, say). */
const maybe = async (p, t, s) => {
  if (await p.evaluate((t, s) => [...document.querySelectorAll(s)].some(e => e.textContent.includes(t)), t, s)) await click(p, t, s);
};
/** Whether a request with this text is listed on the requests tab. */
export async function hasRequest(p, t) {
  await tab(p, 'الطلبات');
  return p.evaluate(t => document.body.innerText.includes(t), t);
}
/** Names unique to this run (letters only: a name with digits is refused). */
const LETTERS = 'ابتثجحخدذر';
let n = 0;
export const fresh = (prefix = 'تجربة') => prefix + String(Date.now() + n++).slice(-5).split('').map(d => LETTERS[+d]).join('');

/** أنا → أجهزتي, as rows: {name, here, small, buttons}. */
export async function myDevices(p) {
  await tab(p, 'أنا');
  return p.evaluate(() =>
    [...document.querySelectorAll('.mydevs .devlist .prow')].map(r => ({
      name: (r.querySelector('.pt b')?.childNodes[0]?.textContent ?? '').trim(),
      here: !!r.querySelector('.tag.here'),
      small: r.querySelector('.pt small')?.innerText.trim() ?? '',
      buttons: [...r.querySelectorAll('button')].map(b => b.textContent.trim() || b.getAttribute('aria-label')),
    })),
  );
}

/** Taps a button in the «أجهزتي» row whose text includes `row`. */
export async function deviceButton(p, row, label) {
  await tab(p, 'أنا');
  const ok = await p.evaluate(
    (row, label) => {
      const r = [...document.querySelectorAll('.mydevs .devlist .prow')].find(e => e.innerText.includes(row));
      const b = r && [...r.querySelectorAll('button')].find(x => x.textContent.includes(label) || x.getAttribute('aria-label') === label);
      b?.click();
      return !!b;
    },
    row,
    label,
  );
  await wait(900);
  return ok;
}

/** «إضافة جهاز» on أنا → أجهزتي: the link of the device invite it shows. */
export async function addDeviceLink(p) {
  await tab(p, 'أنا');
  await click(p, 'إضافة جهاز', '.mydevs .card.cta');
  return copyLink(p);
}

/** This phone's device key and membership (secrets stay in the script). */
export const keysOf = async p => ({ m: await store(p, 'ft-family'), d: await store(p, 'ft-device') });

/**
 * Writes an entry outside the app, signed with `signer` ({sk, pk}) and sealed
 * with the family's current key, which `m` (a membership) and `secrets` must
 * reach. Returns the server's status.
 */
export async function forge(m, signer, secrets, payload) {
  const log = await fetchLog();
  const ring = new Map();
  K$.addKeys(ring, [m.key, ...Object.values(m.keys ?? {})]);
  K$.openLog(log, [], ring, secrets);
  const key = ring.get(log.at(-1).kid);
  if (!key) return 0;
  const e = L$.makeEntry(key, signer, log.length, L$.entryHash(log.at(-1)), payload);
  const r = await fetch(`${base}/api/f/${fid}/log/${e.n}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) });
  return r.status;
}

/** Whether keys a phone held (membership and device secret) open any entry after position `from`. */
export async function opensAfter(m, secrets, from) {
  const log = await fetchLog();
  const ring = new Map();
  K$.addKeys(ring, [m.key, ...Object.values(m.keys ?? {})]);
  const opened = [];
  K$.openLog(log, opened, ring, secrets);
  let direct = 0;
  for (const e of log.slice(from + 1)) {
    for (const k of ring.values()) {
      try {
        L$.openEntry(k, e);
        direct++;
        break;
      } catch {
        /* sealed */
      }
    }
  }
  return { later: log.length - from - 1, opened: opened.slice(from + 1).filter(Boolean).length, direct };
}

/** The root admin's phone: linked to his place in the tree (the eldest «منصور»). */
export async function rootAdmin(name = 'A') {
  const A = await phone(name, adminLink);
  await click(A, 'اربط باسمي');
  await pickRow(A, 'منصور');
  await settle(A);
  return A;
}

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
