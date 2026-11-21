// What an export draws, from what this phone sees (design document, Section 9,
// exporting the tree): who may export what, the people with their names and
// years as this phone may show them, the colours of the houses, the layout
// chosen for the paper, and its pages. A key holder of gold exports their own
// main branch, with the line above it up to the founder; the platinum holder
// and the root admin, anything.
import { canSee, viewer, type State } from '../data/store';
import { nasab, shownName } from '../data/graph';
import { branchOf } from '../data/governance';
import { gToH, hToG } from '../data/dates';
import type { Cal, Year } from '../data/types';
import { layout, type Chart, type Shape } from './layout';
import { cut } from './sheets';
import { tones, type Scheme, type Tone } from './palette';
import { page, poster, sheetFrame, sheetPages, size, PT, type PosterIn, type Sheet, type Stamp, type Who } from './poster';
import type { Shaper } from './text';

export type Paper = 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
export const PAPERS: Record<Paper, [number, number]> = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };

export interface ExportOpts {
  /** Whom the chart is of: the founder for the whole family. */
  from: string;
  /** Their descendants, or their lineage up to the founder (نسب). */
  kind: 'down' | 'up';
  /** One poster, or sheets to lay side by side. */
  mode: 'poster' | 'sheets';
  paper: Paper;
  /** The names' size on sheets, in points. */
  pt: number;
  /** Daughters as «ابنة», by name where this phone opens it, or not at all. */
  women: 'daughter' | 'names' | 'none';
  years: boolean;
  cal: Cal;
  /** The dead with no one living after them too. */
  dead: boolean;
  /** Generations below `from` (null: all). */
  depth: number | null;
  scheme: Scheme;
  cream: boolean;
  title: string;
}

/** What this phone may export: everything, one main branch, or nothing. As the replay checks it (data/store.ts, 'export'). */
export function exportScope(s: State): { all: true } | { branch: string } | null {
  if (s.isSample || s.guest) return null;
  if (s.rootAdmin) return { all: true };
  const v = viewer(s);
  if (!v) return null;
  if (s.seats.some(x => x.tier === 'platinum' && x.holder === v)) return { all: true };
  const gold = s.seats.find(x => x.tier === 'gold' && x.holder === v && x.branch);
  return gold ? { branch: gold.branch! } : null;
}

/** Whether this phone may export a chart of this person (their descendants or their lineage). */
export function mayExport(s: State, from: string): boolean {
  const sc = exportScope(s);
  const n = s.graph.nodes.get(from);
  if (!sc || !n || n.external) return false;
  return 'all' in sc || (!n.familyRoot && branchOf(s.graph, from) === sc.branch);
}

/** The title it starts with: the family, a main branch, a house, or someone's lineage (a daughter's by name only as the daughters are shown). */
export function defaultTitle(s: State, from: string, kind: 'down' | 'up', women: ExportOpts['women'] = 'daughter'): string {
  const g = s.graph;
  const fam = 'أسرة ' + g.family.name;
  const n = g.nodes.get(from)!;
  if (kind === 'up') {
    const name = whoName(s, from, women === 'none' ? 'daughter' : women);
    const father = n.parent ? g.nodes.get(n.parent) : undefined;
    return 'نسب ' + (name === 'ابنة' && father ? 'ابنة ' + shownName(father) : name) + ' من ' + fam;
  }
  if (n.familyRoot) return 'شجرة ' + fam;
  return (g.branches.includes(from) ? 'فرع ' : 'بيت ') + shownName(n) + ' من ' + fam;
}

const AR = '٠١٢٣٤٥٦٧٨٩';
const ar = (n: number | string) => String(n).replace(/[0-9]/g, d => AR[Number(d)]);

function whoName(s: State, id: string, women: ExportOpts['women']): string {
  const n = s.graph.nodes.get(id)!;
  if (n.sex === 'f' && !n.familyRoot) return women === 'names' && canSee(s, id) ? shownName(n) : 'ابنة';
  return shownName(n);
}

/** A year as the poster shows it, in the calendar chosen; `converted` notes one that was not entered in it (it can be a year out). */
function yearText(y: Year, cal: Cal, converted: { any: boolean }): string {
  if (y.cal !== cal) converted.any = true;
  const v = y.cal === cal ? y.v : y.cal === 'g' ? gToH(y.v)[0] : hToG(y.v)[0];
  return (y.approx ? '~' : '') + ar(v);
}

/** Who exported it, as the poster names them: their name and their father's, or the root admin's title. */
export function exporterName(s: State): string {
  const v = viewer(s);
  if (!v || !s.graph.nodes.has(v)) return 'مشرف العائلة';
  const n = s.graph.nodes.get(v)!;
  const line = nasab(s.graph, v, 1);
  return [shownName(n), line].filter(Boolean).join(' ');
}

export function today(): string {
  try {
    return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-arab', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  } catch {
    return ar(new Date().toISOString().slice(0, 10));
  }
}

