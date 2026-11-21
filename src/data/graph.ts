// The family graph, rebuilt in memory from the seed data plus every approved change.
import type { FamilyData, Marriage, Milk, Op, Person, Tx } from './types';
import { gYear, THIS_YEAR } from './dates';

export interface Node extends Person {
  /** Parent in the tree: the father, or the mother when the father is from outside. */
  parent: string | null;
  kids: string[];
  gen: number;
  branch: string | null;
  /** The house used for colour: the first level where the family really splits. */
  house: string | null;
  desc: number;
  by: number | null;
  dead: boolean;
}

export interface Graph {
  family: FamilyData['family'];
  root: string;
  nodes: Map<string, Node>;
  /** Marriages whose husband and wife are both recorded. */
  marriages: Marriage[];
  /** Milk kinship records whose child and nurse are both recorded (design document 1.36). */
  milk: Milk[];
  /** People in the tree; spouses from outside are recorded by name only and not counted. */
  members: number;
  maxGen: number;
  /** Main branches, marked by the root admin; until then the root's sons. */
  branches: string[];
  /** Houses used for colour in the tree. */
  houses: string[];
}

/** What a marriage change may touch: never who married whom. */
const MARRIAGE_FIELDS = ['status', 'year', 'end', 'sealed'] as const;

export function applyTxs(base: FamilyData, txs: Tx[]): FamilyData {
  const people = new Map(base.people.map(p => [p.id, { ...p }]));
  const marriages = base.marriages.map(m => ({ ...m }));
  const milk = (base.milk ?? []).map(m => ({ ...m }));
  for (const tx of txs) {
    if (tx.status !== 'approved') continue;
    for (const op of tx.ops) {
      if (op.op === 'addPerson') people.set(op.person.id, { ...op.person });
      else if (op.op === 'removePerson') people.delete(op.person.id);
      else if (op.op === 'updatePerson') {
        const p = people.get(op.id) as Record<string, unknown> | undefined;
        if (p) for (const [k, v] of Object.entries(op.after)) if (v === null) delete p[k]; else p[k] = v;
      } else if (op.op === 'addMarriage') {
        if (!marriages.some(m => m.id === op.marriage.id)) marriages.push({ ...op.marriage });
      } else if (op.op === 'updateMarriage') {
        const m = marriages.find(x => x.id === op.id) as Record<string, unknown> | undefined;
        for (const k of MARRIAGE_FIELDS) {
          if (!m || !(k in op.after)) continue;
          const v = op.after[k];
          if (v == null) delete m[k];
          else m[k] = v;
        }
      } else if (op.op === 'removeMarriage') {
        const i = marriages.findIndex(x => x.id === op.marriage.id);
        if (i >= 0) marriages.splice(i, 1);
      } else if (op.op === 'addMilk') {
        if (!milk.some(m => m.id === op.milk.id)) milk.push({ ...op.milk });
      } else if (op.op === 'removeMilk') {
        const i = milk.findIndex(x => x.id === op.milk.id);
        if (i >= 0) milk.splice(i, 1);
      }
    }
  }
  return { ...base, people: [...people.values()], marriages, ...(milk.length ? { milk } : {}) };
}

