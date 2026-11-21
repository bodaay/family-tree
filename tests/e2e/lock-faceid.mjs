// Face ID lock: the root admin turns it on, the app opens locked, Face ID opens
// it to the same admin state, and storage holds no plain family key or device
// secret. A phone whose passkeys cannot do PRF is told so and stays unlocked.
// Turning the lock off brings plain storage back. The sample family still works.
//   node lock-faceid.mjs <BASE url> <admin-link file>
import { BASE, adminLink, phone, click, pick, check, wait, text, meName, openMe, storageDump, run } from './locklib.mjs';

await run(async () => {
  // the root admin, linked to his place in the tree
  const A = await phone('A', adminLink, { prf: true });
  await click(A, 'اربط باسمي');
  await pick(A, 'منصور', '1963');
  await openMe(A);
  const who = await meName(A);
  check(!!who, 'admin is linked to a person', who);
  check((await A.evaluate(() => [...document.querySelectorAll('.tab')].some(e => e.textContent.includes('الإدارة')) || (document.querySelector('.page.me')?.innerText ?? '').includes('مشرف العائلة'))), 'admin note shown before the lock');
  const secrets = await A.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('ft-family'));
    const d = JSON.parse(localStorage.getItem('ft-device'));
    return [m.key, m.admin, d.sk].filter(Boolean);
  });
  check(secrets.length === 3, 'plain storage holds family key, admin key and device secret before the lock');
  // a field a later version may add to the membership must pass through the lock untouched
  await A.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('ft-family'));
    localStorage.setItem('ft-family', JSON.stringify({ ...m, futureField: { kept: [1, 2] } }));
  });

  // turn the lock on
  check((await text(A, ':is(.page.me, .page.admin)')).includes('الأمان'), 'أنا has a «الأمان» section');
  await A.evaluate(() => [...document.querySelectorAll('section')].find(s => s.querySelector('h3')?.textContent === 'الأمان').querySelector('.seg button').click());
  await wait(2500);
  check(await A.evaluate(() => !!localStorage.getItem('ft-lock')), 'lock record saved after Face ID');
  check((await text(A, '.toast')).includes('فُعّل قفل البصمة') || (await text(A, ':is(.page.me, .page.admin)')).includes('مشفّرة'), 'the app says the lock is on');
  let dump = await storageDump(A);
  check(secrets.every(x => !dump.includes(x)), 'no secret in storage right after locking');
  check(await A.evaluate(() => !localStorage.getItem('ft-family').startsWith('{')), 'membership is sealed at rest');

  // open again: the lock screen comes first, before the family loads
  await A.reload({ waitUntil: 'networkidle0' });
  await wait(1200);
  check((await text(A, '.join h2')).includes('مقفل'), 'reload shows the lock screen');
  check(await A.evaluate(() => [...document.querySelectorAll('.join button')].some(b => b.textContent.includes('افتح بالبصمة'))), 'lock screen offers «افتح بالبصمة»');
  check(!(await A.evaluate(() => !!document.querySelector('.tabs'))), 'the family is not shown while locked');
  await click(A, 'افتح بالبصمة');
  await wait(2500);
  check(await A.evaluate(() => !!document.querySelector('.tabs')), 'Face ID opens the family');
  await openMe(A);
  check((await meName(A)) === who, 'same person after unlocking', await meName(A));
  check((await A.evaluate(() => [...document.querySelectorAll('.tab')].some(e => e.textContent.includes('الإدارة')) || (document.querySelector('.page.me')?.innerText ?? '').includes('مشرف العائلة'))), 'still the root admin after unlocking');
  dump = await storageDump(A);
  check(secrets.every(x => !dump.includes(x)), 'no secret in storage after unlocking');
  // the admin can still write: give someone view all, and the log grows by one entry
  const logCount = () => A.evaluate(async () => {
    if (!document.querySelector('.page.me')) { [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا'))?.click(); await new Promise(r => setTimeout(r, 500)); }
    const row = [...document.querySelectorAll(':is(.page.me, .page.admin) .srow')].find(r => r.innerText.includes('التغييرات في السجل'));
    return Number(row?.querySelector('b').innerText.split('·')[1]);
  });
  const before = await logCount();
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'منح فرد مشاهدة الكل');
  await pick(A, 'محمد', '');
  await wait(1200);
  check((await logCount()) === before + 1, 'admin can still sign changes while locked at rest', before + ' → ' + (await logCount()));

  // a phone whose passkeys cannot do PRF: said plainly, nothing pretends to be locked
  const N = await phone('N', adminLink, { prf: false });
  await click(N, 'تصفّح');
  await openMe(N);
  const nSecrets = await N.evaluate(() => [JSON.parse(localStorage.getItem('ft-family')).key, JSON.parse(localStorage.getItem('ft-device')).sk]);
  await N.evaluate(() => [...document.querySelectorAll('section')].find(s => s.querySelector('h3')?.textContent === 'الأمان').querySelector('.seg button').click());
  await wait(2500);
  const nText = await text(N, ':is(.page.me, .page.admin)');
  check(nText.includes('لا يستطيع فتح المفاتيح بالبصمة') || nText.includes('غير متاح'), 'no PRF: the app says the lock cannot be used');
  check(await N.evaluate(() => !localStorage.getItem('ft-lock')), 'no PRF: no lock record');
  const nDump = await storageDump(N);
  check(nSecrets.every(x => nDump.includes(x)), 'no PRF: storage stays as it was');
  await N.reload({ waitUntil: 'networkidle0' });
  await wait(1200);
  check(await N.evaluate(() => !!document.querySelector('.tabs')), 'no PRF: the app opens without a lock screen');

  // a passkey that gives its secret only when used, where each tap allows one prompt: a second tap finishes
  const L = await phone('L', adminLink, { late: true });
  await click(L, 'تصفّح');
  await openMe(L);
  const lockSeg = () => L.evaluate(() => [...document.querySelectorAll('section')].find(s => s.querySelector('h3')?.textContent === 'الأمان').querySelector('.seg button').click());
  await lockSeg();
  await wait(1200);
  check((await text(L, ':is(.page.me, .page.admin)')).includes('اضغط «مفعّل» مرة أخرى'), 'late PRF: asks for one more tap');
  check(await L.evaluate(() => !localStorage.getItem('ft-lock')), 'late PRF: not locked yet');
  await lockSeg();
  await wait(1200);
  check(await L.evaluate(() => !!localStorage.getItem('ft-lock') && !localStorage.getItem('ft-device').startsWith('{')), 'late PRF: the second tap turns the lock on');

  // turning the lock off (with Face ID) restores plain storage
  await A.evaluate(() => [...document.querySelectorAll('section')].find(s => s.querySelector('h3')?.textContent === 'الأمان').querySelectorAll('.seg button')[1].click());
  await wait(2500);
  check(await A.evaluate(() => !localStorage.getItem('ft-lock')), 'lock off: record removed');
  const plain = await A.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('ft-family'));
    const d = JSON.parse(localStorage.getItem('ft-device'));
    return [m.key, m.admin, d.sk];
  });
  check(plain.join() === secrets.join(), 'lock off: the same keys are back in plain storage');
  check(await A.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('ft-family')).futureField) === '{"kept":[1,2]}'), 'lock off: an unknown membership field came through untouched');
  await A.reload({ waitUntil: 'networkidle0' });
  await wait(1500);
  await openMe(A);
  check((await meName(A)) === who, 'lock off: opens straight to the same person');

  // the sample family, on a phone that has never joined
  const S = await phone('S', BASE + '/');
  await click(S, 'جرّب العائلة التجريبية');
  await wait(1500);
  const people = await text(S, '.top .sub b');
  check(/\d/.test(people), 'sample family opens', people);
  await openMe(S);
  check(!(await text(S, ':is(.page.me, .page.admin)')).includes('الأمان'), 'sample family has no security section');
});