/** A chart ready to draw: the layout chosen for the paper, and how to make its pages with a given stamp. */
export interface Prepared {
  chart: Chart;
  /** The names' size, in points. */
  pt: number;
  /** How many people it shows. */
  count: number;
  /** Sheets side by side: how many. */
  sheets: number;
  /** Its pages, with a stamp and the look as chosen when drawn (neither needs a new layout). */
  pages(stamp: Omit<Stamp, 'title' | 'subtitle' | 'family'>, look: { title: string; cream: boolean }): Sheet[];
}

const pause = () => new Promise(r => setTimeout(r, 0));

/**
 * Lays the chart out for the paper. The poster: of some two hundred ways
 * (how long the lists run, the childless together or in birth order, how wide
 * a family may stand before it folds), the one with the largest names; of those
 * within 3% of it, the plainest; and when it does not fill the page downwards,
 * its rows open up until it does. Sheets: unfolded, the names at the size
 * asked for, the lists as long as the height allows, cut where families end.
 */
export async function prepare(s: State, o: ExportOpts, sh: Shaper, progress?: (done: number) => void): Promise<Prepared> {
  const g = s.graph;
  const root = g.root;
  const from = g.nodes.get(o.from)!;
  // the line from the founder down to whom the chart is of
  const chain: string[] = [];
  for (let c: string | null = o.from; c; c = g.nodes.get(c)!.parent) chain.unshift(c);
  const next = new Map(chain.slice(0, -1).map((id, i) => [id, chain[i + 1]]));
  const living = new Map<string, boolean>();
  const alive = (id: string): boolean => {
    let v = living.get(id);
    if (v === undefined) {
      const n = g.nodes.get(id)!;
      living.set(id, (v = !n.dead || n.kids.some(alive)));
    }
    return v;
  };
  const keep = (id: string) => {
    const n = g.nodes.get(id);
    if (!n || n.external) return false;
    if (o.women === 'none' && n.sex === 'f') return false;
    if (!o.dead && !alive(id)) return false;
    return o.depth === null || n.gen - from.gen <= o.depth;
  };
  const kidsOf = new Map<string, string[]>();
  const kids = (id: string): string[] => {
    let k = kidsOf.get(id);
    if (!k) {
      const up = next.get(id);
      k = up ? [up] : o.kind === 'up' ? [] : g.nodes.get(id)!.kids.filter(keep);
      kidsOf.set(id, k);
    }
    return k;
  };
  const inChart: string[] = [];
  const walk = (id: string) => (inChart.push(id), kids(id).forEach(walk));
  walk(root);

  const converted = { any: false };
  const yt = (y: Year) => yearText(y, o.cal, converted);
  const yearsOf = (id: string): string => {
    const n = g.nodes.get(id)!;
    if (!o.years || n.familyRoot || (n.sex === 'f' && !(o.women === 'names' && canSee(s, id)))) return '';
    const b = n.birth, d = n.death;
    if (b && d) return `${yt(b)} – ${yt(d)}`;
    if (d) return `ت ${yt(d)}`;
    if (b) return n.dead ? `${yt(b)} –` : yt(b);
    return '';
  };
  const names = new Map(inChart.map(id => [id, whoName(s, id, o.women)]));
  const years = new Map(inChart.map(id => [id, yearsOf(id)]));
  const width = (id: string) => {
    const n = sh.shape(names.get(id)!, id === root ? 'bold' : 'regular').width;
    const y = years.get(id) ? sh.shape(years.get(id)!, 'regular').width * 0.62 : 0;
    return Math.max(2.4, Math.max(n, y) + 1.15);
  };
  const tree = { root, kids, width };

  // colours: each main branch shown (or the one the chart is of) followed down to
  // where it really splits; the lines there are its houses, each its own colour,
  // and each house's own lines shades of it; the line above, in ink
  const desc = (id: string) => kids(id).length > 0;
  const heads = o.kind === 'up' ? [chain[1] ?? root] : from.familyRoot ? kids(root) : [o.from];
  const trunk = new Set<string>();
  const down = (id: string, on: Set<string>) => {
    let t = id;
    on.add(t);
    for (let ls = kids(t).filter(desc); ls.length === 1 && !next.has(t); ls = kids(t).filter(desc)) on.add((t = ls[0]));
    return kids(t).filter(desc);
  };
  const houseTrunk = new Set<string>();
  const plan = heads.map(b => ({ id: b, houses: o.kind === 'up' ? [] : down(b, trunk).map(h => ({ id: h, subs: down(h, houseTrunk) })) }));
  const tone = tones(plan, o.scheme);
  const INK: Tone = { ink: '#4A4F5C', fill: '#4A4F5C', text: '#FFFFFF' };
  const toneOf = new Map<string, Tone>();
  const fill = (id: string, t: Tone) => {
    toneOf.set(id, tone.get(id) ?? t);
    for (const k of kids(id)) fill(k, tone.get(k) ?? toneOf.get(id)!);
  };
  for (const b of plan) fill(b.id, tone.get(b.id) ?? (o.kind === 'up' ? tones([{ id: b.id, houses: [{ id: b.id, subs: [] }] }], o.scheme).get(b.id)! : INK));
  // the line above whom the chart is of
  for (const id of chain.slice(0, -1)) if (o.kind === 'down' || id === root) toneOf.set(id, INK);
  const legend = plan.flatMap(b => b.houses.map(h => ({ name: 'بيت ' + names.get(h.id), tone: tone.get(h.id)! })));
  const who = (id: string): Who => {
    const n = g.nodes.get(id)!;
    return {
      name: names.get(id)!,
      sex: n.sex,
      dead: n.dead,
      root: id === root,
      head: id !== root && (trunk.has(id) || houseTrunk.has(id) || next.has(id) || (o.kind === 'up' && id !== o.from)),
      years: years.get(id) || undefined,
      mark: o.kind === 'up' && id === o.from,
    };
  };

  // the layout
  const paper = PAPERS[o.paper];
  let chart: Chart;
  let pt: number;
  let sheets: [number, number][] = [];
  let sheetScale = 0;
  if (o.mode === 'sheets') {
    const fr = sheetFrame(paper, true);
    const order = new Map<string, number>();
    inChart.forEach((id, i) => order.set(id, i));
    const want = o.pt * PT;
    let pick: { chart: Chart; sheets: [number, number][]; s: number } | null = null;
    for (const listRows of [3, 4, 5, 6, 8, 10, 12, 16]) {
      const c0 = layout(tree, { listFrom: 2, listRows, gather: false, lanesFrom: Infinity, foldAbove: Infinity, columns: true, years: o.years });
      const sc = Math.min(want, (fr.y1 - fr.y0) / size(c0)[1]);
      const r = cut(c0, (fr.x1 - fr.x0) / sc, order);
      if (!pick || sc > pick.s * 1.02 || (sc > pick.s * 0.98 && r.sheets.length < pick.sheets.length)) pick = { ...r, s: sc };
      progress?.(0.1 + listRows / 20);
      await pause();
    }
    ({ chart, sheets } = pick!);
    sheetScale = pick!.s;
    pt = sheetScale / PT;
  } else {
    const base: Shape = { listFrom: 2, listRows: 6, gather: false, lanesFrom: Infinity, foldAbove: Infinity, years: o.years };
    const cands: { s: number; shape: Shape; folds: number }[] = [];
    const folds = o.kind === 'up' ? [Infinity] : [Infinity, ...Array.from({ length: 25 }, (_, i) => 30 + i * 15)];
    const shapes: Shape[] = [];
    for (const listRows of o.kind === 'up' ? [6] : [4, 6, 8, 12]) for (const gather of o.kind === 'up' ? [false] : [false, true]) for (const foldAbove of folds) shapes.push({ ...base, listRows, gather, foldAbove });
    for (let i = 0; i < shapes.length; i++) {
      const c = layout(tree, shapes[i]);
      const [cw, ch] = size(c);
      cands.push({ s: page(cw, ch, paper).s, shape: shapes[i], folds: c.folds });
      if (i % 8 === 7) {
        progress?.(i / shapes.length);
        await pause();
      }
    }
    const top = Math.max(...cands.map(c => c.s));
    const plain = (c: (typeof cands)[0]) => [c.folds, c.shape.gather ? 1 : 0, -c.s];
    const best = cands
      .filter(c => c.s >= top * 0.97)
      .sort((a, b) => {
        const x = plain(a), y = plain(b);
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
        return 0;
      })[0];
    chart = layout(tree, best.shape);
    // the paper not filled downwards: open the rows up, the names staying the size they are
    let lo = 0, hi = 2.6;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      const c = layout(tree, { ...best.shape, drop: 2.2 + mid });
      const [cw, ch] = size(c);
      if (page(cw, ch, paper).s >= best.s * 0.999) lo = mid;
      else hi = mid;
    }
    if (lo > 0.05) chart = layout(tree, { ...best.shape, drop: 2.2 + lo });
    pt = best.s / PT;
  }
  progress?.(1);

  const gens = new Set(inChart.map(id => g.nodes.get(id)!.gen)).size;
  const conv = o.years ? (o.cal === 'h' ? '، السنوات بالهجري' : '، السنوات بالميلادي') + (converted.any ? ' (تقريبية)' : '') : '';
  const subtitle = `${ar(inChart.length)} ${inChart.length > 10 ? 'فردًا' : 'أفراد'}، ${ar(gens)} ${gens > 10 ? 'جيلًا' : 'أجيال'}، كما في ${today()}${conv}`;
  const pages = (st: Omit<Stamp, 'title' | 'subtitle' | 'family'>, look: { title: string; cream: boolean }): Sheet[] => {
    const p: PosterIn = {
      chart,
      who,
      tone: id => toneOf.get(id) ?? INK,
      paper,
      stamp: { ...st, title: look.title.trim() || defaultTitle(s, o.from, o.kind, o.women), subtitle, family: 'أسرة ' + g.family.name },
      legend,
      cream: look.cream,
    };
    return o.mode === 'sheets' ? sheetPages(p, sh, sheets, sheetScale, true) : [poster(p, sh)];
  };
  return { chart, pt, count: inChart.length, sheets: o.mode === 'sheets' ? sheets.length : 1, pages };
}
