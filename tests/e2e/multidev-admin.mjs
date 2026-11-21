// Multiple devices (feat/multidevice): the root admin, from a profile's «الصلاحيات».
//   node multidev-admin.mjs <BASE url> <admin-link file>
// - B joined on one phone: his profile offers «جهاز إضافي» (not «دعوة»). It
//   shows an invite that adds a device, which B's own أجهزتي lists as waiting
//   (from the root admin); a second phone opens it and joins as B.
// - The profile says he joined from two devices and lists each by name, with
//   «فصل كل أجهزته»; a rename on his phone shows there.
// - «فصل الجهاز» on one device: that phone forgets the family, the other stays,
//   the key is renewed. After B makes a kit, its backup key is listed too.
// - «فصل كل أجهزته»: his phone forgets the family, the key is renewed once, the
//   kit no longer opens, and the profile offers a new invite.
import { check, run, wait, until, phone, click, tab, ready, ended, rootAdmin, invite, copyLink, myDevices, deviceButton, keyVersions, meName, openProfile, perm, permButton, text, dialogs } from './multidev-lib.mjs';
// (fix-review) a kit that no longer works is refused before the phone changes: it says so, and stores nothing
const kitRefused = p => p.evaluate(() => (document.querySelector('.join .warnbox')?.innerText ?? '').includes('لم يعد مفتاح الاستعادة هذا يعمل') && !localStorage.getItem('ft-family'));

async function renameHere(p, name) {
  await deviceButton(p, 'هذا الجهاز', 'تسمية');
  await p.evaluate(n => {
    const inp = document.querySelector('.mydevs .devedit input');
    inp.value = n;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, name);
  await click(p, 'حفظ', '.mydevs .devedit button');
  await wait(1200);
}
async function makeKit(p) {
  await tab(p, 'أنا');
  await click(p, 'مفتاح الاستعادة', '.card.cta');
  const words = await p.evaluate(() => [...document.querySelectorAll('.modal.kit .words span')].map(s => s.lastChild.textContent.trim()).join(' '));
  await p.evaluate(() => document.querySelector('.modal.kit .opt input').click());
  await wait(200);
  await click(p, 'إنشاء المفتاح');
  await p.waitForFunction(() => [...document.querySelectorAll('.modal.kit button')].some(b => b.textContent.trim() === 'نسخ'), { timeout: 30000 });
  await p.evaluate(() => { window.__copied = null; });
  await click(p, 'نسخ', '.modal.kit button');
  const link = await p.evaluate(() => window.__copied);
  await click(p, 'إغلاق', '.mhead button');
  return { link, words };
}

await run(async () => {
  const A = await rootAdmin();
  const b = await invite(A, 'محمد', [await meName(A)]);
  const B1 = await phone('B1', b.link);
  await click(B1, 'نعم، أنا');
  await until(() => ready(B1));
  const who = await meName(B1);
  check(await ready(B1), 'B joined on one phone', who);

  // ---- «جهاز إضافي» on his profile
  await openProfile(A, who);
  let st = await until(async () => ((await perm(A))?.phone === 'انضم من هاتفه' ? perm(A) : null));
  check(!!st, 'his profile shows him joined', JSON.stringify(await perm(A)));
  check(!!st && st.rows.some(r => r.startsWith('جهاز إضافي')) && !st.rows.some(r => r.startsWith('دعوة دعوة')) && !st.rows.some(r => r.includes('فصل كل')), 'it offers «جهاز إضافي» (no «دعوة», nothing to unlink all of)', JSON.stringify(st?.rows));
  check(await permButton(A, 'جهاز إضافي', ''), 'the root admin taps «جهاز إضافي»');
  const hint = await until(() => A.evaluate(() => document.querySelector('.modal.invite .qr svg') && document.querySelector('.modal.invite .hint').innerText));
  check(!!hint && hint.includes('يُضاف إلى أجهزته'), 'the invite says it adds a device to his', hint);
  const link2 = await copyLink(A);
  check(!!(await until(async () => (await myDevices(B1)) && (await text(B1, '.mydevs .devlist')).includes('من مشرف العائلة'))), 'B\'s أجهزتي lists the waiting invite, from the root admin');
  const B2 = await phone('B2', link2);
  check((await text(B2, '.join h2')).includes('إضافة جهاز'), 'the second phone is asked to join as an added device');
  await click(B2, 'نعم، أنا');
  check(!!(await until(() => ready(B2))) && (await meName(B2)) === who, 'the second phone joins as B');
  await renameHere(B2, 'هاتف ثان');

  // ---- the profile: two devices, by name
  st = await until(async () => {
    const p = await perm(A);
    return p?.phone === 'انضم من جهازين' && p.rows.some(r => r.includes('هاتف ثان')) ? p : null;
  });
  check(!!st, 'his profile says he joined from two devices, by name', JSON.stringify(await perm(A)));
  check(!!st && st.rows.filter(r => r.includes('جهاز جديد') && r.includes('فصل الجهاز')).length === 2 && st.rows.some(r => r.includes('فصل كل أجهزته')), 'each device has «جهاز جديد» and «فصل الجهاز», and «فصل كل أجهزته» is there', JSON.stringify(st?.rows));

  // ---- one device unlinked
  const v0 = await keyVersions();
  const asked = dialogs.length;
  check(await permButton(A, 'هاتف ثان', 'فصل الجهاز'), 'the root admin unlinks the second phone');
  check(dialogs.length === asked + 1, 'after asking');
  check(!!(await until(() => ended(B2), 15000)), 'that phone forgets the family');
  check(!!(await until(async () => (await keyVersions()) > v0, 15000)), 'the family key is renewed');
  check((await ready(B1)) && !(await ended(B1)), 'his other phone stays');
  check(!!(await until(async () => (await perm(A))?.phone === 'انضم من هاتفه')), 'the profile shows one phone again');

  // ---- a kit: its backup key is listed; then everything is unlinked at once
  const kit = await makeKit(B1);
  check(!!(await until(async () => (await perm(A))?.rows.some(r => r.includes('مفتاح الاستعادة') && r.includes('إبطال')))), 'the profile lists his backup key, which can be taken away');
  const v1 = await keyVersions();
  check(await click(A, 'فصل كل أجهزته', '.page.profile section.perms .permphone button.prow'), 'the root admin taps «فصل كل أجهزته»');
  check(dialogs.at(-1).startsWith('فصل كل أجهزة'), 'after asking', dialogs.at(-1));
  check(!!(await until(() => ended(B1), 15000)), 'his phone forgets the family');
  check(!!(await until(async () => (await keyVersions()) > v1, 15000)), 'the family key is renewed');
  await wait(4000);
  check((await keyVersions()) === v1 + 1, 'once');
  check(!!(await until(async () => (await perm(A))?.phone === 'فُصل جهازه')), 'the profile says his phone was unlinked, and offers a new invite', JSON.stringify(await perm(A)));
  const K = await phone('K', kit.link);
  await K.type('.join .bigin', kit.words, { delay: 5 });
  await click(K, 'استعادة', '.join button');
  await K.waitForFunction(() => /انتهى/.test(document.querySelector('.join h2')?.innerText ?? '') || !!document.querySelector('.join .warnbox') || !!document.querySelector('.tabs'), { timeout: 40000 });
  await wait(1000);
  check(await kitRefused(K), 'his kit no longer opens the family');
});
