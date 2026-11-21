// Where the family log lives: the shared server (encrypted, for a real family)
// or this browser only (the sample family).
import { AS_TYPES, OLD_APP, WRONG_WRITE_KEY, checkEntry, entryHash, makeEntry, type Envelope, type Payload } from '../core/log.ts';
import { b64, deviceFromSecret, newDeviceKey, writeKeyOf, type DeviceKey } from '../core/crypto.ts';
import { addKeys, openLog, ringRecord, type Ring } from '../core/keyring.ts';
import { sampleFamily, sampleKeys } from './sample';
import { forget, load, save } from './vault';
import { loadLog, saveLog } from './logcache';
import { openBundle, openSealed } from '../core/personkeys.ts';
import { signedPrivate, type Wrapped } from './hidden';

export interface Item {
  /** null: this device cannot open it (a key it was never given, or a forged entry). */
  p: Payload | null;
  at: number;
  /** Who signed it. The signer of the first entry is the family's root admin. */
  pub: string;
  /** The version of the family key that sealed it (real families only). */
  kid?: string;
  /** A private entry this device could open (data/hidden.ts): what it holds, each piece signed by its writer. */
  priv?: Wrapped[];
}

/** Builds an entry from the log as it stands just before it is written; null: nothing to write after all. */
export type Build = (items: Item[]) => Payload | null;

export interface Backend {
  kind: 'remote' | 'sample';
  items: Item[];
  /** Fetches anything new; true when the log changed. */
  pull(): Promise<boolean>;
  /**
   * Signs with this device's key, the root admin's key, or another key (a personal
   * invite's). False if a Build declined. `next`: the new family key a renewal hands out.
   */
  append(p: Payload | Build, as?: 'admin' | DeviceKey, next?: Uint8Array): Promise<boolean>;
  /** The root admin key this device holds, if any. */
  adminPub(): string | null;
}

export interface Membership {
  fid: string;
  /** The family key: the link's, then the newest this device has learned (what new links carry). */
  key: string;
  /** Every version of the family key this device has learned, by key id. Older memberships have only `key`. */
  keys?: Record<string, string>;
  /** Root admin's signing key: only in the admin link. */
  admin?: string;
  /** A personal invite's key, kept until this device has joined with it. */
  invite?: string;
  /** A recovery kit's backup key, kept only until it has added this phone to the person's devices. */
  kit?: string;
  /**
   * Joined with a link that moves a person's access out of a browser on an
   * iPhone (design document 1.38): `from`, once known, is that browser's device,
   * which this phone then removes from the person's devices.
   */
  move?: { from?: string };
  /** Women's keys this device has been handed (person id -> key): kept, as the family's key versions are. */
  pkeys?: Record<string, string>;
  /**
   * The log as far as this device has read it: how many entries, and the hash
   * of the last. A server that later serves fewer, or other ones (an old backup
   * restored, or a fork), is refused, so this phone never falls back to a
   * family key it has seen replaced, nor writes with one.
   */
  seen?: Seen;
}

export interface Seen {
  n: number;
  h: string;
}

/** The further of two marks: the log only grows. */
function further(a?: Seen, b?: Seen): Seen | undefined {
  return !a || (b && b.n > a.n) ? b : a;
}

/** The server's log is shorter than, or not the one, this phone has read: it is not opened, nor written to. */
const ROLLED_BACK = 'سجل العائلة على الخادم أقدم مما قرأه هذا الجهاز أو يختلف عنه، فلم يُفتح ولن يُكتب فيه. أخبر مشرف العائلة.';

/** The server takes no entry with this phone's key, even after catching up: the root admin's phone puts it right. */
const WRITE_KEY_MISMATCH = 'مفتاح الكتابة على الخادم لا يطابق مفتاح العائلة الحالي، وسيُصلحه جهاز مشرف العائلة حين يُفتح. حاول بعد قليل.';

const MEMBER = 'ft-family';
const DEVICE = 'ft-device';
const SAMPLE = 'ft-sample-log';

// The membership, this device's key and saved invites are secrets: while the
// Face ID lock is on they are sealed at rest, and vault.ts reads them from memory.
const readJSON = load;
const writeJSON = save;

