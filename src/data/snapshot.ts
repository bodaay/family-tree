// The move to per-person keys for women's details (design document, Section 6).
// Once, the root admin's phone renews the family key without carrying the earlier
// versions forward (a 'rekey' with `cut`), then writes a snapshot of the family
// as it stands: every woman's details sealed with a key of her own, with the
// key seats, settings, members, devices and invites, and each reader's women's
// keys. Every phone works on from the snapshot, so whoever joins later never
// reads the entries before it. This file holds what the replay and the writing
// side share: the snapshot's shape, a woman's record split into structure and
// sealed details, and who holds each woman's key.
import type { FamilyData, Marriage, MarriagePatch, Op, Own, Person, Seat } from './types';
import type { Graph } from './graph';
import type { DeviceInfo, Invite } from './devices';
import type { Guest, ReachSet } from './store';
import { DETAIL_FIELDS, YEAR_FIELDS, b64, bundles, newPersonKey, sealDetails, sealYears, sealedShape, type Bundle, type Details, type MarriageDetails } from '../core/personkeys.ts';
import { kin } from './kinship';

export interface Snapshot {
  v: 1;
  /** The family as it stands, each woman's details sealed with her own key. */
  family: FamilyData;
  /** The main branches the root admin marked, if any. */
  mains: string[] | null;
  seats: Seat[];
  adminBy: string | null;
  invites: Invite[];
  /** Linked devices (their owners are the people they name). */
  devices: DeviceInfo[];
  /** Every key ever handed to a person (device or invite): whose it was. */
  ever: [string, string][];
  guests: Guest[];
  viewAll: string[];
  reach: number | null;
  reachSet: ReachSet | null;
  asks: number | null;
  asksSet: ReachSet | null;
  /** Everyone the cut's renewal reached (public keys). */
  holders: string[];
  /** The number of the family key version the cut made (versions go on counting from the family's start). */
  keyVersion: number;
  /** The waiting invites the move cancelled (their links carried the old key): whom to invite again. */
  cancelled: string[];
  /** Each reader's women's keys, and which women they are. */
  keys: Record<string, { ids: string[]; b: Bundle }>;
  /** Women whose details are seen wider than the family's rule (version 1.29). */
  own?: [string, Own][];
}

/** A woman of the tree or from outside (the family's anchor is not one). */
export function isWoman(p: Pick<Person, 'sex' | 'familyRoot'> | undefined): boolean {
  return !!p && p.sex === 'f' && !p.familyRoot;
}

/** Her details as a record holds them in the clear. */
export function detailsOf(p: Partial<Person>): Details {
  const d: Details = { name: p.name ?? '' };
  if (p.aliases?.length) d.aliases = p.aliases;
  if (p.suffix) d.suffix = p.suffix;
  if (p.birth) d.birth = p.birth;
  if (p.death) d.death = p.death;
  return d;
}

/** Her record without her details: an empty name, the structure, and her seal. */
export function structureOf(p: Person, sealed: Person['sealed']): Person {
  const out = { ...p } as Record<string, unknown>;
  for (const k of DETAIL_FIELDS) delete out[k];
  out.name = '';
  // whether she has died is structure (the mourning band shows); the year is hers
  if (p.death) out.deceased = true;
  out.sealed = sealed;
  return out as unknown as Person;
}

/** Her record sealed with her key. */
export function sealPerson(p: Person, key: Uint8Array): Person {
  return structureOf(p, sealDetails(key, detailsOf(p)));
}

/** Whether a record carries a woman's details in the clear (none may, after the cut). */
function clearRecord(p: Partial<Person> | undefined): boolean {
  if (!p) return false;
  return !!p.name || DETAIL_FIELDS.some(k => k !== 'name' && (p as Record<string, unknown>)[k] != null);
}

/** Whether a marriage record or change carries years in the clear. */
const clearYears = (m: Partial<Marriage> | MarriagePatch) => YEAR_FIELDS.some(k => m[k] != null);
const sameYear = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Years in the clear that only say what the tree holds already (a marriage recorded before its years were sealed). */
const asRecorded = (g: Graph, id: string, m: Partial<Marriage> | MarriagePatch) => {
  const cur = g.marriages.find(x => x.id === id);
  return !!cur && YEAR_FIELDS.every(k => m[k] == null || sameYear(m[k], cur[k]));
};

/**
 * Whether a change carries a woman's details in the clear: after the cut none
 * counts (a phone on an older version would write them so), and a woman's
 * record must carry her seal. A marriage's years are the wife's: they go sealed
 * with her key, and only years the tree already holds in the clear may be
 * named, as they were (to seal them).
 */
