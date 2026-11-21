// The root admin's phone renews a family key that fell due and keeps the
// server's write key, in one open (feat/multidevice + feat/writegate):
//   node combine-renew-first.mjs <BASE url> <admin-link file>
// 1. A family as the live one stands: entries without write signatures, no write
//    key registered, an invite revoked with no renewal after it (the app before
//    renewals). Built outside the app with the root admin key from the link, as
//    the old app wrote them. B joins with a personal invite from that time.
// 2. The root admin's phone opens for the first time since the update: it
//    renews the key at once, and the renewal itself registers the new key's
//    write key on a server that had none. The phone waits for the renewal
//    before it checks the write key, so it sends no registration of the old
//    key's to race it (this script would hold one back a moment, so that it
//    would land second and show). One renewal, the earlier keys carried
//    forward, nothing written with the old key taken, the revoked invite reads
//    nothing new; B catches up and writes on.
// 3. With the root admin's phone closed, B cancels a device invite of his own
//    (a renewal falls due: B is told it comes when the root admin opens the
//    app), then moves the write key with a renewal of his own. The root admin's
//    phone opens: it puts the write key back, then renews, once; the server ends
//    on the newest key's write key, B's note goes and B writes on.
// Prints PASS/FAIL lines; exits non-zero on any failure, page error or console
// error. Never prints links or keys.
import {
  C$, L$, K$, base, fid, adminLink, browser, check, run, wait, until, phone, click, tab, ready, settle, fetchLog, keysOf, addChild, hasRequest, fresh,
  myDevices, deviceButton, addDeviceLink, text,
} from './multidev-lib.mjs';

const [, key1, adminSk] = adminLink.match(/join=[a-z0-9]+\.([A-Za-z0-9_-]+)\.([0-9a-f]{64})/);
const k1 = C$.unb64(key1);
const admin = C$.deviceFromSecret(adminSk);
const w1 = C$.writeKeyOf(k1).pk;
const NOTE = 'سيُجدَّد مفتاح العائلة تلقائيًا عند فتح المشرف للتطبيق';