/**
 * This device's signing key. Kept in browser storage (sealed behind the passkey
 * when the Face ID lock is on). Every phone has its own: a phone restored from a
 * recovery kit makes a new one, which the kit's backup key adds to the person's
 * devices (only a guest's kit carries the guest's phone key).
 */
export function device(): DeviceKey {
  let d = readJSON<DeviceKey>(DEVICE);
  if (!d) {
    d = newDeviceKey();
    writeJSON(DEVICE, d);
  }
  return d;
}

/**
 * Reads a link from a message or this page's address: "#join=<family>.<key>" plus
 * ".i<invite key>" in a personal invite, or ".<admin key>" in the root admin's link.
 */
export function parseInvite(text: string): Membership | null {
  const m = text.match(/join=([a-z0-9]{6,40})\.([A-Za-z0-9_-]{40,})(?:\.(i?)([0-9a-f]{64})(\.m)?)?/);
  if (!m) return null;
  const base = { fid: m[1], key: m[2] };
  if (!m[4]) return base;
  // ".m" after a device invite: it moves access out of a browser on an iPhone (older versions leave it out)
  return m[3] ? { ...base, invite: m[4], ...(m[5] ? { move: {} } : {}) } : { ...base, admin: m[4] };
}

/** This device's signing key if it has one (none is made here): what a recovery kit is checked against. */
export function storedDevice(): DeviceKey | null {
  return readJSON<DeviceKey>(DEVICE);
}

export function membership(hash = location.hash): Membership | null {
  const fromHash = parseInvite(hash);
  if (fromHash) {
    rememberMembership(fromHash);
    history.replaceState(null, '', location.pathname); // the key must not linger in the address bar
    return readJSON<Membership>(MEMBER);
  }
  return readJSON<Membership>(MEMBER);
}

export function rememberMembership(m: Membership | null) {
  if (!m) return forget(MEMBER);
  // opening another link to the same family must not drop the admin key or the key versions this device holds
  const old = readJSON<Membership>(MEMBER);
  if (old?.fid !== m.fid) return writeJSON(MEMBER, m);
  const ring: Ring = new Map();
  addKeys(ring, [old.key, ...Object.values(old.keys ?? {}), m.key, ...Object.values(m.keys ?? {})]);
  // nor how far it has read the log (an older kit, or another tab, may know less)
  const seen = further(old.seen, m.seen);
  // and never a woman's key it was handed
  const pkeys = { ...old.pkeys, ...m.pkeys };
  writeJSON(MEMBER, { ...m, ...(old.admin && !m.admin ? { admin: old.admin } : {}), keys: ringRecord(ring), ...(seen ? { seen } : {}), ...(Object.keys(pkeys).length ? { pkeys } : {}) });
}

/** A personal invite's link: the family's current key plus the invite's secret key; `move`: it moves access out of this browser (design document 1.38). */
export function personalLink(m: Membership, inviteSk: string, move = false): string {
  return `${location.origin}/#join=${m.fid}.${m.key}.i${inviteSk}${move ? '.m' : ''}`;
}

/** What the log takes from a phone acting as a member (design document 1.38): nothing but what a member does, and the keys it hands over. */
export const NOT_WHILE_ACTING = 'لا يُتاح هذا أثناء العمل بصفة غيرك';
const WHILE_ACTING: ReadonlySet<string> = new Set(['pkeys', 'writekey']);

/** Invites this device created, so the root admin can share one again. Never leaves this device. */
export function savedInvites(fid: string): Record<string, string> {
  return readJSON<Record<string, string>>('ft-invites:' + fid) ?? {};
}
export function saveInvite(fid: string, pub: string, sk: string) {
  writeJSON('ft-invites:' + fid, { ...savedInvites(fid), [pub]: sk });
}

/**
 * Puts back what a recovery kit carried: the membership as it was, waiting
 * invites, and a device key: the guest's own (`d`), or a new one for this phone.
 */
