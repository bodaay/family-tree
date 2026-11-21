// A person's own devices under the server's write check (feat/multidevice +
// feat/writegate):
//   node combine-device-gate.mjs <BASE url> <admin-link file>
// 1. A family as the live one stands (no write signatures, no write key, an
//    invite revoked with no renewal), with a platinum holder P. B and then P
//    join with personal invites from that time.
// 2. P's phone renews the key on its own; the server takes it, and still has
//    no write key (only the root admin's phone registers one).
// 3. B adds a second phone B2 himself («إضافة جهاز»), names it from B2, and
//    removes it from his first phone. B2 forgets the family; P's open phone
//    renews again; still no write key.
// 4. The root admin's phone opens for the first time: it registers the newest
//    key's write key, and renews nothing (nothing is due). B2's old membership
//    can add nothing any more, not even an entry about B's devices.
// 5. B makes a recovery kit (its backup key is added under the write check),
//    then a device invite he cancels makes the root admin's open phone renew
//    the key once more (P's app is closed by then). The kit, made before that renewal, restores on a fresh
//    phone: the backup key adds that phone (written with the newest key), and
//    it writes a request that reaches the root admin.
// Prints PASS/FAIL lines; exits non-zero on any failure, page error or console
// error. Never prints links or keys.
import {
  C$, L$, K$, base, fid, adminLink, check, run, wait, until, phone, click, tab, ready, ended, settle, fetchLog, keysOf, addChild, hasRequest, fresh,
  myDevices, deviceButton, addDeviceLink, meId,
} from './multidev-lib.mjs';

const [, key1, adminSk] = adminLink.match(/join=[a-z0-9]+\.([A-Za-z0-9_-]+)\.([0-9a-f]{64})/);
const k1 = C$.unb64(key1);
const admin = C$.deviceFromSecret(adminSk);

