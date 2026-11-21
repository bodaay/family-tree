// Checks the rules for a person's own devices (أجهزتي), without a browser:
//   node scripts/test-devices.ts
// Every phone replays these the same way, so an entry that breaks them counts
// nowhere: only a person's own devices change their devices, a key holder keeps
// a phone, and a key joins only with its own signature.
import assert from 'node:assert/strict';
import { newDeviceKey } from '../src/core/crypto.ts';
import { BACKUP_LABEL, DeviceBook, MAX_WAITING, cleanLabel, deviceLabel, deviceProof, labelProblem } from '../src/data/devices.ts';

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
const guest = newDeviceKey();
/** A book with X on one phone and Y on one phone (both joined with the root admin's invites). */
function setup() {
  const book = new DeviceBook(k => k === admin.pk || k === guest.pk);
  const x = newDeviceKey(), y = newDeviceKey(), ix = newDeviceKey(), iy = newDeviceKey();
  book.invite(ix.pk, 'X', 1);
  book.invite(iy.pk, 'Y', 1);
  book.link(x.pk, 'X', 2, 'invite', 'Chrome · Android');
  book.invites.get(ix.pk)!.status = 'joined';
  book.invites.get(ix.pk)!.device = x.pk;
  book.link(y.pk, 'Y', 2, 'invite', 'Safari · iPhone');
  return { book, x, y };
}
const ctx = (keyHolder = false) => ({ adminPub: admin.pk, keyHolder });
const add = (k: ReturnType<typeof newDeviceKey>, person: string, extra: object = {}) => ({ kind: 'add' as const, device: k.pk, label: 'Brave · Android', proof: deviceProof(k.sk, admin.pk, person, k.pk), ...extra });

test('a member invites another device of their own; the invite is theirs and names the device that made it', () => {
  const { book, x } = setup();
  const k = newDeviceKey();
  assert.deepEqual(book.apply({ kind: 'invite', key: k.pk }, x.pk, 'X', 3, ctx()), [k.pk]);
  assert.equal(book.invites.get(k.pk)?.person, 'X');
  assert.equal(book.invites.get(k.pk)?.from, x.pk);
});

test("a device invite signed by another member's device is ignored", () => {
  const { book, y } = setup();
  const k = newDeviceKey();
  assert.equal(book.apply({ kind: 'invite', key: k.pk }, y.pk, 'X', 3, ctx()), null);
  assert.equal(book.invites.has(k.pk), false);
  // nor by a key that is nobody's device (the root admin key, a stranger)
  assert.equal(book.apply({ kind: 'invite', key: k.pk }, admin.pk, 'X', 3, ctx()), null);
  assert.equal(book.apply({ kind: 'invite', key: k.pk }, newDeviceKey().pk, 'X', 3, ctx()), null);
});

test('an invite key must be new: not a device, an invite, the root admin key or a guest key', () => {
  const { book, x, y } = setup();
  for (const key of [x.pk, y.pk, admin.pk, guest.pk, [...book.invites.keys()][1], 'not-a-key', '00'.repeat(32)]) {
    assert.equal(book.apply({ kind: 'invite', key }, x.pk, 'X', 3, ctx()), null, key.slice(0, 8));
  }
});

test(`at most ${MAX_WAITING} invites made by a person's devices wait at once`, () => {
  const { book, x } = setup();
  for (let i = 0; i < MAX_WAITING; i++) assert.ok(book.apply({ kind: 'invite', key: newDeviceKey().pk }, x.pk, 'X', 3, ctx()));
  assert.equal(book.apply({ kind: 'invite', key: newDeviceKey().pk }, x.pk, 'X', 3, ctx()), null);
});

test('a key joins as a device only with its own signature, for that person, in this family', () => {
  const { book, x } = setup();
  const k = newDeviceKey();
  assert.equal(book.apply({ ...add(k, 'X'), proof: deviceProof(newDeviceKey().sk, admin.pk, 'X', k.pk) }, x.pk, 'X', 3, ctx()), null, 'signed by another key');
  assert.equal(book.apply(add(k, 'Y'), x.pk, 'X', 3, ctx()), null, 'proof made for Y');
  assert.equal(book.apply({ ...add(k, 'X'), proof: deviceProof(k.sk, newDeviceKey().pk, 'X', k.pk) }, x.pk, 'X', 3, ctx()), null, 'proof from another family');
  assert.deepEqual(book.apply(add(k, 'X'), x.pk, 'X', 3, ctx()), [k.pk]);
  assert.equal(book.owner.get(k.pk), 'X');
  assert.equal(book.info.get(k.pk)?.label, 'Brave · Android');
  assert.equal(book.info.get(k.pk)?.via, 'add');
});

