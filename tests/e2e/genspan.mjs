// The generation rail in 3D: «وحده» / «وما بعده» (default) / «وما قبله».
//   node genspan.mjs BASE admin-link-file shots-dir
// Never prints links: the link file is read here and used only in the browser.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.argv[2].replace(/\/+$/, '');
const link = fs.readFileSync(process.argv[3], 'utf8').split('\n').find(l => l.startsWith('http://localhost'))?.trim().replace(/^http:\/\/localhost:\d+/, BASE);
const out = process.argv[4];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
let failed = 0;
const check = (ok, label, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ' · ' + extra : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const errs = [];
const page = await (await browser.createBrowserContext()).newPage();
page.on('pageerror', e => errs.push(e.message));
page.on('dialog', d => d.accept());
await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(link, { waitUntil: 'domcontentloaded' }); await wait(3500);
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('تصفّح أولًا'))?.click()); await wait(1500);
const stops = await page.evaluate(() => [...document.querySelectorAll('.gstop')].map(b => b.textContent.trim()));
check(stops.length >= 4, 'the rail shows generations', stops.join(','));
const tap = n => page.evaluate(n => [...document.querySelectorAll('.gstop')].find(b => b.textContent.trim() === n)?.click(), n);
const state = () => page.evaluate(() => ({
  on: [...document.querySelectorAll('.gstop.on')].map(b => b.textContent.trim()),
  in: [...document.querySelectorAll('.gstop.in')].map(b => b.textContent.trim()),
  seg: document.querySelector('.gflag .seg .on')?.textContent,
  info: document.querySelector('.gflag small')?.textContent,
  flag: (() => { const r = document.querySelector('.gflag')?.getBoundingClientRect(); return r ? [Math.round(r.top), Math.round(r.height), Math.round(r.width)] : null; })(),
  overflow: document.documentElement.scrollWidth > innerWidth,
}));
const pick = label => page.evaluate(l => [...document.querySelectorAll('.gflag .seg button')].find(b => b.textContent === l)?.click(), label);
await tap('4'); await wait(900);
let st = await state();
check(st.on.join() === '4' && st.seg === 'وما بعده', 'default: the chosen generation and those after it', JSON.stringify(st));
check(st.in.length > 0 && st.in.every(n => +n > 4), 'later generations marked on the rail', st.in.join(','));
check(!st.overflow, 'no sideways scroll at 360px');
if (out) await page.screenshot({ path: `${out}/down-dark.png` });
await pick('وحده'); await wait(900);
st = await state();
check(st.seg === 'وحده' && st.in.length === 0, '«وحده»: only this generation', JSON.stringify(st));
if (out) await page.screenshot({ path: `${out}/only-dark.png` });
await pick('وما قبله'); await wait(900);
st = await state();
check(st.seg === 'وما قبله' && st.in.every(n => +n < 4) && st.in.length > 0, '«وما قبله»: this generation and those before it', JSON.stringify(st));
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]); await wait(900);
if (out) await page.screenshot({ path: `${out}/up-light.png` });
// the choice is remembered on this device
await page.evaluate(() => [...document.querySelectorAll('.gflag .x')][0]?.click()); await wait(600);
await tap('3'); await wait(900);
st = await state();
check(st.seg === 'وما قبله', 'the last choice stays', st.seg);
await page.reload({ waitUntil: 'domcontentloaded' }); await wait(3500);
await tap('3'); await wait(900);
st = await state();
check(st.seg === 'وما قبله', 'and survives a reload', st.seg);
check(!errs.length, 'no page errors', errs.join(' | '));
await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
