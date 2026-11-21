// Multiple devices (feat/multidevice): removing them, and the renewal that follows.
//   node multidev-remove.mjs <BASE url> <admin-link file>
// - B (no key) adds a second phone, then removes it from أجهزتي on the first:
//   the removed phone forgets the family; the first says the family key will be
//   renewed when the root admin opens the app. Nobody renews while the root
//   admin's (and the platinum holder's) app is closed; the root admin's phone
//   renews on its own when it opens, and the note goes away. The removed phone's
//   old keys open nothing written after the renewal.
// - Another removal while only the platinum holder opens the app: the platinum
//   holder's phone renews; the root admin's phone, opened after, adds no second
//   renewal.
// - B, holding no key, removes all his devices: both phones forget the family,
//   and the key is renewed.
// - S, a silver key holder, cannot remove his only phone: no «إزالة كل الأجهزة»,
//   and «إزالة» explains (hand the key over, or ask the root admin) and writes
//   nothing. A removal of his last phone forged with that phone's own key is
//   ignored by every phone. With a second phone, he may remove the first.
import {
  check, run, wait, until, phone, join, click, tab, ready, ended, rootAdmin, addChild, fresh, people, text, closeApp, reopen,
  myDevices, deviceButton, addDeviceLink, copyLink, keysOf, forge, fetchLog, keyVersions, opensAfter, meName, meId, openProfile, perm, dialogs,
} from './multidev-lib.mjs';

const NOTE = 'سيُجدَّد مفتاح العائلة تلقائيًا عند فتح المشرف للتطبيق';
const note = async p => {
  await tab(p, 'أنا');
  return (await text(p, '.mydevs')).includes(NOTE);
};

/** The root admin fills an empty seat («بلاتيني» or «فضي») with the first suggestion not in `skip`. */
async function seat(A, tier, skip) {
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await A.evaluate(t => [...document.querySelectorAll('button.keyrow.empty')].find(e => e.innerText.includes(t)).click(), tier);
  await wait(800);
  const r = await A.evaluate(sk => {
    const row = [...document.querySelectorAll('.results .prow')].find(e => !sk.includes(e.querySelector('b').innerText.split('\n')[0].trim()));
    const out = { name: row.querySelector('b').innerText.split('\n')[0].trim(), year: row.querySelector('.pt small').innerText.slice(0, 4) };
    row.click();
    return out;
  }, skip);
  await wait(1500);
  return r;
}
/** The root admin invites exactly that person (name and birth year). */
async function inviteNamed(A, { name, year }) {
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await A.type('.sfield input', name.split(' ')[0], { delay: 10 });
  await wait(600);
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y)).click(), year);
  await wait(1500);
  return copyLink(A);
}
/** Renames the «هذا الجهاز» row of a phone's أجهزتي. */
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
/** Where the newest renewal sits in the log (the rekey entry), and who signed it. */
async function lastRenewal() {
  const log = await fetchLog();
  const kid = log.at(-1).kid;
  const at = log.findIndex(e => e.kid === kid) - 1;
  return { at, pub: log[at]?.pub, admin: log[0].pub };
}

