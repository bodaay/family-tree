// Kinship degrees counted as for GCC bereavement leave: links up to the common
// ancestor and down again. Spouses count as 1st degree; in-laws take the degree
// they have through the spouse. The closest path wins (kin, for privacy and the
// limits on requests); every path is listed by `routes` (design document 1.33).
import type { Graph } from './graph';

// milk kinship, here without importing graph.ts (Node's own tests load this file without a bundler)
const milkParentsOf = (g: Graph, id: string): string[] => (g.milk ?? []).filter(m => m.child === id).flatMap(m => (m.father ? [m.nurse, m.father] : [m.nurse]));
const milkKidsOf = (g: Graph, id: string): string[] => [...new Set((g.milk ?? []).filter(m => m.nurse === id || m.father === id).map(m => m.child))];

interface Up {
  d: number;
  prev: string | null;
}

function parentsOf(g: Graph, id: string): string[] {
  const n = g.nodes.get(id);
  const out: string[] = [];
  if (!n) return out;
  if (n.father && g.nodes.has(n.father)) out.push(n.father);
  if (n.mother && g.nodes.has(n.mother)) out.push(n.mother);
  return out;
}

function ancestors(g: Graph, start: string): Map<string, Up> {
  const A = new Map<string, Up>([[start, { d: 0, prev: null }]]);
  const q = [start];
  while (q.length) {
    const u = q.shift()!;
    const du = A.get(u)!.d;
    for (const v of parentsOf(g, u)) {
      if (!A.has(v)) {
        A.set(v, { d: du + 1, prev: u });
        q.push(v);
      }
    }
  }
  return A;
}

export interface Blood {
  d: number;
  lca: string;
  A: Map<string, Up>;
  B: Map<string, Up>;
}

export function blood(g: Graph, a: string, b: string): Blood | null {
  const A = ancestors(g, a), B = ancestors(g, b);
  let best: Blood | null = null;
  for (const [k, va] of A) {
    const vb = B.get(k);
    if (!vb) continue;
    const d = va.d + vb.d;
    if (!best || d < best.d) best = { d, lca: k, A, B };
  }
  return best;
}

/** The line from the start person up to the common ancestor: [start, ..., lca]. */
function chain(A: Map<string, Up>, lca: string): string[] {
  const out: string[] = [];
  let c: string | null = lca;
  while (c !== null) {
    out.push(c);
    c = A.get(c)!.prev;
  }
  return out.reverse();
}

export interface Kin {
  deg: number;
  kind: 'blood' | 'spouse' | 'inlaw' | 'milk';
  via?: string;
  bl?: Blood;
  path: string[];
}

function spousesOf(g: Graph, id: string): string[] {
  return g.marriages.filter(m => m.husband === id || m.wife === id).map(m => (m.husband === id ? m.wife : m.husband));
}

const cache = new Map<string, Kin | null>();
let cacheGraph: Graph | null = null;

/** How two people are related; null if they are not, or either is not in the tree (a request may name anyone). */
export function kin(g: Graph, a: string, b: string): Kin | null {
  if (!g.nodes.has(a) || !g.nodes.has(b)) return null;
  if (cacheGraph !== g) {
    cache.clear();
    cacheGraph = g;
  }
  const key = a + '|' + b;
  if (cache.has(key)) return cache.get(key)!;
  let best: Kin | null = null;
  const consider = (k: Kin) => {
    if (!best || k.deg < best.deg) best = k;
  };
  if (a === b) best = { deg: 0, kind: 'blood', path: [a] };
  else {
    const bl = blood(g, a, b);
    if (bl) consider({ deg: bl.d, kind: 'blood', bl, path: [...chain(bl.A, bl.lca), ...chain(bl.B, bl.lca).reverse().slice(1)] });
    if (spousesOf(g, a).includes(b)) consider({ deg: 1, kind: 'spouse', path: [a, b] });
    for (const s of spousesOf(g, b)) {
      if (s === a) continue;
      const x = blood(g, a, s);
      if (x) consider({ deg: x.d, kind: 'inlaw', via: s, bl: x, path: [...chain(x.A, x.lca), ...chain(x.B, x.lca).reverse().slice(1), b] });
    }
    for (const s of spousesOf(g, a)) {
      if (s === b) continue;
      const x = blood(g, s, b);
      if (x) consider({ deg: x.d, kind: 'inlaw', via: s, bl: x, path: [a, ...chain(x.A, x.lca), ...chain(x.B, x.lca).reverse().slice(1)] });
    }
    // milk kinship, for the milk child himself (design document 1.36): his milk
    // parents count as his parents, and whoever else they nursed as his siblings
    for (const p of milkParentsOf(g, a)) {
      if (p === b) consider({ deg: 1, kind: 'milk', via: p, path: [a, b] });
      else if (milkKidsOf(g, p).includes(b)) consider({ deg: 2, kind: 'milk', via: p, path: [a, p, b] });
      const x = blood(g, p, b);
      if (x) consider({ deg: x.d + 1, kind: 'milk', via: p, bl: x, path: [a, ...chain(x.A, x.lca), ...chain(x.B, x.lca).reverse().slice(1)] });
    }
  }
  cache.set(key, best);
  return best;
}

