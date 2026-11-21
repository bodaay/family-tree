// The family log: an append-only chain of signed, encrypted entries.
// The server stores the envelopes and checks the chain and signatures,
// but cannot read any content: only members' devices hold the family key.
import { hashHex, isPublicKey, keyId, seal, sign, unseal, utf8ToBytes, verify, writeKeyOf, type DeviceKey } from './crypto.ts';
import type { RawFamily } from './raw.ts';
import type { AccessAct, AdminAct, DeviceAct, ExportWhat, Own, SettingAct, Tx } from '../data/types.ts';
import type { Bundle } from './personkeys.ts';
import type { Snapshot } from '../data/snapshot.ts';

export interface Envelope {
  v: 1;
  /** Position in the log; also the file name on the server. */
  n: number;
  /** Hash of the previous entry ('' for the first). */
  prev: string;
  at: number;
  /** The signing device's public key. */
  pub: string;
  /** Which version of the family key encrypted this entry. */
  kid: string;
  nonce: string;
  ct: string;
  sig: string;
  /**
   * Signed with the write key of the family key that sealed it (writeKeyOf),
   * over the entry's hash and `nw`: shows the server that the writer holds the
   * key, so it can refuse writers who do not hold the current one. Entries
   * written before the write check have none, and stay valid.
   */
  w?: string;
  /** The write key the server asks for from the next entry on: a renewal's new key, or the root admin registering one. */
  nw?: string;
  /** The signer's own signature over `nw` and the entry's hash, so nobody can swap it. */
  ns?: string;
  /** The version of the app that wrote it (APP_FORMAT); entries from before have none, and count as 1. Only the server reads it, so it is not signed. */
  app?: number;
}

/**
 * The app's format, raised when a version from before would write what newer
 * ones refuse, or what must not be written at all: 2 is per-person keys for
 * women's details (an older version would write a woman's name in the open);
 * 3 is a marriage's years under the wife's key (it would write them in the
 * open), with a woman widening who sees her details, and hidden marriages; 4
 * is the record of an exported chart (an older version would not show it); 5
 * is milk kinship (an older version would leave the records out of a snapshot
 * it writes, and out of a removal or a merge).
 * The server takes no entry from an older format after one from a newer
 * (server/handler.ts), so a page opened before an update cannot write once an
 * updated one has: it is told to update.
 */
export const APP_FORMAT = 5;
/** The server's refusal of an entry written by an older version of the app than the entry before it. */
export const OLD_APP = 'old app';

export type Payload =
  | { type: 'seed'; family: RawFamily }
  | { type: 'propose'; tx: Tx }
  | { type: 'approve'; txId: string; by: string; override?: boolean }
  | { type: 'reject'; txId: string; by: string }
  /** Signed with the root admin's key; `by` is the person the admin chose as themselves. */
  | { type: 'admin'; act: AdminAct; by: string | null }
  /** Signed with a personal invite's key: links this device to the invited person, once. `label` names it (browser and system). */
  | { type: 'claim'; device: string; label?: string }
  /** A person's own devices: signed by one of that person's devices (`by`). */
  | { type: 'device'; act: DeviceAct; by: string }
  /** View-all grants and guest invites: signed by the root admin, or by the platinum holder's phone. */
  | { type: 'access'; act: AccessAct; by: string | null }
  /** Family-wide settings: signed by the root admin, or by the platinum holder's phone. */
  | { type: 'setting'; act: SettingAct; by: string | null }
  /** How far one woman's details are seen, wider than the family's rule (data/types.ts, Own): signed by whoever may set it for her. */
  | { type: 'widen'; person: string; own: Own; by: string }
  /**
   * Something private between a few people (a hidden marriage, data/hidden.ts):
   * one box sealed for each of them, saying nothing of whom it is for, in an
   * entry signed with a key of its own; who wrote it is signed inside.
   */
  | { type: 'private'; boxes: Bundle[] }
  /** A chart exported, recorded before the file is made: its code (printed on it), who, and what it shows (src/export). */
  | { type: 'export'; code: string; by: string | null; what: ExportWhat }
  /**
   * A new family key, sealed for each reader who keeps access (`wraps`: their
   * public key -> their copy). The entry itself is sealed with the key it
   * replaces. Counts only from the root admin or the platinum holder's phone.
   */
  | {
      type: 'rekey';
      kid: string;
      epk: string;
      wraps: Record<string, string>;
      by: string | null;
      /**
       * The move to per-person keys (root admin only): this version starts the
       * log afresh, and the earlier ones are never carried forward to it, so
       * whoever joins later reads only from the snapshot that follows.
       */
      cut?: boolean;
    }
  /** Every earlier family key (by key id), sealed with the newest, for whoever joins later. */
  | { type: 'keys'; keys: Record<string, string> }
  /**
   * Root admin: hands the server the write key of the family key in force (`kid`),
   * in the envelope's `nw`: the first time, or to put it back if it no longer matches.
   */
  | { type: 'writekey'; kid: string }
  /**
   * Root admin, right after a cut: the family as it stands (women's details each
   * sealed with her own key), the key seats, settings, members, devices and
   * invites, and each reader's women's keys. Every phone works on from it.
   */
  | { type: 'epoch'; snapshot: Snapshot }
  /**
   * Women's keys handed to readers (public key -> the person ids, and the keys
   * sealed for that reader alone): by whoever adds a woman, and by the root
   * admin's phone for whatever is missing.
   */
  | { type: 'pkeys'; to: Record<string, { ids: string[]; b: Bundle }> };

