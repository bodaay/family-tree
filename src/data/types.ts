// Core data model. Derived values (generation, nasab chain, kinship degree) are
// never stored: they are calculated from the links every time.
import type { Sealed } from '../core/personkeys.ts';

export type Sex = 'm' | 'f';
export type Cal = 'g' | 'h';

/** A year kept exactly as entered: one Hijri year spans two Gregorian years. */
export interface Year {
  v: number;
  cal: Cal;
  approx?: boolean;
}

export interface Alias {
  type: 'kunya' | 'laqab' | 'known' | 'previous' | 'spelling';
  text: string;
}

export interface Person {
  id: string;
  name: string;
  sex: Sex;
  birth?: Year;
  death?: Year;
  deceased?: boolean;
  /** Father in the tree. */
  father?: string;
  /** Mother: a wife record, or a daughter of the family. */
  mother?: string;
  /** Spouse from outside the family, recorded by name only. */
  external?: boolean;
  /** The family anchor (the name the family carries). */
  familyRoot?: boolean;
  /** Link not confirmed (e.g. missing in the source chart). */
  uncertain?: boolean;
  aliases?: Alias[];
  /** Tells apart brothers or sisters of the same name: «الأول», «الثاني», «الكبير». Shown after the name. */
  suffix?: string;
  /**
   * A woman's details (name, other names, suffix, years) sealed with her own
   * key, once the family has moved to per-person keys (core/personkeys.ts): the
   * record then carries an empty name and only her structure in the clear.
   */
  sealed?: Sealed;
}

export interface Marriage {
  id: string;
  husband: string;
  wife: string;
  status: 'married' | 'divorced' | 'widowed';
  year?: Year;
  end?: Year;
  hidden?: boolean;
  /** Its years sealed with the wife's key, once the family uses per-person keys (core/personkeys.ts): the record then carries none in the clear. */
  sealed?: Sealed;
}

/**
 * Milk kinship (الرضاعة, design document 1.36): a child nursed by a woman who is
 * not his mother. The child counts as a child of his milk parents for kinship
 * (from him and his descendants only) and, for him alone, for what he sees. No
 * year: what counts falls in the child's first two years, which his birth places.
 */
export interface Milk {
  id: string;
  /** The nursed child, in the tree. */
  child: string;
  /** The woman who nursed him: of the family, or from outside (recorded by name only, as a spouse from outside is). */
  nurse: string;
  /** The milk father: her husband at the time, from her marriages; left out when not known. */
  father?: string;
  /** The family is not sure of it (the details, or whether it counts). */
  uncertain?: boolean;
}

export interface FamilyData {
  family: { name: string; source?: string };
  root: string;
  people: Person[];
  marriages: Marriage[];
  /** Milk kinship records (version 1.36). */
  milk?: Milk[];
}

// ---- governance

export type Tier = 'platinum' | 'gold' | 'silver';
export interface Seat {
  tier: Tier;
  branch: string | null;
  holder: string;
}

/**
 * What the root admin (مشرف العائلة) can do, for now alongside the keys: mark the
 * main branches and fill or empty the key seats. Only entries signed with the
 * key that created the family count.
 */
export type AdminAct =
  | { kind: 'branches'; ids: string[] }
  | { kind: 'appoint'; tier: Tier; branch: string | null; holder: string; replaces?: string }
  | { kind: 'vacate'; holder: string }
  /** A personal invite: whoever opens it first joins as this person. `key` is the invite's public key. */
  | { kind: 'invite'; person: string; key: string }
  /** Cancels an unused invite, or unlinks a device (a lost phone). */
  | { kind: 'revoke'; key: string }
  /** The root admin's own phone, linked to the admin's place in the tree; `label` names the phone (browser and system). */
  | { kind: 'self'; person: string; device: string; label?: string }
  /** A change the root admin makes directly while setting up (no approvals); kept and revertible like any other. */
  | { kind: 'edit'; tx: Tx }
  /** The root admin approves (`ok`) or rejects a member's request at once, keys or not. */
  | { kind: 'decide'; txId: string; ok: boolean };

/**
 * "View all" (مشاهدة الكل), given and taken back by the root admin or the
 * platinum key holder: a member who sees everyone (the privacy rule is lifted
 * for them), or a guest invite for someone who may only look.
 */
export type AccessAct =
  | { kind: 'viewall'; person: string; on: boolean }
  /** A view-only invite; `key` is its public key, `label` the guest's name. */
  | { kind: 'guest'; key: string; label: string }
  /** Ends a guest's access: cancels the invite or unlinks the guest's phone. */
  | { kind: 'end'; key: string };

/**
 * Family-wide settings, set by the root admin or by the platinum holder's phone.
 * `reach`: how far a woman's details are seen: by relatives within this kinship
 * degree (3 to 6), or by everyone (null).
 * `asks`: about whom a member may send requests: relatives within this degree
 * (1 to 6), no one (0), or anyone in the tree (null).
 */