const server = async () => (await fetch(`${base}/api/f/${fid}/log?after=-1`)).json();
const put = async e => {
  const r = await fetch(`${base}/api/f/${fid}/log/${e.n}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
// as the app wrote entries before the write check
const old = e => {
  const { w, ...rest } = e;
  void w;
  return rest;
};
async function append(key, signer, payload, { nw, shape = e => e } = {}) {
  for (let i = 0; i < 6; i++) {
    const log = await fetchLog();
    const r = await put(shape(L$.makeEntry(key, signer, log.length, log.length ? L$.entryHash(log.at(-1)) : '', payload, nw)));
    if (r.status !== 409) return r;
  }
  return { status: 409 };
}
/** The log opened with these key versions and secrets: what such a holder reads, and the keys it learns. */
function openWith(log, keys, secrets) {
  const ring = new Map();
  K$.addKeys(ring, keys.map(k => (typeof k === 'string' ? k : C$.b64(k))));
  const opened = [];
  K$.openLog(log, opened, ring, secrets);
  return { ring, opened };
}
/** What the root admin's own keys make of the log: its renewals (by the admin key) and the write-key entries. */
async function adminView() {
  const s = await server();
  const { ring, opened } = openWith(s.entries, [k1], [adminSk]);
  const at = type => opened.map((p, i) => (p?.type === type ? i : -1)).filter(i => i >= 0);
  const rekeys = at('rekey').filter(i => s.entries[i].pub === admin.pk);
  const newest = rekeys.length ? ring.get(opened[rekeys.at(-1)].kid) : k1;
  return { ...s, opened, rekeys, keys: at('keys'), writekeys: at('writekey'), newest, wNewest: C$.writeKeyOf(newest).pk };
}
const verifies = log => {
  let prev = '';
  return log.every(e => {
    const ok = !L$.checkEntry(e, prev);
    prev = L$.entryHash(e);
    return ok;
  });
};

// ---- the root admin's phone: its own page handlers, so the conflicts this
// script sets up on purpose (a write turned away as "taken") are expected
const aErrs = [];
const toasts = [];
const puts = [];
let hold = () => 0;
const aCtx = await browser.createBrowserContext();
async function adminPhone(name, url) {
  const page = await aCtx.newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => aErrs.push(name + ': ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/status of 409/.test(m.text())) aErrs.push(name + ': ' + m.text());
  });
  page.on('dialog', d => d.accept());
  await page.exposeFunction('__toast', t => toasts.push(name + ': ' + t)).catch(() => {});
  await page.evaluateOnNewDocument(() => {
    addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => {
        const t = document.querySelector('.toast');
        if (t && t.innerText !== window.__last) {
          window.__last = t.innerText;
          window.__toast(t.innerText);
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
  });
  const nwOf = r => {
    try {
      return JSON.parse(r.postData() ?? 'null')?.nw;
    } catch {
      return undefined;
    }
  };
  await page.setRequestInterception(true);
  page.on('request', r => {
    const ms = r.method() === 'PUT' && r.url().includes(`/api/f/${fid}/log/`) ? hold(nwOf(r)) : 0;
    if (ms) setTimeout(() => r.continue().catch(() => {}), ms);
    else r.continue().catch(() => {});
  });
  page.on('response', r => {
    if (r.request().method() === 'PUT' && r.url().includes(`/api/f/${fid}/log/`)) puts.push({ nw: nwOf(r.request()), status: r.status() });
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await until(() => ready(page), 30000);
  await settle(page);
  return page;
}

await run(async () => {
  // ---- 1. a family as the live app left it
  const first = await fetchLog();
  const seed = L$.openEntry(k1, first[0]).family;
  // (fix-review) adults: since main's merge, members under 18 send no requests and hold no key
  const adult = p => !p.birth || p.birth.v <= (p.birth.cal === 'h' ? 1429 : 2008);
  const men = seed.people.filter(p => p.sex === 'm' && p.parent && p.parent !== seed.root.id && !p.deceased && !p.death && adult(p));
  const [pB, pX] = [men[2], men[3]];
  const invB = C$.newDeviceKey();
  const invX = C$.newDeviceKey();
  const statuses = [];
  for (const p of [
    { type: 'admin', act: { kind: 'invite', person: pB.id, key: invB.pk }, by: null },
    { type: 'admin', act: { kind: 'invite', person: pX.id, key: invX.pk }, by: null },
    { type: 'admin', act: { kind: 'revoke', key: invX.pk }, by: null },
  ]) statuses.push((await append(k1, admin, p, { shape: old })).status);
  check(statuses.every(s => s === 201) && (await server()).wk === null, "the live app's kind of log: no write signatures, no write key, an invite revoked with no renewal after it", statuses.join(' '));
  const B = await phone('B', `${base}/#join=${fid}.${key1}.i${invB.sk}`);
  await click(B, 'نعم، أنا');
  check(!!(await until(() => ready(B))), 'B joins with a personal invite from that time');
  await settle(B);
  const bKeys = await keysOf(B);

  // ---- 2. the root admin's first open: the renewal lands before the registration
  hold = nw => (nw === w1 ? 2500 : 0);
  const A = await adminPhone('A', adminLink);
  check(await ready(A), "the root admin's phone opens the family");
  const v2 = await until(async () => {
    const v = await adminView();
    return v.rekeys.length && v.wk === v.wNewest && v.keys.some(i => i > v.rekeys[0]) ? v : null;
  }, 30000);
  check(!!v2, 'it renews the key on its own as it opens, and the server ends on the new key\'s write key');
  await wait(3500);
  const v2b = await adminView();
  check(v2b.rekeys.length === 1, 'one renewal, signed with the root admin key', String(v2b.rekeys.length));
  const rk = v2b.entries[v2b.rekeys[0]];
  check(rk.nw === v2b.wk && L$.nextWriteKey(rk) === v2b.wk, 'the renewal itself named the new write key, and registered it on a server that had none');
  const sent = JSON.stringify(puts.map(p => [p.nw === w1 ? 'old key' : p.nw ? 'new key' : '-', p.status]));
  check(!puts.some(p => p.nw === w1) && v2b.writekeys.length === 0, 'no registration of the old key was sent to race it, and none was needed', sent);
  check(puts.every(p => p.status === 201), 'everything the phone sent was taken', sent);
  check(v2b.keys.some(i => i > v2b.rekeys[0]), 'the earlier key is carried forward under the new one');
  check(verifies(v2b.entries), `the whole log verifies (${v2b.entries.length} entries)`);
  check(!openWith(v2b.entries, [k1], [invX.sk]).ring.has(C$.keyId(v2b.newest)), "the revoked invite's key does not reach the new key");
  {
    const outsider = C$.newDeviceKey();
    const r1 = await append(k1, outsider, { type: 'keys', keys: {} });
    const r2 = await append(k1, outsider, { type: 'keys', keys: {} }, { shape: old });
    const r3 = await append(k1, invX, { type: 'claim', device: outsider.pk });
    check([r1, r2, r3].every(r => r.status === 403), 'nothing written with the old key is taken now (with or without a write signature, or with the revoked invite)', [r1, r2, r3].map(r => r.status).join(' '));
  }
  check(!!(await until(async () => (await keysOf(B)).m.key === C$.b64(v2b.newest))), "B's phone learns the new key");
  const t1 = fresh('بعدالتجديد');
  await addChild(B, t1, false);
  check(!!(await until(() => hasRequest(A, t1))), "B's request, written with the new key, reaches the root admin");
  check(!toasts.some(t => t.includes('تعذّر')), 'the root admin saw no error', toasts.join(' | '));

  // ---- 3. a write key moved while a renewal is due, with the root admin away
  await A.close();
  const k2 = v2b.newest;
  const w2 = v2b.wk;
  await addDeviceLink(B);
  const waiting = (await myDevices(B)).length;
  await tab(B, 'أنا');
  check(await B.evaluate(() => [...document.querySelectorAll('.mydevs .devlist .prow')].some(r => r.innerText.includes('دعوة جهاز بانتظار الفتح'))), 'B makes a device invite of his own');
  check(await deviceButton(B, 'دعوة جهاز بانتظار الفتح', 'إلغاء الدعوة'), 'and cancels it');
  check(!!(await until(async () => (await myDevices(B)).length < waiting)), 'it is gone from أجهزتي');
  check(!!(await until(async () => {
    await B.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
    return (await text(B, '.mydevs')).includes(NOTE);
  })), 'B is told the family key is renewed when the root admin opens the app');
  const kx = C$.newFamilyKey();
  const rogue = await append(k2, bKeys.d, { type: 'rekey', kid: C$.keyId(kx), ...C$.wrapKey(kx, [bKeys.d.pk]), by: null }, { nw: C$.writeKeyOf(kx).pk });
  check(rogue.status === 201 && (await server()).wk === C$.writeKeyOf(kx).pk, 'B moves the write key with a renewal of his own (he holds the current key)');
  await wait(4000);
  check((await adminView()).rekeys.length === 1, 'nobody renews while the root admin is away (B may not)');

  puts.length = 0;
  hold = () => 0;
  const A2 = await adminPhone('A2', base + '/');
  const v3 = await until(async () => {
    const v = await adminView();
    return v.rekeys.length === 2 && v.wk === v.wNewest && v.keys.some(i => i > v.rekeys[1]) ? v : null;
  }, 30000);
  check(!!v3, "the root admin's phone opens, puts the write key back and renews, on its own");
  await wait(3500);
  const v3b = await adminView();
  check(v3b.rekeys.length === 2, 'one renewal more', String(v3b.rekeys.length));
  check(v3b.writekeys.length === 1 && v3b.entries[v3b.writekeys[0]].nw === w2 && v3b.writekeys[0] < v3b.rekeys[1], 'the write key was put back first (to the key the family was on), then the renewal moved it on', JSON.stringify({ wk: v3b.writekeys, rk: v3b.rekeys }));
  check(!puts.some(p => p.status === 403), 'the root admin\'s phone sent nothing the server refused', JSON.stringify(puts.map(p => p.status)));
  check(v3b.wk === v3b.wNewest && v3b.wk !== w2 && v3b.wk !== C$.writeKeyOf(kx).pk, "the server is on the newest key's write key");
  check(verifies(v3b.entries), `the whole log verifies (${v3b.entries.length} entries)`);
  {
    const r = await append(k2, bKeys.d, { type: 'keys', keys: {} });
    check(r.status === 403, 'the key before is refused now', String(r.status));
  }
  check(!!(await until(async () => {
    await tab(B, 'أنا');
    return !(await text(B, '.mydevs')).includes(NOTE);
  })), "B's note goes away");
  check(!!(await until(async () => (await keysOf(B)).m.key === C$.b64(v3b.newest))), "B's phone learns the newest key");
  const t2 = fresh('بعدالإصلاح');
  await addChild(B, t2, false);
  check(!!(await until(() => hasRequest(A2, t2))), "B's request reaches the root admin");
  check(!toasts.some(t => t.includes('تعذّر')), 'the root admin saw no error', toasts.join(' | '));
  check(aErrs.length === 0, "no page or console errors on the root admin's phone", aErrs.join(' | '));
  await settle(B);
});
