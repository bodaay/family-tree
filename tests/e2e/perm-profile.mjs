// Permissions on a member's profile (feat/permissions), on a fresh local test family.
//   node perm-profile.mjs <BASE> <admin-link-file> [screenshot dir]
// Never prints links or keys: the link file is read here and used only in the browser.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = (process.argv[2] ?? 'http://localhost:5186').replace(/\/+$/, '');
const linkFile = process.argv[3];
const out = process.argv[4] ?? null;
if (!linkFile) { console.log('usage: node perm-profile.mjs BASE admin-link-file [shots]'); process.exit(2); }
const adminLink = fs.readFileSync(linkFile, 'utf8').split('\n').find(l => l.startsWith('http://localhost'))?.trim().replace(/^http:\/\/localhost:\d+/, BASE);
if (!adminLink) { console.log('FAIL no admin link in the file'); process.exit(1); }
const hide = t => String(t).replace(/#join=[^\s'"]*/g, '#join=<hidden>');

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const errs = [];
let failed = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
const check = (ok, label, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' · ' + hide(extra) : ''}`); return ok; };
const shot = async (p, name) => { if (out) await p.screenshot({ path: `${out}/${name}.png` }); };

async function phone(name, link) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errs.push(name + ': ' + hide(e.message)));
  // a write that loses a race to another phone's is refused (409) and retried by the app: not an error
  // (on a moved family the root admin's phone also renews the key on its own while this script writes)
  page.on('console', m => { if (m.type() === 'error' && !/status of 409 \(Conflict\)/.test(m.text())) errs.push(name + ': ' + hide(m.text())); });
  page.on('dialog', d => d.accept());
  try { await page.goto(link, { waitUntil: 'networkidle0' }); } catch (e) { errs.push(name + ': could not open the page ' + hide(e.message)); }
  await wait(1500);
  return page;
}
async function until(p, fn, arg, ms = 9000) {
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
// the permissions section as the screen shows it
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
    viewAll: row('مشاهدة الكل')?.querySelector('.seg .on')?.innerText.trim() ?? null,
    tiers,
    keyCard: !!sec.querySelector('.permkeys'),
    phoneCard: !!sec.querySelector('.permphone'),
    text: sec.innerText.replace(/\s+/g, ' '),
  };
});
// clicks a button inside the permissions section (optionally inside one tier's row)
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
const toPerms = p => p.evaluate(() => { const s = document.querySelector('.page.profile section.perms'); if (s) s.closest('.page').scrollTop += s.getBoundingClientRect().top - 20; }).then(() => wait(300));
const lastInviteLink = p => p.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('ft-family'));
  const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid));
  return `${location.origin}/#join=${m.fid}.${m.key}.i${Object.values(inv).pop()}`;
});
// the keys screen: "tier|name" for every filled seat
const keySeats = async p => {
  await closeProfile(p);
  await p.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await wait(500);
  return p.evaluate(() => [...document.querySelectorAll('button.keyrow:not(.empty)')].map(b => ['platinum', 'gold', 'silver'].find(c => b.classList.contains(c)) + '|' + b.querySelector('.kn').innerText.trim()).sort());
};

const P1 = ['عبدالمحسن', '1945'], P2 = ['ماجد', '1953'], P3 = ['وليد', '1956'], P4 = ['هشام', '1958'], P5 = ['سامي', '1955'], P6 = ['طلال', '1954'];

// ---- the root admin's phone
const A = await phone('A', adminLink);
await click(A, 'اربط باسمي');
await pickResult(A, 'منصور', '1963');
await openProfile(A, ...P1);
let st = await perm(A);
check(!!st, 'root admin sees «الصلاحيات» on a profile');
check(st?.key === 'بلا مفتاح' && st?.phone === 'لم يُدعَ بعد' && st?.viewAll === 'موقوفة', 'status at a glance: no key, not invited, view all off', JSON.stringify(st && [st.key, st.phone, st.viewAll]));
check(st?.tiers.silver?.state === 'open' && st?.tiers.gold?.state === 'open' && st?.tiers.platinum?.state === 'open', 'every key tier is open for him', JSON.stringify(st?.tiers));
await toPerms(A);
await shot(A, 'p1-profile-perms');

