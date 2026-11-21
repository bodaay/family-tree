// The whole server: a web-standard request handler, so the same code can run on
// Node (self-hosting, Docker) or a serverless platform. It stores encrypted
// envelopes, checks the chain and signatures, and never sees family content.
//
// The write check: once a family has a write key registered, the server takes a
// new entry only if it is signed with that key (`w`), which is made from the
// current family key, so only someone holding that key can add to the log. The
// root admin (the signer of entry 0) registers it, or puts it back, with an
// entry that names it (`nw`); a renewal of the family key names the new key's,
// and the server moves to it in the same step as storing that entry. While no
// write key is registered (a family from before the check), entries are taken
// as before.
//
// The version check: each entry says which version of the app wrote it (`app`),
// and none may be older than the entry before it, so a page opened before an
// update cannot write once an updated one has (src/core/log.ts, APP_FORMAT).
import { APP_FORMAT, OLD_APP, WRONG_WRITE_KEY, checkEntry, entryHash, nextWriteKey, writeSigned, type Envelope } from '../src/core/log.ts';

export interface Store {
  /** Every entry with n > after, in order, and the write key in force (null while none is registered). */
  read(fid: string, after: number): Promise<{ entries: Envelope[]; wk: string | null }>;
  /** What checking entry n needs: entry n - 1, the signer of entry 0 (the root admin), and the write key in force. */
  tip(fid: string, n: number): Promise<{ prev: Envelope | null; admin: string | null; wk: string | null }>;
  /**
   * Writes only if no entry n exists yet; false when someone else got there
   * first. With `write`: also only while the write key is still `write.wk`, and
   * `write.next`, if given, becomes the write key together with the entry.
   */
  putIfAbsent(fid: string, e: Envelope, write?: { wk: string | null; next?: string }): Promise<boolean>;
}

const FID = /^[a-z0-9]{6,40}$/;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Compares two secrets in constant time. */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export interface Options {
  /** Whether this request may start a new family (write its first entry). Default: yes. */
  mayCreate?: (req: Request) => boolean;
}

/**
 * Whether entry `e` may be added, given the root admin's key and the write key in
 * force: the write key to move to with it (if any), or why not.
 */
export function writeCheck(e: Envelope, admin: string, wk: string | null): { next?: string } | string {
  const next = nextWriteKey(e);
  if (next === null) return 'bad write key';
  // the root admin may always register or put back the write key
  if (next && e.pub === admin) return { next };
  // nothing registered yet: taken as before; only the root admin can register one
  if (wk === null) return {};
  if (!writeSigned(e, wk)) return WRONG_WRITE_KEY;
  // a renewal, written by someone who holds the current key, hands over to the new one
  return next ? { next } : {};
}

/**
 * The envelope's own fields in the types every phone reads them as (it shows
 * some of them as they are), so an entry it cannot read cannot trip it up either.
 */
function envelopeShape(e: Envelope): boolean {
  const str = (x: unknown) => typeof x === 'string';
  return (
    [e.prev, e.pub, e.kid, e.nonce, e.ct, e.sig].every(str) &&
    [e.w, e.nw, e.ns].every(x => x === undefined || str(x)) &&
    typeof e.at === 'number' &&
    e.at >= 0 &&
    e.at <= 8.64e15 &&
    (e.app === undefined || (Number.isInteger(e.app) && e.app >= 1 && e.app <= APP_FORMAT))
  );
}

export async function handleApi(req: Request, store: Store, opts: Options = {}): Promise<Response | null> {
  const url = new URL(req.url);
  if (url.pathname === '/api/health') return json({ ok: true });
  const m = url.pathname.match(/^\/api\/f\/([^/]+)\/log(?:\/(\d+))?$/);
  if (!m) return url.pathname.startsWith('/api/') ? json({ error: 'not found' }, 404) : null;
  const fid = m[1];
  if (!FID.test(fid)) return json({ error: 'bad family id' }, 400);

  if (req.method === 'GET' && !m[2]) {
    const after = Number(url.searchParams.get('after') ?? -1);
    return json(await store.read(fid, Number.isFinite(after) ? after : -1));
  }

  if (req.method === 'PUT' && m[2]) {
    const n = Number(m[2]);
    if (n === 0 && opts.mayCreate && !opts.mayCreate(req)) return json({ error: 'not allowed' }, 403);
    let e: Envelope;
    try {
      e = (await req.json()) as Envelope;
    } catch {
      return json({ error: 'bad json' }, 400);
    }
    if (!e || typeof e !== 'object' || e.n !== n) return json({ error: 'position mismatch' }, 400);
    if (!envelopeShape(e)) return json({ error: 'bad envelope' }, 400);
    if (JSON.stringify(e).length > 1_500_000) return json({ error: 'too large' }, 413);
    const { prev, admin, wk } = await store.tip(fid, n);
    let prevHash = '';
    if (n > 0) {
      if (!prev) return json({ error: 'gap in log' }, 409);
      prevHash = entryHash(prev);
    }
    const bad = checkEntry(e, prevHash);
    if (bad) return json({ error: bad }, n > 0 && bad === 'broken chain' ? 409 : 400);
    // written by an older version of the app than the entry before it: it must update first
    if (prev && (e.app ?? 1) < (prev.app ?? 1)) return json({ error: OLD_APP }, 426);
    // the first entry starts a family: it needs no write key, and may register one
    const write = writeCheck(e, n === 0 ? e.pub : (admin ?? ''), n === 0 ? null : wk);
    if (typeof write === 'string') return json(write === WRONG_WRITE_KEY ? { error: write, wk } : { error: write }, write === WRONG_WRITE_KEY ? 403 : 400);
    // stored only if the write key is still the one checked (it changes only with an entry)
    const ok = await store.putIfAbsent(fid, e, { wk, next: write.next });
    return ok ? json({ ok: true, n }, 201) : json({ error: 'taken' }, 409);
  }
  return json({ error: 'method not allowed' }, 405);
}