// ---- Arabic terms

function termBlood(g: Graph, a: string, b: string, bl: Blood): string | null {
  return termLine(g, a, b, chain(bl.A, bl.lca), chain(bl.B, bl.lca));
}

/** The word for b as a sees them, along one line: pa = [a, …, top], pb = [b, …, top]. */
function termLine(g: Graph, a: string, b: string, pa: string[], pb: string[], depth = 0): string | null {
  const up = pa.length - 1, down = pb.length - 1;
  const N = (id: string) => g.nodes.get(id)!;
  const m = N(b).sex === 'm';
  const side = up >= 1 ? N(pa[1]).sex : null; // the parent we go up through
  if (up === 0 && down === 1) return m ? 'ابن' : 'ابنة';
  if (up === 0 && down === 2) return m ? 'حفيد' : 'حفيدة';
  if (up === 0) return m ? 'من الأحفاد' : 'من الحفيدات';
  if (up === 1 && down === 0) return m ? 'أب' : 'أم';
  if (up === 2 && down === 0) return m ? 'جد' : 'جدة';
  if (up === 3 && down === 0) return (m ? 'جد ' : 'جدة ') + (side === 'm' ? 'الأب' : 'الأم');
  if (down === 0) return m ? 'جد أعلى' : 'جدة عليا';
  if (up === 1 && down === 1) {
    const A = N(a), B = N(b);
    if (A.father && A.father === B.father && A.mother && A.mother === B.mother) return m ? 'أخ شقيق' : 'أخت شقيقة';
    if (A.father && A.father === B.father) return m ? 'أخ' : 'أخت';
    return m ? 'أخ لأم' : 'أخت لأم';
  }
  if (up === 2 && down === 1) return side === 'm' ? (m ? 'عم' : 'عمة') : m ? 'خال' : 'خالة';
  if (up === 1 && down === 2) {
    const sib = N(pb[down - 1]);
    return (m ? 'ابن ' : 'بنت ') + (sib.sex === 'm' ? 'أخ' : 'أخت');
  }
  if (up === 2 && down === 2) {
    const mid = N(pb[down - 1]);
    const w = side === 'm' ? (mid.sex === 'm' ? 'عم' : 'عمة') : mid.sex === 'm' ? 'خال' : 'خالة';
    return (m ? 'ابن ' : 'بنت ') + w;
  }
  if (up === 3 && down === 1) {
    const g2 = N(pa[2]);
    const w = m ? (g2.sex === 'm' ? 'عم' : 'خال') : g2.sex === 'm' ? 'عمة' : 'خالة';
    return `${w} ${side === 'm' ? 'الأب' : 'الأم'}`;
  }
  if (depth < 2 && up >= down && up >= 3) {
    // the relation of my parent along this line, e.g. "ابن عم الأب"
    const t = termLine(g, pa[1], b, pa.slice(1), pb, depth + 1);
    if (t) return `${t} ${side === 'm' ? 'الأب' : 'الأم'}`;
  }
  if (depth < 2 && down > up && down >= 3) {
    // the child of my relative along this line, e.g. "ابن ابن العم"
    const t = termLine(g, a, pb[1], pa, pb.slice(1), depth + 1);
    if (t) return `${m ? 'ابن' : 'بنت'} ${t}`;
  }
  return null;
}

