// Leadership keys and approvals. Seats are fixed: 1 platinum for the family,
// 2 gold and 3 silver per main branch. Each branch approves what touches its
// own people; platinum handles what belongs to everyone and can override.
// For now the root admin fills the seats; elections come later.
import type { Graph } from './graph';
import type { AdminAct, Level, Op, Seat, Tier, Tx } from './types';
import { kin } from './kinship';
import { THIS_YEAR } from './dates';

/** From this age a member may send requests, approve, and hold a key. */
export const ADULT = 18;

/** Under 18 in that year, by the recorded birth year. With no birth year recorded, counted as an adult. */
export function isMinor(g: Graph, id: string | null, year = THIS_YEAR): boolean {
  const n = id ? g.nodes.get(id) : undefined;
  return !!n && n.by != null && year - n.by < ADULT;
}

export const TIER_AR: Record<Tier, string> = { platinum: 'بلاتيني', gold: 'ذهبي', silver: 'فضي' };
const RANK: Record<Tier, number> = { silver: 1, gold: 2, platinum: 3 };

/** Seats are fixed: 1 platinum for the family, 2 gold and 3 silver per main branch. */
export const SEATS: Record<Tier, number> = { platinum: 1, gold: 2, silver: 3 };

/** Why someone cannot hold a seat, or null if they can: a living member, from the seat's own branch. */
export function seatProblem(g: Graph, tier: Tier, branch: string | null, holder: string): string | null {
  const n = g.nodes.get(holder);
  if (!n || n.familyRoot) return 'ليس في الشجرة';
  if (n.external) return 'من خارج العائلة';
  if (n.dead) return 'متوفى';
  if (isMinor(g, holder)) return 'دون 18 سنة';
  if (tier === 'platinum') return branch === null ? null : 'البلاتيني للعائلة كلها';
  if (!branch || !g.branches.includes(branch)) return 'ليس فرعًا رئيسيًا';
  if (n.branch !== branch) return 'من خارج الفرع';
  return null;
}

/** Seats still valid after the tree changed (a death, a new set of main branches). */
export function validSeats(g: Graph, seats: Seat[]): Seat[] {
  return seats.filter(x => !seatProblem(g, x.tier, x.branch, x.holder));
}

/** Main branches cannot overlap: no founder may descend from another. */
export function mainBranchProblem(g: Graph, ids: string[]): string | null {
  if (new Set(ids).size !== ids.length) return 'فرع مكرر';
  for (const id of ids) {
    const n = g.nodes.get(id);
    if (!n || n.familyRoot) return 'ليس في الشجرة';
    if (n.sex !== 'm') return 'الفرع يُنسب إلى رجل';
    for (let p = n.parent; p; p = g.nodes.get(p)!.parent) if (ids.includes(p)) return 'فرعان متداخلان';
  }
  return null;
}

/** Applies a seat change by the root admin: the new seats, or why it cannot apply. */
export function applySeatAct(g: Graph, seats: Seat[], act: Extract<AdminAct, { kind: 'appoint' | 'vacate' }>): Seat[] | string {
  if (act.kind === 'vacate') return seats.some(x => x.holder === act.holder) ? seats.filter(x => x.holder !== act.holder) : 'لا يحمل مفتاحًا';
  const why = seatProblem(g, act.tier, act.branch, act.holder);
  if (why) return why;
  if (seats.some(x => x.holder === act.holder && x.tier === act.tier && x.branch === act.branch)) return 'يحمل هذا المفتاح أصلًا';
  if (act.replaces && !seats.some(x => x.holder === act.replaces && x.tier === act.tier && x.branch === act.branch)) return 'المقعد تغيّر';
  // one tier per person: taking a new seat frees the old one
  const rest = seats.filter(x => x.holder !== act.holder && x.holder !== act.replaces);
  if (rest.filter(x => x.tier === act.tier && x.branch === act.branch).length >= SEATS[act.tier]) return 'المقاعد ممتلئة';
  return [...rest, { tier: act.tier, branch: act.branch, holder: act.holder }];
}

export function seatOf(seats: Seat[], id: string | null): Seat | null {
  return seats.find(s => s.holder === id) ?? null;
}

