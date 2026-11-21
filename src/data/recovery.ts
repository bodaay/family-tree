// The recovery kit (مفتاح الاستعادة): what this phone holds for one family (the
// whole membership with its keys, and the root admin's invites still waiting)
// and a backup key of its own, sealed with a passphrase the person chooses.
// Making a kit adds the backup key to the person's devices in the log («مفتاح
// الاستعادة» in أجهزتي). It travels as a link (/#restore=…) or its QR code, to
// keep in notes or print. Neither the kit nor the passphrase ever reaches the
// server: browsers never send the "#" part. On a new phone the passphrase opens
// it, the phone makes its own device key, and the backup key adds that key to
// the person's devices: so the place in the tree and any key seat carry over,
// and no two phones share a key. Removing the backup key from the person's
// devices ends the kit.
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { gcm } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { b64, unb64, randomBytes, utf8ToBytes, deviceFromSecret, type DeviceKey } from '../core/crypto.ts';
import type { Membership } from './backend';
import { WORDS } from './words.ts';

/**
 * Argon2id cost: about a second per guess on a mid-range phone (measured in
 * headless Chrome: 0.35 s on a recent laptop, 1.1 to 1.4 s with the CPU slowed
 * 3 to 4×). 64 MiB and 3 passes, RFC 9106's second recommendation, in one lane.
 * Kept with each kit, so it can be raised later without breaking old kits.
 */
const COST = { t: 3, m: 64 * 1024, p: 1 };
// a kit: version, flags (1: deflated), t, p, m (KiB), salt, nonce · sealed body · checksum
const VERSION = 1;
const HEAD = 36;
const SUM = 4;

export interface Kit {
  v: 2;
  /** The whole membership, whatever fields it has (family keys, admin key). */
  m: Membership;
  /** The kit's backup key (its secret): one of the person's devices in the log. A root admin who is not in the tree has none. */
  b?: string;
  /** A guest's phone key, carried as it is (a guest has one device, and no backup key). */
  d?: DeviceKey;
  /** Saved invites still waiting to be used, so they can be shared again (the root admin's kit only). */
  i: Record<string, string>;
}

/** Folds the ways one passphrase can be typed (harakat, أ/ا، ة/ه، ى/ي, Persian keyboards, digits, spaces). */
export function normPass(p: string): string {
  return p
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىیي]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ک/g, 'ك')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Four words drawn from the list: what a typed passphrase must match, at least. */
export const SUGGESTED_BITS = 44;
/** A typed passphrase for a kit that carries the admin key (the suggested words still do). */
export const ADMIN_BITS = 55;
let listed: Set<string> | null = null;

/**
 * A rough, cautious count of how hard a passphrase is to guess (in bits). A
 * word from the built-in list is one of 2048 (11 bits). Any other word is
 * counted as one of the few hundred names and everyday words someone who knows
 * the family tries first («نايف ثامر غازي», «ابوي امي»): a little for each
 * letter, never more than 8 bits.
 */
export function passBits(p: string): number {
  listed ??= new Set(WORDS.map(normPass));
  let bits = 0;
  for (const w of new Set(normPass(p).split(' ').filter(Boolean))) bits += listed.has(w) ? 11 : Math.min(8, 1.25 * [...w].length);
  return bits;
}

/** Why a passphrase is too weak, or null. `need`: the bits it must reach (more for a kit that carries the admin key). */
export function passProblem(p: string, need = SUGGESTED_BITS): string | null {
  const n = normPass(p);
  if (new Set(n.split(' ').filter(Boolean)).size < 4) return 'اكتب أربع كلمات مختلفة على الأقل.';
  if (n.replace(/ /g, '').length < 12) return 'العبارة قصيرة: 12 حرفًا على الأقل.';
  if (passBits(p) < need) return 'العبارة سهلة التخمين: الأسماء والكلمات المألوفة وحدها لا تكفي. استعمل الكلمات المقترحة، أو زد كلمات أطول وأقل شيوعًا.';
  return null;
}

/** Four different words, picked at random from the built-in list (short draws that miss the 12 letters are drawn again). */
export function suggestWords(n = 4): string {
  const limit = Math.floor(0x10000 / WORDS.length) * WORDS.length; // no bias toward the first words
  for (;;) {
    const out: string[] = [];
    while (out.length < n) {
      const r = crypto.getRandomValues(new Uint16Array(1))[0];
      const w = WORDS[r % WORDS.length];
      if (r < limit && !out.includes(w)) out.push(w);
    }
    const p = out.join(' ');
    if (!passProblem(p)) return p;
  }
}

async function squeeze(data: Uint8Array, s: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(s));
  return new Uint8Array(await out.arrayBuffer());
}
function deflater(): CompressionStream | null {
  try {
    return new CompressionStream('deflate-raw');
  } catch {
    return null; // older browsers: the kit is just longer
  }
}

