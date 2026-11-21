// Review of feat/permissions: who can make key, invite and view-all changes take
// effect. Phones other than the root admin's (and the platinum holder's, for view
// all only) write forged entries straight to the server, bypassing the UI; every
// phone's replay must ignore them. Needs a fresh local test family.
//   node perm-review-auth.mjs <BASE> <admin-link-file> [screenshot dir]
// Never prints links or keys: the link file is read here and used only in the browser.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = (process.argv[2] ?? 'http://localhost:5186').replace(/\/+$/, '');
const linkFile = process.argv[3];
const out = process.argv[4] ?? null;
if (!linkFile) { console.log('usage: node perm-review-auth.mjs BASE admin-link-file [shots]'); process.exit(2); }
const adminLink = fs.readFileSync(linkFile, 'utf8').split('\n').find(l => l.startsWith('http://localhost'))?.trim().replace(/^http:\/\/localhost:\d+/, BASE);
if (!adminLink) { console.log('FAIL no admin link in the file'); process.exit(1); }
const hide = t => String(t).replace(/#join=[^\s'"]*/g, '#join=<hidden>').replace(/[0-9a-f]{64}/g, '<hex>');

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const errs = [];
let failed = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
const check = (ok, label, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' · ' + hide(extra) : ''}`); return ok; };
const shot = async (p, name) => { if (out) await p.screenshot({ path: `${out}/${name}.png` }); };

async function phone(name, link) {
  const page = await (await browser.createBrowserContext()).newPage();
  // the app's own module instances: after an edit Vite serves them under a ?t= address
  await page.evaluateOnNewDocument(() => {
    performance.setResourceTimingBufferSize(5000);
    window.__mod = path => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path);
  });
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errs.push(name + ': ' + hide(e.message)));
  page.on('console', m => { if (m.type() === 'error') errs.push(name + ': ' + hide(m.text())); });
  page.on('dialog', d => d.accept());
  try { await page.goto(link, { waitUntil: 'networkidle0' }); } catch (e) { errs.push(name + ': could not open the page ' + hide(e.message)); }
  await wait(1500);
  return page;
}
async function until(p, fn, arg, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await p.evaluate(fn, arg).catch(() => null);
    if (v || Date.now() > end) return v;
    await wait(250);
  }
}
const click = async (p, text, sel = 'button') => {
  const ok = await p.evaluate((t, s) => { const b = [...document.querySelectorAll(s)].find(e => e.textContent.includes(t)); b?.click(); return !!b; }, text, sel);
  if (!ok) check(false, 'button found: ' + text);
  await wait(600);
  return ok;
};
const pickResult = async (p, q, year) => {
  await p.type('.sfield input', q, { delay: 10 }); await wait(500);
  const ok = await p.evaluate(y => { const r = [...document.querySelectorAll('.results .prow')].find(e => !y || e.innerText.includes(y)); r?.click(); return !!r; }, year);
  if (!ok) check(false, `search result ${q} ${year}`);
  await wait(1200);
};
const closeProfile = p => p.evaluate(() => document.querySelector('.page.profile .navbtns .round')?.click()).then(() => wait(300));
async function openProfile(p, q, year) {
  await closeProfile(p);
  await p.evaluate(() => [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الشجرة'))?.click()); await wait(400);
  await p.evaluate(() => document.querySelector('.home .search')?.click()); await wait(400);
  await pickResult(p, q, year);
  await click(p, 'الملف الكامل');
  await until(p, () => !!document.querySelector('.page.profile'));
}
const permClick = async (p, text, tier) => {
  const ok = await p.evaluate((t, tier) => {
    const sec = document.querySelector('.page.profile section.perms');
    const scope = tier ? [...sec.querySelectorAll('.permtier')].find(e => e.querySelector('.key.' + tier)) : sec;
    const b = scope && [...scope.querySelectorAll('button')].find(e => e.textContent.includes(t) || e.getAttribute('aria-label') === t);
    b?.click();
    return !!b;
  }, text, tier ?? null);
  if (!ok) check(false, `permissions button found: ${text}${tier ? ' (' + tier + ')' : ''}`);
  await wait(1500);
};
const lastInviteLink = p => p.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('ft-family'));
  const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid));
  return `${location.origin}/#join=${m.fid}.${m.key}.i${Object.values(inv).pop()}`;
});
async function inviteFromProfile(p, who) {
  await openProfile(p, ...who);
  await permClick(p, 'دعوة');
  const link = await lastInviteLink(p);
  await click(p, 'إغلاق', '.mhead button');
  return link;
}
async function join(name, link) {
  const ph = await phone(name, link);
  await click(ph, 'نعم، أنا');
  check(await until(ph, () => !!document.querySelector('.tabs')), name + ' joined with his invite');
  return ph;
}
// the app's own state, from the module the page already runs (Vite serves one instance per URL)
const view = p => p.evaluate(async () => {
  const st = await window.__mod('/src/data/store.ts');
  const s = st.getState();
  return {
    status: s.status,
    me: s.me,
    seats: s.seats.map(x => `${x.tier}|${x.branch ?? '-'}|${x.holder}`).sort(),
    viewAll: [...s.viewAll].sort(),
    devices: [...s.devices.values()].sort(),
    invites: s.invites.map(i => `${i.person}|${i.status}`).sort(),
    canGrant: st.canGrantAccess(s),
    entries: st.logSize(),
  };
});
const idOf = (p, name, year) => p.evaluate(async (name, year) => {
  const { getState } = await window.__mod('/src/data/store.ts');
  return [...getState().graph.nodes.values()].find(n => n.name === name && n.birth?.v === year)?.id ?? null;
}, name, Number(year));
// writes one entry signed by this phone's own device key (or a brand new key), as a modified app could
const forge = (p, payload, freshKey = false) => p.evaluate(async (payload, freshKey) => {
  const b = await window.__mod('/src/data/backend.ts');
  const c = await window.__mod('/src/core/crypto.ts');
  const log = new b.RemoteLog(b.membership(), items => items.findLast(i => i.p)?.kid ?? null) /* sealed with the newest key version this phone reads (feat/rotation) */;
  try {
    await log.append(payload, freshKey ? c.newDeviceKey() : undefined);
    return 'stored';
  } catch (e) {
    return 'refused: ' + (e instanceof Error ? e.message : String(e));
  }
}, payload, freshKey);
const settle = async (...phones) => { await wait(3800); for (const p of phones) await p.evaluate(async () => (await window.__mod('/src/data/store.ts')).sync()); await wait(600); };