export function termFor(g: Graph, a: string, b: string, k: Kin): string {
  const m = g.nodes.get(b)!.sex === 'm';
  if (a === b) return 'أنت';
  if (k.kind === 'spouse') return m ? 'زوج' : 'زوجة';
  if (k.kind === 'blood' && k.bl) return termBlood(g, a, b, k.bl) ?? (m ? 'قريب' : 'قريبة');
  if (k.kind === 'milk') return headline(routes(g, a, b).filter(r => r.kind === 'milk')) || (m ? 'قريب من الرضاعة' : 'قريبة من الرضاعة');
  return m ? 'قريب بالمصاهرة' : 'قريبة بالمصاهرة';
}

const ORD = ['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة', 'الحادية عشرة', 'الثانية عشرة'];
/** «الثالثة», «السادسة»: a degree as its ordinal. */
export function degreeWord(d: number): string {
  return ORD[d] ?? String(d);
}
export function degreeText(d: number): string {
  return `قرابة من الدرجة ${ORD[d] ?? d}`;
}

// ---- every path between two people

/**
 * One way two people are related. Blood: two lines up that meet in a common
 * ancestor (or in a couple, the two parents of the one below on both lines),
 * touching nowhere else and passing no other ancestor both share. A marriage:
 * the spouse. Through a marriage: the spouse's own relative, or the relative's
 * spouse.
 */
export interface Route {
  kind: 'blood' | 'spouse' | 'inlaw' | 'milk';
  deg: number;
  /** Blood: the common ancestor, or the couple (the father first). */
  top: string[];
  /** Blood: a's line up and b's, each from them to just below the top. */
  up: string[];
  down: string[];
  /** Through a marriage: the spouse it runs through. */
  via?: string;
  /** Everyone on it, from a to b (through the first of a couple): for the tree view. */
  path: string[];
  term: string;
  /** Which of a's parents it goes up through ('f' the father, 'm' the mother), or none. */
  side: 'f' | 'm' | null;
  /** And which of b's: a cousin through his mother may be related again through his father. */
  bside: 'f' | 'm' | null;
  /** Milk: the steps from a nursed child up to a milk parent, as [child, parent] (design document 1.36). */
  milk?: [string, string][];
}

/**
 * Every line up from someone to each of their ancestors, [start, …, ancestor]: a
 * few per ancestor, so a family married within itself stays quick. With `milk`,
 * a line may also go up from a nursed child to his milk parents.
 */
function lines(g: Graph, start: string, cap = 16, milk = false): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  const up = (id: string) => (milk ? [...new Set([...parentsOf(g, id), ...milkParentsOf(g, id)])] : parentsOf(g, id));
  const walk = (path: string[]) => {
    const top = path[path.length - 1];
    let list = out.get(top);
    if (!list) out.set(top, (list = []));
    if (list.length >= cap) return;
    list.push(path);
    if (path.length > 24) return;
    for (const p of up(top)) if (!path.includes(p)) walk([...path, p]);
  };
  walk([start]);
  return out;
}

/**
 * Each way two people meet in a common ancestor: a line up from each that
 * share no one below the top. Two lines that share someone meet lower down,
 * in that one, and that meeting counts instead. A line that only passes someone
 * the other also comes from by another way is a path of its own (design
 * document 1.34): a cousin through his mother, the grandfather's grandson,
 * can be related as well through his father, by a long line to the founder.
 * But a line that goes up through a parent the other shares (brothers and
 * sisters) would only tell how their parents are related: not counted.
 */
function meetings(g: Graph, a: string, b: string, milk = false): { pa: string[]; pb: string[] }[] {
  const LA = lines(g, a, 16, milk), LB = lines(g, b, 16, milk);
  const ofA = new Set(milk ? [...parentsOf(g, a), ...milkParentsOf(g, a)] : parentsOf(g, a));
  const ofB = new Set(milk ? [...parentsOf(g, b), ...milkParentsOf(g, b)] : parentsOf(g, b));
  const out: { pa: string[]; pb: string[] }[] = [];
  for (const [c, pas] of LA) {
    const pbs = LB.get(c);
    if (!pbs) continue;
    for (const pa of pas) {
      const below = new Set(pa.slice(0, -1));
      if (pa.slice(1, -1).some(x => ofB.has(x))) continue;
      for (const pb of pbs) if (!pb.slice(0, -1).some(x => below.has(x)) && !pb.slice(1, -1).some(x => ofA.has(x))) out.push({ pa, pb });
    }
  }
  return out;
}