// three silvers in the branch fill it
await permClick(A, 'منح', 'silver');
st = await perm(A);
check(st?.tiers.silver?.state === 'held' && st?.key.includes('فضي'), 'P1 given a silver key from his profile', st?.key);
await openProfile(A, ...P2); await permClick(A, 'منح', 'silver');
await openProfile(A, ...P3); await permClick(A, 'منح', 'silver');
check((await perm(A))?.tiers.silver?.state === 'held', 'P3 given the third silver key');
await openProfile(A, ...P4);
st = await perm(A);
check(st?.tiers.silver?.state === 'full' && st?.tiers.silver?.text.includes('مشغولة'), 'silver is full for P4', st?.tiers.silver?.text);
await permClick(A, 'تسليم بدلًا من', 'silver');
const holders = await A.evaluate(() => [...document.querySelectorAll('.permfrom .prow')].map(e => e.innerText.replace(/\s+/g, ' ')));
check(holders.length === 3, 'hand-over offer lists the three silver holders', String(holders.length));
await A.evaluate(() => document.querySelector('.page.profile section.perms').scrollIntoView({ block: 'center' })); await wait(200);
await shot(A, 'p2-full-handover-offer');
await A.evaluate(y => [...document.querySelectorAll('.permfrom .prow')].find(e => e.innerText.includes(y)).click(), P1[1]); await wait(1800);
check((await perm(A))?.tiers.silver?.state === 'held', 'P4 took P1\'s silver seat in one step');
await openProfile(A, ...P1);
check((await perm(A))?.key === 'بلا مفتاح', 'P1 no longer holds a key');

// hand over from a holder's profile to someone else, through the picker
await openProfile(A, ...P2);
await permClick(A, 'تسليم المفتاح إلى');
check(await A.evaluate(() => document.querySelector('.searchpage .shead b')?.innerText.includes('فضي')), 'the picker opens for P2\'s silver seat');
const offered = await A.evaluate(() => [...document.querySelectorAll('.results .prow')].map(e => e.innerText));
check(offered.length > 0 && !offered.some(t => t.includes('1953') && t.includes('ماجد')) && !offered.some(t => t.includes('هشام')), 'picker offers only eligible people (not P2, not current silvers)', String(offered.length));
await pickResult(A, ...P5);
st = await perm(A);
check(st?.key === 'بلا مفتاح', 'P2\'s key moved away', st?.key);
await openProfile(A, ...P5);
check((await perm(A))?.tiers.silver?.state === 'held', 'P5 now holds the silver key');

// take a key back
await openProfile(A, ...P3);
await permClick(A, 'سحب المفتاح');
check((await perm(A))?.key === 'بلا مفتاح', 'P3\'s key taken back');

// view all on and off
await openProfile(A, ...P4);
await permClick(A, 'مفعّلة');
check((await perm(A))?.viewAll === 'مفعّلة', 'view all switched on');
await permClick(A, 'موقوفة');
check((await perm(A))?.viewAll === 'موقوفة', 'view all switched off');
await permClick(A, 'مفعّلة');

// a gold key for a silver holder frees his silver seat; platinum hand-over from the full seat
await permClick(A, 'منح', 'gold');
st = await perm(A);
check(st?.tiers.gold?.state === 'held' && st?.tiers.silver?.state === 'open', 'P4 moved from silver to gold', JSON.stringify(st?.tiers));
await openProfile(A, ...P1); await permClick(A, 'منح', 'platinum');
check((await perm(A))?.tiers.platinum?.state === 'held', 'P1 given platinum');
await openProfile(A, ...P2);
check((await perm(A))?.tiers.platinum?.state === 'full', 'platinum is taken for P2');
await permClick(A, 'تسليم بدلًا من', 'platinum');
await A.evaluate(() => document.querySelector('.permfrom .prow').click()); await wait(1800);
check((await perm(A))?.tiers.platinum?.state === 'held', 'platinum handed from P1 to P2 in one step');