export function buildGraph(data: FamilyData, mains?: string[]): Graph {
  const nodes = new Map<string, Node>();
  for (const p of data.people) {
    nodes.set(p.id, { ...p, parent: null, kids: [], gen: 0, branch: null, house: null, desc: 0, by: gYear(p.birth), dead: false });
  }
  for (const n of nodes.values()) {
    const f = n.father ? nodes.get(n.father) : undefined;
    const m = n.mother ? nodes.get(n.mother) : undefined;
    if (f && !f.external) n.parent = f.id;
    else if (m && !m.external) n.parent = m.id;
    if (n.parent) nodes.get(n.parent)!.kids.push(n.id);
  }
  // generations, from the family anchor; everyone under a main branch's founder
  // belongs to it, and anyone above the founders is the trunk
  const root = data.root;
  const branches = mains?.filter(id => nodes.has(id)) ?? nodes.get(root)!.kids.filter(k => nodes.get(k)!.sex === 'm');
  let maxGen = 0;
  const walk = (id: string, g: number, branch: string | null) => {
    const n = nodes.get(id)!;
    n.gen = g;
    n.branch = branches.includes(id) ? id : branch;
    maxGen = Math.max(maxGen, g);
    n.kids.sort((a, b) => (nodes.get(a)!.by ?? 9999) - (nodes.get(b)!.by ?? 9999));
    for (const k of n.kids) walk(k, g + 1, n.branch);
    n.desc = n.kids.reduce((s, k) => s + 1 + nodes.get(k)!.desc, 0);
  };
  walk(root, 0, null);
  for (const n of nodes.values()) {
    n.dead = !!n.deceased || !!n.death || (n.by != null && THIS_YEAR - n.by > 110);
  }
  // Colour by house: go down while only one line carries descendants, so a
  // family entered for one branch still shows its houses in different colours.
  let top = nodes.get(root)!;
  for (;;) {
    const lines = top.kids.filter(k => nodes.get(k)!.kids.length > 0);
    if (lines.length !== 1) break;
    top = nodes.get(lines[0])!;
  }
  const houses = top.kids.filter(k => nodes.get(k)!.kids.length > 0);
  const setHouse = (id: string, h: string | null) => {
    const n = nodes.get(id)!;
    n.house = h;
    for (const k of n.kids) setHouse(k, h ?? (houses.includes(k) ? k : null));
  };
  setHouse(root, null);
  // A spouse from outside is not in the tree; they stand with the one they
  // married (generation, branch and colour), as a wife from outside belongs to
  // her husband's branch.
  const marriages = data.marriages.filter(m => nodes.has(m.husband) && nodes.has(m.wife));
  const placed = new Set<string>();
  for (const m of marriages) {
    for (const [a, b] of [[m.husband, m.wife], [m.wife, m.husband]]) {
      const x = nodes.get(a)!, y = nodes.get(b)!;
      if (!x.external || y.external || placed.has(a)) continue;
      placed.add(a);
      Object.assign(x, { gen: y.gen, branch: y.branch, house: y.house });
    }
  }
  // milk kinship: a milk father must be in the tree too; a nurse from outside who
  // married no one in it stands with the child she nursed, a generation above him
  const milk = (data.milk ?? []).filter(m => nodes.has(m.child) && nodes.has(m.nurse)).map(m => (m.father && !nodes.has(m.father) ? (({ father, ...rest }) => (void father, rest))(m) : m));
  for (const m of milk) {
    const x = nodes.get(m.nurse)!, c = nodes.get(m.child)!;
    if (!x.external || placed.has(m.nurse)) continue;
    placed.add(m.nurse);
    Object.assign(x, { gen: Math.max(0, c.gen - 1), branch: c.branch, house: c.house });
  }
  let members = 0;
  for (const n of nodes.values()) if (!n.external) members++;
  return { family: data.family, root, nodes, marriages, milk, members, maxGen, branches, houses };
}

// ---- helpers used everywhere

/** In the tree through the mother: the father is from outside the family, or not recorded. */
export function viaMother(n: Node): boolean {
  return !!n.parent && n.parent === n.mother;
}

/** A name on its own, with the word that tells apart brothers of the same name («أحمد الثاني»). */
export function shownName(n: Pick<Person, 'name' | 'suffix'>): string {
  return n.suffix ? `${n.name} ${n.suffix}` : n.name;
}

/**
 * A name inside a chain of names: a compound name in brackets, so «بن (محمد
 * سعيد) بن علي» reads as one person. A spouse from outside keeps the full name
 * as entered.
 */
export function unit(n: Pick<Person, 'name' | 'suffix' | 'external'>): string {
  const name = n.name.trim();
  const core = !n.external && /\s/.test(name) ? `(${name})` : name;
  return n.suffix ? `${core} ${n.suffix}` : core;
}

/**
 * The chain of fathers' names. Someone in the tree through their mother ends
 * it with their father from outside, by the full name he was recorded with
 * (his line is not ours), or nowhere when he is not recorded.
 * `plain`: the names alone, as search matches them.
 */
export function nasab(g: Graph, id: string, depth = 4, plain = false): string {
  const n = g.nodes.get(id)!;
  const parts: string[] = [];
  let c: Node | undefined = n;
  let i = 0;
  while (c && c.parent && i < depth) {
    const word = c.sex === 'f' && i === 0 ? 'بنت ' : 'بن ';
    if (viaMother(c)) {
      const f = fatherOutside(g, c);
      if (f) parts.push(word + (plain ? f.name : unit(f)));
      break;
    }
    const p: Node = g.nodes.get(c.parent)!;
    if (p.familyRoot) break;
    parts.push(word + (plain ? p.name : unit(p)));
    c = p;
    i++;
  }
  return parts.join(' ');
}

/**
 * A daughter's child's father from outside the family, who follows the child's
 * name; not when the name was typed in full, with its «بن» or «بنت».
 */
export function fatherOutside(g: Graph, n: Node): Node | undefined {
  const f = n.father ? g.nodes.get(n.father) : undefined;
  return f?.external && viaMother(n) && !typedInFull(n.name) ? f : undefined;
}

/** A name typed in full, with its «بن» or «بنت»: shown as typed. */
export function typedInFull(name: string): boolean {
  return /\s(بن|بنت)\s/.test(` ${name.trim()} `);
}

/** The family's name, for those whose father's line is the family's (not a daughter's children, nor a spouse from outside). */
export function surname(g: Graph, id: string): string {
  for (let c = g.nodes.get(id); c && !c.familyRoot; c = c.parent ? g.nodes.get(c.parent) : undefined) {
    if (c.external || viaMother(c)) return '';
  }
  return g.family.name;
}

export function fullName(g: Graph, id: string, depth = 3): string {
  const n = g.nodes.get(id)!;
  return [unit(n), nasab(g, id, depth), surname(g, id)].filter(Boolean).join(' ');
}

