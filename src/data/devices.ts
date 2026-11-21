// A person's devices (أجهزتي): every phone or browser that acts as them, and a
// recovery kit's backup key. The log says which keys belong to whom, with a
// readable name and the day each was added; this keeps that, and the rules for
// the changes a person makes to their own devices. Every phone replays them the
// same way (store.ts), so an entry that breaks them counts nowhere.
import { canReceiveKey, sign, utf8ToBytes, verify } from '../core/crypto.ts';
import type { DeviceAct } from './types';

/** The name a recovery kit's backup key goes by among a person's devices. */
export const BACKUP_LABEL = 'مفتاح الاستعادة';
export const LABEL_MAX = 40;
/** Devices and waiting invites a person may reach through their own entries (the root admin is not limited). */
export const MAX_DEVICES = 10;
/** Invites a person's own devices may leave waiting at once. */
export const MAX_WAITING = 2;

/** A personal invite, as the log tells it. */
export interface Invite {
  key: string;
  person: string;
  at: number;
  status: 'pending' | 'joined' | 'revoked';
  device?: string;
  /** Made by one of the person's own devices (this one), not by the root admin. */
  from?: string;
}

export interface DeviceInfo {
  key: string;
  person: string;
  /** When the log linked it. */
  at: number;
  /** Browser and system («Brave · Android»), or what the person renamed it to; null for devices linked before names were kept. */
  label: string | null;
  /** How: a personal invite, the root admin's own link, or added by one of the person's devices. */
  via: 'invite' | 'self' | 'add';
  /** A recovery kit's backup key, not a phone. */
  backup?: boolean;
}

/** Why a device name cannot be kept: free text never holds phone or ID numbers, emails or links. */
export function labelProblem(text: string): string | null {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return 'اكتب اسمًا للجهاز';
  if (t.length > LABEL_MAX) return 'الاسم أطول من اللازم';
  const digits = t.replace(/[٠-٩۰-۹]/g, '0').replace(/\D/g, '');
  if (digits.length >= 5 || /@|https?:|www\./i.test(t)) return 'لا تُكتب هنا أرقام الهواتف أو الهويات ولا البريد أو الروابط';
  return null;
}

/** A name as it is kept: trimmed, one space between words; null if it may not be kept. */
export function cleanLabel(text: unknown): string | null {
  if (typeof text !== 'string' || labelProblem(text)) return null;
  return text.trim().replace(/\s+/g, ' ');
}

/** This browser and its system, as a device's first name: «Brave · Android», «Safari · iPhone». */
export function deviceLabel(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as { brave?: unknown; maxTouchPoints?: number };
  const os = /iPhone|iPod/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1 && !/Chrome|Firefox/.test(ua))
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'ChromeOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Mac OS X|Macintosh/.test(ua)
              ? 'Mac'
              : /Linux/.test(ua)
                ? 'Linux'
                : '';
  // most browsers carry "Chrome" or "Safari" too: the more particular names first
  const browser = nav.brave
    ? 'Brave'
    : /EdgA?\/|EdgiOS/.test(ua)
      ? 'Edge'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /HeyTapBrowser/.test(ua)
          ? 'HeyTap'
          : /HuaweiBrowser/.test(ua)
            ? 'Huawei'
            : /OPR\/|OPT\/|OPiOS/.test(ua)
              ? 'Opera'
              : /Firefox|FxiOS/.test(ua)
                ? 'Firefox'
                : /CriOS|Chrome|Chromium/.test(ua)
                  ? 'Chrome'
                  : /Safari/.test(ua)
                    ? 'Safari'
                    : '';
  return [browser, os].filter(Boolean).join(' · ') || 'متصفح';
}

// A key is added as someone's device only with its own signature over the
// family (named by its root admin key), the person and the key itself: so
// nobody can name a key they do not hold, nor move a proof to another family.
function proofText(adminPub: string, person: string, pub: string): Uint8Array {
  return utf8ToBytes(`ft-device-add:v1:${adminPub}:${person}:${pub}`);
}

export function deviceProof(sk: string, adminPub: string, person: string, pub: string): string {
  return sign(sk, proofText(adminPub, person, pub));
}

export function proofOk(pub: string, adminPub: string, person: string, proof: unknown): boolean {
  return typeof proof === 'string' && verify(pub, proofText(adminPub, person, pub), proof);
}

/** A public key as this app writes it (64 lowercase hex digits), and a real one: a point of large order, as only a secret key makes. */
export function realKey(key: unknown): key is string {
  return typeof key === 'string' && /^[0-9a-f]{64}$/.test(key) && canReceiveKey(key);
}

/**
 * Who holds which device, and the personal invites, as the log tells them so
 * far. `taken`: keys that are someone else's already (the root admin key, guest
 * invites and guests' phones), which can never become a member's device.
 */