await run(async () => {
  let A = await rootAdmin();
  const used = [await meName(A)];
  const S = await seat(A, 'فضي', used);
  used.push(S.name);
  const P = await seat(A, 'بلاتيني', used);
  used.push(P.name);
  const S1 = await join('S1', await inviteNamed(A, S));
  const P1 = await join('P1', await inviteNamed(A, P));
  check((await ready(S1)) && (await ready(P1)), 'a silver and the platinum key holder joined', S.name + ' / ' + P.name);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await A.type('.sfield input', 'محمد', { delay: 10 });
  await wait(600);
  // someone other than the two holders: by name and birth year (the holders may be named «محمد» too)
  await A.evaluate(keys => [...document.querySelectorAll('.results .prow')].find(e => !keys.includes(e.querySelector('b').innerText.split('\n')[0].trim() + '|' + (e.querySelector('.pt small')?.innerText.slice(0, 4) ?? ''))).click(), [S, P].map(x => x.name + '|' + x.year));
  await wait(1500);
  const B1 = await join('B1', await copyLink(A));
  const who = await meName(B1);
  check(await ready(B1), 'B (no key) joined', who);

  // ---- B adds a second phone and names it
  const B2 = await join('B2', await addDeviceLink(B1));
  check(await ready(B2), 'B added a second phone');
  await renameHere(B2, 'هاتف ثان');
  check(!!(await until(async () => (await myDevices(B1)).some(d => d.name === 'هاتف ثان'))), 'B1 lists it by its name');
  const b2 = await keysOf(B2);

  // ---- the root admin's and the platinum holder's apps are closed; B removes the second phone
  const aCtx = await closeApp(A);
  const pCtx = await closeApp(P1);
  await wait(500);
  const v0 = await keyVersions();
  const asked = dialogs.length;
  check(await deviceButton(B1, 'هاتف ثان', 'إزالة'), 'B taps «إزالة» on the second phone');
  check(dialogs.length === asked + 1 && dialogs.at(-1).includes('هاتف ثان') && dialogs.at(-1).includes('يُجدَّد مفتاح العائلة'), 'it asks first, naming the phone', dialogs.at(-1));
  check(!!(await until(() => ended(B2), 15000)), 'the removed phone forgets the family');
  check(!!(await until(() => note(B1))), `B1 says: «${NOTE}»`);
  check((await myDevices(B1)).length === 1, 'B1 lists one device');
  await wait(8000);
  check((await keyVersions()) === v0, 'nobody renews while the root admin\'s and the platinum holder\'s apps are closed');

  // ---- the root admin opens the app: his phone renews on its own
  A = await reopen(aCtx, 'A');
  check(!!(await until(async () => (await keyVersions()) > v0, 20000)), 'the root admin\'s phone renews the family key when it opens');
  const r1 = await lastRenewal();
  check(r1.pub === r1.admin, 'signed with the root admin key');
  check(!!(await until(async () => !(await note(B1)), 15000)), 'B1\'s note goes away once the key is renewed');
  const n0 = await people(A);
  await addChild(A, fresh('بعدالتجديد'), true);
  await tab(B1, 'الشجرة');
  check(!!(await until(async () => (await people(B1)) === n0 + 1)), 'B1 reads what is added after the renewal');
  const o = await opensAfter(b2.m, [b2.d.sk], r1.at);
  check(o.later > 0 && o.opened === 0 && o.direct === 0, `the removed phone's old keys open none of the ${o.later} entries after the renewal`, JSON.stringify(o));

  // ---- the platinum holder's phone renews when it opens; the root admin's adds nothing after
  const aCtx2 = await closeApp(A);
  const B3 = await join('B3', await addDeviceLink(B1));
  await renameHere(B3, 'هاتف ثالث');
  await until(async () => (await myDevices(B1)).some(d => d.name === 'هاتف ثالث'));
  const v1 = await keyVersions();
  await deviceButton(B1, 'هاتف ثالث', 'إزالة');
  check(!!(await until(() => ended(B3), 15000)), 'another phone removed (it forgets the family)');
  await wait(3000);
  const P2 = await reopen(pCtx, 'P1');
  check(!!(await until(async () => (await keyVersions()) > v1, 20000)), 'the platinum holder\'s phone renews the key when it opens');
  const r2 = await lastRenewal();
  check(r2.pub === (await keysOf(P2)).d.pk, 'signed by the platinum holder\'s phone');
  const v2 = await keyVersions();
  A = await reopen(aCtx2, 'A');
  await wait(8000);
  check((await keyVersions()) === v2, 'the root admin\'s phone, opened after, renews nothing more');

  // ---- B (no key) removes all his devices
  const B4 = await join('B4', await addDeviceLink(B1));
  check(await ready(B4), 'B added another phone');
  await tab(B1, 'أنا');
  check(await click(B1, 'إزالة كل الأجهزة', '.mydevs button'), 'B taps «إزالة كل الأجهزة»');
  const warn = await text(B1, '.mydevs .removeall');
  check(warn.includes('ومنها هذا الجهاز') && warn.includes('دعوة جديدة'), 'it says what follows before anything is removed', warn);
  check((await myDevices(B1)).length === 2, 'nothing removed yet');
  const v3 = await keyVersions();
  await click(B1, 'نعم، أزل كل أجهزتي', '.mydevs .removeall button');
  check(dialogs.at(-1).includes('هل أنت متأكد'), 'and asks once more');
  check(!!(await until(() => ended(B1), 15000)), 'this phone forgets the family at once');
  check(!!(await until(() => ended(B4), 15000)), 'the other phone forgets it too');
  check(!!(await until(async () => (await keyVersions()) > v3, 20000)), 'and the family key is renewed');

  // ---- S holds a silver key: he keeps a phone
  const s = await myDevices(S1);
  const sMe = await text(S1, '.mydevs');
  check(s.length === 1 && !sMe.includes('إزالة كل الأجهزة'), 'a key holder is not offered «إزالة كل الأجهزة»', JSON.stringify(s));
  check(sMe.includes('سلّم المفتاح أولًا') && sMe.includes('مشرف العائلة'), 'and is told why: hand the key over first, or ask the root admin');
  const len = (await fetchLog()).length;
  await deviceButton(S1, 'هذا الجهاز', 'إزالة');
  check((await text(S1, '.mydevs .warnbox')).includes('سلّم المفتاح أولًا'), '«إزالة» on his only phone explains instead of removing');
  await wait(1500);
  check((await fetchLog()).length === len && (await ready(S1)), 'nothing is written, and his phone stays');
  // the same removal forged outside the app, signed with his own phone's key
  const sk = await keysOf(S1);
  const sId = await meId(S1);
  const st = await forge(sk.m, sk.d, [sk.d.sk], { type: 'device', act: { kind: 'remove', keys: [sk.d.pk] }, by: sId });
  check(st === 201, 'the server stores a forged removal of his last phone', String(st));
  await wait(5000);
  check((await ready(S1)) && (await myDevices(S1)).length === 1, 'every phone ignores it: his phone stays in');
  await openProfile(A, await meName(S1));
  check((await perm(A))?.phone === 'انضم من هاتفه', 'the root admin still sees his phone linked', JSON.stringify(await perm(A)));
  // with a second phone, he may remove the first
  await renameHere(S1, 'هاتف أول');
  const S2 = await join('S2', await addDeviceLink(S1));
  check(await ready(S2), 'the key holder adds a second phone');
  await until(async () => (await myDevices(S2)).some(d => d.name === 'هاتف أول'));
  await deviceButton(S2, 'هاتف أول', 'إزالة');
  check(!!(await until(() => ended(S1), 15000)), 'and removes the first from it');
  check(await ready(S2), 'the second stays');
  void wait;
});