// a personal invite from the profile
await openProfile(A, ...P5);
await permClick(A, 'دعوة');
check(await until(A, () => !!document.querySelector('.modal.invite .qr svg')), 'invite QR shown from the profile');
const link5 = await lastInviteLink(A);
await click(A, 'إغلاق', '.mhead button');
check((await perm(A))?.phone === 'دعوة بانتظار الانضمام', 'profile shows the pending invite');
await permClick(A, 'عرض الدعوة');
check(await until(A, () => !!document.querySelector('.modal.invite .qr svg')), 'the pending invite can be shown again');
await click(A, 'إغلاق', '.mhead button');

const B = await phone('B', link5);
await click(B, 'نعم، أنا'); await wait(1500);
check(await until(B, () => !!document.querySelector('.tabs')), 'P5\'s phone joined');
check(await until(A, () => document.querySelector('.page.profile section.perms')?.innerText.includes('انضم من هاتفه'), null, 10000), 'root admin\'s profile view shows P5 joined');
await toPerms(A); await shot(A, 'p4-joined');

// a member's phone sees no permissions controls
await openProfile(B, ...P4);
check(await B.evaluate(() => !!document.querySelector('.page.profile') && !document.querySelector('section.perms') && !document.body.innerText.includes('الصلاحيات')), 'a member sees no permissions on others\' profiles');
await B.evaluate(() => [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا'))?.click()); await wait(400);
await B.evaluate(() => document.querySelector(':is(.page.me, .page.admin) .card .prow')?.click()); await wait(600);
check(await B.evaluate(() => !!document.querySelector('.page.profile') && !document.querySelector('section.perms')), 'nor on his own profile');

// the platinum holder: view all only
await openProfile(A, ...P2);
await permClick(A, 'دعوة');
const link2 = await lastInviteLink(A);
await click(A, 'إغلاق', '.mhead button');
const P = await phone('P', link2);
await click(P, 'نعم، أنا'); await wait(1500);
await openProfile(P, ...P3);
st = await perm(P);
check(!!st && st.viewAll === 'موقوفة' && !st.keyCard && !st.phoneCard && st.phone === null, 'platinum holder sees only view all on a profile', JSON.stringify(st && [st.viewAll, st.keyCard, st.phoneCard, st.phone]));
await shot(P, 'p5-platinum-view');
await permClick(P, 'مفعّلة');
check((await perm(P))?.viewAll === 'مفعّلة', 'platinum holder switched view all on for P3');
await openProfile(A, ...P3);
check(await until(A, () => document.querySelector('.page.profile section.perms .seg.viewall .on')?.innerText.includes('مفعّلة'), null, 10000), 'root admin sees the platinum holder\'s change');

// unlink P5's phone: his profile is back to "not invited" and his phone forgets the family
await openProfile(A, ...P5);
await permClick(A, 'فصل الجهاز');
st = await perm(A);
check(st?.phone === 'فُصل جهازه' && st.text.includes('دعوة شخصية'), 'unlinked: said so, and the profile offers a new invite', st?.phone);
check(await until(B, () => document.querySelector('.join h2')?.innerText.includes('انتهى') && !localStorage.getItem('ft-family'), null, 12000), 'P5\'s phone wiped the family');

// cancel an unused invite
await openProfile(A, ...P6);
await permClick(A, 'دعوة');
await click(A, 'إغلاق', '.mhead button');
await permClick(A, 'إلغاء الدعوة');
check((await perm(A))?.phone === 'أُلغيت دعوته', 'pending invite cancelled from the profile');

// the keys screen shows the same seats as the profiles
const seats = await keySeats(A);
const expect = ['gold|هشام', 'platinum|ماجد', 'silver|سامي'];
check(JSON.stringify(seats) === JSON.stringify(expect), 'keys screen seats match the profiles', seats.join(', '));
await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
await A.evaluate(() => [...document.querySelectorAll('button.keyrow')].find(b => b.classList.contains('gold') && !b.classList.contains('empty')).click()); await wait(900);
st = await perm(A);
const inView = await A.evaluate(() => { const r = document.querySelector('.page.profile section.perms')?.getBoundingClientRect(); return !!r && r.top >= 0 && r.top < innerHeight / 2; });
check(st?.tiers.gold?.state === 'held' && inView, 'tapping a seat opens the holder\'s profile at «الصلاحيات»');
await shot(A, 'p6-from-keys');
await closeProfile(A);
await A.evaluate(() => [...document.querySelectorAll(':is(.page.me, .page.admin) .prow .pt.tap')].find(e => e.innerText.includes('ماجد'))?.click()); await wait(900);
check((await perm(A))?.tiers.platinum?.state === 'held', 'tapping a member in the members list opens his permissions');

// the root admin's own profile: linked with the admin key, nothing to invite
await openProfile(A, 'منصور', '1963');
st = await perm(A);
check(st?.phone === 'هاتف مشرف العائلة' && !st?.text.includes('دعوة شخصية'), 'own profile: the root admin\'s phone, no invite offered', st?.phone);

// unavailable options say why: a person recorded as deceased while view all is still on
await openProfile(A, ...P3);
await click(A, 'تعديل البيانات');
await click(A, 'متوفى', '.seg button');
await click(A, 'حفظ', '.foot button'); await wait(1200);
st = await perm(A);
check(!!st && Object.keys(st.tiers).length === 0 && st.text.includes('لا يمكن أن يحمل مفتاحًا') && st.text.includes('للأحياء') && !st.phoneCard && st.phone === '—', 'deceased: no key possible, said once with the reason; nothing to invite', JSON.stringify(st && [st.tiers, st.phone, st.phoneCard]));
await toPerms(A); await shot(A, 'p7-unavailable');
await permClick(A, 'موقوفة');
check(await until(A, () => !!document.querySelector('.page.profile') && !document.querySelector('section.perms')), 'deceased with nothing left to undo: no permissions section');

// another phone with the admin key replays the log and agrees
const C = await phone('C', adminLink);
await click(C, 'تصفّح');
check(JSON.stringify(await keySeats(C)) === JSON.stringify(expect), 'a second admin phone replays the same seats');
await openProfile(C, ...P4);
st = await perm(C);
check(st?.viewAll === 'مفعّلة' && st?.tiers.gold?.state === 'held', 'and the same view all and key on a profile');
await C.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]); await wait(400);
await toPerms(C); await shot(C, 'p8-light');

// the sample family keeps today's profile and seat sheet
const S = await phone('S', BASE + '/');
await click(S, 'جرّب العائلة التجريبية'); await wait(1200);
await click(S, 'تصفّح');
await S.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await wait(500);
await S.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
await S.evaluate(() => document.querySelector('button.keyrow:not(.empty)')?.click()); await wait(600);
check(await S.evaluate(() => [...document.querySelectorAll('.modal button')].some(b => b.textContent.includes('تسليم المفتاح لشخص آخر'))), 'sample: a seat still opens its seat sheet');
await S.evaluate(() => document.querySelector('.modal .prow')?.click()); await wait(700);
check(await S.evaluate(() => !!document.querySelector('.page.profile') && !document.querySelector('section.perms')), 'sample: profiles have no permissions section');

await browser.close();
if (errs.length) { failed++; console.log('FAIL page errors:\n' + errs.join('\n')); }
console.log(failed ? `FAIL (${failed})` : 'PASS');
process.exit(failed ? 1 : 0);
