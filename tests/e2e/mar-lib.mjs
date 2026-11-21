// Shared helpers for the marriage e2e scripts. Never prints links or keys.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

export const wait = ms => new Promise(r => setTimeout(r, ms));

export function setup() {
  const [BASE, linkFile, shots] = process.argv.slice(2);
  if (!BASE || !linkFile) {
    console.log('usage: node <script> BASE admin-link-file [screenshots-dir]');
    process.exit(2);
  }
  const base = BASE.replace(/\/+$/, '');
  const raw = fs.readFileSync(linkFile, 'utf8').split('\n').find(l => /^https?:\/\//.test(l.trim()) && l.includes('#join=')) ?? '';
  if (!raw) {
    console.log('FAIL no admin link in the link file');
    process.exit(1);
  }
  const adminLink = base + raw.trim().slice(raw.trim().indexOf('/#join='));
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let failed = 0;
  const errs = [];
  const ok = (cond, what) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + what);
    if (!cond) failed++;
    return cond;
  };
  let browser;
  const launch = async () => {
    browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
    return browser;
  };
  /** A separate phone: its own browser context (storage, device key). */
  const phone = async (name, link) => {
    const page = await (await browser.createBrowserContext()).newPage();
    await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    page.on('pageerror', e => errs.push(name + ': ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 5).join(' <- ')));
    page.on('console', m => {
      if (m.type() === 'error') errs.push(name + ': ' + m.text());
    });
    page.on('dialog', d => d.accept());
    await page.goto(link, { waitUntil: 'networkidle0' });
    await wait(1800);
    return page;
  };
  /** A screenshot; `at` scrolls the open page to the heading with that text first. */
  const shot = async (p, file, at) => {
    if (!shots) return;
    if (at) {
      await p.evaluate(h => [...document.querySelectorAll('.page h3')].find(x => x.textContent.includes(h))?.scrollIntoView(), at);
      await wait(300);
    }
    await p.screenshot({ path: shots + '/' + file });
  };
  const finish = async () => {
    ok(errs.length === 0, 'no page or console errors' + (errs.length ? ':\n  ' + errs.join('\n  ') : ''));
    await browser?.close();
    console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
    process.exit(failed ? 1 : 0);
  };
  const crash = async e => {
    ok(false, 'script error: ' + (e?.stack ?? e));
    await browser?.close().catch(() => {});
    process.exit(1);
  };
  return { base, adminLink, ok, launch, phone, shot, finish, crash, errs };
}

/** Clicks the first element under `sel` whose text includes `text`. */
export async function click(p, text, sel = 'button', pause = 700) {
  const found = await p.evaluate(
    (t, s) => {
      const b = [...document.querySelectorAll(s)].find(e => e.textContent.includes(t));
      b?.click();
      return !!b;
    },
    text,
    sel,
  );
  await wait(pause);
  return found;
}

/** Types into the first input matching `sel`, replacing what is there. */
export async function typeIn(p, sel, text) {
  const found = await p.evaluate(s => {
    const i = document.querySelector(s);
    if (i) { i.focus(); i.select(); }
    return !!i;
  }, sel);
  if (!found) return false;
  await p.keyboard.press('Backspace');
  await p.keyboard.type(text, { delay: 8 });
  await wait(250);
  return true;
}

/** Types into the year field whose label includes `label` (marriage forms). */
export async function typeYear(p, label, text) {
  const found = await p.evaluate(l => {
    const f = [...document.querySelectorAll('.addsheet .fld')].find(x => x.querySelector('small').textContent.includes(l));
    const i = f?.querySelector('input');
    if (i) { i.focus(); i.select(); }
    return !!i;
  }, label);
  if (!found) return false;
  await p.keyboard.press('Backspace');
  await p.keyboard.type(text, { delay: 8 });
  await wait(250);
  return true;
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

/** Opens a person's profile through the search sheet: a name (and father's name), and text in the row such as the birth year. */
export async function openProfile(p, q, rowText) {
  await closeProfile(p);
  await click(p, 'الشجرة', '.tab', 500);
  await p.evaluate(() => (document.querySelector('.searchbar .search') ?? document.querySelector('.home .search'))?.click());
  await wait(400);
  await p.type('.sfield input', q, { delay: 8 });
  await wait(600);
  const found = await p.evaluate(y => {
    const r = [...document.querySelectorAll('.results .prow')].find(e => !y || e.innerText.includes(y));
    r?.click();
    return !!r;
  }, rowText);
  if (!found) return false;
  await wait(1200);
  await click(p, 'الملف الكامل', '.sheet button', 900);
  return p.evaluate(() => !!document.querySelector('.page.profile'));
}

/** The family cards on the open profile: spouse, marriage line, children. */
export function families(p) {
  return p.evaluate(() =>
    [...document.querySelectorAll('.page.profile .card.fam')]
      .filter(c => !(c.querySelector('.famh')?.textContent ?? '').includes('إخوت'))
      .map(c => ({
        spouse: c.querySelector('.prow .pt b')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
        head: c.querySelector('.famh')?.innerText ?? '',
        line: c.querySelector('.mline span')?.innerText ?? '',
        kids: [...c.querySelectorAll('.fp b')].map(b => b.innerText.trim()),
      })),
  );
}

export const history = p => p.evaluate(() => [...document.querySelectorAll('.page.profile .card.hist')].map(c => c.innerText.replace(/\s+/g, ' ')));

/** Opens the marriage editor from the family card whose spouse includes `who`. */
export async function editMarriageOf(p, who) {
  const found = await p.evaluate(w => {
    const c = [...document.querySelectorAll('.page.profile .card.fam')].find(x => (x.querySelector('.prow .pt b')?.textContent ?? '').includes(w));
    const b = c?.querySelector('.mline .link');
    b?.click();
    return !!b;
  }, who);
  await wait(600);
  return found && (await p.evaluate(() => !!document.querySelector('.addsheet')));
}

/** Root admin: removes every marriage on the open profile (to start clean when run again). */
export async function removeAllMarriages(p) {
  for (let i = 0; i < 8; i++) {
    const opened = await p.evaluate(() => {
      const b = document.querySelector('.page.profile .card.fam .mline .link');
      b?.click();
      return !!b;
    });
    if (!opened) return;
    await wait(600);
    await click(p, 'حذف الزواج', '.addsheet button', 1600);
  }
}

/** Adds a child through the open profile's "add" link; `other` picks the mother or father by name (or 'default'). */
export async function addChild(p, { other = 'default', sex, name, submit = 'إضافة إلى الشجرة' }) {
  await click(p, 'إضافة ابن أو ابنة', '.page.profile button.link');
  const steps = await p.evaluate(() => document.querySelector('.addsheet .ahead span')?.textContent ?? '');
  const hasOther = await p.evaluate(() => !!document.querySelector('.addsheet .card.list .brow'));
  let defaultPick = null;
  if (hasOther) {
    defaultPick = await p.evaluate(() => document.querySelector('.addsheet .card.list .brow.on .pt b')?.textContent ?? null);
    if (other !== 'default') await click(p, other, '.addsheet .card.list .brow', 300);
    await click(p, 'التالي', '.addsheet .foot button', 400);
  }
  await click(p, sex === 'f' ? 'ابنة' : 'ابن', '.addsheet .bigchoice button', 300);
  await click(p, 'التالي', '.addsheet .foot button', 400);
  const question = await p.evaluate(() => document.querySelector('.addsheet .q')?.textContent ?? '');
  await p.type('.addsheet input.bigin', name, { delay: 8 });
  await click(p, 'التالي', '.addsheet .foot button', 400);
  await click(p, 'التالي', '.addsheet .foot button', 400);
  const review = await p.evaluate(() => document.querySelector('.addsheet .card.review')?.innerText.replace(/\s+/g, ' ') ?? '');
  await click(p, submit, '.addsheet .foot button', 1800);
  return { steps, hasOther, defaultPick, question, review };
}
