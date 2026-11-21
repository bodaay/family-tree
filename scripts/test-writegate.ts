// Checks the server's write check, without a browser or a running server:
//   node scripts/test-writegate.ts
// The API handler runs against an in-memory store, the file store (in a
// temporary folder), and the Cloudflare Worker with its Durable Object on
// Node's own SQLite. A family from before the check takes entries as before;
// once the root admin registers the write key, only entries signed with the
// current family key's write key are taken; a renewal moves the server to the
// new key; the root admin can always put it back; and the whole log, old
// entries and new, still verifies. And once an updated app has written, an
// entry from an older version is refused, with a reply that says to update.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { handleApi, type Store } from '../server/handler.ts';
import { fileStore } from '../server/fsstore.ts';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hashHex, keyId, newDeviceKey, newFamilyKey, sign, utf8ToBytes, wrapKey, writeKeyOf, type DeviceKey } from '../src/core/crypto.ts';
import { APP_FORMAT, OLD_APP, WRONG_WRITE_KEY, checkEntry, entryHash, makeEntry, nextWriteKey, writeSigned, type Envelope, type Payload } from '../src/core/log.ts';
import type { RawFamily } from '../src/core/raw.ts';

let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '-', e instanceof Error ? e.message : e);
  }
}

function memoryStore(): Store {
  const logs = new Map<string, Envelope[]>();
  const wks = new Map<string, string>();
  const clone = (e: Envelope) => JSON.parse(JSON.stringify(e)) as Envelope;
  return {
    async read(fid, after) {
      return { entries: (logs.get(fid) ?? []).filter(e => e.n > after).map(clone), wk: wks.get(fid) ?? null };
    },
    async tip(fid, n) {
      const l = logs.get(fid) ?? [];
      return { prev: n > 0 && l[n - 1] ? clone(l[n - 1]) : null, admin: l[0]?.pub ?? null, wk: wks.get(fid) ?? null };
    },
    async putIfAbsent(fid, e, write) {
      const l = logs.get(fid) ?? [];
      if (write && (wks.get(fid) ?? null) !== write.wk) return false;
      if (l[e.n]) return false;
      l[e.n] = clone(e);
      logs.set(fid, l);
      if (write?.next) wks.set(fid, write.next);
      return true;
    },
  };
}

/** An entry as app versions from before the write check wrote it: the same, without `w`. */
function old(e: Envelope): Envelope {
  const { w, ...rest } = e;
  void w;
  return rest;
}

const family: RawFamily = { family: { name: 'test' }, root: { id: 'r', name: 'root', sex: 'm' }, people: [{ id: 'a', name: 'أحمد', sex: 'm', parent: 'r' }] };
const tx = (id: string) => ({ id, at: 1, by: 'a', title: 'طلب', subject: 'a', level: 'everyday' as const, branch: null, ops: [], status: 'pending' as const, approvals: [] });

