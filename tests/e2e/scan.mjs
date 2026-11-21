// Joining by scanning a QR code inside the app (an iPhone home-screen app never
// receives tapped links), and the iPhone note that offers to carry an invite
// into the installed app before accepting it in Safari. The camera is faked: a
// canvas that shows a QR code. Needs a fresh local family.
//   node scan.mjs BASE admin-link-file [screenshots-dir]
// Never prints links or keys: they stay inside the browser pages.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE = process.argv[2].replace(/\/+$/, '');
const raw = fs.readFileSync(process.argv[3], 'utf8').split('\n').find(l => l.includes('/#join=')).trim();
const adminLink = BASE + raw.slice(raw.indexOf('/#join='));
const out = process.argv[4];
if (out) fs.mkdirSync(out, { recursive: true });
const { renderSVG } = await import('uqr');
const qr = text => 'data:image/svg+xml;base64,' + Buffer.from(renderSVG(text, { border: 2 })).toString('base64');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
let failed = 0;
const errs = [];
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = (p, name) => out && p.screenshot({ path: `${out}/${name}.png` });
const store = (p, fn, arg) => p.evaluate((src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts') ?? '/src/data/store.ts').then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), fn.toString(), arg);

/** A phone: its own storage. `opts.camera` fakes the camera; `opts.ua` and `opts.installed` pretend to be an iPhone, or the app on its home screen. */
async function phone(name, opts = {}) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE, ['clipboard-read', 'clipboard-sanitized-write']);
  const p = await ctx.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (opts.ua) await p.setUserAgent(opts.ua);
  p.on('pageerror', e => errs.push(name + ': ' + e.message));
  p.on('dialog', d => d.accept());
  await p.evaluateOnNewDocument(installed => {
    if (installed) Object.defineProperty(navigator, 'standalone', { get: () => true });
    // the fake camera shows whatever window.__cam says: a QR image, or 'deny'
    navigator.mediaDevices.getUserMedia = async () => {
      if (window.__cam === 'deny') throw new DOMException('denied', 'NotAllowedError');
      const c = document.createElement('canvas');
      c.width = 640; c.height = 480;
      const g = c.getContext('2d');
      const img = new Image();
      img.src = window.__cam;
      await img.decode();
      const draw = () => { g.fillStyle = '#fff'; g.fillRect(0, 0, 640, 480); g.drawImage(img, 170, 90, 300, 300); };
      draw();
      setInterval(draw, 100);
      window.__stream = c.captureStream(10);
      return window.__stream;
    };
  }, !!opts.installed);
  return p;
}
const click = async (p, text, sel = 'button') => {
  const ok = await p.evaluate((t, s) => { const b = [...document.querySelectorAll(s)].find(e => e.textContent.includes(t)); b?.click(); return !!b; }, text, sel);
  if (!ok) check(false, 'button found: ' + text);
  await wait(500);
};
const scanning = p => p.evaluate(() => ({ open: !!document.querySelector('.overlay.scan'), msg: document.querySelector('.scan .scanmsg')?.textContent ?? '', live: window.__stream?.getTracks()[0]?.readyState ?? null }));

