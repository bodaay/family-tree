// Integration: the Face ID lock, the recovery kit and key renewal together.
//   node int-kit-rotation.mjs <BASE url> <admin-link file>
// - A member B turns the Face ID lock on; his sealed membership takes the new key
//   versions as the root admin renews the key, and he keeps reading.
// - A kit B made after a renewal carries every key version: restored on phone C,
//   C's membership holds them all and C reads on.
// - A kit B made before the renewal, restored on phone D, still opens everything:
//   the renewal reached B's device key, which D now holds.
// - (feat/multidevice) every restored phone has a device key of its own, added
//   by the kit's backup key; the late kit keeps the early one («إبطال المفتاح
//   السابق» unticked). Later renewals reach C and D through their own keys.
// - «جهاز جديد» on B's phone unlinks only that phone: B forgets the family, C and
//   D read on after the renewal, and the new invite opens on phone E.
// - «فصل كل أجهزته» on his profile: C, D and E forget the family, and both kits
//   (their backup keys) stop working.
import { adminLink, phone, click, pick, check, wait, text, meName, openMe, openAdmin, lastInvite, run } from './locklib.mjs';

const fid = adminLink.match(/join=([a-z0-9]+)\./)[1];
const base = adminLink.slice(0, adminLink.indexOf('/#'));
const versions = async () => new Set((await (await fetch(`${base}/api/f/${fid}/log?after=-1`)).json()).entries.map(e => e.kid)).size;
const until = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { /* not yet */ }
    if (v || Date.now() > end) return v;
    await wait(500);
  }
};
// made-up names, unique to this run, so a search finds only the one just added
const LETTERS = 'ابتثجحخدذر';
let n = 0;
const fresh = () => 'تجربة' + String(Date.now() + n++).slice(-4).split('').map(d => LETTERS[+d]).join('');

/** The root admin adds a son under himself, directly. */
async function addSon(A, name) {
  await click(A, 'الشجرة', '.tab');
  await A.evaluate(() => document.querySelector('.fab').click());
  await wait(700);
  await click(A, 'ابن', '.bigchoice button');
  await click(A, 'التالي');
  await A.type('.bigin', name, { delay: 10 });
  await click(A, 'التالي');
  await click(A, 'متابعة', '.modal button');
  await click(A, 'التالي');
  await click(A, 'إضافة إلى الشجرة', '.foot button');
  await click(A, 'متابعة', '.modal button');
  await wait(1500);
}
/** How many people this phone finds by that name (son of منصور). */
async function finds(p, name) {
  await click(p, 'الشجرة', '.tab');
  await p.evaluate(() => document.querySelector('.home .search')?.click());
  await wait(400);
  await p.type('.sfield input', name + ' منصور', { delay: 10 });
  await wait(600);
  const c = await p.evaluate(() => document.querySelectorAll('.results .prow').length);
  await p.evaluate(() => document.querySelector('.searchpage .round')?.click());
  await wait(300);
  return c;
}
async function makeKit(p, keepOld = false) {
  await openMe(p);
  await click(p, 'مفتاح الاستعادة', '.card.cta');
  const words = await p.evaluate(() => [...document.querySelectorAll('.modal.kit .words span')].map(s => s.lastChild.textContent.trim()).join(' '));
  await p.evaluate(() => document.querySelector('.modal.kit .opt input').click());
  if (keepOld) await p.evaluate(() => document.querySelector('.modal.kit input.replace')?.click());
  await wait(200);
  await click(p, 'إنشاء المفتاح');
  await p.waitForFunction(() => [...document.querySelectorAll('.modal.kit button')].some(b => b.textContent.trim() === 'نسخ'), { timeout: 30000 });
  await click(p, 'نسخ', '.modal.kit button');
  const link = await p.evaluate(() => window.__copied);
  await click(p, 'إغلاق', '.mhead button');
  return [link, words];
}
async function restore(name, link, words) {
  const p = await phone(name, link);
  await p.type('.join .bigin', words, { delay: 5 });
  await click(p, 'استعادة', '.join button');
  await p.waitForFunction(() => !!document.querySelector('.tabs'), { timeout: 30000 });
  await wait(1500);
  return p;
}
const renew = async A => {
  const before = await versions();
  await openAdmin(A);
  await A.evaluate(() => [...document.querySelectorAll('.card.cta.renew button')].find(b => b.textContent.includes('تجديد'))?.click());
  return until(async () => (await versions()) > before);
};
const ringSize = p => p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ft-family') ?? '{}').keys ?? {}).length);
const ended = p => p.evaluate(() => !!document.querySelector('.join h2')?.innerText.includes('انتهى دخولك') && !localStorage.getItem('ft-family'));
// (fix-review) a kit that no longer works is refused before the phone changes: it says so, and stores nothing
const kitRefused = p => p.evaluate(() => (document.querySelector('.join .warnbox')?.innerText ?? '').includes('لم يعد مفتاح الاستعادة هذا يعمل') && !localStorage.getItem('ft-family'));

