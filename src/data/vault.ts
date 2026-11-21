// This device's keys at rest. Without the lock they sit in browser storage as
// plain JSON, as they always have. With the Face ID lock on (أنا → الأمان), every
// secret value is sealed (AES-256-GCM) with a key that only this phone's passkey
// can produce (the WebAuthn PRF extension): nothing secret is readable until
// Face ID or a fingerprint unlocks it when the app opens. The unlocked values
// live in this page's memory only, so the rest of the app reads them as before.
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { b64, unb64, seal, unseal, randomBytes, utf8ToBytes } from '../core/crypto.ts';

const LOCK = 'ft-lock';
/** This browser's own passkey user id (not secret): kept when the lock is turned off, to be reused. */
const LOCK_USER = 'ft-lock-user';
/** A sealed value starts with this; anything else is plain JSON. */
const SEALED = 'ftlock1:';
/** Back in the app after this long away, it asks for Face ID again. */
const IDLE_MS = 5 * 60 * 1000;

interface LockRecord {
  v: 1;
  /** The passkey's credential id. */
  cred: string;
  /** The PRF input: the passkey turns it into this device's lock secret. */
  salt: string;
  /** A sealed constant, to tell a wrong passkey from damaged data. */
  check: { nonce: string; ct: string };
}

/** What holds secrets: the membership (family and admin keys), this device's signing key, saved invites. */
export function isSecret(k: string): boolean {
  return k === 'ft-family' || k === 'ft-device' || k.startsWith('ft-invites:');
}

let aes: Uint8Array | null = null;
/** Unlocked secret values (their JSON), while the lock is on. */
const cache = new Map<string, string>();

function record(): LockRecord | null {
  try {
    const v = localStorage.getItem(LOCK);
    return v ? (JSON.parse(v) as LockRecord) : null;
  } catch {
    return null;
  }
}

function secretKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isSecret(k)) out.push(k);
    }
  } catch {
    /* no storage */
  }
  return out;
}

export function lockOn(): boolean {
  return !!record();
}

/** The lock is on and Face ID has not opened it yet: nothing secret can be read. */
export function isLocked(): boolean {
  return lockOn() && !aes;
}

// ---- reading and writing: every stored value goes through here

export function load<T>(k: string): T | null {
  try {
    const raw = isSecret(k) && lockOn() ? cache.get(k) : stored(k);
    return raw && !raw.startsWith(SEALED) ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function save(k: string, v: unknown) {
  const json = JSON.stringify(v);
  if (isSecret(k)) {
    if (lockOn()) {
      if (!aes) throw new Error('locked');
      cache.set(k, json);
      put(k, sealJSON(aes, json));
      return;
    }
    // never write over a sealed value that cannot be read (e.g. a new device key over the real one)
    if (stored(k)?.startsWith(SEALED)) throw new Error('locked');
  }
  put(k, json);
}

export function forget(k: string) {
  cache.delete(k);
  try {
    localStorage.removeItem(k);
  } catch {
    /* nothing stored */
  }
}

function stored(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null; // storage blocked
  }
}

function put(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode: works for this session only */
  }
}

// the whole value is sealed, so fields added later (a new key version) pass through untouched
function sealJSON(key: Uint8Array, json: string): string {
  const { nonce, ct } = seal(key, json);
  return SEALED + nonce + '.' + ct;
}
function unsealJSON(key: Uint8Array, v: string): string {
  const [nonce, ct] = v.slice(SEALED.length).split('.');
  return unseal<string>(key, nonce, ct);
}

// ---- the passkey

export type LockResult = 'ok' | 'cancelled' | 'unsupported' | 'noprf' | 'wrong';

/** Whether this browser could hold the lock at all; 'noprf' when it says plainly that its passkeys cannot. */
export async function lockSupport(): Promise<'ok' | 'unsupported' | 'noprf'> {
  if (!window.isSecureContext || !window.PublicKeyCredential) return 'unsupported';
  try {
    if (!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) return 'unsupported';
    const caps = await PublicKeyCredential.getClientCapabilities?.();
    if (caps && caps['extension:prf'] === false) return 'noprf';
  } catch {
    /* older browsers: try, and see */
  }
  return 'ok';
}