export function restoreKeys(m: Membership, d: DeviceKey | null, invites: Record<string, string>) {
  writeJSON(DEVICE, d ?? newDeviceKey());
  // like opening another link to the same family: a member's kit must not drop the
  // admin key this phone holds, and the key versions of both are kept
  rememberMembership(m);
  writeJSON('ft-invites:' + m.fid, { ...savedInvites(m.fid), ...invites });
}

export class RemoteLog implements Backend {
  kind = 'remote' as const;
  items: Item[] = [];
  envelopes: Envelope[] = [];
  /** Every version of the family key this device holds. */
  private ring: Ring = new Map();
  private opened: (Payload | null | undefined)[] = [];
  private last = '';
  /**
   * The write key the server takes new entries with (public): null while none is
   * registered, undefined from a server without the write check.
   */
  wk: string | null | undefined;
  /**
   * `current` says which key version new entries must use, given the log: the
   * store replays it to check who renewed the key. `probe`: only reads, to
   * check a recovery kit against the log before anything on this phone
   * changes; it opens with the given device key (or none) and stores nothing.
   */
  constructor(
    public m: Membership,
    private current: (items: Item[]) => string | null,
    private probe?: { device: DeviceKey | null },
  ) {
    addKeys(this.ring, [m.key, ...Object.values(m.keys ?? {})]);
    for (const [id, k] of Object.entries(m.pkeys ?? {})) this.pkeys.set(id, k);
  }

  /**
   * The entries this phone kept from its last read (logcache.ts), each checked
   * again: the family opens from them with no connection, and the next pull
   * fetches only what is newer. Never what disagrees with what it has read.
   */
  async restore(): Promise<boolean> {
    if (this.probe || this.envelopes.length) return false;
    const kept = await loadLog(this.m.fid);
    if (!kept?.length) return false;
    const ok: Envelope[] = [];
    let last = '';
    for (const e of kept) {
      if (e.n !== ok.length || checkEntry(e, last)) break;
      ok.push(e);
      last = entryHash(e);
    }
    const s = this.m.seen;
    if (!ok.length || (s && ok.length >= s.n && entryHash(ok[s.n - 1]) !== s.h)) return false;
    this.envelopes = ok;
    this.last = last;
    this.open();
    return true;
  }

