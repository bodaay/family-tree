// What an opened log entry must look like. Anyone who holds the family key can
// write an entry with anything at all inside it; one that is not in the shape
// this app writes is set aside like an entry that does not open, so the replay,
// and every screen built from it, only ever meets the shapes it knows. Kinds
// this version does not know (a newer version's) pass through untouched: the
// replay ignores them. Only fields the app reads are checked, and only their type.
import type { Payload } from './log.ts';
import { bundleShape, sealedShape } from './personkeys.ts';

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown) => typeof x === 'string';
const optStr = (x: unknown) => x === undefined || typeof x === 'string';
const strOrNull = (x: unknown) => x === null || typeof x === 'string';
const optBool = (x: unknown) => x === undefined || typeof x === 'boolean';
const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const strings = (x: unknown) => Array.isArray(x) && x.every(str);
// fields that would reach an object's prototype when copied onto it
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const safeKeys = (o: Obj) => Object.keys(o).every(k => !UNSAFE.has(k));

const year = (x: unknown) => isObj(x) && num(x.v) && (x.cal === 'g' || x.cal === 'h') && optBool(x.approx);
const sex = (x: unknown) => x === 'm' || x === 'f';
const alias = (x: unknown) => isObj(x) && str(x.type) && str(x.text);

/** A person's field, when present (null clears it in a patch). */
const PERSON: Record<string, (x: unknown) => boolean> = {
  id: str,
  name: str,
  sex,
  birth: year,
  death: year,
  deceased: optBool,
  father: str,
  mother: str,
  external: optBool,
  familyRoot: optBool,
  uncertain: optBool,
  aliases: x => Array.isArray(x) && x.every(alias),
  suffix: str,
  sealed: sealedShape,
};
// a field may be left out, or null (a patch clears it with null)
const fieldsOk = (o: Obj, rules: Record<string, (x: unknown) => boolean>) => safeKeys(o) && Object.entries(o).every(([k, v]) => !rules[k] || v == null || rules[k](v));

const person = (x: unknown) => isObj(x) && str(x.id) && str(x.name) && sex(x.sex) && fieldsOk(x, PERSON);
// a patch never changes who someone is, and never clears a name
const personPatch = (x: unknown) => isObj(x) && x.id === undefined && x.name !== null && x.sex !== null && fieldsOk(x, PERSON);

const STATUS = new Set(['married', 'divorced', 'widowed']);
const MARRIAGE: Record<string, (x: unknown) => boolean> = { status: x => STATUS.has(x as string), year, end: year, hidden: optBool, sealed: sealedShape };
const marriage = (x: unknown) => isObj(x) && str(x.id) && str(x.husband) && str(x.wife) && STATUS.has(x.status as string) && fieldsOk(x, MARRIAGE);
const marriagePatch = (x: unknown) => isObj(x) && fieldsOk(x, MARRIAGE);
const milk = (x: unknown) => isObj(x) && str(x.id) && str(x.child) && str(x.nurse) && x.child !== x.nurse && fieldsOk(x, { father: str, uncertain: optBool });

function op(x: unknown): boolean {
  if (!isObj(x) || !str(x.op)) return false;
  switch (x.op) {
    case 'addPerson':
    case 'removePerson':
      return person(x.person);
    case 'updatePerson':
      return str(x.id) && personPatch(x.before) && personPatch(x.after);
    case 'addMarriage':
    case 'removeMarriage':
      return marriage(x.marriage);
    case 'updateMarriage':
      return str(x.id) && marriagePatch(x.before) && marriagePatch(x.after);
    case 'addMilk':
    case 'removeMilk':
      return milk(x.milk);
    default:
      return true;
  }
}

const LEVELS = new Set(['everyday', 'death', 'sensitive', 'critical', 'trunk']);
/** A change, as proposed or made by the root admin (its status and approvals come from the replay). */
const tx = (x: unknown) =>
  isObj(x) &&
  safeKeys(x) &&
  str(x.id) &&
  num(x.at) &&
  str(x.by) &&
  str(x.title) &&
  str(x.subject) &&
  LEVELS.has(x.level as string) &&
  (x.branch === undefined || strOrNull(x.branch)) &&
  Array.isArray(x.ops) &&
  x.ops.every(op) &&
  optStr(x.revertOf);

const TIERS = new Set(['platinum', 'gold', 'silver']);
function adminAct(x: unknown): boolean {
  if (!isObj(x) || !str(x.kind)) return false;
  switch (x.kind) {
    case 'branches':
      return strings(x.ids);
    case 'appoint':
      return TIERS.has(x.tier as string) && strOrNull(x.branch) && str(x.holder) && optStr(x.replaces);
    case 'vacate':
      return str(x.holder);
    case 'invite':
      return str(x.person) && str(x.key);
    case 'revoke':
      return str(x.key);
    case 'self':
      return str(x.person) && str(x.device) && optStr(x.label);
    case 'edit':
      return tx(x.tx);
    default:
      return true;
  }
}

function accessAct(x: unknown): boolean {
  if (!isObj(x) || !str(x.kind)) return false;
  switch (x.kind) {
    case 'viewall':
      return str(x.person) && typeof x.on === 'boolean';
    case 'guest':
      return str(x.key) && str(x.label);
    case 'end':
      return str(x.key);
    default:
      return true;
  }
}

