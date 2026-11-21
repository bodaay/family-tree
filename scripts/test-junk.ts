// Checks that a phone steps over entries it cannot use, without a browser:
//   node scripts/test-junk.ts
// Anyone who holds the family key (and, before the write check, anyone at all)
// can append an entry with anything inside. One that does not open, or opens to
// something that is not an entry this app writes, is set aside; the entries
// after it still open, and keys are still learned. Every shape the app writes
// is still taken. A replay that trips over one entry runs again without it.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { gcm } from '@noble/ciphers/aes.js';
import { b64, keyId, newDeviceKey, newFamilyKey, randomBytes, wrapKey } from '../src/core/crypto.ts';
import { entryHash, makeEntry, type Envelope, type Payload } from '../src/core/log.ts';
import { addKeys, openLog, type Ring } from '../src/core/keyring.ts';
import { wellFormed } from '../src/core/wellformed.ts';
import { skipBad } from '../src/data/skipbad.ts';
import { kin } from '../src/data/kinship.ts';
import type { Graph } from '../src/data/graph.ts';
import type { RawFamily } from '../src/core/raw.ts';
import type { Op, Tx } from '../src/data/types.ts';

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
const k1 = newFamilyKey();
const k2 = newFamilyKey();
const family = JSON.parse(await fs.readFile(new URL('../tests/e2e/fixture/family.json', import.meta.url), 'utf8')) as RawFamily;
const y = (v: number, cal: 'g' | 'h' = 'g', approx?: boolean) => ({ v, cal, ...(approx ? { approx } : {}) });
const tx = (ops: Op[], extra: Partial<Tx> = {}): Tx => ({
  id: 'tx-' + Math.random().toString(36).slice(2),
  at: Date.now(),
  by: 'p1',
  title: 'إضافة ابن: سعد بن أحمد',
  subject: 'p1',
  level: 'everyday',
  branch: null,
  ops,
  status: 'pending',
  approvals: [],
  ...extra,
});

