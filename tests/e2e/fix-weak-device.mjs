// Fix check: a claim cannot link a small-order key, and nobody can sign as one (secrev-weak-device).
//   node fix-weak-device.mjs <BASE url> <admin-link file>
// B holds a waiting device invite and claims it for the identity point: the
// entry is stored (it is signed by the invite's own key) but counts nowhere: B
// still has one device and the invite still waits. Member C then writes an
// entry whose signer is the identity point, with a signature made without any
// secret: the server refuses it, and B's phone stays.
import {
  check, run, wait, until, join, ready, ended, rootAdmin, invite, myDevices, addDeviceLink, keysOf, fetchLog,
  meName, meId, fid, base, K$, L$, C$, forge,
} from './multidev-lib.mjs';
import { ed25519 } from '@noble/curves/ed25519.js';

const IDENTITY = '01' + '00'.repeat(31);
function forgedSig() {
  const R = ed25519.Point.BASE.multiply(7n).toBytes();
  const S = new Uint8Array(32);
  S[0] = 7;
  return C$.bytesToHex(new Uint8Array([...R, ...S]));
}
async function forgeAsIdentity(m, secrets, payload) {
  const log = await fetchLog();
  const ring = new Map();
  K$.addKeys(ring, [m.key, ...Object.values(m.keys ?? {})]);
  K$.openLog(log, [], ring, secrets);
  const key = ring.get(log.at(-1).kid);
  const { nonce, ct } = C$.seal(key, payload);
  const e = { v: 1, n: log.length, prev: L$.entryHash(log.at(-1)), at: Date.now(), pub: IDENTITY, kid: C$.keyId(key), nonce, ct };
  e.sig = forgedSig();
  e.w = C$.sign(C$.writeKeyOf(key).sk, C$.utf8ToBytes(JSON.stringify(['ft-write:v1', L$.entryHash(e), null])));
  const r = await fetch(`${base}/api/f/${fid}/log/${e.n}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) });
  return r.status;
}

await run(async () => {
  const A = await rootAdmin();
  const used = [await meName(A)];
  const b = await invite(A, 'محمد', used);
  const B1 = await join('B1', b.link);
  const bId = await meId(B1);
  used.push(await meName(B1));
  check(await ready(B1), 'B joined on B1');
  const c = await invite(A, 'عبدالله', used);
  const C1 = await join('C1', c.link);
  check(await ready(C1), 'C (another member, no key seat) joined');

  check(C$.verify(IDENTITY, C$.utf8ToBytes('any'), forgedSig()) === false, 'a signature made without a secret for the identity point does not verify');

  const spare = await addDeviceLink(B1);
  const invSk = spare.match(/\.i([0-9a-f]{64})/)[1];
  const bk = await keysOf(B1);
  const st = await forge(bk.m, C$.deviceFromSecret(invSk), [bk.d.sk], { type: 'claim', device: IDENTITY, label: 'Chrome · Android' });
  check(st === 201, 'a claim of the waiting invite for the identity point is stored (signed by the invite key)', st);
  await wait(4000);
  const devs = await myDevices(B1);
  check(devs.filter(d => !d.name.startsWith('دعوة جهاز')).length === 1, 'but counts nowhere: B still has one device', devs.map(d => d.name).join(' | '));
  check(devs.some(d => d.name.startsWith('دعوة جهاز')), 'and the invite still waits');

  const ck = await keysOf(C1);
  const st2 = await forgeAsIdentity(ck.m, [ck.d.sk], { type: 'device', act: { kind: 'remove', keys: [bk.d.pk] }, by: bId });
  check(st2 === 400, 'the server refuses C\'s entry "signed" by the identity point', st2);
  await wait(4000);
  check(!(await ended(B1)) && (await ready(B1)), 'B\'s phone keeps the family');
  // the invite is still B's to use: a real phone joins with it
  const B2 = await join('B2', spare);
  check(await ready(B2), 'the waiting invite still works for a real phone of B');
});