export type SettingAct = { kind: 'reach'; deg: number | null } | { kind: 'asks'; deg: number | null };

/**
 * How far one woman's details are seen, set for her: by herself, or, while she
 * has no phone in the family, by her close relatives (1st or 2nd degree) or a
 * gold of her branch; and by the root admin or the platinum holder. Never
 * narrower than the family's rule. `reach`: the family's ('family'), a wider
 * degree, or everyone ('all'); `people`: anyone else she names.
 */
export interface Own {
  reach: 'family' | 'all' | number;
  people: string[];
}

/**
 * A chart exported (src/export, design document Section 9): whom it is of, and
 * how; recorded in the log before the file is made, with the code printed on it.
 */
export interface ExportWhat {
  /** Whose descendants (`down`), or whose lineage up to the founder (`up`). */
  from: string;
  kind: 'down' | 'up';
  mode: 'poster' | 'sheets';
  paper: 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
  sheets: number;
  /** Daughters as «ابنة», by name where the phone opened them, or left out. */
  women: 'daughter' | 'names' | 'none';
  years: boolean;
}

/** An export as the replay found it; `ok`: whoever exported it could, as the seats stood. */
export interface ExportRec {
  code: string;
  by: string | null;
  at: number;
  /** Signed with the root admin's key. */
  admin: boolean;
  /** Made by the root admin acting as `by` (design document 1.38). */
  via?: boolean;
  what: ExportWhat;
  ok: boolean;
}

/** The degrees `reach` may be set to; the 3rd until it is changed. */
export const REACHES = [3, 4, 5, 6] as const;

/** The degrees `asks` may be set to (0: no one); no limit until it is changed. */
export const ASKS = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * A member's own devices (أجهزتي), signed by one of that person's devices.
 * Every device of a person is equal: each can add, rename or remove the others.
 */
export type DeviceAct =
  /** A one-time invite for another phone or browser of the same person; `key` is the invite's public key. */
  | { kind: 'invite'; key: string }
  /**
   * Adds a key whose secret the writer holds, as one of the person's devices:
   * a recovery kit's backup key (`backup`), or a phone restored from a kit
   * (signed by the backup key). `proof` is that key's own signature (deviceProof).
   */
  | { kind: 'add'; device: string; label: string; backup?: boolean; proof: string }
  /** Renames one of the person's devices. */
  | { kind: 'label'; device: string; label: string }
  /** Removes some of the person's devices, or cancels their invites still waiting. */
  | { kind: 'remove'; keys: string[] };

export type Level = 'everyday' | 'death' | 'sensitive' | 'critical' | 'trunk';

/** Changed fields of a person; null removes a field (e.g. clearing a year). */
export type PersonPatch = { [K in keyof Person]?: Person[K] | null };
/** Changed fields of a marriage (status, years, or the years sealed); null removes a field. */
export type MarriagePatch = { [K in 'status' | 'year' | 'end' | 'sealed']?: Marriage[K] | null };

export type Op =
  | { op: 'addPerson'; person: Person }
  | { op: 'updatePerson'; id: string; before: PersonPatch; after: PersonPatch }
  | { op: 'addMarriage'; marriage: Marriage }
  | { op: 'updateMarriage'; id: string; before: MarriagePatch; after: MarriagePatch }
  | { op: 'removeMarriage'; marriage: Marriage }
  | { op: 'removePerson'; person: Person }
  | { op: 'addMilk'; milk: Milk }
  | { op: 'removeMilk'; milk: Milk };

export interface Approval {
  by: string;
  at: number;
  override?: boolean;
  /** Given by the root admin acting as `by` (design document 1.38; worked out by the replay, never written). */
  via?: boolean;
}

export interface Tx {
  id: string;
  at: number;
  by: string;
  title: string;
  subject: string;
  level: Level;
  branch: string | null;
  ops: Op[];
  status: 'pending' | 'approved' | 'rejected';
  approvals: Approval[];
  rejectedBy?: string;
  /** Refused by the root admin acting as `rejectedBy` (worked out by the replay, never written). */
  rejectedVia?: boolean;
  revertOf?: string;
  /** Made directly by the root admin. */
  direct?: boolean;
  /** Approved or rejected by the root admin (worked out by the replay, never written). */
  byAdmin?: boolean;
  /** Closed without a decision: the one it is about is not in the tree (worked out by the replay, never written). */
  closed?: boolean;
  /** The level and branch its sender wrote, when they differ from what every phone works out (worked out by the replay, never written). */
  declared?: { level: Level; branch: string | null };
  /** Sent by the root admin acting as `by` (design document 1.38; worked out by the replay, never written). */
  via?: boolean;
}