const server = async () => (await fetch(`${base}/api/f/${fid}/log?after=-1`)).json();
const put = async e => {
  const r = await fetch(`${base}/api/f/${fid}/log/${e.n}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const old = e => {
  const { w, ...rest } = e;
  void w;
  return rest;
};
async function append(key, signer, payload, { shape = e => e } = {}) {
  for (let i = 0; i < 6; i++) {
    const log = await fetchLog();
    const r = await put(shape(L$.makeEntry(key, signer, log.length, log.length ? L$.entryHash(log.at(-1)) : '', payload)));
    if (r.status !== 409) return r;
  }
  return { status: 409 };
}
/**
 * The log as the root admin's keys open it: renewals by `managers` (public
 * keys), write-key entries, and the newest key.
 */
async function view(managers) {
  const s = await server();
  const ring = new Map();
  K$.addKeys(ring, [key1]);
  const opened = [];
  K$.openLog(s.entries, opened, ring, [adminSk]);
  const at = type => opened.map((p, i) => (p?.type === type ? i : -1)).filter(i => i >= 0);
  const rekeys = at('rekey').filter(i => managers.includes(s.entries[i].pub));
  const newest = rekeys.length ? ring.get(opened[rekeys.at(-1)].kid) : k1;
  return { ...s, rekeys, by: rekeys.map(i => s.entries[i].pub), writekeys: at('writekey'), newest, wNewest: C$.writeKeyOf(newest).pk };
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
  await wait(1000);
  return { link, words };
}
async function restore(name, kit) {
  const p = await phone(name, kit.link);
  await p.type('.join .bigin', kit.words, { delay: 5 });
  await click(p, 'استعادة', '.join button');
  await p.waitForFunction(() => !!document.querySelector('.tabs') || /انتهى/.test(document.querySelector('.join h2')?.innerText ?? ''), { timeout: 40000 });
  await wait(1500);
  return p;
}

await run(async () => {
  // ---- 1. the live app's kind of log, with a platinum holder
  const seed = L$.openEntry(k1, (await fetchLog())[0]).family;
  // (fix-review) adults: since main's merge, members under 18 send no requests and hold no key
  const adult = p => !p.birth || p.birth.v <= (p.birth.cal === 'h' ? 1429 : 2008);
  const men = seed.people.filter(p => p.sex === 'm' && p.parent && p.parent !== seed.root.id && !p.deceased && !p.death && adult(p));
  const [pB, pP, pX] = [men[2], men[3], men[4]];
  const invB = C$.newDeviceKey();
  const invP = C$.newDeviceKey();
  const invX = C$.newDeviceKey();
  const statuses = [];
  for (const p of [
    { type: 'admin', act: { kind: 'invite', person: pB.id, key: invB.pk }, by: null },
    { type: 'admin', act: { kind: 'invite', person: pP.id, key: invP.pk }, by: null },
    { type: 'admin', act: { kind: 'appoint', tier: 'platinum', branch: null, holder: pP.id }, by: null },
    { type: 'admin', act: { kind: 'invite', person: pX.id, key: invX.pk }, by: null },
    { type: 'admin', act: { kind: 'revoke', key: invX.pk }, by: null },
  ]) statuses.push((await append(k1, admin, p, { shape: old })).status);
  check(statuses.every(s => s === 201) && (await server()).wk === null, 'a log as the live app wrote it: a platinum holder, an invite revoked with no renewal, no write key', statuses.join(' '));
  const B1 = await phone('B1', `${base}/#join=${fid}.${key1}.i${invB.sk}`);
  await click(B1, 'نعم، أنا');
  check(!!(await until(() => ready(B1))), 'B joins');
  await settle(B1);
  const bId = await meId(B1);
  const P = await phone('P', `${base}/#join=${fid}.${key1}.i${invP.sk}`);
  await click(P, 'نعم، أنا');
  check(!!(await until(() => ready(P))), 'P, the platinum holder, joins');
  await settle(P);
  const pDev = (await keysOf(P)).d.pk;
  const managers = [admin.pk, pDev];

  // ---- 2. P's phone renews on its own; no write key yet
  const v1 = await until(async () => {
    const v = await view(managers);
    return v.rekeys.length === 1 ? v : null;
  }, 30000);
  check(!!v1 && v1.by[0] === pDev, "P's phone renews the key on its own (the revoked invite held it)");
  check(v1?.wk === null, 'the server takes it, and still has no write key (only the root admin registers one)', String(v1?.wk));

  // ---- 3. B adds a phone himself, then removes it
  const link2 = await addDeviceLink(B1);
  check(/#join=/.test(link2 ?? ''), '«إضافة جهاز» gives B a link for his next device');
  const B2 = await phone('B2', link2);
  check(await B2.evaluate(() => document.querySelector('.join h2')?.innerText.includes('إضافة جهاز')), 'the second phone is asked to join as an added device');
  await click(B2, 'نعم، أنا');
  check(!!(await until(() => ready(B2))) && (await meId(B2)) === bId, 'B2 joins as B');
  await settle(B2);
  await renameHere(B2, 'الهاتف الثاني');
  check(!!(await until(async () => (await myDevices(B1)).some(d => d.name === 'الهاتف الثاني'))), "B2's name, written from B2, shows on B's first phone");
  const b2Old = await keysOf(B2);
  check(await deviceButton(B1, 'الهاتف الثاني', 'إزالة'), 'B removes B2 from his first phone');
  check(!!(await until(() => ended(B2), 20000)), 'B2 forgets the family');
  const v2 = await until(async () => {
    const v = await view(managers);
    return v.rekeys.length === 2 ? v : null;
  }, 30000);
  check(!!v2 && v2.by[1] === pDev, "P's open phone renews again, on its own");
  check(v2?.wk === null, 'still no write key', String(v2?.wk));

  // ---- 4. the root admin's first open: registers the newest key's write key
  const A = await phone('A', adminLink);
  check(await ready(A), "the root admin's phone opens the family");
  const v3 = await until(async () => {
    const v = await view(managers);
    return v.wk && v.wk === v.wNewest ? v : null;
  }, 20000);
  check(!!v3, "it registers the newest key's write key");
  await wait(3500);
  const v3b = await view(managers);
  check(v3b.rekeys.length === 2 && v3b.writekeys.length === 1, 'with one entry, and renews nothing (nothing is due)', JSON.stringify({ rekeys: v3b.rekeys.length, writekeys: v3b.writekeys.length }));
  {
    const ring = new Map();
    K$.addKeys(ring, [b2Old.m.key, ...Object.values(b2Old.m.keys ?? {})]);
    const held = [...ring.values()].at(-1);
    const r1 = await append(held, b2Old.d, { type: 'device', act: { kind: 'label', device: b2Old.d.pk, label: 'ما زلت هنا' }, by: bId });
    const r2 = await append(held, b2Old.d, { type: 'device', act: { kind: 'invite', key: C$.newDeviceKey().pk }, by: bId });
    check([r1, r2].every(r => r.status === 403), "B2's old membership can add nothing, not even an entry about B's devices", [r1, r2].map(r => r.status).join(' '));
  }
  const t1 = fresh('بعدالتسجيل');
  await addChild(B1, t1, false);
  check(!!(await until(() => hasRequest(A, t1))), "B's request reaches the root admin");

  // ---- 5. a kit made before a renewal, restored after it (P's app is closed:
  // the root admin's phone makes the renewal)
  await P.close();
  const b1Dev = (await keysOf(B1)).d.pk;
  const kit = await makeKit(B1);
  check(/\/#restore=/.test(kit.link ?? '') && (await myDevices(B1)).some(d => d.name === 'مفتاح الاستعادة'), 'B makes a recovery kit: its backup key is among his devices');
  await addDeviceLink(B1);
  check(await deviceButton(B1, 'دعوة جهاز بانتظار الفتح', 'إلغاء الدعوة'), 'B makes a device invite and cancels it');
  const v4 = await until(async () => {
    const v = await view(managers);
    return v.rekeys.length === 3 && v.wk === v.wNewest ? v : null;
  }, 30000);
  check(!!v4, "an open manager's phone renews once more, and the server moves to the new write key with it");
  const R = await restore('R', kit);
  check(await ready(R), 'the kit, made before that renewal, restores on a fresh phone');
  check((await meId(R)) === bId, 'as B');
  const rk = await keysOf(R);
  check(!rk.m.kit && rk.m.key === C$.b64(v4.newest), 'with the newest key, and without the backup key', String(!!rk.m.kit));
  {
    const log = (await server()).entries;
    // signed by none of the phones: the kit's backup key, adding the restored phone
    const added = log.slice(v4.rekeys.at(-1) + 1).filter(e => ![admin.pk, pDev, b1Dev, rk.d.pk].includes(e.pub));
    check(added.length === 1 && L$.writeSigned(added[0], v4.wNewest), "the backup key's entry adding it carries the newest key's write signature", String(added.length));
  }
  check(!!(await until(async () => (await myDevices(B1)).some(d => d.small.includes('بمفتاح الاستعادة')))), "B's first phone lists the restored phone");
  const t2 = fresh('منالمستعاد');
  await addChild(R, t2, false);
  check(!!(await until(() => hasRequest(A, t2))), "the restored phone's request reaches the root admin");
  check(!!(await until(async () => (await server()).wk === v4.wNewest)), 'the write key stayed where the renewal put it');
});