export function clearWomen(g: Graph, ops: Op[]): boolean {
  for (const op of ops) {
    if (op.op === 'addMarriage') {
      if (clearYears(op.marriage) || (op.marriage.sealed != null && !sealedShape(op.marriage.sealed))) return true;
      continue;
    }
    if (op.op === 'removeMarriage') {
      if (clearYears(op.marriage) && !asRecorded(g, op.marriage.id, op.marriage)) return true;
      continue;
    }
    if (op.op === 'updateMarriage') {
      if (clearYears(op.after) || (op.after.sealed != null && !sealedShape(op.after.sealed))) return true;
      if (clearYears(op.before) && !asRecorded(g, op.id, op.before)) return true;
      continue;
    }
    if (op.op === 'addPerson' || op.op === 'removePerson') {
      if (isWoman(op.person) && (clearRecord(op.person) || !sealedShape(op.person.sealed))) return true;
    } else if (op.op === 'updatePerson') {
      const n = g.nodes.get(op.id);
      // a woman recorded as a man again (a correction) leaves her seal, and her details come out with it
      if (op.after.sex === 'm') {
        if (op.after.sealed !== null && isWoman(n)) return true;
        continue;
      }
      const woman = isWoman(n) || op.after.sex === 'f';
      // (a man recorded as a woman: his details before were his, in the clear)
      if (woman && (clearRecord(op.after as Partial<Person>) || (isWoman(n) && clearRecord(op.before as Partial<Person>)))) return true;
      if (woman && op.after.sealed != null && !sealedShape(op.after.sealed)) return true;
    }
  }
  return false;
}

/** Who may read whom: what the replay and the root admin's phone work out the same way. */
export interface Readership {
  adminPub: string;
  reach: number | null;
  viewAll: Set<string>;
  /** device key -> its person */
  devices: Map<string, string>;
  /** pending personal invites (their keys go to the person's phone when it joins) */
  invites: Invite[];
  /** guests' invite keys and guests' phones: they see everyone */
  guests: string[];
  /** women whose details are seen wider than the family's rule */
  own: Map<string, Own>;
}

/** The degree a woman's details reach: the family's, or hers when wider (null: everyone). */
export function reachOf(reach: number | null, own: Own | undefined): number | null {
  if (reach === null || own?.reach === 'all') return null;
  return typeof own?.reach === 'number' ? Math.max(reach, own.reach) : reach;
}

/**
 * Whether this person may hold this woman's key: herself, her relatives within
 * the family's reach (or hers, when wider), anyone she names, or someone who
 * sees everyone.
 */
export function mayRead(g: Graph, r: Readership, person: string, woman: string): boolean {
  if (person === woman || r.viewAll.has(person)) return true;
  const own = r.own.get(woman);
  const lim = reachOf(r.reach, own);
  if (lim === null || own?.people.includes(person)) return true;
  const k = kin(g, person, woman);
  return !!k && k.deg <= lim;
}