export const NEED: Record<Level, { tier: Tier; count: number; text: string }> = {
  everyday: { tier: 'silver', count: 1, text: 'فضي واحد' },
  death: { tier: 'silver', count: 2, text: 'مفتاحان فضيان' },
  sensitive: { tier: 'gold', count: 1, text: 'ذهبي واحد' },
  critical: { tier: 'gold', count: 2, text: 'الذهبيان معًا' },
  trunk: { tier: 'platinum', count: 1, text: 'البلاتيني وذهبي من كل فرع' },
};

/** The main branch a change lands in. */
export function branchOf(g: Graph, id: string | undefined | null): string | null {
  if (!id) return null;
  return g.nodes.get(id)?.branch ?? null;
}

export interface CanApprove {
  ok: boolean;
  override?: boolean;
  why?: string;
}

/**
 * Whether `persona` may approve this request with their key: the right tier, in
 * the request's branch (the platinum anywhere). A key holder approves their own
 * requests and those about their own family too, like anyone else's.
 */
export function canApprove(g: Graph, seats: Seat[], persona: string | null, tx: Tx): CanApprove {
  if (!persona) return { ok: false, why: 'اختر من تكون أولًا' };
  if (tx.status !== 'pending') return { ok: false };
  // a request about someone no longer in the tree (or never in it): nothing to approve
  if (!g.nodes.has(tx.subject)) return { ok: false, why: 'من يخصه الطلب ليس في الشجرة' };
  if (tx.approvals.some(a => a.by === persona)) return { ok: false, why: 'اعتمدته مسبقًا' };
  const seat = seatOf(seats, persona);
  if (!seat) return { ok: false, why: 'الاعتماد لحاملي المفاتيح' };
  const need = NEED[tx.level];
  if (seat.tier === 'platinum') return { ok: true, override: need.tier !== 'platinum' };
  if (tx.level === 'trunk') {
    const has = tx.approvals.some(a => seatOf(seats, a.by)?.branch === seat.branch);
    return has ? { ok: false, why: 'اعتمد ذهبي من فرعك' } : seat.tier === 'gold' ? { ok: true } : { ok: false, why: 'يحتاج مفتاحًا ذهبيًا' };
  }
  if (seat.branch !== tx.branch) return { ok: false, why: 'المفاتيح لا تعمل خارج فرعها' };
  if (RANK[seat.tier] < RANK[need.tier]) return { ok: false, why: `يحتاج مفتاحًا ${TIER_AR[need.tier]}` };
  return { ok: true };
}

/** Whether a pending change now has every approval it needs. */
export function isComplete(g: Graph, seats: Seat[], tx: Tx): boolean {
  if (tx.approvals.some(a => a.override)) return true;
  const need = NEED[tx.level];
  if (tx.level === 'trunk') {
    const hasPlat = tx.approvals.some(a => seatOf(seats, a.by)?.tier === 'platinum');
    const branches = new Set(tx.approvals.map(a => seatOf(seats, a.by)?.branch).filter(Boolean));
    const withGolds = g.branches.filter(b => seats.some(x => x.tier === 'gold' && x.branch === b));
    return hasPlat && withGolds.every(b => branches.has(b));
  }
  const ok = tx.approvals.filter(a => {
    const s = seatOf(seats, a.by);
    return s && RANK[s.tier] >= RANK[need.tier];
  });
  return ok.length >= need.count;
}

/** Key holders who could approve, for the request card. */
export function approversFor(g: Graph, seats: Seat[], tx: Tx): Seat[] {
  return seats.filter(s => canApprove(g, seats, s.holder, tx).ok && !canApprove(g, seats, s.holder, tx).override);
}

/**
 * Whom one change in a request is about, among those in the tree: the person
 * changed or removed, a new person's parents, a marriage's two. Someone added
 * in the same request is not in the tree yet, and is left out.
 */
export function opPeople(g: Graph, op: Op): string[] {
  if (op.op === 'addMilk' || op.op === 'removeMilk') return [op.milk.child, op.milk.nurse, op.milk.father].filter((x): x is string => !!x && g.nodes.has(x));
  const m = op.op === 'updateMarriage' ? g.marriages.find(x => x.id === op.id) : 'marriage' in op ? op.marriage : null;
  const ids = op.op === 'addPerson' ? [op.person.father, op.person.mother] : op.op === 'removePerson' ? [op.person.id] : op.op === 'updatePerson' ? [op.id] : m ? [m.husband, m.wife] : [];
  return ids.filter((x): x is string => !!x && g.nodes.has(x));
}