// what the app writes, in each shape (from the screens and store.ts)
const person = { id: 'n1', name: 'غازي', sex: 'm' as const, father: 'p1', birth: y(1990, 'g', true) };
const marriage = { id: 'm1', husband: 'p1', wife: 'n2', status: 'married' as const, year: y(1410, 'h') };
const valid: Payload[] = [
  { type: 'seed', family },
  { type: 'propose', tx: tx([{ op: 'addPerson', person }]) },
  { type: 'propose', tx: tx([{ op: 'updatePerson', id: 'p1', before: { aliases: null }, after: { aliases: [{ type: 'kunya', text: 'أبو فهد' }] } }], { level: 'everyday' }) },
  { type: 'propose', tx: tx([{ op: 'addPerson', person: { id: 'n2', name: 'نورة', sex: 'f', external: true } }, { op: 'addMarriage', marriage }], { level: 'sensitive', branch: 'p0' }) },
  { type: 'approve', txId: 'tx-1', by: 'p2', override: true },
  { type: 'approve', txId: 'tx-1', by: 'p2' },
  { type: 'reject', txId: 'tx-1', by: 'p2' },
  { type: 'admin', act: { kind: 'branches', ids: ['p1', 'p2'] }, by: null },
  { type: 'admin', act: { kind: 'appoint', tier: 'gold', branch: 'p1', holder: 'p3', replaces: 'p4' }, by: 'p1' },
  { type: 'admin', act: { kind: 'appoint', tier: 'platinum', branch: null, holder: 'p3' }, by: null },
  { type: 'admin', act: { kind: 'vacate', holder: 'p3' }, by: null },
  { type: 'admin', act: { kind: 'invite', person: 'p3', key: b.pk }, by: null },
  { type: 'admin', act: { kind: 'revoke', key: b.pk }, by: null },
  { type: 'admin', act: { kind: 'self', person: 'p1', device: admin.pk }, by: null },
  { type: 'admin', act: { kind: 'self', person: 'p1', device: admin.pk, label: 'Safari · iPhone' }, by: null },
  // a merge: parents moved, years and other names taken over, a marriage moved, the other record removed
  {
    type: 'admin',
    act: {
      kind: 'edit',
      tx: tx(
        [
          { op: 'updatePerson', id: 'k1', before: { father: 'n9' }, after: { father: 'n1' } },
          { op: 'removeMarriage', marriage },
          { op: 'addMarriage', marriage: { ...marriage, id: 'm1', husband: 'n1' } },
          { op: 'updatePerson', id: 'n1', before: { birth: null, uncertain: null, aliases: null }, after: { birth: y(1950), uncertain: true, aliases: [{ type: 'known', text: 'سعود' }] } },
          { op: 'removePerson', person: { ...person, id: 'n9', aliases: [{ type: 'spelling', text: 'سعد' }] } },
        ],
        { level: 'sensitive', revertOf: 'tx-0', direct: true, status: 'approved' },
      ),
    },
    by: null,
  },
  { type: 'admin', act: { kind: 'edit', tx: tx([{ op: 'updateMarriage', id: 'm1', before: { status: 'married', end: null }, after: { status: 'widowed', end: y(2001) } }]) }, by: 'p1' },
  { type: 'admin', act: { kind: 'edit', tx: tx([{ op: 'updatePerson', id: 'n1', before: { father: 'p1', mother: null }, after: { mother: 'n2', father: null } }]) }, by: null },
  { type: 'claim', device: b.pk },
  { type: 'claim', device: 'zz' },
  { type: 'claim', device: b.pk, label: 'Chrome · Android' },
  { type: 'device', act: { kind: 'invite', key: b.pk }, by: 'p1' },
  { type: 'device', act: { kind: 'add', device: b.pk, label: 'مفتاح الاستعادة', backup: true, proof: 'ab' }, by: 'p1' },
  { type: 'device', act: { kind: 'add', device: b.pk, label: 'Chrome · Android', proof: 'ab' }, by: 'p1' },
  { type: 'device', act: { kind: 'label', device: b.pk, label: 'هاتف العمل' }, by: 'p1' },
  { type: 'device', act: { kind: 'remove', keys: [b.pk, admin.pk] }, by: 'p1' },
  { type: 'access', act: { kind: 'viewall', person: 'p3', on: true }, by: 'p3' },
  { type: 'access', act: { kind: 'guest', key: b.pk, label: 'ضيف' }, by: null },
  { type: 'access', act: { kind: 'end', key: b.pk }, by: null },
  { type: 'rekey', kid: keyId(k2), ...wrapKey(k2, [admin.pk, b.pk]), by: null },
  { type: 'keys', keys: { [keyId(k1)]: b64(k1) } },
  { type: 'writekey', kid: keyId(k1) },
];

