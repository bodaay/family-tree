// Encryption and signing, built only on audited libraries (noble). The same code
// runs in the browser and on the server, and needs no secure context.
import { gcm } from '@noble/ciphers/aes.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes, randomBytes } from '@noble/hashes/utils.js';

export { bytesToHex, hexToBytes, randomBytes };

export function b64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64(s: string): Uint8Array {
  const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const u8 = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) u8[i] = t.charCodeAt(i);
  return u8;
}

export function hashHex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
}

/** A new random family key (AES-256). */
export function newFamilyKey(): Uint8Array {
  return randomBytes(32);
}

/** A short public label for a key, so a key's version can be named without revealing it. */
export function keyId(key: Uint8Array): string {
  return hashHex(new Uint8Array([...utf8ToBytes('ft-key-id:'), ...key])).slice(0, 16);
}

/** Encrypt a JSON value with AES-256-GCM and a fresh random nonce. */
export function seal(key: Uint8Array, value: unknown): { nonce: string; ct: string } {
  const nonce = randomBytes(12);
  const ct = gcm(key, nonce).encrypt(utf8ToBytes(JSON.stringify(value)));
  return { nonce: b64(nonce), ct: b64(ct) };
}

export function unseal<T>(key: Uint8Array, nonce: string, ct: string): T {
  const pt = gcm(key, unb64(nonce)).decrypt(unb64(ct));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

export interface DeviceKey {
  sk: string;
  pk: string;
}

/** A new Ed25519 signing key for this device. */
export function newDeviceKey(): DeviceKey {
  const sk = ed25519.utils.randomSecretKey();
  return { sk: bytesToHex(sk), pk: bytesToHex(ed25519.getPublicKey(sk)) };
}

/** The signing key for a secret carried in an admin link. */
export function deviceFromSecret(skHex: string): DeviceKey {
  return { sk: skHex, pk: bytesToHex(ed25519.getPublicKey(hexToBytes(skHex))) };
}

/**
 * The family key's write key: an Ed25519 key made from the family key itself
 * (HKDF-SHA256 with a fixed label), so everyone who holds that version of the
 * key holds it too. The server keeps only its public half and takes new
 * entries only when signed with it: that shows the writer holds the current
 * key, without the server ever seeing the key.
 */
export function writeKeyOf(familyKey: Uint8Array): DeviceKey {
  const sk = hkdf(sha256, familyKey, undefined, utf8ToBytes('ft-write-key:v1'), 32);
  return { sk: bytesToHex(sk), pk: bytesToHex(ed25519.getPublicKey(sk)) };
}

/** A public key in the form this app writes: 64 lowercase hex digits, and a real Ed25519 point. */
export function isPublicKey(pub: unknown): pub is string {
  if (typeof pub !== 'string' || !/^[0-9a-f]{64}$/.test(pub)) return false;
  try {
    ed25519.Point.fromHex(pub);
    return true;
  } catch {
    return false;
  }
}

export function sign(skHex: string, msg: Uint8Array): string {
  return bytesToHex(ed25519.sign(msg, hexToBytes(skHex)));
}

/**
 * Strict RFC 8032 checking: a small-order or non-canonical public key never
 * verifies (under the lax ZIP-215 rules anyone could sign "as" such a key,
 * without a secret). Every key this app makes passes it.
 */
export function verify(pkHex: string, msg: Uint8Array, sigHex: string): boolean {
  try {
    return ed25519.verify(hexToBytes(sigHex), msg, hexToBytes(pkHex), { zip215: false });
  } catch {
    return false;
  }
}

// ---- handing a new family key to its readers
// Every reader already has an Ed25519 key (a device, an invite, the root admin),
// and its X25519 twin is derived from it, so no extra keys need sharing. One
// ephemeral X25519 key per hand-over; each reader's copy is sealed with
// AES-256-GCM under HKDF-SHA256 of their shared secret. The ephemeral key is
// derived from the new key itself, so anyone who holds the new key can check
// any reader's copy (wrapOpens) without that reader's secret.

function wrapKeyFor(shared: Uint8Array, epk: Uint8Array, readerX: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, epk, new Uint8Array([...utf8ToBytes('ft-wrap:v1:'), ...readerX]), 32);
}

function ephemeralOf(key: Uint8Array): Uint8Array {
  return hkdf(sha256, key, undefined, utf8ToBytes('ft-wrap-ephemeral:v1'), 32);
}

const receivers = new Map<string, boolean>();
/**
 * Whether a key can be handed to this public key: a real Ed25519 public key
 * (not small order), as only a secret key can make. Nothing can be sealed for
 * anything else, and nobody could open it.
 */
export function canReceiveKey(pub: string): boolean {
  if (typeof pub !== 'string') return false;
  let ok = receivers.get(pub);
  if (ok === undefined) {
    try {
      ok = !ed25519.Point.fromHex(pub).isSmallOrder();
    } catch {
      ok = false;
    }
    receivers.set(pub, ok);
  }
  return ok;
}

/** Seals `key` for each reader, named by their Ed25519 public key (hex). Keys that cannot receive one are skipped. */
export function wrapKey(key: Uint8Array, readers: string[]): { epk: string; wraps: Record<string, string> } {
  const esk = ephemeralOf(key);
  const epk = x25519.getPublicKey(esk);
  const wraps: Record<string, string> = {};
  for (const pub of readers) {
    if (!canReceiveKey(pub)) continue;
    try {
      const rx = ed25519.utils.toMontgomery(hexToBytes(pub));
      const nonce = randomBytes(12);
      const ct = gcm(wrapKeyFor(x25519.getSharedSecret(esk, rx), epk, rx), nonce).encrypt(key);
      wraps[pub] = b64(new Uint8Array([...nonce, ...ct]));
    } catch {
      /* not a valid public key: nobody can read with it */
    }
  }
  return { epk: b64(epk), wraps };
}

/** Opens one reader's copy with that reader's Ed25519 secret key (hex); null if it is not theirs. */
export function unwrapKey(skHex: string, epk: string, box: string): Uint8Array | null {
  try {
    const xsk = ed25519.utils.toMontgomerySecret(hexToBytes(skHex));
    const e = unb64(epk);
    const b = unb64(box);
    return gcm(wrapKeyFor(x25519.getSharedSecret(xsk, e), e, x25519.getPublicKey(xsk)), b.subarray(0, 12)).decrypt(b.subarray(12));
  } catch {
    return null;
  }
}

/** Checks, with the new key itself, that one reader's copy opens to that key for them. */
export function wrapOpens(key: Uint8Array, epk: string, pub: string, box: string): boolean {
  try {
    const esk = ephemeralOf(key);
    const e = x25519.getPublicKey(esk);
    if (b64(e) !== epk) return false;
    const rx = ed25519.utils.toMontgomery(hexToBytes(pub));
    const b = unb64(box);
    const k = gcm(wrapKeyFor(x25519.getSharedSecret(esk, rx), e, rx), b.subarray(0, 12)).decrypt(b.subarray(12));
    return bytesToHex(k) === bytesToHex(key);
  } catch {
    return false;
  }
}

export { utf8ToBytes };
