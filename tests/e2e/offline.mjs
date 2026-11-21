// Opening with no connection (the built app, its own server): the first visit
// keeps the app's files (public/sw.js) and the family log as read, sealed
// (logcache.ts). With the site unreachable, the app still opens on the family as
// last read: the tree, profiles and search, marked «بلا اتصال», and nothing is
// written. When the site is back, it fetches only what is new and the mark goes.
// A family that leaves the phone takes its kept log with it, and a log kept for
// a family the phone no longer holds is dropped.
//   SERVER_DIR=<worktree> SERVER_DATA=<data dir> node offline.mjs BASE admin-link-file [shots-dir]
// (BASE is that worktree's own server, serving its build: this script stops and restarts it)
import { setup, click, wait } from './mar-lib.mjs';
import { spawn, execSync } from 'node:child_process';
const t = setup();
const { ok } = t;
const shots = process.argv[4];
const shot = async (p, name) => { if (shots) await p.screenshot({ path: shots + '/' + name + '.png' }); };
const port = process.env.STOP_PORT ?? new URL(process.argv[2]).port;
const until = async (fn, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(400)) if (await fn().catch(() => false)) return true;
  return false;
};
const stop = () => { try { execSync(`lsof -ti tcp:${port} -sTCP:LISTEN | xargs kill`); } catch { /* not running */ } };
let server = null;
const start = () => { server = spawn('node', ['server/index.ts'], { cwd: process.env.SERVER_DIR, env: { ...process.env, PORT: port, FT_DATA: process.env.SERVER_DATA }, stdio: 'ignore', detached: true }); server.unref(); };
const up = () => until(async () => (await fetch(`http://localhost:${port}/api/health`).catch(() => fetch(`http://localhost:${port}/`))).status < 500, 20000);
const idb = (p, fid) => p.evaluate(fid => new Promise(res => { const r = indexedDB.open('ft-log', 1); r.onupgradeneeded = () => r.result.createObjectStore('logs'); r.onsuccess = () => { const tx = r.result.transaction('logs', 'readonly'); const q = tx.objectStore('logs').getAllKeys(); q.onsuccess = async () => { const keys = q.result; const g = tx.objectStore('logs').get(fid); g.onsuccess = () => res({ keys, n: Array.isArray(g.result) ? g.result.length : 0 }); }; }; r.onerror = () => res(null); }), fid);
// how many search results carry a woman's name (the root admin sees every woman's details online)
const WOMAN = 'منيرة';
let womenShot = 0;
const women = async p => {
  await p.evaluate(() => document.querySelector('button.search')?.click()); await wait(500);
  await p.type('.sfield input', WOMAN, { delay: 8 }); await wait(700);
  const n = await p.evaluate(w => [...document.querySelectorAll('.results .prow')].filter(e => e.innerText.includes(w)).length, WOMAN);
  if (shots) await p.screenshot({ path: shots + '/women-' + (++womenShot) + '.png' });
  await p.evaluate(() => document.querySelector('button.round[aria-label="إغلاق"]')?.click()); await wait(600);
  return n;
};
const view = p => p.evaluate(() => ({ eyebrow: document.querySelector('.top .eyebrow')?.textContent ?? '', people: document.querySelector('.top .sub b')?.textContent ?? '', tabs: !!document.querySelector('nav.tabs, .tabs') }));
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await click(A, 'تصفّح أولًا', 'button', 500);
  const fid = await A.evaluate(() => JSON.parse(localStorage.getItem('ft-family')).fid);
  ok(await until(() => A.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active))), 'the app\'s files are kept by its service worker');
  ok(await until(() => A.evaluate(() => caches.open('ft-app-1').then(c => c.keys()).then(k => k.map(r => new URL(r.url).pathname)).then(p => p.includes('/') && p.some(x => x.startsWith('/assets/index-') && x.endsWith('.js')) && p.some(x => x.startsWith('/fonts/'))))), 'the page, its script and styles, and its fonts');
  const kept = await idb(A, fid);
  ok(kept && kept.n > 0, 'the family log is kept on the phone, as read · ' + kept?.n + ' entries');
  const before = await view(A);
  ok(before.people && !before.eyebrow.includes('بلا اتصال'), 'online: the tree, with no mark · ' + before.people);
  const w0 = await women(A);
  ok(w0 > 0, `online: a woman's name is found · ${w0} «${WOMAN}»`);

  // the site is unreachable
  stop();
  ok(!(await fetch(process.argv[2]).then(() => true).catch(() => false)), 'the site no longer answers');
  await A.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  ok(await until(() => A.evaluate(() => !!document.querySelector('.top .sub b'))), 'the app opens with no connection');
  await wait(1200);
  await click(A, 'تصفّح أولًا', 'button', 500);
  const off = await view(A);
  ok(off.people === before.people, 'on the family as last read: the same people · ' + off.people);
  ok(off.eyebrow.includes('بلا اتصال'), 'marked «بلا اتصال» · ' + off.eyebrow);
  await shot(A, 'offline-tree');
  ok((await women(A)) === 0, 'opened with no connection: women\'s details are not shown, only the male line and the structure');
  // a profile, and search, work
  await A.evaluate(() => document.querySelector('button.search')?.click()); await wait(500);
  await A.type('.sfield input', 'محمد', { delay: 8 }); await wait(700);
  ok((await A.evaluate(() => document.querySelectorAll('.results .prow').length)) > 0, 'search finds people');
  await A.evaluate(() => document.querySelector('.results .prow')?.click()); await wait(800);
  ok(await A.evaluate(() => document.body.innerText.includes('إخوته وأخواته')), 'a person\'s family card opens');
  await shot(A, 'offline-profile');

  // the site is back: what is new is fetched, the mark goes
  start();
  ok(await up(), 'the site answers again');
  // (on the tree itself, whose header carries the mark)
  await A.evaluate(() => [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الشجرة'))?.click()); await wait(400);
  ok(await until(() => view(A).then(v => v.eyebrow.includes('شجرة العائلة') && !v.eyebrow.includes('بلا اتصال')), 40000), 'within a sync, the mark is gone');
  await shot(A, 'offline-back');
  const w1 = await women(A);
  await shot(A, 'offline-back-search');
  if (w1 !== w0) console.log('  [state] ' + JSON.stringify(await A.evaluate(() => import('/src/data/store.ts').then(m => { const s = m.getState(); return { kept: s.kept, online: s.online, seesAll: s.seesAll, rootAdmin: s.rootAdmin, reach: s.reach, status: s.status }; }).catch(e => 'no store: ' + e.message))));
  ok(w1 === w0, 'and women\'s details show again · ' + w1);

  // a second phone, a member: its kept log goes when the family leaves the phone
  await A.evaluate(() => [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة'))?.click()); await wait(600);
  await click(A, 'دعوة فرد', '.page button', 600);
  await A.type('.sfield input', 'مشاري', { delay: 8 }); await wait(600);
  await A.evaluate(() => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes('1985'))?.click()); await wait(1500);
  const link = await A.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}'); const sk = Object.values(inv).pop(); return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null; });
  const B = await t.phone('B', link);
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'a member joins');
  ok(await until(async () => (await idb(B, fid))?.n > 0), 'his phone keeps the log too');
  // a log kept for a family this phone no longer holds
  await B.evaluate(() => new Promise(res => { const r = indexedDB.open('ft-log', 1); r.onsuccess = () => { const tx = r.result.transaction('logs', 'readwrite'); tx.objectStore('logs').put([{ v: 1 }], 'an-old-family'); tx.oncomplete = res; }; }));
  await B.reload({ waitUntil: 'networkidle0' }); await wait(1500);
  ok(await until(async () => { const x = await idb(B, fid); return x && !x.keys.includes('an-old-family') && x.n > 0; }), 'opening drops a log kept for another family, and keeps this one');
  // the root admin unlinks his phone: at its next sync it forgets the family, and its kept log
  await A.evaluate(() => [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الشجرة'))?.click()); await wait(600);
  await A.evaluate(() => document.querySelector('button.search')?.click()); await wait(500);
  await A.type('.sfield input', 'مشاري', { delay: 8 }); await wait(700);
  await A.evaluate(() => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes('1985'))?.click()); await wait(900);
  await click(A, 'الملف الكامل', 'button', 900);
  ok(await A.evaluate(() => { const bs = [...document.querySelectorAll('.page.profile button')]; const b = bs.find(x => x.textContent.includes('فصل كل أجهزته')) ?? bs.find(x => x.textContent.trim() === 'فصل الجهاز'); b?.click(); return !!b; }), 'the root admin unlinks his phone');
  ok(await until(() => B.evaluate(() => !localStorage.getItem('ft-family')), 40000), 'his phone forgets the family');
  ok(await until(async () => { const x = await idb(B, fid); return x && x.n === 0 && !x.keys.includes(fid); }), 'and the log it kept with it');
  // the site was down on purpose: the failed fetches then are expected, nothing else
  const expected = /ERR_CONNECTION_REFUSED|ERR_FAILED|ERR_INTERNET_DISCONNECTED/;
  t.errs.splice(0, t.errs.length, ...t.errs.filter(e => !expected.test(e)));
  await t.finish();
} catch (e) { await t.crash(e); }