const ADMIN = ['منصور', '1963'], PLAT = ['عبدالمحسن', '1945'], SILV = ['ماجد', '1953'], MEM = ['وليد', '1956'], OTHER = ['هشام', '1958'];

// ---- set up: platinum and silver given from profiles, three phones invited from profiles
const A = await phone('A', adminLink);
await click(A, 'اربط باسمي');
await pickResult(A, ...ADMIN);
const id = {};
for (const [k, who] of Object.entries({ PLAT, SILV, MEM, OTHER })) id[k] = await idOf(A, ...who);
check(Object.values(id).every(Boolean), 'test people found in the tree');
const branch = await A.evaluate(async x => (await window.__mod('/src/data/store.ts')).getState().graph.nodes.get(x).branch, id.SILV);
await openProfile(A, ...PLAT); await permClick(A, 'منح', 'platinum');
await openProfile(A, ...SILV); await permClick(A, 'منح', 'silver');
const PL = await join('PL (platinum)', await inviteFromProfile(A, PLAT));
const SV = await join('SV (silver)', await inviteFromProfile(A, SILV));
const M = await join('M (member)', await inviteFromProfile(A, MEM));
await settle(A, PL, SV, M);
const before = await view(A);
check(before.seats.length === 2 && before.devices.length === 4, 'set-up: 2 seats, 3 invited phones and the admin\'s', JSON.stringify([before.seats.length, before.devices.length]));
const deviceOf = who => A.evaluate(async x => [...(await window.__mod('/src/data/store.ts')).getState().devices].find(([, p]) => p === x)?.[0] ?? null, who);
const svDevice = await deviceOf(id.SILV);
const mDevice = await M.evaluate(() => JSON.parse(localStorage.getItem('ft-device')).pk);