test("a forged add (signed by another member's device) is ignored, and nobody's device can be taken over", () => {
  const { book, x, y } = setup();
  const k = newDeviceKey();
  assert.equal(book.apply(add(k, 'X'), y.pk, 'X', 3, ctx()), null);
  assert.equal(book.apply(add(y, 'X'), x.pk, 'X', 3, ctx()), null, "Y's phone stays Y's");
  assert.equal(book.owner.get(y.pk), 'Y');
});

test('a backup key is named «مفتاح الاستعادة» whatever the entry says, and can sign for the person', () => {
  const { book, x } = setup();
  const b = newDeviceKey();
  assert.ok(book.apply(add(b, 'X', { backup: true, label: 'something else' }), x.pk, 'X', 3, ctx()));
  assert.equal(book.info.get(b.pk)?.label, BACKUP_LABEL);
  assert.equal(book.info.get(b.pk)?.backup, true);
  // a phone restored from the kit: added by the backup key, with a key of its own
  const phone = newDeviceKey();
  assert.ok(book.apply(add(phone, 'X'), b.pk, 'X', 4, ctx()));
  assert.equal(book.of('X').length, 3);
});

test('renaming: only the person\'s own devices, and never a number, an email or a link', () => {
  const { book, x, y } = setup();
  assert.deepEqual(book.apply({ kind: 'label', device: x.pk, label: '  هاتف   العمل ' }, x.pk, 'X', 3, ctx()), []);
  assert.equal(book.info.get(x.pk)?.label, 'هاتف العمل');
  assert.equal(book.apply({ kind: 'label', device: y.pk, label: 'مسروق' }, x.pk, 'X', 3, ctx()), null);
  assert.equal(book.info.get(y.pk)?.label, 'Safari · iPhone');
  for (const bad of ['0551234567', 'a@b.co', 'https://x.y', '', ' ', 'ا'.repeat(41)]) {
    assert.equal(book.apply({ kind: 'label', device: x.pk, label: bad }, x.pk, 'X', 3, ctx()), null, bad);
  }
  assert.ok(labelProblem('٠٥٥١٢٣٤٥٦٧'));
  assert.equal(cleanLabel('Samsung Internet · Android'), 'Samsung Internet · Android');
});

test('removing: only their own devices and invites, and then they are gone (with the invite they joined with)', () => {
  const { book, x, y } = setup();
  const k = newDeviceKey();
  book.apply(add(k, 'X'), x.pk, 'X', 3, ctx());
  assert.equal(book.apply({ kind: 'remove', keys: [y.pk] }, x.pk, 'X', 4, ctx()), null, "Y's phone");
  assert.equal(book.apply({ kind: 'remove', keys: [k.pk, y.pk] }, x.pk, 'X', 4, ctx()), null, 'all or nothing');
  assert.equal(book.owner.get(k.pk), 'X');
  assert.deepEqual(book.apply({ kind: 'remove', keys: [x.pk] }, k.pk, 'X', 4, ctx()), []);
  assert.equal(book.owner.has(x.pk), false);
  assert.equal(book.info.has(x.pk), false);
  assert.equal([...book.invites.values()].find(i => i.device === x.pk)?.status, 'revoked');
  assert.equal(book.ever.get(x.pk), 'X', 'still known as having been theirs');
  // a removed device can no longer sign for them
  assert.equal(book.apply({ kind: 'remove', keys: [k.pk] }, x.pk, 'X', 5, ctx()), null);
});