// what anyone holding the key could write instead
const junk: unknown[] = [
  null,
  42,
  'propose',
  [],
  {},
  { type: 7 },
  { type: 'propose' },
  { type: 'propose', tx: null },
  { type: 'propose', tx: { ...tx([]), ops: 'all' } },
  { type: 'propose', tx: { ...tx([]), level: 'everything' } },
  { type: 'propose', tx: { ...tx([]), title: { x: 1 } } },
  { type: 'propose', tx: { ...tx([]), by: 5 } },
  { type: 'propose', tx: tx([{ op: 'addPerson', person: { id: 'x', name: 99, sex: 'm' } } as unknown as Op]) },
  { type: 'propose', tx: tx([{ op: 'addPerson', person: { id: 'x', name: 'x', sex: 'q' } } as unknown as Op]) },
  { type: 'propose', tx: tx([{ op: 'addPerson' } as unknown as Op]) },
  { type: 'propose', tx: tx([{ op: 'updatePerson', id: 'p1', before: {}, after: JSON.parse('{"__proto__": {"name": "x"}}') }]) },
  { type: 'propose', tx: tx([{ op: 'updatePerson', id: 'p1', before: {}, after: { name: null } }]) },
  { type: 'propose', tx: tx([{ op: 'updatePerson', id: 'p1', before: {}, after: { id: 'p2' } }]) },
  { type: 'propose', tx: tx([{ op: 'updatePerson', id: 'p1', before: {}, after: { aliases: 'x' } }] as unknown as Op[]) },
  { type: 'propose', tx: tx([{ op: 'updatePerson', id: 'p1', before: {}, after: { birth: 1990 } }] as unknown as Op[]) },
  { type: 'propose', tx: tx([{ op: 'addMarriage', marriage: { ...marriage, status: 'eloped' } }] as unknown as Op[]) },
  { type: 'propose', tx: tx([{ op: 'updateMarriage', id: 'm1', before: {}, after: { year: 'soon' } }] as unknown as Op[]) },
  { type: 'propose', tx: tx([null as unknown as Op]) },
  { type: 'approve', txId: { id: 1 }, by: 'p2' },
  { type: 'approve', txId: 'tx-1' },
  { type: 'admin', act: null, by: null },
  { type: 'admin', act: { kind: 'branches', ids: 'p1' }, by: null },
  { type: 'admin', act: { kind: 'appoint', tier: 'diamond', branch: null, holder: 'p3' }, by: null },
  { type: 'admin', act: { kind: 'edit', tx: { id: 'x' } }, by: null },
  { type: 'admin', act: { kind: 'self', person: 'p1' }, by: { who: 1 } },
  { type: 'claim', device: { pk: 1 } },
  { type: 'claim', device: b.pk, label: 7 },
  { type: 'admin', act: { kind: 'self', person: 'p1', device: admin.pk, label: ['x'] }, by: null },
  { type: 'device', act: null, by: 'p1' },
  { type: 'device', act: { kind: 'invite', key: b.pk }, by: null },
  { type: 'device', act: { kind: 'invite', key: 5 }, by: 'p1' },
  { type: 'device', act: { kind: 'add', device: b.pk, label: 'x', backup: 'yes', proof: 'ab' }, by: 'p1' },
  { type: 'device', act: { kind: 'add', device: b.pk, label: 'x' }, by: 'p1' },
  { type: 'device', act: { kind: 'label', device: b.pk, label: { x: 1 } }, by: 'p1' },
  { type: 'device', act: { kind: 'remove', keys: b.pk }, by: 'p1' },
  { type: 'access', act: { kind: 'viewall', person: 'p3', on: 'yes' }, by: null },
  { type: 'access', act: { kind: 'guest', key: b.pk, label: ['x'] }, by: null },
  { type: 'rekey', kid: 'x', epk: 'x', wraps: null, by: null },
  { type: 'rekey', kid: 'x', epk: 'x', wraps: { [b.pk]: 5 }, by: null },
  { type: 'keys', keys: 'all' },
  { type: 'writekey' },
  { type: 'seed', family: { family: { name: 'x' }, root: null, people: [] } },
  { type: 'seed', family: { ...family, people: 'many' } },
];

test('every shape the app writes is taken (including the tracked family chart as a seed)', () => {
  for (const p of valid) assert.equal(wellFormed(p), true, JSON.stringify(p).slice(0, 120));
});

test('entries in a shape the app does not write are set aside', () => {
  for (const p of junk) assert.equal(wellFormed(p), false, JSON.stringify(p)?.slice(0, 120));
});

test("kinds this version does not know (a newer version's) pass through, for the replay to ignore", () => {
  for (const p of [{ type: 'photo', id: 'x' }, { type: 'admin', act: { kind: 'device', person: 'p1' }, by: null }, { type: 'access', act: { kind: 'later' }, by: null }, { type: 'device', act: { kind: 'later' }, by: 'p1' }, { type: 'propose', tx: tx([{ op: 'addPhoto', id: 'x' } as unknown as Op]) }]) {
    assert.equal(wellFormed(p), true, JSON.stringify(p));
  }
});

