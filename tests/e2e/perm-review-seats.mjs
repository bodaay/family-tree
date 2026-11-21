// Review of feat/permissions: the seat rules hold through every profile action
// (hand-over, take-back, moving tiers, platinum), replay rejects admin-signed
// entries that break them, statuses are exact, and the section fits a phone.
// Needs a fresh local test family.
//   node perm-review-seats.mjs <BASE> <admin-link-file> [screenshot dir]
// Never prints links or keys: the link file is read here and used only in the browser.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = (process.argv[2] ?? 'http://localhost:5186').replace(/\/+$/, '');
const linkFile = process.argv[3];
const out = process.argv[4] ?? null;
if (!linkFile) { console.log('usage: node perm-review-seats.mjs BASE admin-link-file [shots]'); process.exit(2); }
const adminLink = fs.readFileSync(linkFile, 'utf8').split('\n').find(l => l.startsWith('http://localhost'))?.trim().replace(/^http:\/\/localhost:\d+/, BASE);
if (!adminLink) { console.log('FAIL no admin link in the file'); process.exit(1); }
const hide = t => String(t).replace(/#join=[^\s'"]*/g, '#join=<hidden>').replace(/[0-9a-f]{64}/g, '<hex>');

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const errs = [];
let failed = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
const check = (ok, label, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' · ' + hide(extra) : ''}`); return ok; };
const shot = async (p, name) => { if (out) await p.screenshot({ path: `${out}/${name}.png` }); };

async function phone(name, link, width = 412) {
  const page = await (await browser.createBrowserContext()).newPage();
  // the app's own module instances: after an edit Vite serves them under a ?t= address
  await page.evaluateOnNewDocument(() => {
    performance.setResourceTimingBufferSize(5000);
    window.__mod = path => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path);
  });
  await page.setViewport({ width, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
// opens a profile the way the keys screen does (by id): names repeat in this family
const openId = async (p, id) => {
  await closeProfile(p);
  await p.evaluate(async id => (await window.__mod('/src/data/store.ts')).set({ profile: id }), id);
  await until(p, () => !!document.querySelector('.page.profile'));
  await wait(300);
};
const perm = p => p.evaluate(() => {
  const sec = document.querySelector('.page.profile section.perms');
  if (!sec) return null;
  const row = label => [...sec.querySelectorAll('.permstat .srow')].find(r => r.querySelector('span')?.firstChild?.textContent.trim() === label);
  const tiers = {};
  for (const t of sec.querySelectorAll('.permtier')) {
    const tier = ['platinum', 'gold', 'silver'].find(c => t.querySelector('.key.' + c));
    tiers[tier] = { state: ['held', 'open', 'full', 'no'].find(c => t.classList.contains(c)), text: t.querySelector('.pt small')?.innerText ?? '' };
  }
  return {
    key: row('المفتاح')?.querySelector('.key, b')?.innerText.trim() ?? '',
    phone: row('الهاتف')?.querySelector('b')?.innerText.trim() ?? null,
    tiers,
    text: sec.innerText.replace(/\s+/g, ' '),
  };
});
const permClick = async (p, text, tier, double = false) => {
  const ok = await p.evaluate((t, tier, double) => {
    const sec = document.querySelector('.page.profile section.perms');
    const scope = tier ? [...sec.querySelectorAll('.permtier')].find(e => e.querySelector('.key.' + tier)) : sec;
    const b = scope && [...scope.querySelectorAll('button')].find(e => e.textContent.includes(t) || e.getAttribute('aria-label') === t);
    b?.click();
    if (double) b?.click();
    return !!b;
  }, text, tier ?? null, double);
  if (!ok) check(false, `permissions button found: ${text}${tier ? ' (' + tier + ')' : ''}`);
  await wait(1600);
};
const S = p => p.evaluate(async () => {
  const { getState, logSize } = await window.__mod('/src/data/store.ts');
  const s = getState();
  return { seats: s.seats.map(x => `${x.tier}|${x.branch ?? '-'}|${x.holder}`).sort(), invites: s.invites.map(i => `${i.person}|${i.status}`), entries: logSize() };
});
// the seat rules, checked on the replayed state: fixed counts, one seat per person, valid holders
const invariant = async (p, label) => {
  const bad = await p.evaluate(async () => {
    const { getState } = await window.__mod('/src/data/store.ts');
    const { SEATS, seatProblem } = await window.__mod('/src/data/governance.ts');
    const s = getState();
    const out = [];
    const per = new Map();
    for (const x of s.seats) per.set(x.tier + '|' + x.branch, (per.get(x.tier + '|' + x.branch) ?? 0) + 1);
    for (const [k, n] of per) if (n > SEATS[k.split('|')[0]]) out.push('too many ' + k);
    if (new Set(s.seats.map(x => x.holder)).size !== s.seats.length) out.push('someone holds two seats');
    if (s.seats.filter(x => x.tier === 'platinum').length > 1) out.push('two platinum');
    for (const x of s.seats) if (seatProblem(s.graph, x.tier, x.branch, x.holder)) out.push('invalid holder ' + x.holder);
    return out;
  });
  check(bad.length === 0, 'seat rules hold: ' + label, bad.join('; '));
};
const holds = async (p, id) => (await S(p)).seats.find(x => x.endsWith('|' + id))?.split('|')[0] ?? null;
// the section fits the screen: no sideways scroll, every control on screen and big enough to tap
const fits = async (p, label) => {
  const r = await p.evaluate(() => {
    const page = document.querySelector('.page.profile');
    const sec = page?.querySelector('section.perms');
    if (!sec) return 'no section';
    const issues = [];
    if (page.scrollWidth > page.clientWidth + 1) issues.push('page scrolls sideways ' + page.scrollWidth + '>' + page.clientWidth);
    for (const el of sec.querySelectorAll('.prow, .srow, button')) {
      const b = el.getBoundingClientRect();
      if (b.width && (b.left < -1 || b.right > innerWidth + 1)) issues.push('off screen: ' + el.innerText.slice(0, 30));
    }
    for (const el of sec.querySelectorAll('button')) {
      const b = el.getBoundingClientRect();
      if (b.width && b.height < 36) issues.push('small tap target: ' + (el.innerText || el.getAttribute('aria-label')).slice(0, 30) + ' ' + Math.round(b.height));
    }
    for (const el of sec.querySelectorAll('.pt small, .hint, .permtier .pt b, .permstat .srow > *')) if (el.scrollWidth > el.clientWidth + 1) issues.push('clipped: ' + el.innerText.slice(0, 30));
    return issues.join('; ');
  });
  check(r === '', 'fits a ' + (await p.evaluate(() => innerWidth)) + 'px phone: ' + label, r);
};
const adminForge = (p, act) => p.evaluate(async act => {
  const b = await window.__mod('/src/data/backend.ts');
  const log = new b.RemoteLog(b.membership(), items => items.findLast(i => i.p)?.kid ?? null) /* sealed with the newest key version this phone reads (feat/rotation) */;
  try { await log.append({ type: 'admin', act, by: null }, 'admin'); return 'stored'; } catch (e) { return 'refused: ' + e.message; }
}, act);

const A = await phone('A', adminLink);
await click(A, 'اربط باسمي');
await pickResult(A, 'منصور', '1963');
// living people of the one branch with living members: eight men (eldest first) and a woman
const ppl = await A.evaluate(async () => {
  const { getState } = await window.__mod('/src/data/store.ts');
  const g = getState().graph;
  const live = [...g.nodes.values()].filter(n => !n.dead && !n.familyRoot && n.branch && n.birth);
  // the branch with the most living men (others may have a few, added in the app)
  const count = b => live.filter(n => n.sex === 'm' && n.branch === b).length;
  const main = g.branches.slice().sort((a, b) => count(b) - count(a))[0];
  const men = live.filter(n => n.sex === 'm' && n.branch === main).sort((a, b) => a.birth.v - b.birth.v).slice(0, 8).map(n => n.id);
  const woman = live.filter(n => n.sex === 'f' && !n.external).sort((a, b) => a.birth.v - b.birth.v)[0].id;
  const dead = [...g.nodes.values()].find(n => n.dead && n.branch && !n.familyRoot).id;
  const other = g.branches.find(b => b !== g.nodes.get(men[0]).branch);
  return { men, woman, dead, branch: g.nodes.get(men[0]).branch, other, branches: g.branches, name: Object.fromEntries([...men, woman].map(id => [id, g.nodes.get(id).name])) };
});
const [M1, M2, M3, M4, M5, M6, M7, M8] = ppl.men, W = ppl.woman, B = ppl.branch;

// ---- fill the branch from profiles: three silvers, two golds
for (const m of [M1, M2, M3]) { await openId(A, m); await permClick(A, 'منح', 'silver'); }
for (const m of [M4, M5]) { await openId(A, m); await permClick(A, 'منح', 'gold'); }
await invariant(A, 'branch filled from profiles');
await openId(A, M6);
let st = await perm(A);
check(st?.tiers.gold?.state === 'full' && st?.tiers.silver?.state === 'full' && st?.tiers.gold.text === 'المقعدان مشغولان', 'a seventh man: gold and silver both full', JSON.stringify(st?.tiers));
await fits(A, 'every tier offered');
await permClick(A, 'تسليم بدلًا من', 'gold');
const goldFrom = await A.evaluate(() => [...document.querySelectorAll('.permfrom .prow')].map(e => e.innerText));
check(goldFrom.length === 2, 'gold hand-over lists the two gold holders', String(goldFrom.length));
await fits(A, 'hand-over list open');
await A.evaluate(n => [...document.querySelectorAll('.permfrom .prow')].find(e => e.innerText.includes(n)).click(), ppl.name[M4]); await wait(1800);
check(await holds(A, M6) === 'gold' && await holds(A, M4) === null, 'gold moved from the 4th to the 6th man in one step');
await invariant(A, 'after a gold hand-over');

// ---- hand over from a holder's profile, through the picker, to a silver holder: he moves up, his silver frees
await permClick(A, 'تسليم المفتاح إلى');
const offered = await A.evaluate(() => [...document.querySelectorAll('.results .prow')].map(e => e.innerText));
check(offered.length > 0 && !offered.some(t => /رحمه? الله|رحمها الله/.test(t)), 'the picker offers only living people', String(offered.length));
const offeredIds = await A.evaluate(async () => {
  const { getState } = await window.__mod('/src/data/store.ts');
  return getState().pickSeat;
});
check(offeredIds?.tier === 'gold' && offeredIds?.replaces === M6, 'the picker fills the 6th man\'s gold seat');
await A.type('.sfield input', ppl.name[M1], { delay: 10 }); await wait(500);
const rowsForM1 = await A.evaluate(() => [...document.querySelectorAll('.results .prow')].length);
// several people share a name: tap the one carrying the silver badge
const tapped = await A.evaluate(() => { const r = [...document.querySelectorAll('.results .prow')].find(e => e.querySelector('.key.silver')); r?.click(); return !!r; });
check(rowsForM1 > 0 && tapped, 'a silver holder is offered, with his badge');
await wait(1800);
await invariant(A, 'after a picker hand-over to a silver holder');
const afterPick = await S(A);
check(await holds(A, M6) === null && afterPick.seats.filter(x => x.startsWith('silver|')).length === 2 && afterPick.seats.filter(x => x.startsWith('gold|')).length === 2, 'the 6th man gave his gold away; the new gold\'s silver seat is free', afterPick.seats.join(', '));

// ---- a woman: words follow her, and the hand-over list names her rightly
await openId(A, W);
st = await perm(A);
check(st?.phone === 'لم تُدعَ بعد', 'a woman\'s phone status', st?.phone);
await permClick(A, 'منح', 'silver');
check(await holds(A, W) === 'silver', 'the woman given the third silver');
st = await perm(A);
check(st?.tiers.silver?.text === 'تحمله الآن', 'her row: «تحمله الآن»', st?.tiers.silver?.text);
await openId(A, M7);
await permClick(A, 'تسليم بدلًا من', 'silver');
const wRow = await A.evaluate(n => [...document.querySelectorAll('.permfrom .prow')].find(e => e.innerText.includes(n))?.innerText ?? '', ppl.name[W]);
check(wRow.includes('بدلًا منها'), 'the hand-over list says «بدلًا منها» for her', wRow.replace(/\s+/g, ' '));
// platinum to her, then the single-seat wording on another profile
await openId(A, W);
await permClick(A, 'منح', 'platinum');
check(await holds(A, W) === 'platinum', 'the woman moved from silver to platinum');
await openId(A, M7);
st = await perm(A);
check(st?.tiers.platinum?.state === 'full' && st?.tiers.platinum.text === 'تحمله ' + ppl.name[W], 'platinum row: «تحمله …» for her', st?.tiers.platinum?.text);
await permClick(A, 'تسليم بدلًا من', 'platinum');
await A.evaluate(() => document.querySelector('.permfrom .prow').click()); await wait(1800);
check(await holds(A, M7) === 'platinum' && await holds(A, W) === null, 'platinum handed from her to the 7th man in one step');
await invariant(A, 'after platinum changes');

// ---- take back, and give twice in a hurry: one seat, rules intact
await openId(A, M8);
await permClick(A, 'منح', 'silver', true);
check(await holds(A, M8) === 'silver', 'a double tap on «منح» gives one silver');
await invariant(A, 'after a double tap');
await permClick(A, 'سحب المفتاح');
check(await holds(A, M8) === null && (await perm(A))?.tiers.silver?.state === 'open', 'key taken back; silver open again');

// ---- invites: a double tap makes one invite; statuses stay exact after cancelling and unlinking
const inv0 = (await S(A)).invites.length;
await permClick(A, 'دعوة', null, true);
await until(A, () => !!document.querySelector('.modal.invite .qr svg'));
await click(A, 'إغلاق', '.mhead button');
await wait(1500);
const inv1 = (await S(A)).invites;
check(inv1.length === inv0 + 1, 'a double tap on «دعوة» makes one invite', `${inv1.length - inv0} new`);
await permClick(A, 'إلغاء الدعوة');
st = await perm(A);
check(st?.phone === 'أُلغيت دعوته' && st.text.includes('دعوة شخصية'), 'cancelled invite: said so, and a new invite offered', st?.phone);

// ---- replay rejects admin-signed seat changes that break the rules
const before = await S(A);
const dead = ppl.dead;
const tries = [
  ['a 3rd gold without replaces', { kind: 'appoint', tier: 'gold', branch: B, holder: M8 }],
  ['a 2nd platinum without replaces', { kind: 'appoint', tier: 'platinum', branch: null, holder: M8 }],
  ['replacing someone not in that seat', { kind: 'appoint', tier: 'gold', branch: B, holder: M8, replaces: M2 }],
  ['a key for the deceased', { kind: 'appoint', tier: 'silver', branch: B, holder: dead }],
  ['a key in another branch', { kind: 'appoint', tier: 'silver', branch: ppl.other, holder: M8 }],
  ['platinum tied to a branch', { kind: 'appoint', tier: 'platinum', branch: B, holder: M8, replaces: M7 }],
  ['vacating someone without a key', { kind: 'vacate', holder: M8 }],
];
for (const [label, act] of tries) check(await adminForge(A, act) === 'stored', 'stored: ' + label);
await wait(1200);
await A.evaluate(async () => (await window.__mod('/src/data/store.ts')).sync()); await wait(800);
check(JSON.stringify((await S(A)).seats) === JSON.stringify(before.seats), 'replay ignored every entry that breaks the seat rules', (await S(A)).seats.join(', '));
await invariant(A, 'after rule-breaking entries');

// ---- changing the main branches: seats that no longer fit go, and the trunk gets its reasons
const head = await A.evaluate(async (m) => (await window.__mod('/src/data/store.ts')).getState().graph.nodes.get(m).parent, M1);
await A.evaluate(async h => (await window.__mod('/src/data/store.ts')).setMainBranches([h]), head); await wait(2000);
const trunkMan = await A.evaluate(async h => {
  const { getState } = await window.__mod('/src/data/store.ts');
  const g = getState().graph;
  // (fix-review) an adult: since main's merge, members under 18 hold no key («دون 18 سنة»)
  return [...g.nodes.values()].find(n => !n.dead && !n.familyRoot && n.sex === 'm' && !n.branch && (n.by == null || 2026 - n.by >= 18))?.id ?? null;
}, head);
check(!!trunkMan, 'a living man is now in the trunk');
await openId(A, trunkMan);
st = await perm(A);
check(st?.tiers.platinum?.state && st.tiers.platinum.state !== 'no' && st.tiers.gold?.state === 'no' && st.tiers.silver?.state === 'no' && st.tiers.gold.text.includes('ليس من فرع رئيسي'), 'trunk man: platinum possible, gold and silver say why not', JSON.stringify(st?.tiers));
await fits(A, 'reasons shown');
await A.evaluate(() => document.querySelector('section.perms')?.scrollIntoView()); await wait(300);
await shot(A, 'seats-trunk');
const left = (await S(A)).seats;
check(left.every(x => x.startsWith('platinum|')), 'branch seats emptied by the new main branches; platinum kept', left.join(', '));
await openId(A, M5);
check((await perm(A))?.key === 'بلا مفتاح', 'a former gold\'s profile shows no key at once');
await invariant(A, 'after changing main branches');
await A.evaluate(async b => (await window.__mod('/src/data/store.ts')).setMainBranches(b), ppl.branches); await wait(2000);

// ---- a narrow phone (360px) with the longest rows open
const N = await phone('N', adminLink, 360);
await click(N, 'تصفّح');
await openId(N, M8);
await N.evaluate(() => document.querySelector('section.perms')?.scrollIntoView()); await wait(300);
await fits(N, 'keys and phone');
await shot(N, 'seats-360');
await permClick(N, 'تسليم بدلًا من', 'platinum');
await fits(N, 'platinum hand-over list open');

// ---- the same seats from a fresh replay
check(JSON.stringify((await S(N)).seats) === JSON.stringify((await S(A)).seats), 'a fresh phone replays the same seats');

await browser.close();
if (errs.length) { failed++; console.log('FAIL page errors:\n' + errs.join('\n')); }
console.log(failed ? `FAIL (${failed})` : 'PASS');
process.exit(failed ? 1 : 0);