await run(async () => {
  // the root admin, linked to his place, invites B
  const A = await phone('A', adminLink);
  await click(A, 'اربط باسمي');
  await pick(A, 'منصور', '1963');
  await openAdmin(A);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await pick(A, 'يوسف', '');
  const bInvite = await lastInvite(A);
  await click(A, 'إغلاق', '.mhead button');

  // B joins and turns the Face ID lock on
  const B = await phone('B', bInvite, { prf: true });
  await click(B, 'نعم، أنا');
  await wait(1500);
  await openMe(B);
  const who = await meName(B);
  check(!!who, 'B joined', who);
  await B.evaluate(() => [...document.querySelectorAll('section')].find(s => s.querySelector('h3')?.textContent === 'الأمان').querySelector('.seg button').click());
  await wait(2500);
  check(await B.evaluate(() => !!localStorage.getItem('ft-lock') && localStorage.getItem('ft-family').startsWith('ftlock1:')), 'B: the lock is on and the membership is sealed');
  const [early, earlyWords] = await makeKit(B);
  check(/\/#restore=/.test(early ?? ''), 'B made a kit before any renewal');

  // the root admin renews the key by hand, then adds someone
  check(!!(await renew(A)), 'the root admin renewed the family key (version 2)');
  const after1 = fresh();
  await addSon(A, after1);
  check((await until(() => finds(B, after1))) > 0, 'B (locked phone) reads what was added after the renewal');

  // B reloads: Face ID opens the sealed membership, which now holds both key versions
  await B.reload({ waitUntil: 'networkidle0' });
  await wait(1200);
  check(await B.evaluate(() => [...document.querySelectorAll('.join button')].some(b => b.textContent.includes('افتح بالبصمة'))), 'B opens locked after a reload');
  await click(B, 'افتح بالبصمة');
  await B.waitForFunction(() => !!document.querySelector('.tabs'), { timeout: 20000 });
  check((await finds(B, after1)) > 0, 'B after Face ID still reads after the renewal');

  // a kit made now carries both versions (and keeps the early kit working)
  const [late, lateWords] = await makeKit(B, true);
  const C = await restore('C', late, lateWords);
  await openMe(C);
  check((await meName(C)) === who, 'C restored from the late kit as the same person', await meName(C));
  const cKey = (await C.evaluate(() => JSON.parse(localStorage.getItem('ft-device')))).pk;
  check((await ringSize(C)) >= 2, 'C: the late kit carried every key version', String(await ringSize(C)));
  check((await finds(C, after1)) > 0, 'C reads what was added after the renewal');

  // the early kit (made before the renewal) on D: the renewal reached B's device key
  const D = await restore('D', early, earlyWords);
  await openMe(D);
  check((await meName(D)) === who, 'D restored from the early kit as the same person', await meName(D));
  check((await finds(D, after1)) > 0, 'D (early kit: the renewal reached its backup key) reads what was added after the renewal');
  const dKey = (await D.evaluate(() => JSON.parse(localStorage.getItem('ft-device')))).pk;
  check(!!cKey && !!dKey && cKey !== dKey, 'C and D each have their own device key');
  await openMe(B);
  const listed = await B.evaluate(() => [...document.querySelectorAll('.mydevs .devlist .prow')].map(r => r.innerText.replace(/\s+/g, ' ')));
  check(listed.length === 5 && listed.filter(x => x.includes('مفتاح الاستعادة')).length >= 2, 'B (sealed storage: its key stays sealed) lists his phone, C, D and both backup keys: three device keys', listed.join(' | '));

  // another renewal reaches B, C and D (each through its own key)
  check(!!(await renew(A)), 'the root admin renewed the family key again (version 3)');
  const after2 = fresh();
  await addSon(A, after2);
  for (const [name, p] of [['B', B], ['C', C], ['D', D]]) check((await until(() => finds(p, after2))) > 0, `${name} reads on after the second renewal`);
  check((await ringSize(C)) >= 3, 'C keeps every key version', String(await ringSize(C)));

  // «جهاز جديد» on B's phone: only that device key is unlinked, and the key renewed
  const v = await versions();
  await openAdmin(A);
  const replaced = await A.evaluate(n => {
    const row = [...document.querySelectorAll(':is(.page.me, .page.admin) .prow')].find(e => e.querySelector('.pt b')?.innerText.replace(/\s+/g, ' ').trim() === n && [...e.querySelectorAll('button')].some(b => b.textContent.includes('جهاز جديد')));
    [...(row?.querySelectorAll('button') ?? [])].find(b => b.textContent.includes('جهاز جديد'))?.click();
    return !!row;
  }, who);
  check(replaced, 'the root admin taps «جهاز جديد» for B');
  check(!!(await until(() => A.evaluate(() => !!document.querySelector('.modal.invite')))), 'a new invite opens for the same person');
  check(!!(await until(async () => (await versions()) > v)), 'replacing the phone renewed the family key');
  const eInvite = await lastInvite(A);
  await click(A, 'إغلاق', '.mhead button');
  check(!!(await until(() => ended(B), 25000)), 'B (the replaced phone) forgets the family');
  const after3 = fresh();
  await addSon(A, after3);
  for (const [name, p] of [['C', C], ['D', D]]) check((await until(() => finds(p, after3))) > 0, `${name} (its own device key) reads on after that renewal`);
  const E = await phone('E', eInvite);
  await click(E, 'نعم، أنا');
  await wait(1800);
  await openMe(E);
  check((await meName(E)) === who, 'the new phone joins as the same person', await meName(E));
  check((await finds(E, after2)) > 0, 'the new phone reads the whole family');

  // «فصل كل أجهزته» on his profile: every phone and both backup keys, one renewal
  const v2 = await versions();
  await openAdmin(A);
  await A.evaluate(n => [...document.querySelectorAll(':is(.page.me, .page.admin) .prow')].find(e => e.querySelector('.pt b')?.innerText.replace(/\s+/g, ' ').trim() === n)?.querySelector('button.pt').click(), who);
  await wait(1200);
  check(await click(A, 'فصل كل أجهزته', '.page.profile section.perms .permphone button.prow'), 'the root admin unlinks all his devices from his profile');
  check(!!(await until(async () => (await versions()) > v2)), 'the family key is renewed');
  for (const [name, p] of [['C', C], ['D', D], ['E', E]]) check(!!(await until(() => ended(p), 25000)), `${name} forgets the family`);
  for (const [name, link, words] of [['K1', early, earlyWords], ['K2', late, lateWords]]) {
    const p = await phone(name, link);
    await p.type('.join .bigin', words, { delay: 5 });
    await click(p, 'استعادة', '.join button');
    await p.waitForFunction(() => /انتهى/.test(document.querySelector('.join h2')?.innerText ?? '') || !!document.querySelector('.join .warnbox') || !!document.querySelector('.tabs'), { timeout: 30000 });
    check(await kitRefused(p), `${name === 'K1' ? 'the early' : 'the late'} kit no longer opens the family`);
  }
  void text;
});