/** The blood routes between two people: meetings in the two parents of one child are one route, through the couple. */
function bloodRoutes(g: Graph, a: string, b: string, milk = false): { pa: string[]; pb: string[]; top: string[] }[] {
  const groups = new Map<string, { pa: string[]; pb: string[]; top: string[] }>();
  // with milk: only the lines that take a milk step somewhere (the others are blood routes)
  for (const m of meetings(g, a, b, milk).filter(m => !milk || milkSteps(g, m.pa).length + milkSteps(g, m.pb).length > 0)) {
    const key = m.pa.slice(0, -1).join(',') + '|' + m.pb.slice(0, -1).join(',');
    const top = m.pa[m.pa.length - 1];
    const gr = groups.get(key);
    if (!gr) groups.set(key, { ...m, top: [top] });
    else if (!gr.top.includes(top)) gr.top.push(top);
  }
  for (const gr of groups.values()) {
    // the father first, and the lines through him
    gr.top.sort((x, y) => +(g.nodes.get(x)?.sex === 'f') - +(g.nodes.get(y)?.sex === 'f'));
    gr.pa = [...gr.pa.slice(0, -1), gr.top[0]];
    gr.pb = [...gr.pb.slice(0, -1), gr.top[0]];
  }
  return [...groups.values()];
}

/** The steps of a line that go from a nursed child to a milk parent (not a parent by birth). */
function milkSteps(g: Graph, line: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < line.length; i++) if (!parentsOf(g, line[i]).includes(line[i + 1])) out.push([line[i], line[i + 1]]);
  return out;
}

/** The word for b along a line with a milk step: as by birth, without «شقيق» or «لأم», and «من الرضاعة». */
function termMilk(g: Graph, a: string, b: string, pa: string[], pb: string[]): string {
  const m = g.nodes.get(b)!.sex === 'm';
  const up = pa.length - 1, down = pb.length - 1;
  const t = up === 1 && down === 1 ? (m ? 'أخ' : 'أخت') : termLine(g, a, b, pa, pb);
  if (!t) return m ? 'قريب من الرضاعة' : 'قريبة من الرضاعة';
  return t.replace(/ (شقيقة?|لأم)\b/g, '') + ' من الرضاعة';
}

/** Which parent a line goes up through, when it goes on above them (brothers and sisters meet in the parents themselves). */
const sideOf = (g: Graph, line: string[]): 'f' | 'm' | null => (line.length > 2 ? (g.nodes.get(line[1])!.sex === 'm' ? 'f' : 'm') : null);

const routeCache = new Map<string, Route[]>();
let routeGraph: Graph | null = null;

/**
 * Every way b is related to a, the closest first (at one degree: the marriage,
 * then blood, the fathers' line first, then through a marriage). At most `max`.
 */