const toBuf = (u8: Uint8Array) => u8.slice().buffer as ArrayBuffer;

function deriveKey(prf: ArrayBuffer): Uint8Array {
  return hkdf(sha256, new Uint8Array(prf), undefined, utf8ToBytes('ft-lock v1'), 32);
}

function failure(e: unknown): LockResult {
  // the person cancelled, or the prompt timed out
  return e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError') ? 'cancelled' : 'unsupported';
}

/** Face ID or a fingerprint, then the PRF secret for this salt. */
async function prfGet(cred: string, salt: string): Promise<ArrayBuffer | LockResult> {
  try {
    const a = (await navigator.credentials.get({
      publicKey: {
        rpId: location.hostname,
        challenge: toBuf(randomBytes(32)),
        allowCredentials: [{ type: 'public-key', id: toBuf(unb64(cred)) }],
        userVerification: 'required',
        timeout: 120_000,
        extensions: { prf: { eval: { first: toBuf(unb64(salt)) } } },
      },
    })) as PublicKeyCredential | null;
    if (!a) return 'cancelled';
    const first = a.getClientExtensionResults().prf?.results?.first;
    return first ? (first as ArrayBuffer) : 'noprf';
  } catch (e) {
    return failure(e);
  }
}

/** The lock key from Face ID, checked against the record. */
async function keyFromPasskey(rec: LockRecord): Promise<Uint8Array | LockResult> {
  const out = await prfGet(rec.cred, rec.salt);
  if (typeof out === 'string') return out;
  const key = deriveKey(out);
  try {
    unseal(key, rec.check.nonce, rec.check.ct);
    return key;
  } catch {
    return 'wrong';
  }
}

/** A passkey made by the last tap that gives its secret only when used: the next tap finishes with it. */
let made: { cred: string; salt: Uint8Array } | null = null;

/**
 * Turns the lock on: a new passkey on this phone (Face ID or fingerprint), and
 * every secret value sealed with the key it yields. If the passkey cannot
 * produce a key (no PRF), nothing changes and the result says so. 'again':
 * the passkey was made, and one more tap (and Face ID) completes it; phones
 * allow a passkey prompt only straight after a tap, so this never awaits
 * anything else first.
 */
export async function enableLock(name: string): Promise<LockResult | 'again'> {
  if (lockOn()) return 'ok';
  if (!window.isSecureContext || !window.PublicKeyCredential) return 'unsupported';
  const salt = made?.salt ?? randomBytes(32);
  const r = made ? { cred: made.cred, out: await prfGet(made.cred, b64(made.salt)) } : await createPasskey(name, salt);
  if (typeof r === 'string') return r;
  const { cred, out } = r;
  if (typeof out === 'string') {
    if (out === 'cancelled' && made) return 'again';
    made = null;
    if (out === 'noprf') forgetPasskey(cred); // made, but of no use: off the phone's passkey list
    return out;
  }
  made = null;
  const key = deriveKey(out);
  const plain = secretKeys().map(k => [k, stored(k) ?? ''] as const);
  // the record first: if the page dies halfway, unlocking seals whatever is still plain
  const rec: LockRecord = { v: 1, cred, salt: b64(salt), check: seal(key, 'ft-lock') };
  put(LOCK, JSON.stringify(rec));
  if (!lockOn()) return 'unsupported'; // storage refused it
  aes = key;
  for (const [k, json] of plain) {
    if (json.startsWith(SEALED)) continue;
    cache.set(k, json);
    put(k, sealJSON(key, json));
  }
  return 'ok';
}