function signedBytes(e: Omit<Envelope, 'sig'>): Uint8Array {
  return utf8ToBytes(JSON.stringify([e.v, e.n, e.prev, e.at, e.pub, e.kid, e.nonce, e.ct]));
}

// The hash chain and `sig` cover the same fields as before the write check, so
// every entry, old or new, verifies the same way (older app versions too). The
// fields added since (w, nw, ns) are bound to the entry by signatures over its hash.
export function entryHash(e: Envelope): string {
  return hashHex(JSON.stringify([e.v, e.n, e.prev, e.at, e.pub, e.kid, e.nonce, e.ct, e.sig]));
}

function writeBytes(e: Envelope): Uint8Array {
  return utf8ToBytes(JSON.stringify(['ft-write:v1', entryHash(e), e.nw ?? null]));
}

function nextBytes(e: Envelope): Uint8Array {
  return utf8ToBytes(JSON.stringify(['ft-next-write:v1', entryHash(e), e.nw]));
}

/**
 * Seals and signs an entry, and signs it with the write key of `key`. `nw`: the
 * write key (public) the server should ask for from the next entry on.
 */
export function makeEntry(key: Uint8Array, dev: DeviceKey, n: number, prev: string, payload: Payload, nw?: string): Envelope {
  const { nonce, ct } = seal(key, payload);
  const body = { v: 1 as const, n, prev, at: Date.now(), pub: dev.pk, kid: keyId(key), nonce, ct };
  const e: Envelope = { ...body, sig: sign(dev.sk, signedBytes(body)), app: APP_FORMAT };
  if (nw) {
    e.nw = nw;
    e.ns = sign(dev.sk, nextBytes(e));
  }
  e.w = sign(writeKeyOf(key).sk, writeBytes(e));
  return e;
}

/** The server's refusal of an entry not signed with the write key in force (its reply names that key). */
export const WRONG_WRITE_KEY = 'wrong write key';

/** Whether the entry carries a write signature made with this write key (public, hex). */
export function writeSigned(e: Envelope, wk: string): boolean {
  return typeof e.w === 'string' && verify(wk, writeBytes(e), e.w);
}

/**
 * The new write key an entry asks for: undefined if none, null if it is not
 * one, or not signed by the entry's own signer. Check the entry first.
 */
export function nextWriteKey(e: Envelope): string | null | undefined {
  if (e.nw === undefined) return undefined;
  return isPublicKey(e.nw) && typeof e.ns === 'string' && verify(e.pub, nextBytes(e), e.ns) ? e.nw : null;
}

/** Checks the signature and the link to the previous entry. Needs no key. */
export function checkEntry(e: Envelope, prevHash: string): string | null {
  if (e.v !== 1 || !Number.isInteger(e.n) || e.n < 0) return 'bad envelope';
  if (e.prev !== prevHash) return 'broken chain';
  if (!verify(e.pub, signedBytes(e), e.sig)) return 'bad signature';
  return null;
}

export function openEntry(key: Uint8Array, e: Envelope): Payload {
  return unseal<Payload>(key, e.nonce, e.ct);
}
