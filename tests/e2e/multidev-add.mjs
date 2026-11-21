// Multiple devices (feat/multidevice): a member adds a second phone himself.
//   node multidev-add.mjs <BASE url> <admin-link file>
// - B joins with the root admin's invite. أنا → أجهزتي lists this phone, named
//   from the browser, as «هذا الجهاز».
// - «إضافة جهاز» shows a one-time link and QR code (tapping again shows the same
//   one); a third browser opens it, is asked to join as an added device of the
//   same person, and joins.
// - Both phones read and write as B; أجهزتي lists both on each, «هذا الجهاز» on
//   the right one; renaming one shows on the other; a name with a phone number
//   is refused and nothing is written. The root admin's profile view says he
//   joined from two devices.
// - Entries forged with another member's (C's) phone, about B's devices, are
//   stored by the server and ignored by every phone: a device invite (its link
//   opens nothing), an added key, a rename, a removal.
import {
  C$, D$, base, fid, check, run, wait, until, phone, join, click, tab, ready, invite, rootAdmin, addChild, hasRequest, fresh,
  myDevices, deviceButton, addDeviceLink, copyLink, keysOf, forge, fetchLog, meName, meId, openProfile, perm, text, people,
} from './multidev-lib.mjs';

await run(async () => {
  const A = await rootAdmin();
  const used = [await meName(A)];
  const b = await invite(A, 'محمد', used);
  used.push(b.who);
  const B1 = await join('B1', b.link);
  check(await ready(B1), 'B joined on his first phone', b.who);
  const who = await meName(B1);
  const bId = await meId(B1);

  // ---- أجهزتي: this phone, named from the browser
  let devs = await myDevices(B1);
  check(devs.length === 1 && devs[0].here && devs[0].name === 'Chrome · Mac' && /أُضيف .* بدعوة شخصية/.test(devs[0].small), 'أجهزتي lists this phone, named from the browser, with the day it was added and «هذا الجهاز»', JSON.stringify(devs));
  check(!(await text(B1, '.mydevs')).includes('سيُجدَّد'), 'no renewal waiting');

  // ---- «إضافة جهاز»: a one-time link and QR code
  await click(B1, 'إضافة جهاز', '.mydevs .card.cta');
  const sheet = await until(() => B1.evaluate(() => {
    const m = document.querySelector('.modal.invite');
    return m && m.querySelector('.qr svg') ? m.querySelector('.mhead b').innerText + ' | ' + m.querySelector('.hint').innerText : null;
  }));
  check(!!sheet && sheet.includes('إضافة جهاز') && sheet.includes('أجهزتك'), '«إضافة جهاز» shows a QR code and says it adds a device of his', sheet);
  const link2 = await copyLink(B1);
  check(/\/#join=[a-z0-9]+\.[A-Za-z0-9_-]+\.i[0-9a-f]{64}$/.test(link2 ?? ''), 'its link can be copied');
  await click(B1, 'إضافة جهاز', '.mydevs .card.cta');
  check((await copyLink(B1)) === link2, 'tapping again shows the same waiting invite, not another one');
  devs = await myDevices(B1);
  check((await text(B1, '.mydevs .devlist')).includes('دعوة جهاز بانتظار الفتح'), 'the waiting invite is listed');

  // ---- the third browser opens it and joins as the same person
  const B2 = await phone('B2', link2);
  const asked = await text(B2, '.join');
  check(asked.includes('إضافة جهاز') && asked.includes(who.split(' ')[0]), 'the new phone is asked to join as an added device of the same person', asked.slice(0, 120));
  await click(B2, 'نعم، أنا');
  check(!!(await until(() => ready(B2))), 'the second phone joined');
  check((await meName(B2)) === who, 'as the same person', await meName(B2));
  check(await B2.evaluate(() => !JSON.parse(localStorage.getItem('ft-family')).invite), 'it keeps no invite secret once joined');

  // ---- both read and write
  const n0 = await people(A);
  const s1 = fresh('أولى'), s2 = fresh('ثانية');
  await addChild(B1, s1, false);
  await addChild(B2, s2, false);
  check(!!(await until(() => hasRequest(A, s1))) && !!(await until(() => hasRequest(A, s2))), 'requests from both phones reach the root admin');
  check(!!(await until(() => hasRequest(B2, s1))) && !!(await until(() => hasRequest(B1, s2))), 'each phone reads what the other wrote');
  const kid = (await fetchLog()).at(-1).kid;
  const added = fresh('ابن');
  await addChild(A, added, true);
  await tab(B2, 'الشجرة');
  check(!!(await until(async () => (await people(B2)) === n0 + 1)), 'the second phone reads what the root admin adds');
  check((await fetchLog()).at(-1).kid === kid, 'adding a device renewed nothing');

  // ---- أجهزتي on both
  devs = await myDevices(B1);
  const devs2 = await myDevices(B2);
  check(devs.length === 2 && devs.filter(d => d.here).length === 1 && devs2.length === 2 && devs2.filter(d => d.here).length === 1, 'both phones list both devices, «هذا الجهاز» once', JSON.stringify([devs, devs2]));
  const k1 = (await keysOf(B1)).d.pk, k2 = (await keysOf(B2)).d.pk;
  check(k1 !== k2, 'each phone has its own device key');
  check(devs.every(d => d.name === 'Chrome · Mac') && !devs[0].buttons.includes(undefined), 'each is named from its browser', JSON.stringify(devs));

  // ---- renaming: B1 renames the other phone; B2 sees it as itself
  const other = devs.findIndex(d => !d.here);
  await B1.evaluate(i => [...document.querySelectorAll('.mydevs .devlist .prow')][i].querySelector('button').click(), other);
  await wait(400);
  const lenBefore = (await fetchLog()).length;
  await B1.evaluate(() => {
    const inp = document.querySelector('.mydevs .devedit input');
    inp.value = 'جوالي 0551234567';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(B1, 'حفظ', '.mydevs .devedit button');
  check((await text(B1, '.mydevs .warnbox')).includes('أرقام الهواتف'), 'a name with a phone number is refused, saying why');
  check((await fetchLog()).length === lenBefore, 'and nothing is written');
  await B1.evaluate(() => {
    const inp = document.querySelector('.mydevs .devedit input');
    inp.value = 'هاتف العمل';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(B1, 'حفظ', '.mydevs .devedit button');
  await wait(1500);
  check((await myDevices(B1)).some(d => d.name === 'هاتف العمل' && !d.here), 'renamed on the phone that renamed it');
  check(!!(await until(async () => (await myDevices(B2)).some(d => d.name === 'هاتف العمل' && d.here))), 'the other phone shows its new name, as «هذا الجهاز»');

  // ---- the root admin sees two devices
  await openProfile(A, who);
  const st = await until(async () => {
    const p = await perm(A);
    return p?.phone === 'انضم من جهازين' ? p : null;
  });
  check(!!st, 'his profile says he joined from two devices', JSON.stringify(await perm(A)));
  check(!!st && st.rows.some(r => r.includes('هاتف العمل')) && st.rows.some(r => r.includes('Chrome · Mac')) && st.rows.some(r => r.includes('جهاز إضافي')), 'each device is listed by name, with «جهاز إضافي»', JSON.stringify(st?.rows));
  await A.evaluate(() => document.querySelector('.page.profile button[aria-label="رجوع"]')?.click());
  await wait(500);

  // ---- forged entries about B's devices, signed by another member's phone
  const c = await invite(A, 'محمد', used);
  used.push(c.who);
  const C = await join('C', c.link);
  check(await ready(C), 'C joined');
  const ck = await keysOf(C);
  const stolen = C$.newDeviceKey();
  const logBefore = await fetchLog();
  const adminPub = logBefore[0].pub;
  const statuses = [];
  statuses.push(await forge(ck.m, ck.d, [ck.d.sk], { type: 'device', act: { kind: 'invite', key: stolen.pk }, by: bId }));
  const added2 = C$.newDeviceKey();
  statuses.push(await forge(ck.m, ck.d, [ck.d.sk], { type: 'device', act: { kind: 'add', device: added2.pk, label: 'مزوّر', proof: D$.deviceProof(added2.sk, adminPub, bId, added2.pk) }, by: bId }));
  statuses.push(await forge(ck.m, ck.d, [ck.d.sk], { type: 'device', act: { kind: 'label', device: k2, label: 'اسم مزوّر' }, by: bId }));
  statuses.push(await forge(ck.m, ck.d, [ck.d.sk], { type: 'device', act: { kind: 'remove', keys: [k2] }, by: bId }));
  check(statuses.every(x => x === 201), 'the server stores the forged entries (it cannot read them)', statuses.join(' '));
  await wait(4500);
  check((await ready(B1)) && (await ready(B2)), 'both of B\'s phones are still in');
  devs = await myDevices(B1);
  check(devs.length === 2 && devs.some(d => d.name === 'هاتف العمل') && !(await text(B1, '.mydevs')).includes('مزوّر'), 'B\'s devices are unchanged (no added key, no new name, nothing removed)', JSON.stringify(devs));
  const forgedLink = `${base}/#join=${fid}.${ck.m.key}.i${stolen.sk}`;
  const F = await phone('F', forgedLink);
  check(!(await ready(F)) && !(await text(F, '.join')).includes('نعم، أنا'), 'the forged device invite opens nothing', await text(F, '.join h2'));
  check(await F.evaluate(() => !localStorage.getItem('ft-family')), 'and leaves no family key behind');
  void wait;
});