export function ancestorsOf(g: Graph, id: string): string[] {
  const out: string[] = [];
  let c = g.nodes.get(id)!.parent;
  while (c) {
    out.push(c);
    c = g.nodes.get(c)!.parent;
  }
  return out;
}

export function marriagesOf(g: Graph, id: string): Marriage[] {
  return g.marriages.filter(m => m.husband === id || m.wife === id).sort((a, b) => (gYear(a.year) ?? 0) - (gYear(b.year) ?? 0));
}

export function siblingsOf(g: Graph, id: string): string[] {
  const n = g.nodes.get(id)!;
  if (!n.parent) return [];
  return g.nodes.get(n.parent)!.kids.filter(k => k !== id);
}

export interface Family {
  spouse: string | null;
  marriage: Marriage | null;
  kids: string[];
}

/**
 * Children grouped by the other parent, in the order of marriages. A couple
 * married twice keeps their children under the latest marriage; a parent with
 * no marriage recorded still gets their own group.
 */
export function familiesOf(g: Graph, id: string): Family[] {
  const ms = marriagesOf(g, id);
  const other = (k: Node) => (k.father === id ? k.mother : k.father);
  const kidsAll = [...g.nodes.values()].filter(k => k.father === id || k.mother === id).sort((a, b) => (a.by ?? 9999) - (b.by ?? 9999));
  const out: Family[] = ms.map((m, i) => {
    const spouse = m.husband === id ? m.wife : m.husband;
    const later = ms.slice(i + 1).some(x => x.husband === m.husband && x.wife === m.wife);
    return { spouse, marriage: m, kids: later ? [] : kidsAll.filter(k => other(k) === spouse).map(k => k.id) };
  });
  const placed = new Set(out.flatMap(f => f.kids));
  for (const k of kidsAll) {
    const o = other(k);
    if (placed.has(k.id) || !o || !g.nodes.has(o)) continue;
    let f = out.find(x => x.spouse === o);
    if (!f) out.push((f = { spouse: o, marriage: null, kids: [] }));
    f.kids.push(k.id);
    placed.add(k.id);
  }
  const rest = kidsAll.filter(k => !placed.has(k.id)).map(k => k.id);
  if (rest.length) out.push({ spouse: null, marriage: null, kids: rest });
  return out;
}

/** A person's own record, without what the graph works out from it. */
export function personRecord(g: Graph, id: string): Person {
  const { parent, kids, gen, branch, house, desc, by, dead, ...person } = g.nodes.get(id)!;
  void parent; void kids; void gen; void branch; void house; void desc; void by; void dead;
  return person;
}

/** Whether a change touches this person: their record, one of their marriages, or a milk record of theirs. */
export function opTouches(g: Graph, op: Op, id: string): boolean {
  if (op.op === 'addPerson' || op.op === 'removePerson') return op.person.id === id;
  if (op.op === 'updatePerson') return op.id === id;
  if (op.op === 'addMilk' || op.op === 'removeMilk') return milkPeople(op.milk).includes(id);
  const m = op.op === 'updateMarriage' ? g.marriages.find(x => x.id === op.id) : op.marriage;
  return !!m && (m.husband === id || m.wife === id);
}

// ---- milk kinship (design document 1.36)

/** The people a milk record names: the child, the nurse, the milk father if known. */
export function milkPeople(m: Milk): string[] {
  return m.father ? [m.child, m.nurse, m.father] : [m.child, m.nurse];
}

/** A child's milk records. */
export function milkOf(g: Graph, child: string): Milk[] {
  return g.milk.filter(m => m.child === child);
}

/** Someone's milk parents: the nurse and the milk father of each record (the nurse first). */
export function milkParentsOf(g: Graph, child: string): string[] {
  return g.milk.filter(m => m.child === child).flatMap(milkPeople).filter(x => x !== child);
}

/** Those a woman nursed, or whose milk father a man is. */
export function milkKidsOf(g: Graph, id: string): string[] {
  return [...new Set(g.milk.filter(m => m.nurse === id || m.father === id).map(m => m.child))];
}

/**
 * Someone's milk brothers and sisters: the other children of his milk parents,
 * their own and those they nursed or fathered by milk, from any wife.
 */
export function milkSiblingsOf(g: Graph, child: string): string[] {
  const out = new Set<string>();
  for (const p of milkParentsOf(g, child)) {
    for (const k of g.nodes.get(p)?.kids ?? []) out.add(k);
    for (const n of g.nodes.values()) if (n.father === p || n.mother === p) out.add(n.id);
    for (const k of milkKidsOf(g, p)) out.add(k);
  }
  out.delete(child);
  return [...out].filter(id => g.nodes.has(id) && !g.nodes.get(id)!.external);
}

export function displayName(g: Graph, id: string): string {
  return g.nodes.get(id)!.name;
}

let seq = 0;
export function newId(prefix: string): string {
  seq++;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}