  async pull(): Promise<boolean> {
    const after = this.envelopes.length - 1;
    const r = await fetch(`/api/f/${this.m.fid}/log?after=${after}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('server ' + r.status);
    const { entries, wk } = (await r.json()) as { entries: Envelope[]; wk?: string | null };
    this.wk = wk;
    let changed = false;
    for (const e of entries) {
      if (e.n !== this.envelopes.length) continue;
      const bad = checkEntry(e, this.last);
      if (bad) throw new Error(`entry ${e.n}: ${bad}`);
      this.envelopes.push(e);
      this.last = entryHash(e);
      changed = true;
    }
    this.keepSeen();
    if (changed) {
      this.open();
      if (!this.probe) void saveLog(this.m.fid, this.envelopes);
    }
    return changed;
  }

  /** Refuses a log shorter than, or other than, what this device has read before; then remembers how far it has read. */
  private keepSeen() {
    const s = this.m.seen;
    if (s && (this.envelopes.length < s.n || entryHash(this.envelopes[s.n - 1]) !== s.h)) throw new Error(ROLLED_BACK);
    if (this.envelopes.length > (s?.n ?? 0)) {
      this.m = { ...this.m, seen: { n: this.envelopes.length, h: this.last } };
      this.store();
    }
  }

  /** The secret keys a renewal may seal a copy for: this phone's, the admin or invite key from its link, a recovery kit's backup key. */
  private secrets(): string[] {
    const own = this.probe ? this.probe.device?.sk : device().sk;
    return [own, this.m.admin, this.m.invite, this.m.kit].filter((x): x is string => !!x);
  }

  /** Opens what this device can; entries sealed with a key it was never given stay closed. */
  private open() {
    if (openLog(this.envelopes, this.opened, this.ring, this.secrets())) this.save();
    this.learnPersonKeys();
    this.items = this.envelopes.map((e, i) => {
      const p = this.opened[i] ?? null;
      const priv = p?.type === 'private' ? this.privateOf(p) : undefined;
      return { p, at: e.at, pub: e.pub, kid: e.kid, ...(priv ? { priv } : {}) };
    });
  }

  /** Women's keys this device holds (person id -> key, base64url): handed to it in the log, or made here. */
  pkeys = new Map<string, string>();
  private bundlesRead = new WeakSet<object>();

  /** Women's keys handed to this device, or to the admin or invite key it holds: from the snapshot and every hand-over since. */
  private learnPersonKeys() {
    const mine = this.secrets().map(sk => ({ sk, pk: deviceFromSecret(sk).pk }));
    let learned = false;
    for (const p of this.opened) {
      if (!p || this.bundlesRead.has(p)) continue;
      const boxes = p.type === 'epoch' ? p.snapshot.keys : p.type === 'pkeys' ? p.to : null;
      if (!boxes) continue;
      this.bundlesRead.add(p);
      for (const { sk, pk } of mine) {
        const box = Object.hasOwn(boxes, pk) ? boxes[pk] : undefined;
        const set = box ? openBundle(sk, box.b) : null;
        if (set) for (const [id, k] of Object.entries(set)) if (typeof k === 'string' && this.pkeys.get(id) !== k) (this.pkeys.set(id, k), (learned = true));
      }
    }
    if (learned) this.savePersonKeys();
  }

  /** Private entries opened here, each once: null where none of the boxes is this device's. */
  private privs = new WeakMap<object, Wrapped[] | null>();
  private privateOf(p: Extract<Payload, { type: 'private' }>): Wrapped[] | undefined {
    if (!this.privs.has(p)) {
      let got: Wrapped[] | null = null;
      for (const sk of this.secrets()) {
        for (const box of p.boxes) {
          const list = openSealed<Wrapped[]>(sk, box);
          if (Array.isArray(list)) {
            got = list.filter(w => w && Array.isArray(w.to) && signedPrivate(w));
            break;
          }
        }
        if (got) break;
      }
      this.privs.set(p, got);
      // the women's keys it carries (a hidden wife's): kept like any handed to this device
      let learned = false;
      for (const w of got ?? []) {
        if (w.body.kind !== 'hide' || !w.body.keys) continue;
        for (const [id, k] of Object.entries(w.body.keys)) if (typeof k === 'string' && this.pkeys.get(id) !== k) (this.pkeys.set(id, k), (learned = true));
      }
      if (learned) this.savePersonKeys();
    }
    return this.privs.get(p) ?? undefined;
  }

  /** Keeps a woman's key this device made (it hands it to itself in the log too). */
  rememberPersonKey(id: string, key: string) {
    if (this.pkeys.get(id) === key) return;
    this.pkeys.set(id, key);
    this.savePersonKeys();
  }

  private savePersonKeys() {
    if (this.probe) return;
    this.m = { ...this.m, pkeys: Object.fromEntries(this.pkeys) };
    this.store();
  }

  /** The public keys a renewal may seal a copy for. */
  mine(): string[] {
    return this.secrets().map(sk => deviceFromSecret(sk).pk);
  }

  private save() {
    this.m = { ...this.m, keys: ringRecord(this.ring) };
    this.store();
  }

  /** Never brings back a family this device has since removed (a request may still be under way). */
  private store() {
    if (!this.probe && readJSON<Membership>(MEMBER)?.fid === this.m.fid) rememberMembership(this.m);
  }

  /** Joined with the invite: its secret is no longer needed (the keys it unlocked are kept). */
  joined() {
    // every other field stays (the key versions, the admin key)
    const { invite, ...rest } = this.m;
    void invite;
    this.m = rest;
    this.store();
  }

  /** Joined with a link that moves access out of a browser: the browser's device, to remove once this phone is in. */
  moveFrom(device: string) {
    this.m = { ...this.m, move: { from: device } };
    this.store();
  }

  /** That browser is no longer one of the person's devices. */
  moved() {
    const { move, ...rest } = this.m;
    if (!move) return;
    this.m = rest;
    this.store();
  }

  /** This phone is one of the person's devices now: the kit's backup key leaves it (the keys it unlocked are kept). */
  kitDone() {
    const { kit, ...rest } = this.m;
    if (!kit) return;
    this.m = rest;
    this.store();
  }

  /** That version of the family key, if this device holds it. */
  key(kid: string): Uint8Array | undefined {
    return this.ring.get(kid);
  }

  /** Keeps a key this device made (a renewal it is about to hand out). */
  remember(key: Uint8Array) {
    if (addKeys(this.ring, [b64(key)])) {
      this.save();
      this.open();
    }
  }

  /** The keys of these versions, for the entry that carries them to later readers. */
  keysOf(kids: string[]): Record<string, string> {
    return Object.fromEntries(kids.filter(k => this.ring.has(k)).map(k => [k, b64(this.ring.get(k)!)]));
  }

  /** Makes the current version the one new links carry. */
  adopt(kid: string) {
    const k = this.ring.get(kid);
    if (!k || this.m.key === b64(k)) return;
    this.m = { ...this.m, key: b64(k) };
    this.save();
  }

  adminPub(): string | null {
    return this.m.admin ? deviceFromSecret(this.m.admin).pk : null;
  }

  /**
   * The root admin acting as this member (design document 1.38): what a member
   * does goes out as an `as` entry signed with the admin key; the keys this
   * phone hands over go out as ever; anything else is refused here, whatever
   * asked for it.
   */
  acting: string | null = null;

  /** This phone's own writes, one at a time: two at once would race each other for the same place in the log. */
  private queue: Promise<unknown> = Promise.resolve();
  append(p: Payload | Build, as?: 'admin' | DeviceKey, next?: Uint8Array): Promise<boolean> {
    const run = this.queue.then(() => this.appendNow(p, as, next));
    this.queue = run.catch(() => {});
    return run;
  }

  private async appendNow(p: Payload | Build, as?: 'admin' | DeviceKey, next?: Uint8Array): Promise<boolean> {
    if (as === 'admin' && !this.m.admin) throw new Error('هذا الجهاز لا يحمل مفتاح المشرف');
    const signer = as === 'admin' ? deviceFromSecret(this.m.admin!) : as ?? device();
    for (let attempt = 0; attempt < 6; attempt++) {
      await this.pull();
      const built = typeof p === 'function' ? p(this.items) : p;
      if (!built) return false;
      const acting = this.acting;
      if (acting && ((!AS_TYPES.has(built.type) && !WHILE_ACTING.has(built.type)) || !this.m.admin)) throw new Error(NOT_WHILE_ACTING);
      const payload: Payload = acting && AS_TYPES.has(built.type) ? { type: 'as', person: acting, p: built } : built;
      const by = payload.type === 'as' ? deviceFromSecret(this.m.admin!) : signer;
      // always the family's current key, which the pull above may just have renewed
      const kid = this.current(this.items);
      const key = kid ? this.ring.get(kid) : undefined;
      if (!key) throw new Error('لا يحمل هذا الجهاز مفتاح العائلة الحالي');
      // the server would refuse it: catch up first (the root admin's registration is what puts it right)
      if (this.wk && !this.writesWith(kid) && payload.type !== 'writekey') {
        await this.writeKeyMismatch(payload);
        continue;
      }
      // the write key the server should ask for from here on: a renewal's new key's, or the current one's when the root admin registers it
      const nw = payload.type === 'rekey' && next ? writeKeyOf(next).pk : payload.type === 'writekey' ? writeKeyOf(key).pk : undefined;
      const e = makeEntry(key, by, this.envelopes.length, this.last, payload, nw);
      const r = await fetch(`/api/f/${this.m.fid}/log/${e.n}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) });
      // read to the end, so the request is done with (and its connection free)
      const reply = (await r.json().catch(() => null)) as { error?: string } | null;
      if (r.ok) {
        await this.pull();
        return true;
      }
      if (r.status === 403 && reply?.error === WRONG_WRITE_KEY) {
        await this.writeKeyMismatch(payload);
        continue;
      }
      if (r.status === 426 && reply?.error === OLD_APP) throw new Error('صدر إصدار أحدث من التطبيق: حدّثه ثم أعد المحاولة');
      if (r.status !== 409) throw new Error('server ' + r.status);
      // someone else wrote this position first: fetch it and try the next one
    }
    throw new Error('the log is busy, try again');
  }

  /**
   * The server asks for another write key than this phone's: a renewal this phone
   * has not read yet (after a pull it writes with the new key), or a key the
   * family is not on, which the root admin's phone puts back. Resolves when it is
   * worth trying again; throws when this phone can do nothing about it.
   */
  private async writeKeyMismatch(payload: Payload): Promise<void> {
    await this.pull();
    if (this.writesWith(this.current(this.items))) return;
    // the root admin's phone puts it right, or found it put right meanwhile (a renewal of its own landed first)
    // (already inside this phone's write: the fix goes out directly, not behind it)
    if (payload.type !== 'writekey' && ((await this.ensureWriteKey(true)) || this.writesWith(this.current(this.items)))) return;
    throw new Error(WRITE_KEY_MISMATCH);
  }

  /** Whether the server takes entries with the write key of this version of the family key. */
  private writesWith(kid: string | null): boolean {
    const key = kid ? this.ring.get(kid) : undefined;
    return !!key && this.wk === writeKeyOf(key).pk;
  }

  private fixing: Promise<boolean> | null = null;
  /** Mismatches this phone already put right: each is put right once, never again and again. */
  private fixed = new Set<string>();

  /**
   * Root admin's phone: has the server take new entries only with the current
   * family key's write key. The first time (a family from before the write
   * check), and whenever the server's no longer matches (someone who held the
   * key moved it). True if it wrote the entry that does it.
   */
  ensureWriteKey(inside = false): Promise<boolean> {
    // inside a write, never wait for a fix queued behind it
    if (inside) return this.fixWriteKey(true);
    this.fixing ??= this.fixWriteKey(false).finally(() => (this.fixing = null));
    return this.fixing;
  }

  private async fixWriteKey(inside: boolean): Promise<boolean> {
    // only the root admin's phone, on a server with the write check, holding the current key
    const admin = this.adminPub();
    if (!admin || admin !== this.envelopes[0]?.pub || this.wk === undefined) return false;
    const kid = this.current(this.items);
    if (!kid || !this.ring.has(kid) || this.writesWith(kid)) return false;
    // the server's write key moves only with an entry that names one: a new one is a new mismatch
    let moved = -1;
    this.envelopes.forEach((e, i) => e.nw !== undefined && (moved = i));
    const seen = `${this.wk}>${kid}@${moved}`;
    if (this.fixed.has(seen)) return false;
    this.fixed.add(seen);
    try {
      const write = inside ? this.appendNow.bind(this) : this.append.bind(this);
      return await write(items => {
        // as the log stands where it lands: a renewal may have moved it on meanwhile
        const now = this.current(items);
        return now && !this.writesWith(now) ? { type: 'writekey', kid: now } : null;
      }, 'admin');
    } catch (e) {
      // not written (offline, a busy log): tried again on a later sync
      this.fixed.delete(seen);
      throw e;
    }
  }
}

/** The sample family: this browser created it, so this browser is its root admin. */
export class SampleLog implements Backend {
  kind = 'sample' as const;
  items: Item[];
  private setup: number;
  constructor() {
    const pub = device().pk;
    const family = sampleFamily();
    const keys: Item[] = sampleKeys(family).map(act => ({ p: { type: 'admin', act, by: null }, at: 0, pub }));
    // everything in the sample family is this browser's, also from before its device key was replaced (a recovery kit)
    const saved = (readJSON<Item[]>(SAMPLE) ?? []).map(i => ({ ...i, pub }));
    this.items = [{ p: { type: 'seed', family }, at: 0, pub }, ...keys, ...saved];
    this.setup = 1 + keys.length;
  }
  async pull() {
    return false;
  }
  adminPub() {
    return device().pk;
  }
  async append(p: Payload | Build) {
    const payload = typeof p === 'function' ? p(this.items) : p;
    if (!payload) return false;
    this.items.push({ p: payload, at: Date.now(), pub: device().pk });
    writeJSON(SAMPLE, this.items.slice(this.setup));
    return true;
  }
  static reset() {
    forget(SAMPLE);
  }
}