// a log with junk all through it: the entries after each still open, and a renewal after them still hands over its key
test('junk in the log never stops the entries after it from opening, nor a renewal from handing over its key', () => {
  const log: Envelope[] = [];
  const entry = (key: Uint8Array, p: unknown, by = b) => makeEntry(key, by, log.length, log.length ? entryHash(log[log.length - 1]) : '', p as Payload);
  const put = (key: Uint8Array, p: unknown, by = b) => log.push(entry(key, p, by));
  put(k1, { type: 'seed', family }, admin);
  // cannot be opened: the wrong key under the right id, a mangled ciphertext, text that is not JSON, an unknown key id
  log.push({ ...entry(newFamilyKey(), valid[1]), kid: keyId(k1) });
  const mangled = entry(k1, valid[1]);
  log.push({ ...mangled, ct: mangled.ct.slice(0, -6) + 'AAAAAA' });
  const nonce = randomBytes(12);
  log.push({ ...entry(k1, valid[1]), nonce: b64(nonce), ct: b64(gcm(k1, nonce).encrypt(new TextEncoder().encode('{"type": "propose", '))) });
  put(newFamilyKey(), valid[1]);
  // opens, but is not an entry
  for (const p of junk) put(k1, p);
  const firstGood = log.length;
  for (const p of valid.slice(1, 8)) put(k1, p);
  put(k1, { type: 'rekey', kid: keyId(k2), ...wrapKey(k2, [admin.pk, b.pk]), by: null }, admin);
  put(k2, valid[1]);
  put(k2, null);
  put(k2, valid[2]);
  const opened: (Payload | null | undefined)[] = [];
  const ring: Ring = new Map();
  addKeys(ring, [b64(k1)]);
  assert.equal(openLog(log, opened, ring, [b.sk]), true, 'the renewal after the junk still hands over the new key');
  assert.ok(ring.has(keyId(k2)));
  assert.equal(opened.length, log.length);
  assert.ok(opened[0] && (opened[0] as Payload).type === 'seed');
  for (let i = 1; i < firstGood; i++) assert.ok(!opened[i], 'entry ' + i + ' is set aside');
  for (let i = firstGood; i < log.length; i++) assert.equal(!!opened[i], i !== log.length - 2, 'entry ' + i);
  // and opening again from the stored results changes nothing
  assert.equal(openLog(log, opened, ring, [b.sk]), false);
});

test('a replay that trips over one entry runs again without it; the rest still counts', () => {
  const items = [1, 2, 3, 4, 5, 6].map(n => ({ p: n as number | null }));
  const bad = new Set([3, 5]);
  let runs = 0;
  const sum = skipBad(items, list => {
    runs++;
    return list.reduce((s, x) => {
      if (x.p !== null && bad.has(x.p)) throw new TypeError('cannot read ' + x.p);
      return s + (x.p ?? 0);
    }, 0);
  });
  assert.equal(sum, 1 + 2 + 4 + 6);
  assert.ok(runs < 20, 'a few replays, not one per entry and prefix: ' + runs);
  assert.deepEqual(
    items.map(x => x.p),
    [1, 2, 3, 4, 5, 6],
    'the log itself is left as it was',
  );
});

test('a replay that fails for no one entry (or on an empty log) still says so, rather than looping', () => {
  assert.throws(() => skipBad([{ p: 1 }, { p: null }], () => {
    throw new Error('always');
  }));
  assert.throws(() => skipBad([], () => {
    throw new Error('empty');
  }));
  // nothing to skip: the replay runs once
  let runs = 0;
  assert.equal(skipBad([{ p: 1 }], () => ++runs), 1);
});

test('a replay that trips over an entry only once a later one comes (e.g. the approval of a broken change) leaves out that later one', () => {
  const items = ['seed', 'propose-bad', 'other', 'approve-bad', 'after'].map(p => ({ p: p as string | null }));
  const out = skipBad(items, list => {
    const seen: string[] = [];
    let pending = false;
    for (const { p } of list) {
      if (!p) continue;
      if (p === 'propose-bad') pending = true;
      if (p === 'approve-bad' && pending) throw new Error('applying the broken change');
      seen.push(p);
    }
    return seen;
  });
  assert.deepEqual(out, ['seed', 'propose-bad', 'other', 'after']);
});

test('a request may name anyone as the one it is about: kinship with someone not in the tree is none, never an error', () => {
  const g = {
    nodes: new Map([
      ['f', { id: 'f', sex: 'm' }],
      ['a', { id: 'a', sex: 'm', father: 'f' }],
      ['b', { id: 'b', sex: 'f', father: 'f' }],
    ]),
    marriages: [],
  } as unknown as Graph;
  assert.equal(kin(g, 'a', 'b')?.deg, 2);
  assert.equal(kin(g, 'a', 'nobody'), null);
  assert.equal(kin(g, 'nobody', 'a'), null);
  assert.equal(kin(g, 'nobody', 'nobody'), null);
});

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