const LEVELS: Level[] = ['everyday', 'death', 'sensitive', 'critical', 'trunk'];

/**
 * A request's level and branch, worked out from its changes and the tree as it
 * stands, the same on every phone: never taken from the request itself, which a
 * modified app could label as it liked. The level is the highest any of its
 * changes needs (the table in the design document); the branch is the one main
 * branch its changes are in, and changes in two or more need the whole trunk.
 * `linked`: whether someone has (or had) a phone of their own; `seats`: who
 * holds a key (a key holder's death needs more than two silvers).
 */
export function assess(g: Graph, ops: Op[], linked: (id: string) => boolean = () => false, seats: Seat[] = []): { level: Level; branch: string | null } {
  const homes = new Set<string>();
  let top = 0;
  for (const op of ops) {
    top = Math.max(top, LEVELS.indexOf(opLevel(g, op, ops, linked, seats)));
    const home = opHome(g, op);
    if (home) homes.add(home);
  }
  if (homes.size > 1) return { level: 'trunk', branch: null };
  return { level: LEVELS[top], branch: [...homes][0] ?? null };
}

/** The main branch one change is in: the person's, a new child's parent's, a marriage's husband's (the wife's when he is from outside). */
function opHome(g: Graph, op: Op): string | null {
  const node = (id: string | null | undefined) => (id ? g.nodes.get(id) : undefined);
  if (op.op === 'addPerson') {
    if (op.person.external) return null;
    const f = node(op.person.father), m = node(op.person.mother);
    return (f && !f.external ? f : m && !m.external ? m : (f ?? m))?.branch ?? null;
  }
  if (op.op === 'removePerson') return node(op.person.id)?.branch ?? null;
  if (op.op === 'updatePerson') return node(op.id)?.branch ?? null;
  // milk kinship: the child's branch (as a marriage goes to the husband's)
  if (op.op === 'addMilk' || op.op === 'removeMilk') return node(op.milk.child)?.branch ?? null;
  const mar = op.op === 'updateMarriage' ? g.marriages.find(x => x.id === op.id) : op.marriage;
  if (!mar) return null;
  const h = node(mar.husband), w = node(mar.wife);
  return (h && !h.external ? h : (w ?? h))?.branch ?? null;
}

/** What one change needs. */
function opLevel(g: Graph, op: Op, ops: Op[], linked: (id: string) => boolean, seats: Seat[]): Level {
  // the family's anchor and the main branches' founders: their records belong to everyone
  const trunk = (id: string) => id === g.root || g.branches.includes(id) || !!g.nodes.get(id)?.familyRoot;
  if (op.op === 'addPerson') {
    const p = op.person;
    if (p.familyRoot) return 'trunk';
    if (p.external) return 'everyday';
    // nobody in the tree to hang from (above the anchor, or a line of its own), or a new son of the anchor (a new main branch)
    if (!g.nodes.has(p.father ?? '') && !g.nodes.has(p.mother ?? '')) return 'trunk';
    return p.father === g.root ? 'trunk' : 'everyday';
  }
  if (op.op === 'removePerson') {
    const n = g.nodes.get(op.person.id);
    if (!n) return 'everyday';
    if (trunk(n.id)) return 'trunk';
    if (n.kids.length) return 'critical';
    return linked(n.id) || g.marriages.some(m => m.husband === n.id || m.wife === n.id) ? 'sensitive' : 'everyday';
  }
  if (op.op === 'updatePerson') {
    if (trunk(op.id)) return 'trunk';
    const n = g.nodes.get(op.id);
    if (!n) return 'everyday';
    let top = 0;
    for (const k of Object.keys(op.after) as (keyof typeof op.after)[]) top = Math.max(top, LEVELS.indexOf(fieldLevel(g, n, k, op.after, ops)));
    // a key holder's death: never two silvers alone, so that nobody is declared dead to
    // push him out of his seat (until elections, the whole trunk or the root admin)
    if (LEVELS[top] === 'death' && seats.some(x => x.holder === n.id)) return 'trunk';
    return LEVELS[top];
  }
  if (op.op === 'updateMarriage') {
    const keys = Object.keys(op.after);
    if (keys.every(k => k === 'year' || k === 'end' || k === 'sealed')) return 'everyday';
    // widowhood that goes with recording the spouse's death (or ends with undoing it): part of the death
    const m = g.marriages.find(x => x.id === op.id);
    if (m && keys.every(k => k === 'status' || k === 'year' || k === 'end' || k === 'sealed') && (op.after.status === 'widowed' || m.status === 'widowed') && ops.some(o => o.op === 'updatePerson' && (o.id === m.husband || o.id === m.wife) && records(g, o) === 'death')) return 'death';
    return 'sensitive';
  }
  return 'sensitive';
}

