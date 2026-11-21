// Which version of the family key the log is on, as every device works it out
// while replaying it. Entries count only if sealed with the current version, so
// whoever was left out of a renewal can neither read nor add anything after it.
// Who may renew (the root admin, or the platinum holder's phone) is checked by
// the replay; this keeps the versions and who has been given the current one.
import { canReceiveKey, keyId, unb64, wrapOpens } from '../core/crypto.ts';
import type { Payload } from '../core/log.ts';

type Rekey = Extract<Payload, { type: 'rekey' }>;
type Keys = Extract<Payload, { type: 'keys' }>;

const adminCopies = new WeakMap<object, boolean>();
/**
 * Whether a renewal's copy for the root admin opens to the new key: anyone who
 * holds the new key can check it, so every phone agrees, and a renewal that
 * would shut the root admin out counts nowhere. Checked once per entry (replays
 * run often, and it costs two curve multiplications).
 */
export function adminCopyOpens(key: Uint8Array, p: Rekey, adminPub: string): boolean {
  let ok = adminCopies.get(p);
  if (ok === undefined) {
    ok = !!p.wraps && typeof p.wraps === 'object' && Object.hasOwn(p.wraps, adminPub) && wrapOpens(key, p.epk, adminPub, p.wraps[adminPub]);
    adminCopies.set(p, ok);
  }
  return ok;
}

export class KeyChain {
  /** Key ids in force so far, oldest first; the last is the one entries must use. */
  kids: string[] = [];
  /** Versions before these (the move to per-person keys starts the list afresh; its number goes on). */
  earlier = 0;

  /** The current version's number, counting every version since the family began. */
  get version(): number {
    return this.earlier + this.kids.length;
  }
  /** When the current version was made. */
  at: number | null = null;
  /**
   * Public keys that have been given the current version: everyone it was
   * sealed for, then each invite made since (its link carries the key) and each
   * phone linked since. A claimed invite hands over to the phone that claimed it.
   */
  holders = new Set<string>();
  /** The entry carrying every earlier version, sealed with the current one, is in the log. */
  backfilled = true;

  get kid(): string | null {
    return this.kids[this.kids.length - 1] ?? null;
  }

  /** The family's first key: the one that sealed the seed, held by the root admin. */
  start(kid: string, adminPub: string, at: number) {
    this.kids = [kid];
    this.at = at;
    this.holders = new Set([adminPub]);
  }

  /** Whether an entry sealed with this version counts (entries without one are the sample family's). */
  counts(kid?: string): boolean {
    return !kid || !this.kids.length || kid === this.kid;
  }

  gave(pub: string) {
    this.holders.add(pub);
  }

  handOver(invite: string, device: string) {
    this.holders.delete(invite);
    this.holders.add(device);
  }

  /**
   * A renewal from someone allowed to make one. It counts only if it is a new
   * version and sealed for every reader who keeps access, so no one can be left
   * out by mistake. (A "device" in a claim is whatever its signer wrote: one
   * that is not a real public key can receive nothing, and must not block every
   * renewal after it.)
   */
  renew(p: Rekey, readers: Set<string>, at: number): boolean {
    if (typeof p.kid !== 'string' || !/^[0-9a-f]{16}$/.test(p.kid) || this.kids.includes(p.kid)) return false;
    if (typeof p.epk !== 'string' || !p.wraps || typeof p.wraps !== 'object') return false;
    for (const r of readers) if (!(Object.hasOwn(p.wraps, r) && typeof p.wraps[r] === 'string') && canReceiveKey(r)) return false;
    this.kids.push(p.kid);
    this.at = at;
    this.holders = new Set(Object.keys(p.wraps));
    this.backfilled = false;
    return true;
  }

  /**
   * The move to per-person keys: the version a cut renewal made starts the log
   * afresh. The earlier ones are never carried forward to it (nothing is owed),
   * and only entries sealed with it, or later ones, count from here on.
   */
  restart(kid: string, holders: Iterable<string>, at: number, version = this.version) {
    this.earlier = Math.max(0, version - 1);
    this.kids = [kid];
    this.at = at;
    this.holders = new Set(holders);
    this.backfilled = true;
  }

  /** Every earlier version, carried under the current one for whoever joins later. */
  backfill(p: Keys) {
    if (this.backfilled || !p.keys || typeof p.keys !== 'object') return;
    this.backfilled = this.kids.slice(0, -1).every(kid => {
      try {
        return typeof p.keys[kid] === 'string' && keyId(unb64(p.keys[kid])) === kid;
      } catch {
        return false;
      }
    });
  }

  /** Holders of the current version who no longer have access: the key should be renewed. */
  stale(readers: Set<string>): string[] {
    return [...this.holders].filter(h => !readers.has(h));
  }
}