export function routes(g: Graph, a: string, b: string, max = 12): Route[] {
  if (a === b || !g.nodes.has(a) || !g.nodes.has(b)) return [];
  if (routeGraph !== g) {
    routeCache.clear();
    routeGraph = g;
  }
  const key = a + '|' + b + '|' + max;
  const hit = routeCache.get(key);
  if (hit) return hit;
  const N = (id: string) => g.nodes.get(id)!;
  const male = N(b).sex === 'm';
  const out: Route[] = [];
  if (spousesOf(g, a).includes(b)) out.push({ kind: 'spouse', deg: 1, top: [], up: [a], down: [b], path: [a, b], term: male ? 'زوج' : 'زوجة', side: null, bside: null });
  const blood = bloodRoutes(g, a, b)
    .map(r => {
      const deg = r.pa.length - 1 + r.pb.length - 1;
      const term = termLine(g, a, b, r.pa, r.pb) ?? (male ? 'قريب' : 'قريبة');
      const route: Route = { kind: 'blood', deg, top: r.top, up: r.pa.slice(0, -1), down: r.pb.slice(0, -1), path: [...r.pa, ...r.pb.slice(0, -1).reverse()], term, side: sideOf(g, r.pa), bside: sideOf(g, r.pb) };
      return { route, fathers: r.pa.slice(1, -1).every(x => N(x).sex === 'm') && r.pb.slice(1, -1).every(x => N(x).sex === 'm') };
    })
    .sort((x, y) => x.route.deg - y.route.deg || +y.fathers - +x.fathers)
    .map(x => x.route);
  out.push(...blood);
  // milk kinship (design document 1.36): lines that go up from a nursed child to his milk parents
  for (const r of bloodRoutes(g, a, b, true)) {
    const steps = [...milkSteps(g, r.pa), ...milkSteps(g, r.pb)];
    out.push({ kind: 'milk', deg: r.pa.length - 1 + r.pb.length - 1, top: r.top, up: r.pa.slice(0, -1), down: r.pb.slice(0, -1), path: [...r.pa, ...r.pb.slice(0, -1).reverse()], term: termMilk(g, a, b, r.pa, r.pb), side: sideOf(g, r.pa), bside: sideOf(g, r.pb), milk: steps });
  }
  // through a marriage: the closest route to each spouse's relatives
  const closest = (x: string, y: string) => bloodRoutes(g, x, y).sort((p, q) => p.pa.length + p.pb.length - (q.pa.length + q.pb.length))[0];
  for (const s of spousesOf(g, b)) {
    if (s === a) continue;
    const r = closest(a, s);
    if (!r) continue;
    const t = termLine(g, a, s, r.pa, r.pb);
    out.push({ kind: 'inlaw', deg: r.pa.length + r.pb.length - 2, top: r.top, up: r.pa.slice(0, -1), down: r.pb.slice(0, -1), via: s, path: [...r.pa, ...r.pb.slice(0, -1).reverse(), b], term: t ? `${male ? 'زوج' : 'زوجة'} ${t}` : male ? 'قريب بالمصاهرة' : 'قريبة بالمصاهرة', side: sideOf(g, r.pa), bside: null });
  }
  for (const s of spousesOf(g, a)) {
    if (s === b) continue;
    const r = closest(s, b);
    if (!r) continue;
    const t = termLine(g, s, b, r.pa, r.pb);
    out.push({ kind: 'inlaw', deg: r.pa.length + r.pb.length - 2, top: r.top, up: r.pa.slice(0, -1), down: r.pb.slice(0, -1), via: s, path: [a, ...r.pa, ...r.pb.slice(0, -1).reverse()], term: t ? `${t} ${N(a).sex === 'm' ? 'الزوجة' : 'الزوج'}` : male ? 'قريب بالمصاهرة' : 'قريبة بالمصاهرة', side: null, bside: null });
  }
  const order = { spouse: 0, blood: 1, milk: 2, inlaw: 3 };
  const list = out
    .map((r, i) => ({ r, i }))
    .sort((x, y) => x.r.deg - y.r.deg || order[x.r.kind] - order[y.r.kind] || x.i - y.i)
    .map(x => x.r)
    .slice(0, max);
  routeCache.set(key, list);
  return list;
}

/**
 * What b is to a in one line: the marriage between them, each blood relation at
 * the closest blood degree, and any relation through a marriage closer than
 * that, the closest first, joined.
 */
export function headline(rs: Route[]): string {
  const least = (k: Route['kind']) => Math.min(Infinity, ...rs.filter(r => r.kind === k).map(r => r.deg));
  const nearest = least('blood'), byMilk = least('milk'), closeIn = least('inlaw');
  // milk relations at their closest, unless blood is closer; through a marriage, only closer than both
  const pick = rs.filter(r => r.kind === 'spouse' || (r.kind === 'blood' && r.deg === nearest) || (r.kind === 'milk' && r.deg === byMilk && byMilk <= nearest) || (r.kind === 'inlaw' && r.deg < Math.min(nearest, byMilk) && r.deg === closeIn));
  const words = [...new Set(pick.map(r => r.term))];
  return words.length > 1 ? words.slice(0, -1).join('، ') + '، و' + words[words.length - 1] : (words[0] ?? '');
}

/**
 * A milk relation that would bar a marriage between two people if it were by
 * birth (design document 1.36): one of them a milk ancestor of the other, milk
 * brothers and sisters and their descendants, a milk parent's brothers and
 * sisters. The app does not rule: a marriage between them is sent with a
 * warning, and those who approve it decide. Null when there is none.
 */
export function milkProblem(g: Graph, a: string, b: string): Route | null {
  return routes(g, a, b).find(r => r.kind === 'milk' && Math.min(r.up.length, r.down.length) <= 1) ?? null;
}