/** Each reader (public key) and the women whose keys they should hold, among `women`. */
export function readersOf(g: Graph, r: Readership, women: string[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const all = new Set(women);
  out.set(r.adminPub, all);
  for (const k of r.guests) out.set(k, all);
  const forPerson = new Map<string, Set<string>>();
  const of = (person: string) => {
    let s = forPerson.get(person);
    if (!s) {
      s = new Set(women.filter(w => mayRead(g, r, person, w)));
      forPerson.set(person, s);
    }
    return s;
  };
  for (const [device, person] of r.devices) if (g.nodes.has(person)) out.set(device, of(person));
  for (const i of r.invites) if (i.status === 'pending' && g.nodes.has(i.person)) out.set(i.key, of(i.person));
  return out;
}

/** What sealing a change needs to know, as this phone holds it. */
export interface SealCtx {
  /** Her record as every phone holds it (structure and seal), if she is in the tree. */
  structure(id: string): Person | undefined;
  /** Her key, if this phone holds it. */
  key(id: string): Uint8Array | null;
  /** Her details as this phone reads them (with her key). */
  details(id: string): Details | null;
  /** A marriage as every phone holds it (structure and seal), if it is in the tree. */
  marriage(id: string): Marriage | undefined;
  /** A marriage's years as this phone reads them (with the wife's key, or in the clear from before they were sealed). */
  years(id: string): MarriageDetails | null;
}

/**
 * A change with every woman's details it carries sealed with her key: a new
 * woman gets a new key (returned in `fresh`, to hand out); a woman already in
 * the tree keeps hers, and a change to her details seals them whole again. Her
 * removal carries her record as every phone holds it. Throws if a change
 * touches the details of a woman whose key this phone does not hold.
 */
export function sealOps(ops: Op[], ctx: SealCtx): { ops: Op[]; fresh: Map<string, Uint8Array> } {
  const fresh = new Map<string, Uint8Array>();
  const keyOf = (id: string) => {
    let k = ctx.key(id) ?? fresh.get(id);
    if (!k) fresh.set(id, (k = newPersonKey()));
    return k;
  };
  // a wife's key: hers if she is in the tree already (only if this phone holds it), or a new one with her
  const wifeKey = (id: string) => (ctx.structure(id) ? ctx.key(id) : keyOf(id));
  const years = (m: Partial<Marriage>): MarriageDetails => ({ ...(m.year ? { year: m.year } : {}), ...(m.end ? { end: m.end } : {}) });
  const noYears = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([k]) => !(YEAR_FIELDS as readonly string[]).includes(k))) as T;
  const out = ops.map((op): Op => {
    if (op.op === 'addMarriage') {
      if (!clearYears(op.marriage)) return op;
      const k = wifeKey(op.marriage.wife);
      if (!k) throw new Error('لا يحمل هذا الهاتف مفتاحها: سنوات الزواج يسجلها من يحمله');
      return { ...op, marriage: { ...noYears(op.marriage), sealed: sealYears(k, years(op.marriage)) } };
    }
    if (op.op === 'removeMarriage') {
      // as every phone holds it
      const st = ctx.marriage(op.marriage.id);
      return st ? { ...op, marriage: st } : clearYears(op.marriage) ? { ...op, marriage: noYears(op.marriage) } : op;
    }
    if (op.op === 'updateMarriage') {
      const touched = YEAR_FIELDS.filter(k => k in op.after || k in op.before);
      const st = ctx.marriage(op.id);
      if (!touched.length || !st) return op;
      const k = ctx.key(st.wife);
      if (!k) {
        // the year a widowhood ended (with a death) is hers: without her key it is left out, and the status says it
        if (touched.every(x => x === 'end')) return { ...op, before: noYears(op.before), after: noYears(op.after) };
        throw new Error('لا يحمل هذا الهاتف مفتاحها: سنوات الزواج يسجلها من يحمله');
      }
      const merged = { ...(ctx.years(op.id) ?? {}) } as Record<string, unknown>;
      for (const f of YEAR_FIELDS) {
        if (!(f in op.after)) continue;
        const v = op.after[f];
        if (v == null) delete merged[f];
        else merged[f] = v;
      }
      // years recorded in the clear before they were sealed go into the seal
      const was = clearYears(st) ? { year: st.year ?? null, end: st.end ?? null } : {};
      const gone = clearYears(st) ? { year: null, end: null } : {};
      const before: MarriagePatch = { ...noYears(op.before), ...was, sealed: st.sealed ?? null };
      const after: MarriagePatch = { ...noYears(op.after), ...gone, sealed: Object.keys(merged).length ? sealYears(k, merged as MarriageDetails) : null };
      return { ...op, before, after };
    }
    if (op.op === 'addPerson' || op.op === 'removePerson') {
      if (!isWoman(op.person)) return op;
      // already sealed (an undo puts her record back as it was)
      if (!clearRecord(op.person) && sealedShape(op.person.sealed)) return op;
      const st = op.op === 'removePerson' ? ctx.structure(op.person.id) : undefined;
      if (st && sealedShape(st.sealed)) return { ...op, person: st };
      const k = keyOf(op.person.id);
      // a woman new to the tree goes in with her key handed out: also one this phone held already (a hidden marriage's wife, revealed)
      if (op.op === 'addPerson' && !ctx.structure(op.person.id)) fresh.set(op.person.id, k);
      return { ...op, person: sealPerson(op.person, k) };
    }
    if (op.op !== 'updatePerson') return op;
    const st = ctx.structure(op.id);
    const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !(DETAIL_FIELDS as readonly string[]).includes(k)));
    // a correction of sex: a woman recorded as a man comes out of her seal (his details in the clear), a man recorded as a woman goes into one
    if (isWoman(st) && op.after.sex === 'm') {
      const cur = ctx.details(op.id);
      if (!cur) throw new Error('لا يحمل هذا الهاتف مفتاحها');
      const after = { ...cur, ...op.after, sealed: null } as Record<string, unknown>;
      return { ...op, before: { ...strip(op.before as Record<string, unknown>), sealed: st?.sealed ?? null }, after } as Op;
    }
    if (st && !isWoman(st) && op.after.sex === 'f') {
      const merged = { ...detailsOf(st), ...Object.fromEntries(DETAIL_FIELDS.filter(k => k in op.after).map(k => [k, (op.after as Record<string, unknown>)[k]])) } as Record<string, unknown>;
      for (const k of DETAIL_FIELDS) if (merged[k] == null) delete merged[k];
      const cleared = Object.fromEntries(DETAIL_FIELDS.filter(k => k !== 'name').map(k => [k, null]));
      const before = { ...(op.before as Record<string, unknown>), ...detailsOf(st) };
      return { ...op, before, after: { ...strip(op.after as Record<string, unknown>), ...cleared, name: '', sealed: sealDetails(keyOf(op.id), merged as unknown as Details) } } as Op;
    }
    if (!isWoman(st) && op.after.sex !== 'f') return op;
    const touched = DETAIL_FIELDS.filter(k => k in op.after || k in op.before);
    if (!touched.length) return op;
    const cur = ctx.details(op.id);
    if (!cur) throw new Error('لا يحمل هذا الهاتف مفتاحها');
    const merged = { ...cur } as Record<string, unknown>;
    for (const k of DETAIL_FIELDS) {
      if (!(k in op.after)) continue;
      const v = (op.after as Record<string, unknown>)[k];
      if (v == null) delete merged[k];
      else merged[k] = v;
    }
    const before = { ...strip(op.before as Record<string, unknown>), sealed: st?.sealed ?? null };
    const after = { ...strip(op.after as Record<string, unknown>), sealed: sealDetails(keyOf(op.id), merged as unknown as Details) } as Record<string, unknown>;
    // a death year makes her deceased (structure); the year itself is hers
    if ((op.after as Record<string, unknown>).death) after.deceased = true;
    return { ...op, before, after } as Op;
  });
  return { ops: out, fresh };
}

