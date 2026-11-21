// Each woman's details sealed with a key of her own (her person key): her name,
// other names, «للتمييز», and birth and death years, and the years of her
// marriages (since version 1.29). The family's structure (who
// is whose child or spouse, sex, whether someone has died) stays under the
// family key, so every phone can still work the tree out; only a phone holding
// her key can read her details. Her key reaches its readers in bundles: one per
// reader (a device, an invite or the root admin, by public key), each a set of
// person keys sealed for that reader alone, the same way a renewed family key is.
import { b64, keyId, newFamilyKey, seal, unb64, unseal, unwrapKey, wrapKey } from './crypto.ts';
import type { Alias, Year } from '../data/types.ts';

/** What a woman's own key protects. */
export interface Details {
  name: string;
  aliases?: Alias[];
  suffix?: string;
  birth?: Year;
  death?: Year;
}

/** The years of a marriage: the wife's, sealed with her key (its status stays structure, which every phone checks). */
export interface MarriageDetails {
  year?: Year;
  end?: Year;
}

/** The fields of a marriage that are the wife's details. */
export const YEAR_FIELDS = ['year', 'end'] as const;

/** The fields of a person that are her details (a woman's): the rest is structure. */
export const DETAIL_FIELDS = ['name', 'aliases', 'suffix', 'birth', 'death'] as const;

/** Her details sealed with her key: `k` names the key (its id), so a reader knows which one opens it. */
export interface Sealed {
  k: string;
  n: string;
  c: string;
}

/** A new person key. */
export const newPersonKey = newFamilyKey;

export function sealDetails(key: Uint8Array, d: Details): Sealed {
  const { nonce, ct } = seal(key, d);
  return { k: keyId(key), n: nonce, c: ct };
}

/** Her details, if this is her key and the seal is whole; null otherwise. */
export function openDetails(key: Uint8Array, s: Sealed): Details | null {
  if (!s || keyId(key) !== s.k) return null;
  try {
    const d = unseal<Details>(key, s.n, s.c);
    return d && typeof d.name === 'string' ? d : null;
  } catch {
    return null;
  }
}

/** A marriage's years sealed with the wife's key. */
export function sealYears(key: Uint8Array, d: MarriageDetails): Sealed {
  const { nonce, ct } = seal(key, d);
  return { k: keyId(key), n: nonce, c: ct };
}

const isYear = (x: unknown) => {
  const y = x as Record<string, unknown>;
  return !!y && typeof y === 'object' && typeof y.v === 'number' && Number.isFinite(y.v) && (y.cal === 'g' || y.cal === 'h') && (y.approx === undefined || typeof y.approx === 'boolean');
};

/** A marriage's years, if this is the wife's key and the seal is whole; null otherwise. */
export function openYears(key: Uint8Array, s: Sealed): MarriageDetails | null {
  if (!s || keyId(key) !== s.k) return null;
  try {
    const d = unseal<MarriageDetails>(key, s.n, s.c);
    if (!d || typeof d !== 'object' || (d.year !== undefined && !isYear(d.year)) || (d.end !== undefined && !isYear(d.end))) return null;
    return { ...(d.year ? { year: d.year } : {}), ...(d.end ? { end: d.end } : {}) };
  } catch {
    return null;
  }
}

export function sealedShape(x: unknown): x is Sealed {
  const o = x as Record<string, unknown>;
  return !!o && typeof o === 'object' && typeof o.k === 'string' && /^[0-9a-f]{16}$/.test(o.k) && typeof o.n === 'string' && typeof o.c === 'string';
}

/** Person keys for one reader: sealed for them alone (`e`, `w`: the wrapped bundle key; `n`, `c`: the keys). */
export interface Bundle {
  e: string;
  w: string;
  n: string;
  c: string;
}

/** person id -> person key (base64url) */
export type PersonKeys = Record<string, string>;

/** Anything sealed for one reader alone (a public key): a key of its own, wrapped for that reader. Null if it cannot receive one. */
export function sealFor(reader: string, content: unknown): Bundle | null {
  const bk = newFamilyKey();
  const { epk, wraps } = wrapKey(bk, [reader]);
  if (!wraps[reader]) return null;
  const { nonce, ct } = seal(bk, content);
  return { e: epk, w: wraps[reader], n: nonce, c: ct };
}

/** What a bundle holds, if it was sealed for this secret key (hex); null otherwise. Nothing in it says for whom. */
export function openSealed<T>(skHex: string, b: Bundle): T | null {
  try {
    const bk = unwrapKey(skHex, b.e, b.w);
    return bk ? unseal<T>(bk, b.n, b.c) : null;
  } catch {
    return null;
  }
}

/** Seals these person keys for each reader (public keys); readers that cannot receive a key are skipped. */
export function bundles(keys: Record<string, PersonKeys>): Record<string, Bundle> {
  const out: Record<string, Bundle> = {};
  for (const [reader, set] of Object.entries(keys)) {
    if (!Object.keys(set).length) continue;
    const b = sealFor(reader, set);
    if (b) out[reader] = b;
  }
  return out;
}

/** The person keys in a bundle sealed for this secret key (hex); each checked against the id its person's seal names, by the caller. */
export function openBundle(skHex: string, b: Bundle): PersonKeys | null {
  const set = openSealed<PersonKeys>(skHex, b);
  return set && typeof set === 'object' ? set : null;
}

export function bundleShape(x: unknown): x is Bundle {
  const o = x as Record<string, unknown>;
  return !!o && typeof o === 'object' && ['e', 'w', 'n', 'c'].every(k => typeof o[k] === 'string');
}

/** A person key from a bundle, if it is the one her seal names. */
export function keyFor(s: Sealed, b64key: unknown): Uint8Array | null {
  if (typeof b64key !== 'string') return null;
  try {
    const k = unb64(b64key);
    return k.length === 32 && keyId(k) === s.k ? k : null;
  } catch {
    return null;
  }
}

export { b64 };