// ---- a member's phone writes admin and access entries straight to the log
const forged = [
  ['member appoints himself gold', { type: 'admin', act: { kind: 'appoint', tier: 'gold', branch, holder: id.MEM }, by: id.MEM }],
  ['member takes the platinum seat (replaces)', { type: 'admin', act: { kind: 'appoint', tier: 'platinum', branch: null, holder: id.MEM, replaces: id.PLAT }, by: id.MEM }],
  ['member vacates the silver holder', { type: 'admin', act: { kind: 'vacate', holder: id.SILV }, by: id.MEM }],
  ['member unlinks the silver holder\'s phone', { type: 'admin', act: { kind: 'revoke', key: svDevice }, by: id.MEM }],
  ['member links his phone to the platinum holder', { type: 'admin', act: { kind: 'self', person: id.PLAT, device: mDevice }, by: id.MEM }],
  ['member changes the main branches', { type: 'admin', act: { kind: 'branches', ids: [id.OTHER] }, by: id.MEM }],
  ['member gives himself view all', { type: 'access', act: { kind: 'viewall', person: id.MEM, on: true }, by: id.MEM }],
  ['member gives view all in the platinum holder\'s name', { type: 'access', act: { kind: 'viewall', person: id.MEM, on: true }, by: id.PLAT }],
];
for (const [label, p] of forged) check(await forge(M, p) === 'stored', 'server stores the forged entry (it cannot read it): ' + label);
// an unknown key claiming to be the platinum holder, and an invite for someone else
check(await forge(M, { type: 'access', act: { kind: 'viewall', person: id.OTHER, on: true }, by: id.PLAT }, true) === 'stored', 'server stores a view-all entry from an unknown key');
check(await forge(M, { type: 'admin', act: { kind: 'invite', person: id.OTHER, key: 'a'.repeat(64) }, by: id.MEM }) === 'stored', 'server stores a forged invite');
// the silver holder: no view all either
check(await forge(SV, { type: 'access', act: { kind: 'viewall', person: id.SILV, on: true }, by: id.SILV }) === 'stored', 'server stores the silver holder\'s view-all entry');
// the platinum holder: admin acts are not his
check(await forge(PL, { type: 'admin', act: { kind: 'appoint', tier: 'silver', branch, holder: id.MEM }, by: id.PLAT }) === 'stored', 'server stores the platinum holder\'s appoint');
check(await forge(PL, { type: 'admin', act: { kind: 'vacate', holder: id.SILV }, by: id.PLAT }) === 'stored', 'server stores the platinum holder\'s vacate');
check(await forge(PL, { type: 'admin', act: { kind: 'revoke', key: mDevice }, by: id.PLAT }) === 'stored', 'server stores the platinum holder\'s unlink');

await settle(A, PL, SV, M);
const C = await phone('C', adminLink); // a fresh phone replays the whole log from the start
await click(C, 'تصفّح');
for (const [name, p] of [['admin', A], ['platinum', PL], ['silver', SV], ['member', M], ['fresh admin phone', C]]) {
  const v = await view(p);
  check(v.status === 'ready', `${name}: still opens the family`, v.status);
  check(JSON.stringify(v.seats) === JSON.stringify(before.seats), `${name}: seats unchanged by forged entries`, v.seats.join(', '));
  check(v.viewAll.length === 0, `${name}: nobody got view all from forged entries`, v.viewAll.join(','));
  check(JSON.stringify(v.devices) === JSON.stringify(before.devices), `${name}: no phone unlinked or relinked`, v.devices.join(','));
  check(JSON.stringify(v.invites) === JSON.stringify(before.invites), `${name}: no forged invite`, v.invites.join(','));
}
check((await view(M)).me === id.MEM && (await view(SV)).me === id.SILV, 'member and silver phones are still who their invites say');
check((await view(C)).entries === (await view(A)).entries, 'the fresh phone read the same log');

// ---- the member's phone shows no controls anywhere
await openProfile(M, ...OTHER);
check(await M.evaluate(() => !!document.querySelector('.page.profile') && !document.querySelector('section.perms')), 'member: no permissions section on a profile');
await closeProfile(M);
await M.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await wait(500);
check(await M.evaluate(() => ![...document.querySelectorAll('h3')].some(h => /مشاهدة الكل|الأعضاء/.test(h.textContent))), 'member: no view-all or members screen');

// ---- the platinum holder may give view all, from a profile, and it counts everywhere
await openProfile(PL, ...MEM);
await permClick(PL, 'مفعّلة');
await settle(A, PL, M, C);
for (const [name, p] of [['admin', A], ['member', M], ['fresh admin phone', C]]) check((await view(p)).viewAll.join() === id.MEM, `${name}: the platinum holder's view all counts`);
check(await until(M, () => window.__mod('/src/data/store.ts').then(m => m.getState().seesAll)), 'member now sees everyone');