/** The mark a woman's name leaves in a change's title once the family uses per-person keys: filled in only where her details may show. */
export const nameToken = (id: string) => `⟦${id}⟧`;

/** A title with these women's names (longest first) turned into their marks. */
export function tokenTitle(title: string, women: { id: string; names: string[] }[]): string {
  const pairs = women.flatMap(w => w.names.filter(Boolean).map(n => [n, nameToken(w.id)] as const)).sort((a, b) => b[0].length - a[0].length);
  let t = title;
  for (const [n, tok] of pairs) t = t.split(n).join(tok);
  return t;
}

/** Each reader's women's keys, sealed for them (person keys by id). */
export function handOut(keysOf: (id: string) => Uint8Array | null, readers: Map<string, Set<string>>): Record<string, { ids: string[]; b: Bundle }> {
  const sets: Record<string, Record<string, string>> = {};
  for (const [r, ids] of readers) {
    const set: Record<string, string> = {};
    for (const id of ids) {
      const k = keysOf(id);
      if (k) set[id] = b64(k);
    }
    if (Object.keys(set).length) sets[r] = set;
  }
  const sealed = bundles(sets);
  return Object.fromEntries(Object.entries(sealed).map(([r, b]) => [r, { ids: Object.keys(sets[r]), b }]));
}

/** JSON with keys in order: two records written apart compare equal when they hold the same. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object')
    return '{' + Object.keys(v).sort().filter(k => (v as Record<string, unknown>)[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon((v as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}

/** What every phone can compare of a person: the structure, and a man's details (a woman's are sealed). */
function comparable(p: Person): string {
  const base = { sex: p.sex, father: p.father, mother: p.mother, external: !!p.external, familyRoot: !!p.familyRoot, uncertain: !!p.uncertain, dead: !!(p.deceased || p.death) };
  return canon(isWoman(p) ? base : { ...base, name: p.name, aliases: p.aliases ?? [], suffix: p.suffix, birth: p.birth, death: p.death });
}

/**
 * Whether a snapshot agrees with the family as this phone's own replay of the
 * log had it just before (a phone from before the move): the same people with
 * the same structure, the same men's details, marriages, key seats and settings.
 */
export function snapshotAgrees(sn: Snapshot, mine: { people: Person[]; marriages: unknown[]; milk?: unknown[]; seats: Seat[]; viewAll: Set<string>; reach: number | null; asks: number | null }): boolean {
  const a = new Map(mine.people.map(p => [p.id, comparable(p)]));
  const b = new Map(sn.family.people.map(p => [p.id, comparable(p)]));
  if (a.size !== b.size || [...a].some(([id, v]) => b.get(id) !== v)) return false;
  const sorted = (xs: unknown[]) => xs.map(canon).sort().join('|');
  return (
    sorted(mine.marriages) === sorted(sn.family.marriages) &&
    sorted(mine.milk ?? []) === sorted(sn.family.milk ?? []) &&
    sorted(mine.seats) === sorted(sn.seats) &&
    [...mine.viewAll].sort().join() === [...sn.viewAll].sort().join() &&
    mine.reach === sn.reach &&
    mine.asks === sn.asks
  );
}
