// Checks renewing the family key, without a browser or server:
//   node scripts/test-rotation.ts
// Handing a key to readers, and that someone left out of a renewal cannot open
// anything after it, while a newcomer with only the newest key reads it all.
import assert from 'node:assert/strict';
import { b64, bytesToHex, canReceiveKey, keyId, newDeviceKey, newFamilyKey, unwrapKey, wrapKey, wrapOpens } from '../src/core/crypto.ts';
import { entryHash, makeEntry, type Envelope, type Payload } from '../src/core/log.ts';
import { addKeys, openLog, type Ring } from '../src/core/keyring.ts';
import { KeyChain, adminCopyOpens } from '../src/data/keychain.ts';
import type { RawFamily } from '../src/core/raw.ts';

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '-', e instanceof Error ? e.message : e);
  }
}

const admin = newDeviceKey();
const b = newDeviceKey();
const c = newDeviceKey();
const invite = newDeviceKey();
const k1 = newFamilyKey();
const k2 = newFamilyKey();

test('wrap and unwrap: each reader opens their own copy, nobody else does', () => {
  const { epk, wraps } = wrapKey(k2, [admin.pk, b.pk, invite.pk, 'not-a-key']);
  assert.deepEqual(Object.keys(wraps).sort(), [admin.pk, b.pk, invite.pk].sort());
  for (const r of [admin, b, invite]) assert.equal(bytesToHex(unwrapKey(r.sk, epk, wraps[r.pk])!), bytesToHex(k2));
  assert.equal(unwrapKey(c.sk, epk, wraps[b.pk]), null);
  assert.equal(unwrapKey(b.sk, epk, wraps[admin.pk]), null);
});

// a small log: seed and a change under k1, then C is unlinked and the key renewed for admin, B and an open invite
const family: RawFamily = { family: { name: 'test' }, root: { id: 'r', name: 'root', sex: 'm' }, people: [] };
const log: Envelope[] = [];
function put(key: Uint8Array, by: typeof admin, p: Payload) {
  log.push(makeEntry(key, by, log.length, log.length ? entryHash(log[log.length - 1]) : '', p));
}
put(k1, admin, { type: 'seed', family });
put(k1, admin, { type: 'admin', act: { kind: 'revoke', key: c.pk }, by: null });
put(k1, admin, { type: 'rekey', kid: keyId(k2), ...wrapKey(k2, [admin.pk, b.pk, invite.pk]), by: null });
put(k2, admin, { type: 'keys', keys: { [keyId(k1)]: b64(k1) } });
put(k2, b, { type: 'reject', txId: 'x', by: 'b' });
const ring = (...keys: Uint8Array[]): Ring => {
  const r: Ring = new Map();
  addKeys(r, keys.map(b64));
  return r;
};

test('a removed device (old key, its own secret) cannot open anything after the renewal', () => {
  const opened: (Payload | null | undefined)[] = [];
  const r = ring(k1);
  assert.equal(openLog(log, opened, r, [c.sk]), false);
  assert.equal(opened.slice(0, 3).every(p => p), true, 'entries before the renewal stay readable');
  assert.equal(log.length, 5);
  assert.equal([3, 4].every(i => opened[i] === undefined), true, 'entries after it stay sealed');
  assert.equal(r.has(keyId(k2)), false);
});

test('a reader who keeps access learns the new key from the renewal and reads on', () => {
  const opened: (Payload | null | undefined)[] = [];
  const r = ring(k1);
  assert.equal(openLog(log, opened, r, [b.sk]), true);
  assert.equal(opened.every(p => p), true);
  assert.equal(r.has(keyId(k2)), true);
});

test('an open invite made before the renewal still gets in', () => {
  const opened: (Payload | null | undefined)[] = [];
  openLog(log, opened, ring(k1), [newDeviceKey().sk, invite.sk]);
  assert.equal(opened.every(p => p), true);
});

test('a newcomer with only the newest key reads the whole history', () => {
  const opened: (Payload | null | undefined)[] = [];
  const r = ring(k2);
  openLog(log, opened, r, [newDeviceKey().sk]);
  assert.equal(opened.every(p => p), true);
  assert.equal((opened[0] as Payload).type, 'seed');
  assert.equal(r.has(keyId(k1)), true);
});

test('forged entries: a key that is not the one its id names is refused; garbage stays closed', () => {
  const k3 = newFamilyKey();
  const forged: Envelope[] = [...log];
  const add = (key: Uint8Array, p: Payload) => forged.push(makeEntry(key, b, forged.length, entryHash(forged[forged.length - 1]), p));
  add(k2, { type: 'keys', keys: { [keyId(k3)]: b64(newFamilyKey()) } });
  const junk = makeEntry(k2, b, forged.length, entryHash(forged[forged.length - 1]), { type: 'keys', keys: {} });
  forged.push({ ...junk, ct: junk.ct.slice(0, -4) + 'AAAA' });
  const opened: (Payload | null | undefined)[] = [];
  const r = ring(k2);
  openLog(forged, opened, r, []);
  assert.equal(r.has(keyId(k3)), false);
  assert.equal(opened[opened.length - 1], null);
});