export class DeviceBook {
  /** device key -> the person it belongs to */
  owner = new Map<string, string>();
  info = new Map<string, DeviceInfo>();
  /** invite key -> invite */
  invites = new Map<string, Invite>();
  /** Every key ever handed to a person (device or invite), kept after it is removed: whose it was. */
  ever = new Map<string, string>();

  private taken: (key: string) => boolean;
  constructor(taken: (key: string) => boolean) {
    this.taken = taken;
  }

  /** A key that may become a device: a real public key nobody holds as a device, invite or guest. */
  fresh(key: unknown): key is string {
    return realKey(key) && !this.owner.has(key) && !this.invites.has(key) && !this.taken(key);
  }

  /**
   * Whether a claim may link this key: a real public key (a claim carries no
   * proof, and a small-order key would let anyone sign as it), not an invite's
   * or a guest's key, nor the root admin's.
   */
  claimable(key: unknown): boolean {
    return realKey(key) && !this.invites.has(key) && !this.taken(key);
  }

  invite(key: string, person: string, at: number, from?: string) {
    this.invites.set(key, { key, person, at, status: 'pending', ...(from ? { from } : {}) });
    this.ever.set(key, person);
  }

  link(key: string, person: string, at: number, via: DeviceInfo['via'], label?: unknown, backup = false) {
    // a device linked again to the same person keeps its name and day
    if (this.owner.get(key) !== person || !this.info.has(key)) {
      this.info.set(key, { key, person, at, label: backup ? BACKUP_LABEL : cleanLabel(label), via, ...(backup ? { backup } : {}) });
    }
    this.owner.set(key, person);
    this.ever.set(key, person);
  }

  /**
   * Unlinks a device, with the invite it joined with and every invite it made
   * that is still waiting (a stolen phone's «إضافة جهاز» link must not bring it
   * back, nor receive the renewal that follows); false if it was nobody's.
   */
  unlink(key: string): boolean {
    this.info.delete(key);
    if (!this.owner.delete(key)) return false;
    for (const i of this.invites.values()) {
      if (i.device === key) i.status = 'revoked';
      else if (i.from === key && i.status === 'pending') i.status = 'revoked';
    }
    return true;
  }

  /** The book as a snapshot left it (data/snapshot.ts): its devices, invites, and every key ever handed out. */
  restore(devices: DeviceInfo[], invites: Invite[], ever: [string, string][]) {
    this.owner.clear();
    this.info.clear();
    this.invites.clear();
    this.ever.clear();
    for (const d of devices) {
      this.owner.set(d.key, d.person);
      this.info.set(d.key, { ...d });
    }
    for (const i of invites) this.invites.set(i.key, { ...i });
    for (const [k, person] of ever) this.ever.set(k, person);
  }

  /** A person's devices, oldest first. */
  of(person: string): DeviceInfo[] {
    return [...this.info.values()].filter(d => this.owner.get(d.key) === person);
  }

  waiting(person: string): Invite[] {
    return [...this.invites.values()].filter(i => i.person === person && i.status === 'pending');
  }

  /**
   * A change a person makes to their own devices, signed by one of them.
   * `keyHolder`: they hold a key seat, so they must keep a phone to approve with.
   * Returns the keys it hands the family key to (a new device or invite), or
   * null when the entry does not count.
   */
  apply(act: DeviceAct, signer: string, by: string, at: number, ctx: { adminPub: string; keyHolder: boolean }): string[] | null {
    if (!act || typeof act !== 'object' || this.owner.get(signer) !== by) return null;
    const mine = this.of(by);
    const waiting = this.waiting(by);
    const room = mine.length + waiting.length < MAX_DEVICES;
    if (act.kind === 'invite') {
      if (!this.fresh(act.key) || !room || waiting.filter(i => i.from).length >= MAX_WAITING) return null;
      this.invite(act.key, by, at, signer);
      return [act.key];
    }
    if (act.kind === 'add') {
      if (!this.fresh(act.device) || !room || !proofOk(act.device, ctx.adminPub, by, act.proof)) return null;
      this.link(act.device, by, at, 'add', act.label, act.backup === true);
      return [act.device];
    }
    if (act.kind === 'label') {
      const d = this.info.get(act.device);
      const label = cleanLabel(act.label);
      if (!d || this.owner.get(act.device) !== by || !label) return null;
      d.label = label;
      return [];
    }
    if (act.kind === 'remove') {
      if (!Array.isArray(act.keys) || !act.keys.length || act.keys.length > 2 * MAX_DEVICES) return null;
      const keys = [...new Set(act.keys)];
      const own = (k: unknown) => typeof k === 'string' && (this.owner.get(k) === by || waiting.some(i => i.key === k));
      if (!keys.every(own)) return null;
      // a key holder keeps at least one phone or browser (the backup key cannot approve)
      if (ctx.keyHolder && !mine.some(d => !d.backup && !keys.includes(d.key))) return null;
      for (const k of keys) {
        const inv = this.invites.get(k);
        if (inv?.status === 'pending') inv.status = 'revoked';
        this.unlink(k);
      }
      return [];
    }
    return null;
  }
}