/** A person's own devices (أجهزتي): who may change them is the replay's to check (data/devices.ts). */
function deviceAct(x: unknown): boolean {
  if (!isObj(x) || !str(x.kind)) return false;
  switch (x.kind) {
    case 'invite':
      return str(x.key);
    case 'add':
      return str(x.device) && str(x.label) && optBool(x.backup) && str(x.proof);
    case 'label':
      return str(x.device) && str(x.label);
    case 'remove':
      return strings(x.keys);
    default:
      return true;
  }
}

const by = (x: unknown) => x === undefined || strOrNull(x);
const record = (x: unknown) => isObj(x) && Object.values(x).every(str);

/** Whether an opened entry is in a shape the replay can take. */
export function wellFormed(p: unknown): p is Payload {
  if (!isObj(p) || !str(p.type)) return false;
  switch (p.type) {
    case 'seed': {
      // the family as first entered, by the root admin
      const f = p.family;
      return isObj(f) && isObj(f.family) && str(f.family.name) && isObj(f.root) && str(f.root.id) && str(f.root.name) && Array.isArray(f.people) && f.people.every(x => isObj(x) && str(x.id) && str(x.name));
    }
    case 'propose':
      return tx(p.tx);
    case 'approve':
    case 'reject':
      return str(p.txId) && str(p.by) && optBool(p.override);
    case 'admin':
      return adminAct(p.act) && by(p.by);
    case 'claim':
      return str(p.device) && optStr(p.label);
    case 'device':
      return deviceAct(p.act) && str(p.by);
    case 'access':
      return accessAct(p.act) && by(p.by);
    case 'rekey':
      return str(p.kid) && str(p.epk) && record(p.wraps) && by(p.by) && optBool(p.cut);
    case 'keys':
      return record(p.keys);
    case 'writekey':
      return str(p.kid);
    case 'epoch':
      return snapshot(p.snapshot);
    case 'pkeys':
      return handed(p.to);
    case 'widen':
      return str(p.person) && str(p.by) && own(p.own);
    case 'private':
      return list(p.boxes, bundleShape) && (p.boxes as unknown[]).length >= 1 && (p.boxes as unknown[]).length <= 40;
    case 'export':
      return str(p.code) && CODE.test(p.code as string) && by(p.by) && exportWhat(p.what);
    default:
      return true;
  }
}

/** An export's code: eight letters and digits that cannot be mistaken for one another, in two fours. */
export const CODE = /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

/** What a chart exported shows (data/types.ts, ExportWhat). */
const exportWhat = (x: unknown) =>
  isObj(x) &&
  str(x.from) &&
  (x.kind === 'down' || x.kind === 'up') &&
  (x.mode === 'poster' || x.mode === 'sheets') &&
  ['A4', 'A3', 'A2', 'A1', 'A0'].includes(x.paper as string) &&
  Number.isInteger(x.sheets) &&
  (x.sheets as number) >= 1 &&
  (x.sheets as number) <= 500 &&
  ['daughter', 'names', 'none'].includes(x.women as string) &&
  typeof x.years === 'boolean';

/** How far one woman's details are seen: the family's rule, a wider degree, or everyone; and anyone named. */
const own = (x: unknown) => isObj(x) && (x.reach === 'family' || x.reach === 'all' || num(x.reach)) && strings(x.people) && (x.people as unknown[]).length <= 50;

/** Women's keys for each reader: which women, and the keys sealed for that reader. */
const handed = (x: unknown) => isObj(x) && safeKeys(x) && Object.values(x).every(v => isObj(v) && strings(v.ids) && bundleShape(v.b));
const list = (x: unknown, each: (y: unknown) => boolean) => Array.isArray(x) && x.every(each);

/** The family as it stands after the move to per-person keys, and who has what (data/snapshot.ts). */
function snapshot(x: unknown): boolean {
  if (!isObj(x) || x.v !== 1 || !isObj(x.family)) return false;
  const f = x.family;
  return (
    isObj(f.family) &&
    str(f.family.name) &&
    str(f.root) &&
    list(f.people, person) &&
    list(f.marriages, marriage) &&
    (f.milk === undefined || list(f.milk, milk)) &&
    (x.mains === null || strings(x.mains)) &&
    list(x.seats, y => isObj(y) && TIERS.has(y.tier as string) && strOrNull(y.branch) && str(y.holder)) &&
    strOrNull(x.adminBy) &&
    list(x.invites, y => isObj(y) && str(y.key) && str(y.person) && num(y.at) && str(y.status)) &&
    list(x.devices, y => isObj(y) && str(y.key) && str(y.person) && num(y.at)) &&
    list(x.ever, y => Array.isArray(y) && y.length === 2 && str(y[0]) && str(y[1])) &&
    list(x.guests, y => isObj(y) && str(y.key) && str(y.label) && str(y.status)) &&
    strings(x.viewAll) &&
    (x.reach === null || num(x.reach)) &&
    (x.asks === null || num(x.asks)) &&
    strings(x.holders) &&
    num(x.keyVersion) &&
    strings(x.cancelled) &&
    handed(x.keys) &&
    (x.own === undefined || list(x.own, y => Array.isArray(y) && y.length === 2 && str(y[0]) && own(y[1])))
  );
}