try {
  // ---- a new phone with nothing on it
  const P = await phone('P');
  await P.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await wait(1500);
  check(await P.evaluate(() => [...document.querySelectorAll('.join button')].some(b => b.textContent.includes('مسح رمز الدعوة'))), 'the welcome screen offers «مسح رمز الدعوة»');
  await shot(P, 'welcome');

  // a code that is not an invite
  await P.evaluate(src => (window.__cam = src), qr('https://example.com/hello'));
  await click(P, 'مسح رمز الدعوة'); await wait(2500);
  let st = await scanning(P);
  check(st.open && st.msg.includes('ليس دعوة') && st.live === 'live', 'another QR code: the camera stays on and says it is not an invite');
  await shot(P, 'scan-other');
  await click(P, '', '.scan .scantop button'); await wait(300);
  st = await scanning(P);
  check(!st.open && st.live === 'ended', 'closing the scanner turns the camera off');

  // the camera not allowed
  await P.evaluate(() => (window.__cam = 'deny'));
  await click(P, 'مسح رمز الدعوة'); await wait(1200);
  st = await scanning(P);
  check(st.open && st.msg.includes('لم يُسمح باستخدام الكاميرا'), 'camera refused: says how to allow it, or to paste the link');
  await click(P, '', '.scan .scantop button');

  // the root admin's code: this phone becomes the root admin
  await P.evaluate(src => (window.__cam = src), qr(adminLink));
  await click(P, 'مسح رمز الدعوة'); await wait(6000);
  st = await scanning(P);
  const admin = await store(P, m => ({ admin: m.getState().rootAdmin, people: m.getState().graph.nodes.size }));
  check(!st.open && st.live === 'ended' && admin.admin && admin.people > 100, 'scanning the admin code opens the family as root admin, camera off · ' + JSON.stringify({ admin: admin.admin, people: admin.people }));

  // ---- a personal invite opened in Safari on an iPhone
  await store(P, m => m.createInvite('p131')); await wait(2500);
  const link = await store(P, m => { const s = m.getState(); const k = s.inviteOpen; const sk = JSON.parse(localStorage.getItem('ft-invites:' + m.currentMembership().fid) ?? '{}')[k]; return sk ? m.inviteLinkFor(sk) : null; });
  check(!!link, 'the root admin made a personal invite');
  const I = await phone('I', { ua: IPHONE });
  await I.goto(link, { waitUntil: 'domcontentloaded' }); await wait(3500);
  const note = await I.evaluate(() => { const c = document.querySelector('.join .card.iosfirst'); return c ? c.innerText.replace(/\s+/g, ' ') : null; });
  check(!!note && note.includes('إضافة إلى الشاشة الرئيسية'), 'iPhone Safari: the invite offers to go into the installed app first');
  await shot(I, 'ios-invite');
  // a real tap on a focused page, as the clipboard requires
  await I.bringToFront();
  await I.click('.join .card.iosfirst .btn'); await wait(500);
  const said = (await store(I, m => m.getState().toast)) ?? '';
  const copied = await I.evaluate(() => navigator.clipboard.readText().then(t => t.includes('#join=') && t.includes('.i')));
  check(said.includes('نُسخ'), 'it says the link was copied · ' + said);
  check(copied, 'the invite link is copied (whole, with the invite key)');
  // not on other phones
  const A = await phone('A');
  await A.goto(link, { waitUntil: 'domcontentloaded' }); await wait(3500);
  check(await A.evaluate(() => !!document.querySelector('.join h2') && !document.querySelector('.join .card.iosfirst')), 'not an iPhone: no such note');

  // ---- the installed app: paste the copied link, accept there
  const H = await phone('H', { ua: IPHONE, installed: true });
  await H.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await wait(1500);
  check(await H.evaluate(() => document.querySelector('.join p')?.textContent.includes('تُفتح في المتصفح لا في التطبيق')), 'installed app: says links open in the browser, so paste or scan');
  await shot(H, 'installed-welcome');
  await I.bringToFront();
  const copiedText = await I.evaluate(() => navigator.clipboard.readText());
  await H.bringToFront();
  await H.evaluate(t => { const i = document.querySelector('.join input.bigin'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); }, copiedText);
  await click(H, 'انضمام'); await wait(3500);
  const claim = await H.evaluate(() => ({ h2: document.querySelector('.join h2')?.textContent, note: !!document.querySelector('.join .card.iosfirst') }));
  check(claim.h2 === 'دعوة شخصية' && !claim.note, 'the installed app shows the invite, without the Safari note');
  await H.evaluate(() => [...document.querySelectorAll('.join button')].find(b => b.textContent.startsWith('نعم'))?.click()); await wait(3500);
  const me = await store(H, m => m.getState().me);
  check(me === 'p131', 'accepted in the installed app: it is his phone');
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
} catch (e) {
  check(false, 'script error: ' + String(e?.stack ?? e).replace(/#join=[^\s'"]*/g, '#join=<hidden>'));
}
await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
