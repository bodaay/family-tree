// 3D layout of the "tree of light": the founder at the top, one level per
// generation going down. Each subtree gets an angular wedge sized by how many
// people it holds; the canopy spreads out fast, then hangs down.
import type { Graph } from '../data/graph';

export interface P3 {
  x: number;
  y: number;
  z: number;
  a: number;
}

export const LEVEL = 15;
export const RADIUS = 54;

export function ringR(g: number, maxGen: number): number {
  if (g === 0) return 0;
  return (RADIUS * (1 - Math.exp(-g / 1.5))) / (1 - Math.exp(-Math.max(1, maxGen) / 1.5));
}

export const levelY = (g: number) => -g * LEVEL;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

export function layout(g: Graph): Map<string, P3> {
  const w = new Map<string, number>();
  const weight = (id: string): number => {
    const n = g.nodes.get(id)!;
    const v = n.kids.length ? n.kids.reduce((s, k) => s + weight(k), 0) : n.sex === 'f' ? 0.75 : 1;
    w.set(id, v);
    return v;
  };
  weight(g.root);
  const pos = new Map<string, P3>();
  const assign = (id: string, a0: number, a1: number) => {
    const n = g.nodes.get(id)!;
    const a = (a0 + a1) / 2;
    const jitter = n.gen ? 0.95 + 0.1 * hash(id) : 1;
    const r = ringR(n.gen, g.maxGen) * jitter;
    pos.set(id, { x: r * Math.cos(a), z: r * Math.sin(a), y: levelY(n.gen) + (n.gen ? (hash(id + 'y') - 0.5) * 1.2 : 0), a });
    const tot = n.kids.reduce((s, k) => s + w.get(k)!, 0);
    let c = a0;
    for (const k of n.kids) {
      const span = ((a1 - a0) * w.get(k)!) / tot;
      assign(k, c, c + span);
      c += span;
    }
  };
  assign(g.root, 0, Math.PI * 2);
  spread(g, pos);
  return pos;
}

/** World size of a person's dot per generation (the renderer's NODE sizes). */
const DOT = [2.7, 1.8, 1.42, 1.15, 0.95, 0.8, 0.68, 0.58, 0.5, 0.45];

/**
 * Keeps people on the same ring apart. A slice of the circle is sized by how
 * many descendants each line has, so a son with none gets a sliver right next
 * to his brothers' (four sons where one has 690 descendants: three land on the
 * same spot). Every ring therefore gets a minimum gap between neighbours, all
 * the way round, with extra room near the top where names are shown; rings
 * that are simply full also hang every other person a little lower.
 */
function spread(g: Graph, pos: Map<string, P3>) {
  const byGen = new Map<number, string[]>();
  // spouses from outside the family are not in the tree, so have no place
  for (const n of g.nodes.values()) if (n.gen > 0 && pos.has(n.id)) byGen.set(n.gen, [...(byGen.get(n.gen) ?? []), n.id]);
  const TAU = Math.PI * 2;
  for (const [gen, ids] of byGen) {
    if (ids.length < 2) continue;
    const R = ringR(gen, g.maxGen);
    // centre to centre, in world units: room for a name near the top, for the dots further down
    const need = gen === 1 ? 22 : gen === 2 ? 13 : gen === 3 ? 7 : (DOT[gen] ?? 0.45) * 3.2;
    const room = (TAU * R) / ids.length;
    const rows = room >= need ? 1 : room * 2 >= need ? 2 : 3;
    const step = Math.min(need / rows / R, TAU / ids.length);
    const norm = (a: number) => ((a % TAU) + TAU) % TAU;
    ids.sort((a, b) => norm(pos.get(a)!.a) - norm(pos.get(b)!.a));
    const a0 = ids.map(id => norm(pos.get(id)!.a));
    // start after the widest gap, so a cluster across the 0/360° seam stays together
    let k = 0, widest = -1;
    for (let i = 0; i < a0.length; i++) {
      const gap = i === a0.length - 1 ? a0[0] + TAU - a0[i] : a0[i + 1] - a0[i];
      if (gap > widest) { widest = gap; k = (i + 1) % a0.length; }
    }
    const order = ids.map((_, i) => ids[(k + i) % ids.length]);
    const orig = order.map((id, i) => norm(pos.get(id)!.a) + (i > 0 && (k + i) % ids.length < k ? TAU : 0));
    const as = [...orig];
    for (let i = 1; i < as.length; i++) as[i] = Math.max(as[i], as[i - 1] + step);
    // spread the push both ways: shift back by the average move
    const shift = as.reduce((s, a, i) => s + a - orig[i], 0) / as.length;
    order.forEach((id, i) => {
      const p = pos.get(id)!;
      const r = Math.hypot(p.x, p.z);
      p.a = as[i] - shift;
      p.x = r * Math.cos(p.a);
      p.z = r * Math.sin(p.a);
      if (rows > 1) p.y = levelY(gen) - (i % rows) * 3.6;
    });
  }
}