test("removing a device cancels the invites it made that nobody opened (a stolen phone's «إضافة جهاز» links), and only those", () => {
  const { book, x, y } = setup();
  const second = newDeviceKey();
  book.apply(add(second, 'X'), x.pk, 'X', 3, ctx());
  // x makes two invites: one is opened by a new phone, the other still waits; second makes one too; Y one of his own
  const [used] = book.apply({ kind: 'invite', key: newDeviceKey().pk }, x.pk, 'X', 4, ctx())!;
  const joined = newDeviceKey();
  book.link(joined.pk, 'X', 5, 'invite');
  Object.assign(book.invites.get(used)!, { status: 'joined', device: joined.pk });
  const [spare] = book.apply({ kind: 'invite', key: newDeviceKey().pk }, x.pk, 'X', 5, ctx())!;
  const [other] = book.apply({ kind: 'invite', key: newDeviceKey().pk }, second.pk, 'X', 5, ctx())!;
  const [ys] = book.apply({ kind: 'invite', key: newDeviceKey().pk }, y.pk, 'Y', 5, ctx())!;
  assert.deepEqual(book.apply({ kind: 'remove', keys: [x.pk] }, second.pk, 'X', 6, ctx()), []);
  assert.equal(book.invites.get(spare)?.status, 'revoked', 'the waiting one it made');
  assert.equal(book.invites.get(used)?.status, 'joined', 'one already opened stays as it was');
  assert.equal(book.owner.get(joined.pk), 'X', 'and the phone that opened it stays theirs');
  assert.equal(book.invites.get(other)?.status, 'pending', "another device's invite still waits");
  assert.equal(book.invites.get(ys)?.status, 'pending', "someone else's too");
  // the root admin unlinking a device (a 'revoke' in the log) does the same
  book.unlink(second.pk);
  assert.equal(book.invites.get(other)?.status, 'revoked');
  assert.equal(book.waiting('X').length, 0);
});

test('a claim links only a real public key: never a small-order point (anyone could sign as it) or another spelling', () => {
  const { book } = setup();
  const k = newDeviceKey();
  assert.equal(book.claimable(k.pk), true);
  const smallOrder = ['01' + '00'.repeat(31), '00'.repeat(32), 'ec' + 'ff'.repeat(30) + '7f', 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a'];
  for (const key of [...smallOrder, k.pk.toUpperCase(), k.pk.slice(2), 'x'.repeat(64), 42, null]) assert.equal(book.claimable(key), false, String(key).slice(0, 12));
  // nor someone else's key: the root admin's, a guest's, an invite's
  assert.equal(book.claimable(admin.pk), false);
  assert.equal(book.claimable(guest.pk), false);
  assert.equal(book.claimable([...book.invites.keys()][0]), false);
});

test('a key holder keeps at least one phone; anyone else may remove them all, the signing one too', () => {
  const { book, x } = setup();
  const b = newDeviceKey();
  book.apply(add(b, 'X', { backup: true }), x.pk, 'X', 3, ctx());
  assert.equal(book.apply({ kind: 'remove', keys: [x.pk] }, x.pk, 'X', 4, ctx(true)), null, 'the last phone (the backup key cannot approve)');
  assert.equal(book.apply({ kind: 'remove', keys: [x.pk, b.pk] }, x.pk, 'X', 4, ctx(true)), null, 'all of them');
  assert.deepEqual(book.apply({ kind: 'remove', keys: [b.pk] }, x.pk, 'X', 4, ctx(true)), [], 'the backup key alone');
  const second = newDeviceKey();
  book.apply(add(second, 'X'), x.pk, 'X', 5, ctx(true));
  assert.deepEqual(book.apply({ kind: 'remove', keys: [x.pk] }, x.pk, 'X', 6, ctx(true)), [], 'one of two phones');
  // without a key: everything, including the phone that signs
  const w = book.apply({ kind: 'invite', key: newDeviceKey().pk }, second.pk, 'X', 7, ctx())!;
  assert.deepEqual(book.apply({ kind: 'remove', keys: [second.pk, ...w] }, second.pk, 'X', 8, ctx()), []);
  assert.equal(book.of('X').length, 0);
  assert.equal(book.waiting('X').length, 0);
});

test('garbage entries count nowhere', () => {
  const { book, x } = setup();
  for (const act of [null, {}, { kind: 'remove' }, { kind: 'remove', keys: [] }, { kind: 'remove', keys: 'x' }, { kind: 'add', device: 5 }, { kind: 'label' }, { kind: 'nope' }]) {
    assert.equal(book.apply(act as never, x.pk, 'X', 3, ctx()), null, JSON.stringify(act));
  }
});

test('device names from the browser', () => {
  const ua = {
    android: 'Mozilla/5.0 (Linux; Android 14; CPH2671) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0',
  };
  assert.equal(deviceLabel(ua.android), 'Chrome · Android');
  assert.equal(deviceLabel(ua.samsung), 'Samsung Internet · Android');
  assert.equal(deviceLabel(ua.iphone), 'Safari · iPhone');
  assert.equal(deviceLabel(ua.chromeIos), 'Chrome · iPhone');
  assert.equal(deviceLabel(ua.edge), 'Edge · Windows');
  assert.equal(deviceLabel(ua.firefox), 'Firefox · Mac');
  assert.equal(deviceLabel(''), 'متصفح');
});

console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