test('a keys entry cannot fill every phone with keys no entry was sealed with', () => {
  const spam = Array.from({ length: 50 }, () => newFamilyKey());
  const forged: Envelope[] = [...log];
  forged.push(makeEntry(k2, b, forged.length, entryHash(forged[forged.length - 1]), { type: 'keys', keys: Object.fromEntries(spam.map(k => [keyId(k), b64(k)])) }));
  const r = ring(k2);
  openLog(forged, [], r, []);
  assert.equal(r.size, 2, 'only the two versions the log uses');
});

test('key versions: a renewal counts only if every reader gets the new key, and old keys stop counting', () => {
  const kc = new KeyChain();
  kc.start(keyId(k1), admin.pk, 1);
  kc.gave(invite.pk);
  kc.handOver(invite.pk, b.pk);
  kc.gave(c.pk);
  const readers = new Set([admin.pk, b.pk]);
  assert.deepEqual(kc.stale(readers), [c.pk], 'C still holds the current key');
  const partial = { type: 'rekey' as const, kid: keyId(k2), ...wrapKey(k2, [admin.pk]), by: null };
  assert.equal(kc.renew(partial, readers, 2), false, 'leaves B out');
  const full = { type: 'rekey' as const, kid: keyId(k2), ...wrapKey(k2, [admin.pk, b.pk]), by: null };
  assert.equal(kc.renew(full, readers, 2), true);
  assert.equal(kc.counts(keyId(k1)), false);
  assert.equal(kc.counts(keyId(k2)), true);
  assert.deepEqual(kc.stale(readers), []);
  assert.equal(kc.renew({ ...full, kid: keyId(k1) }, readers, 3), false, 'never back to an old key');
  assert.equal(kc.backfilled, false);
  kc.backfill({ type: 'keys', keys: { [keyId(k1)]: b64(newFamilyKey()) } });
  assert.equal(kc.backfilled, false, 'a wrong key does not count');
  kc.backfill({ type: 'keys', keys: { [keyId(k1)]: b64(k1) } });
  assert.equal(kc.backfilled, true);
});

test('anyone holding the new key can check any reader\'s copy, without that reader\'s secret', () => {
  const w = wrapKey(k2, [admin.pk, b.pk]);
  assert.equal(wrapOpens(k2, w.epk, admin.pk, w.wraps[admin.pk]), true);
  assert.equal(wrapOpens(k2, w.epk, b.pk, w.wraps[b.pk]), true);
  assert.equal(wrapOpens(k2, w.epk, admin.pk, w.wraps[b.pk]), false, "B's copy is not the admin's");
  assert.equal(wrapOpens(newFamilyKey(), w.epk, admin.pk, w.wraps[admin.pk]), false, 'another key');
  // a copy that opens, but under an ephemeral key not made from the new key, cannot be checked: refused
  const other = wrapKey(newFamilyKey(), [admin.pk]);
  assert.equal(wrapOpens(k2, other.epk, admin.pk, w.wraps[admin.pk]), false);
  assert.equal(wrapOpens(k2, w.epk, admin.pk, 'garbage'), false);
});

test("a renewal whose copy for the root admin does not open is refused (the platinum holder cannot shut the admin out)", () => {
  const good = { type: 'rekey' as const, kid: keyId(k2), ...wrapKey(k2, [admin.pk, b.pk]), by: 'p' };
  assert.equal(adminCopyOpens(k2, good, admin.pk), true);
  const bad = { ...good, wraps: { ...good.wraps, [admin.pk]: good.wraps[b.pk] } };
  assert.equal(adminCopyOpens(k2, bad, admin.pk), false);
  const missing = { ...good, wraps: { [b.pk]: good.wraps[b.pk] } };
  assert.equal(adminCopyOpens(k2, missing, admin.pk), false);
});

test('a linked "device" that is not a real public key cannot block every renewal', () => {
  const small = '01' + '00'.repeat(31); // the identity point: small order, no secret key makes it
  assert.equal(canReceiveKey(b.pk), true);
  for (const x of ['zz', small, 'ab'.repeat(32), '__proto__', 'constructor']) assert.equal(canReceiveKey(x), false, x);
  const kc = new KeyChain();
  kc.start(keyId(k1), admin.pk, 1);
  const readers = new Set([admin.pk, b.pk, 'zz', small, '__proto__', 'constructor']);
  const p = { type: 'rekey' as const, kid: keyId(k2), ...wrapKey(k2, [...readers]), by: null };
  assert.deepEqual(Object.keys(p.wraps).sort(), [admin.pk, b.pk].sort());
  assert.equal(kc.renew(p, readers, 2), true);
  const noB = { type: 'rekey' as const, kid: keyId(newFamilyKey()), ...wrapKey(k2, [admin.pk]), by: null };
  assert.equal(new KeyChain().renew(noB, readers, 2), false, 'a real reader left out still counts');
});

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
