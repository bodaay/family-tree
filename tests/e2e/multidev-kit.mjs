// Multiple devices (feat/multidevice): the recovery kit as a backup key.
//   node multidev-kit.mjs <BASE url> <admin-link file>
// - Making a kit adds «مفتاح الاستعادة» to أجهزتي.
// - Restoring it on a fresh phone gives that phone a device key of its own,
//   added to the person's devices (the backup key does not stay on it).
// - From the restored phone he removes the lost phone: it forgets the family,
//   the key is renewed, and the restored phone reads on.
// - Removing the backup key ends the kit: restoring it again opens nothing.
// - A new kit works; another made after it replaces it («إبطال المفتاح
//   السابق», ticked by default): the older no longer opens, the newer does.
import { check, run, wait, until, phone, join, click, tab, ready, ended, rootAdmin, invite, addChild, fresh, people, myDevices, deviceButton, keysOf, keyVersions, meName } from './multidev-lib.mjs';
// (fix-review) a kit that no longer works is refused before the phone changes: it says so, and stores nothing
const kitRefused = p => p.evaluate(() => (document.querySelector('.join .warnbox')?.innerText ?? '').includes('لم يعد مفتاح الاستعادة هذا يعمل') && !localStorage.getItem('ft-family'));

async function makeKit(p) {
  await tab(p, 'أنا');
  await click(p, 'مفتاح الاستعادة', '.card.cta');
  const words = await p.evaluate(() => [...document.querySelectorAll('.modal.kit .words span')].map(s => s.lastChild.textContent.trim()).join(' '));
  const replace = await p.evaluate(() => document.querySelector('.modal.kit input.replace')?.checked ?? null);
  await p.evaluate(() => document.querySelector('.modal.kit .opt input').click());
  await wait(200);
  await click(p, 'إنشاء المفتاح');
  await p.waitForFunction(() => [...document.querySelectorAll('.modal.kit button')].some(b => b.textContent.trim() === 'نسخ'), { timeout: 30000 });
  await p.evaluate(() => { window.__copied = null; });
  await click(p, 'نسخ', '.modal.kit button');
  const link = await p.evaluate(() => window.__copied);
  await click(p, 'إغلاق', '.mhead button');
  await wait(1000);
  return { link, words, replace };
}
/** Opens a kit on a fresh phone with its passphrase; waits until it is in, or told its access ended. */
async function restore(name, kit) {
  const p = await phone(name, kit.link);
  await p.type('.join .bigin', kit.words, { delay: 5 });
  await click(p, 'استعادة', '.join button');
  await p.waitForFunction(() => !!document.querySelector('.tabs') || !!document.querySelector('.join .warnbox') || /انتهى/.test(document.querySelector('.join h2')?.innerText ?? ''), { timeout: 40000 });
  await wait(1500);
  return p;
}
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

await run(async () => {
  const A = await rootAdmin();
  const b = await invite(A, 'محمد', [await meName(A)]);
  const B1 = await join('B1', b.link);
  const who = await meName(B1);
  check(await ready(B1), 'B joined', who);
  await renameHere(B1, 'الهاتف القديم');

  // ---- making a kit adds the backup key to his devices
  const kit1 = await makeKit(B1);
  check(/\/#restore=/.test(kit1.link ?? ''), 'B made a recovery kit');
  check(kit1.replace === null, 'his first kit has nothing to replace');
  let devs = await myDevices(B1);
  const backup = devs.find(d => d.name === 'مفتاح الاستعادة');
  check(devs.length === 2 && !!backup && !backup.here && backup.buttons.length === 1 && backup.small.includes('عبارة المرور'), 'أجهزتي lists «مفتاح الاستعادة» (it can be removed, not renamed)', JSON.stringify(devs));

  // ---- restoring on a fresh phone: a device key of its own
  const R = await restore('R', kit1);
  check(await ready(R), 'the kit restores on a fresh phone');
  check((await meName(R)) === who, 'as the same person', await meName(R));
  const rk = await keysOf(R), bk = await keysOf(B1);
  check(!!rk.d.pk && rk.d.pk !== bk.d.pk, 'with a new device key of its own');
  check(!rk.m.kit, 'the backup key does not stay on the restored phone');
  devs = await myDevices(R);
  const here = devs.find(d => d.here);
  check(devs.length === 3 && !!here && here.small.includes('بمفتاح الاستعادة') && here.name === 'Chrome · Mac', 'it is listed among his devices, added with the recovery kit', JSON.stringify(devs));
  check(!!(await until(async () => (await myDevices(B1)).length === 3)), 'the old phone lists it too');

  // ---- from the restored phone, he removes the lost phone
  const v0 = await keyVersions();
  check(await deviceButton(R, 'الهاتف القديم', 'إزالة'), 'he removes the lost phone from the restored one');
  check(!!(await until(() => ended(B1), 15000)), 'the lost phone forgets the family');
  check(!!(await until(async () => (await keyVersions()) > v0, 20000)), 'the root admin\'s phone renews the family key');
  const n0 = await people(A);
  await addChild(A, fresh('بعدالاستعادة'), true);
  await tab(R, 'الشجرة');
  check(!!(await until(async () => (await people(R)) === n0 + 1)), 'the restored phone reads on after the renewal');

  // ---- removing the backup key ends the kit
  check(await deviceButton(R, 'مفتاح الاستعادة', 'إزالة'), 'he removes the backup key');
  await wait(1500);
  check(!(await myDevices(R)).some(d => d.name === 'مفتاح الاستعادة'), 'it is gone from أجهزتي');
  const K1 = await restore('K1', kit1);
  check(await kitRefused(K1), 'the kit no longer opens the family (it says so, no key left)');

  // ---- a new kit works; another one made after it replaces it
  const kit2 = await makeKit(R);
  const kit3 = await makeKit(R);
  check(kit3.replace === true, 'the second kit offers «إبطال المفتاح السابق», ticked');
  await wait(1500);
  devs = await myDevices(R);
  check(devs.filter(d => d.name === 'مفتاح الاستعادة').length === 1, 'one backup key is listed', JSON.stringify(devs));
  const K2 = await restore('K2', kit2);
  check(await kitRefused(K2), 'the replaced kit no longer opens the family');
  const K3 = await restore('K3', kit3);
  check((await ready(K3)) && (await meName(K3)) === who, 'the new kit does');
  check((await keysOf(K3)).d.pk !== rk.d.pk, 'with yet another device key of its own');
});