// async, so the screen stays alive (and says what it is doing) during the second it takes
function stretch(pass: string, salt: Uint8Array, cost: typeof COST): Promise<Uint8Array> {
  return argon2idAsync(utf8ToBytes(normPass(pass)), salt, { ...cost, dkLen: 32, asyncTick: 30 });
}

/** Seals a kit with the passphrase; the result goes after "#restore=". */
export async function sealKit(kit: Kit, pass: string): Promise<string> {
  let body: Uint8Array = utf8ToBytes(JSON.stringify(kit));
  const z = deflater();
  if (z) body = await squeeze(body, z);
  const head = new Uint8Array(HEAD);
  const view = new DataView(head.buffer);
  head[0] = VERSION;
  head[1] = z ? 1 : 0;
  head[2] = COST.t;
  head[3] = COST.p;
  view.setUint32(4, COST.m);
  head.set(randomBytes(16), 8);
  head.set(randomBytes(12), 24);
  const key = await stretch(pass, head.subarray(8, 24), COST);
  // the header is authenticated too, so its cost and flags cannot be changed
  const ct = gcm(key, head.subarray(24, 36), head).encrypt(body);
  const all = new Uint8Array(HEAD + ct.length + SUM);
  all.set(head);
  all.set(ct, HEAD);
  all.set(checksum(all.subarray(0, all.length - SUM)), all.length - SUM);
  return b64(all);
}

/** A plain checksum at the end, so a link cut short or mistyped is told apart from a wrong passphrase. */
function checksum(data: Uint8Array): Uint8Array {
  return sha256(data).subarray(0, SUM);
}

/** Opens a kit: 'bad' if the link is damaged or incomplete, 'wrong' for a wrong passphrase. */
export async function openKit(blob: string, pass: string): Promise<Kit | 'bad' | 'wrong'> {
  let all: Uint8Array;
  try {
    all = unb64(blob);
  } catch {
    return 'bad';
  }
  if (all.length < HEAD + 16 + SUM || all[0] !== VERSION) return 'bad';
  const sum = all.subarray(all.length - SUM);
  all = all.subarray(0, all.length - SUM);
  if (checksum(all).some((b, i) => b !== sum[i])) return 'bad';
  const head = all.subarray(0, HEAD);
  const cost = { t: head[2], p: head[3], m: new DataView(head.buffer, head.byteOffset).getUint32(4) };
  // a link is only data: refuse a cost that would freeze the phone
  if (cost.t < 1 || cost.t > 10 || cost.p !== 1 || cost.m < 8 * 1024 || cost.m > 256 * 1024) return 'bad';
  const key = await stretch(pass, head.subarray(8, 24), cost);
  let body: Uint8Array;
  try {
    body = gcm(key, head.subarray(24, 36), head).decrypt(all.subarray(HEAD));
  } catch {
    return 'wrong';
  }
  try {
    if (head[1] & 1) body = await squeeze(body, new DecompressionStream('deflate-raw'));
    const kit = JSON.parse(new TextDecoder().decode(body)) as Kit;
    return wellFormed(kit) ? { ...kit, ...(kit.d ? { d: deviceFromSecret(kit.d.sk) } : {}), i: kit.i ?? {} } : 'bad';
  } catch {
    return 'bad';
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
/** What the app will use from a kit has the shape a link of its own would have (the fid ends up in the server address). */
function wellFormed(kit: Kit): boolean {
  const m = kit?.m;
  return (
    kit?.v === 2 &&
    typeof m?.fid === 'string' && /^[a-z0-9]{6,40}$/.test(m.fid) &&
    typeof m.key === 'string' && /^[A-Za-z0-9_-]{40,}$/.test(m.key) &&
    (m.admin === undefined || HEX64.test(m.admin)) &&
    (m.invite === undefined || HEX64.test(m.invite)) &&
    // every version of the family key this phone had learned (key renewals)
    (m.keys === undefined || (!!m.keys && typeof m.keys === 'object' && Object.values(m.keys).every(k => typeof k === 'string' && /^[A-Za-z0-9_-]{40,}$/.test(k)))) &&
    m.kit === undefined &&
    // how far the phone had read the log
    (m.seen === undefined || (!!m.seen && Number.isInteger(m.seen.n) && m.seen.n > 0 && typeof m.seen.h === 'string' && HEX64.test(m.seen.h))) &&
    (kit.b === undefined || (typeof kit.b === 'string' && HEX64.test(kit.b))) &&
    (kit.d === undefined || (typeof kit.d?.sk === 'string' && HEX64.test(kit.d.sk))) &&
    (kit.i === undefined || (!!kit.i && typeof kit.i === 'object' && Object.entries(kit.i).every(([k, v]) => HEX64.test(k) && typeof v === 'string' && HEX64.test(v))))
  );
}

/** The kit inside a pasted text or this page's address ("#restore=…"). */
export function restoreBlob(text: string): string | null {
  return text.match(/restore=([A-Za-z0-9_-]{40,})/)?.[1] ?? null;
}

export function restoreLink(blob: string): string {
  return `${location.origin}/#restore=${blob}`;
}
