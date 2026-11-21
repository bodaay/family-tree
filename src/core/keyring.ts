// The family key's versions. Renewing the key adds a version, and every entry
// names the version that sealed it (its kid). A device keeps every version it
// has learned, so it can read the whole history, and learns new ones from the
// log itself: a 'rekey' entry hands the new key to each reader who keeps
// access, and a 'keys' entry, sealed with the new key, carries all earlier
// ones for whoever joins later with only the newest key in their link.
import { b64, deviceFromSecret, keyId, unb64, unwrapKey } from './crypto.ts';
import { openEntry, type Envelope, type Payload } from './log.ts';
import { wellFormed } from './wellformed.ts';

/** key id -> key */
export type Ring = Map<string, Uint8Array>;

/** Adds keys (base64url) to a ring, each under its own id. Returns whether any was new. */
export function addKeys(ring: Ring, keys: Iterable<string>): boolean {
  let added = false;
  for (const s of keys) {
    try {
      const k = unb64(s);
      if (k.length !== 32) continue;
      const kid = keyId(k);
      if (!ring.has(kid)) {
        ring.set(kid, k);
        added = true;
      }
    } catch {
      /* not a key */
    }
  }
  return added;
}

export function ringRecord(ring: Ring): Record<string, string> {
  return Object.fromEntries([...ring].map(([kid, k]) => [kid, b64(k)]));
}

/** A key from a 'keys' or 'rekey' entry counts only if it is the key its id names. */
function learn(ring: Ring, kid: string, k: Uint8Array | null): boolean {
  if (!k || k.length !== 32 || ring.has(kid) || keyId(k) !== kid) return false;
  ring.set(kid, k);
  return true;
}

/**
 * Opens every entry it can, learning keys as it goes from rekey entries sealed
 * for one of `secrets` (the Ed25519 secret keys this device holds) and from
 * 'keys' entries, and goes round again while it learns something. Which key is
 * the family's current one is not decided here: the replay checks who renewed
 * it. `opened` keeps results between calls: a payload; null for an entry that
 * will not open with the key it names (forged), or opens to something that is
 * not an entry this app can take (wellformed.ts); undefined while its key is
 * unknown. Returns whether any key was learned.
 */
export function openLog(envelopes: Envelope[], opened: (Payload | null | undefined)[], ring: Ring, secrets: string[]): boolean {
  const mine = secrets.map(sk => ({ sk, pk: deviceFromSecret(sk).pk }));
  // a 'keys' entry can be written by anyone holding the current key: learn only
  // versions some entry was sealed with, so nobody can fill every phone's storage
  const used = new Set(envelopes.map(e => e.kid));
  let learned = false;
  for (let again = true; again; ) {
    again = false;
    envelopes.forEach((e, i) => {
      if (opened[i] !== undefined) return;
      const key = ring.get(e.kid);
      if (!key) return;
      let p: Payload;
      try {
        p = openEntry(key, e);
      } catch {
        opened[i] = null;
        return;
      }
      if (!wellFormed(p)) {
        opened[i] = null;
        return;
      }
      opened[i] = p;
      let got = false;
      if (p.type === 'rekey' && p.wraps && typeof p.wraps === 'object') {
        for (const { sk, pk } of mine) {
          const box = p.wraps[pk];
          if (typeof box === 'string' && learn(ring, p.kid, unwrapKey(sk, p.epk, box))) got = true;
        }
      } else if (p.type === 'keys' && p.keys && typeof p.keys === 'object') {
        for (const [kid, s] of Object.entries(p.keys)) {
          try {
            if (used.has(kid) && learn(ring, kid, unb64(s))) got = true;
          } catch {
            /* not a key */
          }
        }
      }
      if (got) again = learned = true;
    });
  }
  return learned;
}
