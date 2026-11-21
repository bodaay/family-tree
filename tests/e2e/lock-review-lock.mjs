// Review: the Face ID lock under pressure.
// - Another tab of the same phone starts again locked when the lock is turned on.
// - Back after more than five minutes away, the app locks again; after a short
//   absence it does not.
// - Deleting the lock record (someone with the phone and developer tools) shows
//   nothing and exposes nothing: the sealed values stay sealed; putting the
//   record back opens as before.
// - A locked member whose phone the admin replaced («جهاز جديد») opens to
//   «انتهى دخولك» after Face ID, and the family key is gone.
// - Leaving the family with the lock on: the sample family can still switch the
//   lock off, and then opens without Face ID.
//   node lock-review-lock.mjs <BASE url> <admin-link file>
import { BASE, adminLink, phone, click, pick, check, wait, text, meName, openMe, openAdmin, lastInvite, storageDump, run } from './locklib.mjs';

const lockSeg = (p, i) => p.evaluate(i => [...document.querySelectorAll('section')].find(s => s.querySelector('h3')?.textContent === 'الأمان').querySelectorAll('.seg button')[i].click(), i);
const locked = async p => (await text(p, '.join h2')).includes('مقفل');
const opened = p => p.evaluate(() => !!document.querySelector('.tabs'));
const secretsOf = p => p.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('ft-family'));
  const d = JSON.parse(localStorage.getItem('ft-device'));
  return [m.key, m.admin, d.sk].filter(Boolean);
});

await run(async () => {
  const A = await phone('A', adminLink, { prf: true });
  await click(A, 'تصفّح');
  await openMe(A);
  const secrets = await secretsOf(A);

  // a second tab on the same phone, open on the family
  const T = await A.browserContext().newPage();
  const tErrs = [];
  T.on('pageerror', e => tErrs.push(e.message));
  T.on('console', m => m.type() === 'error' && tErrs.push(m.text()));
  await T.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });
  await T.goto(BASE + '/', { waitUntil: 'networkidle0' });
  await wait(1200);
  check(await opened(T), 'second tab opens the family');

  await A.bringToFront(); // passkeys need the focused tab
  await lockSeg(A, 0);
  await wait(2500);
  check(await A.evaluate(() => !!localStorage.getItem('ft-lock')), 'lock on');
  await wait(1500);
  check(await locked(T), 'the other tab starts again locked');
  check(!(await opened(T)), 'the other tab no longer shows the family');
  await T.close();
  check(tErrs.length === 0, 'no errors in the other tab', tErrs.join(' | '));

  // a short absence keeps it open; more than five minutes locks it again
  const away = async minutes => {
    await A.evaluate(() => {
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const back = () => A.evaluate(ms => {
      const real = Date.now.bind(Date);
      Date.now = () => real() + ms;
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, minutes * 60 * 1000);
    if (minutes > 5) await Promise.all([A.waitForNavigation({ waitUntil: 'networkidle0' }), back()]);
    else await back();
    await wait(1200);
  };
  await away(1);
  check(await opened(A), 'one minute away: still open');
  await away(6);
  check(await locked(A), 'six minutes away: locked again');
  await click(A, 'افتح بالبصمة');
  await wait(2500);
  check(await opened(A), 'Face ID opens it again');

  // someone deletes the lock record: nothing opens, nothing is exposed, nothing is overwritten
  const rec = await A.evaluate(() => localStorage.getItem('ft-lock'));
  const sealedDevice = await A.evaluate(() => localStorage.getItem('ft-device'));
  await A.evaluate(() => localStorage.removeItem('ft-lock'));
  await A.reload({ waitUntil: 'networkidle0' });
  await wait(1500);
  check(!(await opened(A)), 'without its record the family does not open');
  const dump = await storageDump(A);
  check(secrets.every(x => !dump.includes(x)), 'without its record no secret is readable in storage');
  check((await A.evaluate(() => localStorage.getItem('ft-device'))) === sealedDevice, 'the sealed device key is left as it was');
  await A.evaluate(r => localStorage.setItem('ft-lock', r), rec);
  await A.reload({ waitUntil: 'networkidle0' });
  await wait(1200);
  check(await locked(A), 'record back: lock screen');
  await click(A, 'افتح بالبصمة');
  await wait(2500);
  await openMe(A);
  check((await A.evaluate(() => [...document.querySelectorAll('.tab')].some(e => e.textContent.includes('الإدارة')) || (document.querySelector('.page.me')?.innerText ?? '').includes('مشرف العائلة'))), 'record back: the same root admin');

  // a locked member whose phone the admin replaces
  const AD = await phone('AD', adminLink);
  await click(AD, 'تصفّح');
  await openAdmin(AD);
  await AD.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(AD, 'دعوة فرد');
  await pick(AD, 'عبدالله', '');
  const invite = await lastInvite(AD);
  await click(AD, 'إغلاق', '.mhead button');
  const B = await phone('B', invite, { prf: true });
  await click(B, 'نعم، أنا');
  await wait(1500);
  await openMe(B);
  const who = await meName(B);
  check(!!who, 'member joined', who);
  await lockSeg(B, 0);
  await wait(2500);
  check(await B.evaluate(() => !!localStorage.getItem('ft-lock')), 'member locked his phone');
  await B.reload({ waitUntil: 'networkidle0' });
  await wait(1000);
  check(await locked(B), 'member phone opens locked');
  await wait(2500);
  await openAdmin(AD);
  await AD.evaluate(n => [...[...document.querySelectorAll(':is(.page.me, .page.admin) .prow')].find(e => e.querySelector('.pt b')?.innerText.replace(/\s+/g, ' ').trim() === n && e.querySelector('.pt small.ok')).querySelectorAll('button')].find(b => b.textContent.includes('جهاز جديد')).click(), who);
  await wait(2500);
  await click(AD, 'إغلاق', '.mhead button');
  await click(B, 'افتح بالبصمة');
  await wait(3000);
  check((await text(B, '.join h2')).includes('انتهى دخولك'), 'replaced phone: «انتهى دخولك» after Face ID', await text(B, '.join h2'));
  check(await B.evaluate(() => !localStorage.getItem('ft-family')), 'replaced phone: no family key left');

  // leaving the family with the lock on: the sample family can still switch it off
  await openMe(A);
  await click(A, 'إزالة العائلة من هذا الجهاز');
  await wait(800);
  await A.reload({ waitUntil: 'networkidle0' });
  await wait(1000);
  check(await locked(A), 'after leaving, the phone still opens locked (its key is still sealed)');
  await click(A, 'افتح بالبصمة');
  await wait(2000);
  await click(A, 'جرّب العائلة التجريبية');
  await wait(1500);
  await openMe(A);
  const me = await text(A, ':is(.page.me, .page.admin)');
  check(me.includes('الأمان') && !me.includes('مفتاح الاستعادة'), 'sample family with the lock on shows the lock switch (no kit)');
  await lockSeg(A, 1);
  await wait(2500);
  check(await A.evaluate(() => !localStorage.getItem('ft-lock') && localStorage.getItem('ft-device').startsWith('{')), 'lock switched off from the sample family');
  await A.reload({ waitUntil: 'networkidle0' });
  await wait(1500);
  check(await opened(A), 'sample family opens without Face ID');
  await openMe(A);
  check(!(await text(A, ':is(.page.me, .page.admin)')).includes('الأمان'), 'and the security section is gone again');
});