async function suite(label: string, store: Store, handle = (req: Request) => handleApi(req, store)) {
  const fid = 'fam' + Math.random().toString(36).slice(2, 10);
  const api = (method: string, p: string, body?: unknown) =>
    handle(new Request('http://localhost/api/f/' + fid + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
  const log = async () => (await (await api('GET', '/log?after=-1'))!.json()) as { entries: Envelope[]; wk: string | null };
  const put = async (e: Envelope) => {
    const r = (await api('PUT', '/log/' + e.n, e))!;
    return { status: r.status, body: (await r.json()) as { error?: string; wk?: string | null } };
  };
  /** The next entry at the end of the log, as `by` writes it with `key`. */
  const next = async (key: Uint8Array, by: DeviceKey, p: Payload, nw?: string) => {
    const { entries } = await log();
    return makeEntry(key, by, entries.length, entries.length ? entryHash(entries[entries.length - 1]) : '', p, nw);
  };
  const t = (name: string, fn: () => Promise<void>) => test(`${label}: ${name}`, fn);

  const admin = newDeviceKey();
  const b = newDeviceKey(); // a member who keeps access
  const c = newDeviceKey(); // a member removed at the renewal
  const plat = newDeviceKey(); // the platinum holder's phone
  const k1 = newFamilyKey();
  const k2 = newFamilyKey();
  const w1 = writeKeyOf(k1).pk;
  const w2 = writeKeyOf(k2).pk;

  await t('a family from before the write check takes entries without a write signature, as before', async () => {
    const seed = makeEntry(k1, admin, 0, '', { type: 'seed', family });
    assert.equal((await put(old(seed))).status, 201);
    assert.equal((await put(old(await next(k1, b, { type: 'propose', tx: tx('t1') })))).status, 201);
    assert.equal((await put(old(await next(k1, c, { type: 'claim', device: c.pk })))).status, 201);
    assert.equal((await log()).wk, null);
  });

  await t('while nothing is registered, anyone who knows the family id can still append (the gap this closes)', async () => {
    assert.equal((await put(old(await next(newFamilyKey(), newDeviceKey(), { type: 'keys', keys: {} })))).status, 201);
  });

  await t('an envelope whose plain fields are not of the types phones read is refused, even when signed', async () => {
    const { entries } = await log();
    const prev = entryHash(entries[entries.length - 1]);
    const dev = newDeviceKey();
    for (const odd of [{ at: 1e20 }, { at: '2026' }, { ct: 12345 }, { kid: { x: 1 } }, { w: 7 }]) {
      const body = { v: 1, n: entries.length, prev, at: Date.now(), pub: dev.pk, kid: 'x', nonce: 'x', ct: 'x', ...odd };
      const sig = sign(dev.sk, utf8ToBytes(JSON.stringify([body.v, body.n, body.prev, body.at, body.pub, body.kid, body.nonce, body.ct])));
      const r = await put({ ...body, sig } as unknown as Envelope);
      assert.equal(r.status, 400, JSON.stringify(odd));
      assert.equal(r.body.error, 'bad envelope');
    }
  });

  await t('only the root admin registers a write key: anyone else naming one changes nothing', async () => {
    const r = await put(await next(k1, b, { type: 'writekey', kid: keyId(k1) }, writeKeyOf(newFamilyKey()).pk));
    assert.equal(r.status, 201);
    assert.equal((await log()).wk, null);
  });

  await t("the root admin's phone registers the current key's write key", async () => {
    const r = await put(await next(k1, admin, { type: 'writekey', kid: keyId(k1) }, w1));
    assert.equal(r.status, 201);
    assert.equal((await log()).wk, w1);
  });

  await t('then an entry without a write signature is refused (an older app version), naming the key in force', async () => {
    const r = await put(old(await next(k1, b, { type: 'propose', tx: tx('t2') })));
    assert.equal(r.status, 403);
    assert.equal(r.body.error, WRONG_WRITE_KEY);
    assert.equal(r.body.wk, w1);
  });

  await t('a wrong write signature is refused: another key, a device key, or one copied from another entry', async () => {
    assert.equal((await put(await next(newFamilyKey(), b, { type: 'propose', tx: tx('t3') }))).status, 403, 'another family key');
    const e = await next(k1, b, { type: 'propose', tx: tx('t3') });
    const byDevice = { ...e, w: makeEntry(k1, b, e.n, e.prev, { type: 'keys', keys: {} }).sig };
    assert.equal((await put(byDevice)).status, 403, 'a device signature');
    const { entries } = await log();
    const copied = { ...e, w: entries[entries.length - 1].w };
    assert.equal((await put(copied)).status, 403, "the last entry's");
  });

  await t('an entry signed with the current write key is taken', async () => {
    assert.equal((await put(await next(k1, b, { type: 'propose', tx: tx('t4') }))).status, 201);
  });

  await t('an entry "signed" by a small-order key is refused: such a signature is made without any secret', async () => {
    const e = await next(k1, b, { type: 'propose', tx: tx('t4b') });
    // under the lax ZIP-215 rules R = [7]B, S = 7 verifies for the identity point, whatever the message
    const forged = { ...e, pub: '01' + '00'.repeat(31), sig: bytesToHex(new Uint8Array([...ed25519.Point.BASE.multiply(7n).toBytes(), 7, ...new Uint8Array(31)])) };
    forged.w = sign(writeKeyOf(k1).sk, utf8ToBytes(JSON.stringify(['ft-write:v1', entryHash(forged), null])));
    assert.notEqual(checkEntry(forged, e.prev), null);
    assert.equal((await put(forged)).status, 400);
  });

  await t('a write key its signer did not sign, or that is not a key, is refused', async () => {
    const e = await next(k1, admin, { type: 'writekey', kid: keyId(k1) }, w1);
    assert.equal((await put({ ...e, nw: writeKeyOf(newFamilyKey()).pk })).status, 400, 'swapped');
    const { ns, ...noNs } = e;
    void ns;
    assert.equal((await put(noNs)).status, 400, 'unsigned');
    assert.equal((await put(await next(k1, admin, { type: 'writekey', kid: keyId(k1) }, 'zz'))).status, 400, 'not a key');
    assert.equal((await log()).wk, w1);
  });

  await t("the root admin's entries need the write signature too, unless they register a key", async () => {
    assert.equal((await put(old(await next(k1, admin, { type: 'admin', act: { kind: 'revoke', key: c.pk }, by: null })))).status, 403);
    assert.equal((await put(await next(k1, admin, { type: 'admin', act: { kind: 'revoke', key: c.pk }, by: null }))).status, 201);
  });

  await t('a renewal (here by the platinum phone) moves the server to the new key as it is stored', async () => {
    const p = { type: 'rekey' as const, kid: keyId(k2), ...wrapKey(k2, [admin.pk, b.pk, plat.pk]), by: 'p' };
    assert.equal((await put(await next(k1, plat, p, w2))).status, 201);
    assert.equal((await log()).wk, w2);
  });

  await t('after the renewal the old key is refused: the removed member cannot append anything', async () => {
    for (const p of [{ type: 'propose', tx: tx('t5') }, { type: 'claim', device: c.pk }, { type: 'keys', keys: {} }] as Payload[]) {
      const r = await put(await next(k1, c, p));
      assert.equal(r.status, 403);
      assert.equal(r.body.wk, w2);
    }
    // nor move the write key with a renewal of their own
    assert.equal((await put(await next(k1, c, { type: 'rekey', kid: keyId(k1), epk: '', wraps: {}, by: null }, writeKeyOf(newFamilyKey()).pk))).status, 403);
    assert.equal((await log()).wk, w2);
  });

  await t('a member still on the old key is refused too; with the new key (learned from the renewal) it is taken', async () => {
    assert.equal((await put(await next(k1, b, { type: 'propose', tx: tx('t6') }))).status, 403);
    assert.equal((await put(await next(k2, b, { type: 'keys', keys: { [keyId(k1)]: 'x' } }))).status, 201);
  });

  await t('someone holding the current key can move it (a renewal of their own); the root admin puts it back', async () => {
    const rogue = writeKeyOf(newFamilyKey()).pk;
    assert.equal((await put(await next(k2, b, { type: 'rekey', kid: 'x', epk: '', wraps: {}, by: null }, rogue))).status, 201);
    assert.equal((await log()).wk, rogue);
    assert.equal((await put(await next(k2, plat, { type: 'propose', tx: tx('t7') }))).status, 403, 'everyone else is locked out');
    // the root admin's entry is taken although its write signature is not the rogue key's
    assert.equal((await put(await next(k2, admin, { type: 'writekey', kid: keyId(k2) }, w2))).status, 201);
    assert.equal((await log()).wk, w2);
    assert.equal((await put(await next(k2, plat, { type: 'propose', tx: tx('t7') }))).status, 201);
  });

  await t('the store refuses an entry when the write key moved on after it was checked', async () => {
    const e = await next(k2, b, { type: 'propose', tx: tx('t8') });
    assert.equal(await store.putIfAbsent(fid, e, { wk: w1 }), false);
    assert.equal((await log()).entries.length, e.n, 'nothing written');
    assert.equal(await store.putIfAbsent(fid, e, { wk: w2 }), true);
    assert.equal(await store.putIfAbsent(fid, e, { wk: w2 }), false, 'never overwritten');
  });

  await t('the whole log verifies, old entries and new, and old entries hash as they always did', async () => {
    const { entries } = await log();
    assert.ok(entries.some(e => !e.w) && entries.some(e => e.w) && entries.some(e => e.nw));
    let prev = '';
    for (const e of entries) {
      assert.equal(checkEntry(e, prev), null, 'entry ' + e.n);
      // the hash chain is over the same fields as before the write check
      const h = hashHex(JSON.stringify([e.v, e.n, e.prev, e.at, e.pub, e.kid, e.nonce, e.ct, e.sig]));
      assert.equal(entryHash(e), h);
      prev = h;
    }
  });

  await t("a stored entry's added fields cannot be swapped: each is signed", async () => {
    const e = (await log()).entries.find(x => x.nw === w2 && x.pub === admin.pk)!;
    assert.equal(nextWriteKey(e), w2);
    assert.equal(writeSigned(e, w2), true);
    assert.equal(nextWriteKey({ ...e, nw: w1 }), null);
    assert.equal(writeSigned({ ...e, nw: w1 }, w2), false);
    assert.equal(writeSigned({ ...e, ct: e.ct.slice(0, -2) + 'AA' }, w2), false);
  });

  await t('a new family can register its write key with its first entry', async () => {
    const fid2 = fid + 'n';
    const k = newFamilyKey();
    const seed = makeEntry(k, admin, 0, '', { type: 'seed', family }, writeKeyOf(k).pk);
    const r = await handle(new Request(`http://localhost/api/f/${fid2}/log/0`, { method: 'PUT', body: JSON.stringify(seed) }));
    assert.equal(r!.status, 201);
    const got = (await (await handle(new Request(`http://localhost/api/f/${fid2}/log`)))!.json()) as { wk: string | null };
    assert.equal(got.wk, writeKeyOf(k).pk);
  });

  await t('a page from before an update writes as before until an updated one has; then it is told to update', async () => {
    const fid3 = fid + 'v';
    const k = newFamilyKey();
    const at = async (e: Envelope) => (await handle(new Request(`http://localhost/api/f/${fid3}/log/${e.n}`, { method: 'PUT', body: JSON.stringify(e) })))!;
    // as versions from before the version check wrote it: without `app`
    const before = (e: Envelope): Envelope => {
      const { app, ...rest } = e;
      void app;
      return rest;
    };
    const e0 = before(makeEntry(k, admin, 0, '', { type: 'seed', family }));
    assert.equal((await at(e0)).status, 201);
    const e1 = before(makeEntry(k, b, 1, entryHash(e0), { type: 'propose', tx: tx('v1') }));
    assert.equal((await at(e1)).status, 201);
    const e2 = makeEntry(k, admin, 2, entryHash(e1), { type: 'approve', txId: 'v1', by: 'r' });
    assert.equal(e2.app, APP_FORMAT);
    assert.equal((await at(e2)).status, 201);
    const e3 = before(makeEntry(k, b, 3, entryHash(e2), { type: 'propose', tx: tx('v2') }));
    const r = await at(e3);
    assert.equal(r.status, 426);
    assert.equal(((await r.json()) as { error?: string }).error, OLD_APP);
    assert.equal((await at({ ...e3, app: APP_FORMAT })).status, 201, 'the same entry from an updated app');
    // a version the server does not know is refused outright: no one can shut out the versions after theirs
    const e4 = makeEntry(k, b, 4, entryHash(e3), { type: 'propose', tx: tx('v3') });
    for (const app of [APP_FORMAT + 1, 1.5, 0, '2']) {
      const got = await at({ ...e4, app } as unknown as Envelope);
      assert.equal(got.status, 400, String(app));
    }
    assert.equal((await at(e4)).status, 201);
  });

  await t('an unknown family reads as empty, with no write key', async () => {
    const r = (await (await handle(new Request('http://localhost/api/f/nosuchfamily/log')))!.json()) as { entries: Envelope[]; wk: string | null };
    assert.deepEqual(r, { entries: [], wk: null });
  });

  await t('two entries for the same place at once: one is stored, the other is told to retry', async () => {
    const { entries, wk } = await log();
    const prev = entryHash(entries[entries.length - 1]);
    const one = makeEntry(k2, b, entries.length, prev, { type: 'propose', tx: tx('t9') });
    const two = makeEntry(k2, admin, entries.length, prev, { type: 'writekey', kid: keyId(k2) }, writeKeyOf(newFamilyKey()).pk);
    const got = await Promise.all([store.putIfAbsent(fid, one, { wk }), store.putIfAbsent(fid, two, { wk, next: two.nw })]);
    assert.deepEqual(got.filter(Boolean).length, 1);
    const after = await log();
    assert.equal(after.wk, got[1] ? two.nw : wk, 'the write key moves only with its own entry');
  });
  return fid;
}

await suite('memory', memoryStore());

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-writegate-'));
try {
  const fid = await suite('files', fileStore(tmp));
  await test('files: the write key is kept on disk, for the next start of the server', async () => {
    const { wk } = await fileStore(tmp).read(fid, -1);
    assert.equal(wk, (await fileStore(tmp).tip(fid, 1)).wk);
    assert.match(wk ?? '', /^[0-9a-f]{64}$/);
  });
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}

// ---- the Cloudflare Worker: its Durable Object, each family's own SQLite database (here Node's)
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        if (s !== 'cloudflare:workers') return next(s, c);
        return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }') };
      }`,
    ),
);
// the worker's own types need the Cloudflare ones, so it is loaded by a path the type check does not follow
interface DurableLog {
  read(after: number): ReturnType<Store['read']> extends Promise<infer R> ? R : never;
  tip(n: number): ReturnType<Store['tip']> extends Promise<infer R> ? R : never;
  putIfAbsent(e: Envelope, write?: { wk: string | null; next?: string }): boolean;
}
const workerFile = '../worker/index.ts';
const worker = (await import(workerFile)) as {
  FamilyLog: new (ctx: unknown, env: unknown) => DurableLog;
  default: { fetch(req: Request, env: unknown): Promise<Response> };
};
type Cursor = { toArray(): unknown[]; rowsWritten: number };
function durableStorage(db: DatabaseSync) {
  return {
    sql: {
      exec(query: string, ...args: (string | number | null)[]): Cursor {
        const st = db.prepare(query);
        if (/^\s*select/i.test(query)) {
          const rows = st.all(...args);
          return { toArray: () => rows, rowsWritten: 0 };
        }
        const r = st.run(...args);
        return { toArray: () => [], rowsWritten: Number(r.changes) };
      },
    },
    transactionSync<T>(fn: () => T): T {
      db.exec('BEGIN');
      try {
        const v = fn();
        db.exec('COMMIT');
        return v;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
const objects = new Map<string, DurableLog>();
const env = {
  CREATE_TOKEN: 'test-token',
  ASSETS: { fetch: async () => new Response('app') },
  LOGS: {
    getByName(fid: string) {
      if (!objects.has(fid)) objects.set(fid, new worker.FamilyLog({ storage: durableStorage(new DatabaseSync(':memory:')) }, env));
      return objects.get(fid)!;
    },
  },
};
const durable: Store = {
  read: async (fid, after) => env.LOGS.getByName(fid).read(after),
  tip: async (fid, n) => env.LOGS.getByName(fid).tip(n),
  putIfAbsent: async (fid, e, write) => env.LOGS.getByName(fid).putIfAbsent(e, write),
};
const fetchWorker = (req: Request) => {
  // starting a family needs the token, as on the live site
  const headers = new Headers(req.headers);
  headers.set('authorization', 'Bearer ' + env.CREATE_TOKEN);
  return worker.default.fetch(new Request(req, { headers }), env);
};
await suite('worker', durable, fetchWorker);
await test('worker: a family cannot be started without the token', async () => {
  const k = newFamilyKey();
  const seed = makeEntry(k, newDeviceKey(), 0, '', { type: 'seed', family });
  const r = await worker.default.fetch(new Request('http://localhost/api/f/nofamily1/log/0', { method: 'PUT', body: JSON.stringify(seed) }), env);
  assert.equal(r.status, 403);
});

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
