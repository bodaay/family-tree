// Colours that follow the view. Take whoever sits at the top of what is on
// screen, go down to the first place where the family really splits, and give
// each of those lines its own colour, shared by everyone in the line. Zooming
// into a house recolours its sons' lines; zooming out brings the houses back.
import type { Graph } from '../data/graph';
import { NONE, OUT, PALETTE, ROOT } from './render';

export interface Coloring {
  /** The person whose children's lines are coloured. */
  top: string;
  groups: string[];
  color: Map<string, string>;
}

/**
 * The deepest person whose line holds most of the given people (by default 70%),
 * so a few strays from other branches, in front or far behind, don't pull the
 * colours back up to the whole family.
 */
export function dominantAncestor(g: Graph, ids: string[], share = 0.7): string {
  if (!ids.length) return g.root;
  const count = new Map<string, number>();
  // (someone just removed may still be on screen for a frame: only those in the tree count)
  for (const id of ids) for (let p: string | null = id; p && g.nodes.has(p); p = g.nodes.get(p)!.parent) count.set(p, (count.get(p) ?? 0) + 1);
  let best = g.root;
  for (const [id, c] of count) if (c >= ids.length * share && g.nodes.get(id)!.gen > g.nodes.get(best)!.gen) best = id;
  return best;
}

export function coloring(g: Graph, from: string, theme: 'dark' | 'light'): Coloring {
  let top = g.nodes.get(from) ?? g.nodes.get(g.root)!;
  if (!top.kids.length && top.parent) top = g.nodes.get(top.parent)!;
  // go down while only one line carries descendants
  for (;;) {
    const lines = top.kids.filter(k => g.nodes.get(k)!.kids.length > 0);
    if (lines.length !== 1) break;
    top = g.nodes.get(lines[0])!;
  }
  // everyone else recedes; the line down to the top stays light, like a trunk
  const color = new Map<string, string>();
  for (const n of g.nodes.values()) color.set(n.id, n.familyRoot ? ROOT[theme] : OUT[theme]);
  for (let p: string | null = top.id; p && !g.nodes.get(p)!.familyRoot; p = g.nodes.get(p)!.parent) color.set(p, NONE[theme]);
  const paint = (id: string, c: string) => {
    color.set(id, c);
    for (const k of g.nodes.get(id)!.kids) paint(k, c);
  };
  const pal = PALETTE[theme];
  top.kids.forEach((k, i) => paint(k, pal[i % pal.length]));
  return { top: top.id, groups: top.kids, color };
}

const mixed = new Map<string, string>();
/** A colour between a and b (both #rrggbb). */
export function mix(a: string, b: string, t: number): string {
  if (a === b || t >= 1) return b;
  if (t <= 0) return a;
  const key = a + b + t;
  let m = mixed.get(key);
  if (!m) {
    const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
    m = '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
    if (mixed.size > 2000) mixed.clear();
    mixed.set(key, m);
  }
  return m;
}