// ---- hand platinum over (from the new holder's profile); the old holder's phone loses view all rights
await openProfile(A, ...SILV);
await permClick(A, 'تسليم بدلًا من', 'platinum');
await A.evaluate(() => document.querySelector('.permfrom .prow').click()); await wait(1800);
await settle(A, PL, SV, M);
const afterHand = await view(A);
check(afterHand.seats.length === 1 && afterHand.seats[0] === `platinum|-|${id.SILV}`, 'platinum handed over; his silver seat freed', afterHand.seats.join(', '));
check(!(await view(PL)).canGrant, 'former platinum phone: may no longer grant');
await openProfile(PL, ...MEM);
check(await PL.evaluate(() => !!document.querySelector('.page.profile') && !document.querySelector('section.perms')), 'former platinum phone: the section is gone');
check(await forge(PL, { type: 'access', act: { kind: 'viewall', person: id.MEM, on: false }, by: id.PLAT }) === 'stored', 'server stores the former holder\'s view-all entry');
await settle(A, PL, SV, M);
check((await view(A)).viewAll.join() === id.MEM && (await view(M)).viewAll.join() === id.MEM, 'former platinum holder\'s entry ignored: view all still on');
// the new platinum holder can switch it off from the profile
check(await until(SV, () => window.__mod('/src/data/store.ts').then(m => m.canGrantAccess(m.getState()))), 'new platinum phone may grant');
await openProfile(SV, ...MEM);
const svSec = await SV.evaluate(() => { const s = document.querySelector('section.perms'); return s && { keys: !!s.querySelector('.permkeys'), phone: !!s.querySelector('.permphone'), seg: !!s.querySelector('.seg.viewall') }; });
check(!!svSec && svSec.seg && !svSec.keys && !svSec.phone, 'new platinum phone: view all only', JSON.stringify(svSec));
await shot(SV, 'auth-new-platinum');
await permClick(SV, 'موقوفة');
await settle(A, SV, M);
check((await view(A)).viewAll.length === 0 && (await view(M)).viewAll.length === 0, 'new platinum holder switched it off; every phone agrees');
check(await until(M, () => window.__mod('/src/data/store.ts').then(m => !m.getState().seesAll)), 'member back under the privacy rule');

// ---- the platinum holder's phone unlinked (from his profile): it keeps its keys but may no longer grant
await SV.evaluate(() => { window.__kept = localStorage.getItem('ft-family'); }); // what a modified app would keep
await openProfile(A, ...SILV);
await permClick(A, 'فصل الجهاز');
check(await until(SV, () => !localStorage.getItem('ft-family'), null, 12000), 'unlinked platinum phone forgot the family');
const late = await SV.evaluate(async (payload) => {
  const b = await window.__mod('/src/data/backend.ts');
  const log = new b.RemoteLog(JSON.parse(window.__kept), items => items.findLast(i => i.p)?.kid ?? null) /* sealed with the newest key version this phone reads (feat/rotation) */;
  try { await log.append(payload); return 'stored'; } catch (e) { return 'refused: ' + e.message; }
}, { type: 'access', act: { kind: 'viewall', person: id.OTHER, on: true }, by: id.SILV });
// stored, or refused by the server's write check (feat/writegate): the phone holds only the old key
check(late === 'stored' || late.startsWith('refused: مفتاح الكتابة'), 'server stores (or refuses) a view-all entry from the unlinked platinum phone', late);
await settle(A, M);
check((await view(A)).seats.includes(`platinum|-|${id.SILV}`) && (await view(A)).viewAll.length === 0 && (await view(M)).viewAll.length === 0, 'he still holds platinum, but his unlinked phone\'s entry is ignored');

// ---- a fresh replay still agrees on everything
const D = await phone('D', adminLink);
await click(D, 'تصفّح');
const vd = await view(D), va = await view(A);
check(JSON.stringify([vd.seats, vd.viewAll, vd.devices, vd.invites]) === JSON.stringify([va.seats, va.viewAll, va.devices, va.invites]), 'fresh replay agrees with the admin phone');

await browser.close();
if (errs.length) { failed++; console.log('FAIL page errors:\n' + errs.join('\n')); }
console.log(failed ? `FAIL (${failed})` : 'PASS');
process.exit(failed ? 1 : 0);
