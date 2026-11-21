// The classic 2D family chart (المشجرة): founder at the top, one row per
// generation, the eldest child on the right. A "tidy tree" layout: each subtree
// is packed as close to its neighbour as its outline allows at every depth.
import type { Graph } from '../data/graph';

export const BOX_W = 70;
export const BOX_H = 44;
export const GAP_X = 10;
export const ROW_H = 104;
const STEP = BOX_W + GAP_X;

export interface ChartPos {
  x: number;
  y: number;
}

interface Sub {
  xs: Map<string, number>;
  /** outline per generation: [min x, max x] relative to the subtree's root */
  contour: Map<number, [number, number]>;
}

export function chartLayout(g: Graph): Map<string, ChartPos> {
  const build = (id: string): Sub => {
    const n = g.nodes.get(id)!;
    if (!n.kids.length) return { xs: new Map([[id, 0]]), contour: new Map([[n.gen, [0, 0]]]) };
    const subs = n.kids.map(build);
    const acc = new Map<number, [number, number]>();
    const offsets: number[] = [];
    subs.forEach((sub, i) => {
      let off = 0;
      if (i > 0) {
        off = -Infinity;
        for (const [d, [mn]] of sub.contour) {
          const a = acc.get(d);
          if (a) off = Math.max(off, a[1] - mn + STEP);
        }
        if (off === -Infinity) off = offsets[i - 1] + STEP;
        off = Math.max(off, offsets[i - 1] + STEP);
      }
      offsets.push(off);
      for (const [d, [mn, mx]] of sub.contour) {
        const a = acc.get(d);
        acc.set(d, a ? [Math.min(a[0], mn + off), Math.max(a[1], mx + off)] : [mn + off, mx + off]);
      }
    });
    const px = (offsets[0] + offsets[offsets.length - 1]) / 2;
    const xs = new Map<string, number>([[id, 0]]);
    subs.forEach((sub, i) => sub.xs.forEach((x, k) => xs.set(k, x + offsets[i] - px)));
    const contour = new Map<number, [number, number]>([[n.gen, [0, 0]]]);
    for (const [d, [mn, mx]] of acc) contour.set(d, [mn - px, mx - px]);
    return { xs, contour };
  };
  const { xs } = build(g.root);
  const pos = new Map<string, ChartPos>();
  // mirror so the eldest (laid out first) sits on the right, as Arabic reads
  for (const [id, x] of xs) pos.set(id, { x: -x, y: g.nodes.get(id)!.gen * ROW_H });
  return pos;
}

export function chartBounds(pos: Map<string, ChartPos>): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pos.values()) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return { x0: x0 - BOX_W, x1: x1 + BOX_W, y0: y0 - BOX_H, y1: y1 + BOX_H };
}