/** Whether a change to a person records a death or undoes one ('death'), or leaves that as it was (null). */
function records(g: Graph, op: Extract<Op, { op: 'updatePerson' }>): 'death' | null {
  const n = g.nodes.get(op.id);
  if (!n) return null;
  const was = !!(n.death || n.deceased);
  const death = 'death' in op.after ? op.after.death : n.death;
  const deceased = 'deceased' in op.after ? op.after.deceased : n.deceased;
  return was !== !!(death || deceased) ? 'death' : null;
}

/** What changing one field of a person needs. */
function fieldLevel(g: Graph, n: NonNullable<ReturnType<Graph['nodes']['get']>>, k: string, after: Extract<Op, { op: 'updatePerson' }>['after'], ops: Op[]): Level {
  switch (k) {
    case 'name':
    case 'aliases':
    case 'suffix':
    case 'birth':
    case 'uncertain':
    // a woman's details sealed with her key (her name, other names and years): whether she has died is `deceased`
    case 'sealed':
      return 'everyday';
    case 'death':
    case 'deceased':
      // recording a death, or undoing one; correcting its year is everyday
      return records(g, { op: 'updatePerson', id: n.id, before: {}, after }) ?? 'everyday';
    case 'mother': {
      // a child whose line runs through the mother: moving them is changing their line
      if (n.parent && n.parent === n.mother) return 'critical';
      const to = after.mother ?? null;
      const father = 'father' in after ? (after.father ?? null) : (n.father ?? null);
      // the mother named among the father's wives (or none): a child of a recorded marriage
      return !to || g.marriages.some(m => m.husband === father && m.wife === to) || ops.some(o => o.op === 'addMarriage' && o.marriage.husband === father && o.marriage.wife === to) ? 'everyday' : 'sensitive';
    }
    case 'father': {
      // a daughter's child: the outside husband named as the father (or none)
      const to = after.father ?? null;
      if (n.parent && n.parent === n.mother && (!to || (g.nodes.get(to)?.external && g.marriages.some(m => m.husband === to && m.wife === n.mother)))) return 'everyday';
      // otherwise the child's line (nasab) changes
      return 'critical';
    }
    case 'sex':
    case 'external':
      return 'sensitive';
    case 'familyRoot':
      return 'trunk';
    default:
      return 'critical';
  }
}

/**
 * Whether `by` may send requests about this person, under the family's limit
 * (`asks`: a kinship degree, 0 for no one, null for anyone). A key holder may
 * in their own branch, and the platinum holder anywhere.
 */
export function asksAbout(g: Graph, seats: Seat[], asks: number | null, by: string, id: string): boolean {
  if (asks === null) return true;
  const seat = seatOf(seats, by);
  if (seat?.tier === 'platinum' || (seat && g.nodes.get(id)?.branch === seat.branch)) return true;
  const k = asks > 0 ? kin(g, by, id) : null;
  return !!k && k.deg <= asks;
}

/** Whether a request stays within the limit: each of its changes is about someone `by` may send requests about. */
export function mayAsk(g: Graph, seats: Seat[], asks: number | null, by: string, ops: Op[]): boolean {
  if (asks === null) return true;
  const who = ops.map(op => opPeople(g, op));
  return who.some(x => x.length > 0) && who.every(x => !x.length || x.some(id => asksAbout(g, seats, asks, by, id)));
}