/** A new platform passkey with PRF, and its secret for this salt (or why there is none). */
async function createPasskey(name: string, salt: Uint8Array): Promise<{ cred: string; out: ArrayBuffer | LockResult } | LockResult> {
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        rp: { id: location.hostname, name: 'شجرة العائلة' },
        // the same id each time in this browser, so turning the lock on again replaces its own passkey
        user: { id: toBuf(lockUserId()), name, displayName: name },
        challenge: toBuf(randomBytes(32)),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -8 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 120_000,
        extensions: { prf: { eval: { first: toBuf(salt) } } },
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    return failure(e);
  }
  if (!cred) return 'cancelled';
  const id = b64(new Uint8Array(cred.rawId));
  const prf = cred.getClientExtensionResults().prf;
  const first = prf?.results?.first as ArrayBuffer | undefined;
  if (first) return { cred: id, out: first };
  if (!prf?.enabled) return { cred: id, out: 'noprf' };
  // this passkey gives its secret only when used: ask for it now, or on the next tap
  made = { cred: id, salt };
  return { cred: id, out: await prfGet(id, b64(salt)) };
}

/**
 * Random for each browser, not taken from the device key: a phone restored from
 * a recovery kit (or the home-screen app beside Safari) shares that key, and a
 * passkey with the same user id would replace the other one's in a synced
 * passkey list, leaving its lock unopenable.
 */
function lockUserId(): Uint8Array {
  let id = stored(LOCK_USER);
  if (!id) {
    id = b64(randomBytes(16));
    put(LOCK_USER, id);
  }
  return unb64(id);
}

/** Opens the lock with Face ID: every secret value is read into memory. */
export async function unlock(): Promise<LockResult> {
  const rec = record();
  if (!rec) return 'ok';
  const key = await keyFromPasskey(rec);
  if (typeof key === 'string') return key;
  aes = key;
  for (const k of secretKeys()) {
    const v = stored(k) ?? '';
    try {
      if (v.startsWith(SEALED)) cache.set(k, unsealJSON(key, v));
      else {
        // written in plain by another tab that did not know about the lock: seal it now
        cache.set(k, v);
        put(k, sealJSON(key, v));
      }
    } catch {
      /* damaged: leave it */
    }
  }
  return 'ok';
}

/** A fresh Face ID check while unlocked, before something sensitive (switching the lock off, a recovery kit). */
export async function confirmPresence(): Promise<LockResult> {
  const rec = record();
  if (!rec) return 'ok';
  const key = await keyFromPasskey(rec);
  return typeof key === 'string' ? key : 'ok';
}

/** Turns the lock off (after a fresh Face ID check): the secret values go back to plain storage. */
export async function disableLock(): Promise<LockResult> {
  const rec = record();
  if (!rec) return 'ok';
  if (!aes) return 'wrong';
  const ok = await confirmPresence();
  if (ok !== 'ok') return ok;
  for (const [k, json] of cache) put(k, json);
  forget(LOCK);
  cache.clear();
  aes = null;
  forgetPasskey(rec.cred);
  return 'ok';
}

/** Tells the phone's passkey list this passkey is no longer used (where the browser supports it). */
function forgetPasskey(cred: string) {
  const signal = (PublicKeyCredential as unknown as { signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void> }).signalUnknownCredential;
  signal?.call(PublicKeyCredential, { rpId: location.hostname, credentialId: cred }).catch(() => {});
}

/** Removes the lock and every secret from this phone: the way out when the passkey is gone. */
export function wipeSecrets() {
  for (const k of secretKeys()) forget(k);
  forget(LOCK);
  cache.clear();
  aes = null;
}

// the keys live only in this page's memory: after a while in the background, start again locked
let hiddenAt = 0;
const relockIfIdle = () => {
  if (aes && hiddenAt && Date.now() - hiddenAt > IDLE_MS) location.reload();
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else relockIfIdle();
});
// back to a page the browser kept whole (the back button): the same rule
window.addEventListener('pagehide', () => (hiddenAt = Date.now()));
window.addEventListener('pageshow', e => e.persisted && relockIfIdle());
// another tab turned the lock on or off: start again, so this one reads storage the same way.
// Another unlocked tab saved a secret (a new invite, a joined membership): keep this tab's copy current.
window.addEventListener('storage', e => {
  if (e.key === LOCK || e.key === null) location.reload();
  else if (aes && isSecret(e.key)) {
    try {
      if (e.newValue === null) cache.delete(e.key);
      else if (e.newValue.startsWith(SEALED)) cache.set(e.key, unsealJSON(aes, e.newValue));
    } catch {
      /* not sealed with this lock: unlocking again sorts it out */
    }
  }
});
