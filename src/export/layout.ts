// The exported chart's layout: the classic chart (المشجرة), founder at the top,
// one row per generation, eldest on the right, packed for paper. Three things
// keep a wide family from running off the page:
//  - childless brothers and sisters hang in a list under their father's line
//    instead of standing side by side (in more columns when the list is long);
//  - every family is pushed as close to its neighbour as its outline allows, at
//    every height, so a short family's empty space below is used by the next;
//  - many small families under one father (a son and his young children) can
//    stand on two levels, the second one lower, their lines passing between the
//    first: the up-and-down that fills the white space.
// Everything is in em (the names' font size): the poster scales it to the paper.

export interface Tree {
  root: string;
  /** In birth order, eldest first. */
  kids(id: string): string[];
  /** The width of the person's box, name inside. */
  width(id: string): number;
}

export interface Shape {
  /** Childless children, this many in a row or more, hang as a list (Infinity: never). */
  listFrom: number;
  /** The longest a list runs before it takes another column. */
  listRows: number;
  /** All a father's childless children in one list after the others, rather than in runs keeping the birth order. */
  gather: boolean;
  /** A father with this many small families or more sets them on two levels (Infinity: never). */
  lanesFrom: number;
  /**
   * A family wider than this folds: the father on a trunk down the middle, his
   * children's families on both sides of it, tier under tier; the widest of
   * them, if it is folded too, carries the trunk on down (Infinity: never).
   */
  foldAbove: number;
  /**
   * Each family in a column of its own, nothing of a younger one under an elder's:
   * for sheets laid side by side, so a cut between families is a straight line.
   */
  columns?: boolean;
  /** Room between a row and the next, from the father's box to the children's (more spreads a chart down a page it does not fill). */
  drop?: number;
  /** A line of years under each name: the boxes taller. */
  years?: boolean;
}

export const SHAPE: Shape = { listFrom: 3, listRows: 6, gather: false, lanesFrom: 4, foldAbove: Infinity };

export interface Box {
  id: string;
  /** Left edge and top. */
  x: number;
  y: number;
  w: number;
  /** In a list under its father's line; `more`: not its first. */
  list?: boolean;
  more?: boolean;
}

/** A line, as points; `of` is the person it leads to (for its colour); `from`: it starts under this father. */
export interface Line {
  pts: [number, number][];
  of: string;
  from?: string;
}

export interface Chart {
  boxes: Box[];
  lines: Line[];
  /** The bounds: x from minX to maxX, y from 0 to height. */
  minX: number;
  maxX: number;
  height: number;
  /** How many people stand on a trunk (folded families): the fewer, the plainer the chart. */
  folds: number;
  /** Every box's height. */
  boxH: number;
}

export const BOX_H = 1.75;
/** With a line of years under the name. */
export const BOX_H_YEARS = 2.6;
/** From a row's boxes to the next row's: the father's line, the brothers' bar, each child's line (set per chart: Shape.drop). */
export const DROP = 2.2;
let drop = DROP;
let ROW = BOX_H + drop;
/** From one name to the next in a list. */
let boxH = BOX_H;
let PITCH = BOX_H + 0.4;
/** Between neighbours. */
const GAP = 0.55;
/** From a list's line to its names. */
const GUT = 0.75;
/** The outlines' step, and half a line's width in them. */
const Q = 0.25;
const LW = 0.1;

/** For each step of height, the leftmost and rightmost thing there. */
type Outline = Map<number, [number, number]>;

interface Block {
  boxes: Box[];
  lines: Line[];
  out: Outline;
  /** Where the line from above comes in, and how high. */
  ax: number;
  top: number;
  bottom: number;
  /** A tip, a list, or a person whose children are all tips: may stand on the lower level. */
  small: boolean;
  /** A tip or a list (not a family). */
  leaf: boolean;
  /** Folded: a trunk down the middle, its families on both sides; what it was made of, for a folded father to take up into his own trunk. */
  parts?: Parts;
}

/** A trunk: a person on it, his children's families beside it, and the folded child who carries it on. */
interface Parts {
  id: string;
  w: number;
  y: number;
  groups: Block[][];
  next?: Parts;
}

function mark(o: Outline, x1: number, x2: number, y1: number, y2: number) {
  for (let k = Math.floor(y1 / Q); k < Math.ceil(y2 / Q); k++) {
    const c = o.get(k);
    if (!c) o.set(k, [x1, x2]);
    else {
      if (x1 < c[0]) c[0] = x1;
      if (x2 > c[1]) c[1] = x2;
    }
  }
}

const vline = (o: Outline, x: number, y1: number, y2: number) => mark(o, x - LW, x + LW, y1, y2);

function moved(b: Block, dx: number, dy = 0): Block {
  const k = Math.round(dy / Q);
  const out: Outline = new Map();
  for (const [s, [a, c]] of b.out) out.set(s + k, [a + dx, c + dx]);
  return {
    boxes: b.boxes.map(x => ({ ...x, x: x.x + dx, y: x.y + dy })),
    lines: b.lines.map(l => ({ ...l, pts: l.pts.map(([x, y]) => [x + dx, y + dy] as [number, number]) })),
    out,
    ax: b.ax + dx,
    top: b.top + dy,
    bottom: b.bottom + dy,
    small: b.small,
    leaf: b.leaf,
    parts: b.parts,
  };
}

/** Each block's offset, left to right, each as close to those before it as the outlines allow. */
function pack(items: Block[], columns = false): number[] {
  const acc: Outline = new Map();
  const offs: number[] = [];
  let prev = -Infinity;
  let right = -Infinity;
  for (const it of items) {
    let off = -Infinity;
    const [mn0, mx0] = extent([it]);
    if (columns) {
      if (Number.isFinite(right)) off = right + GAP - mn0;
    } else
      for (const [k, [mn]] of it.out) {
        const a = acc.get(k);
        if (a) off = Math.max(off, a[1] + GAP - mn);
      }
    // never left of the one before at the bar: the order is the birth order
    off = Math.max(off, prev + GAP - it.ax);
    if (!Number.isFinite(off)) off = 0;
    offs.push(off);
    right = Math.max(right, mx0 + off);
    for (const [k, [mn, mx]] of it.out) {
      const a = acc.get(k);
      if (!a) acc.set(k, [mn + off, mx + off]);
      else {
        if (mn + off < a[0]) a[0] = mn + off;
        if (mx + off > a[1]) a[1] = mx + off;
      }
    }
    prev = off + it.ax;
  }
  return offs;
}

function merge(into: Block, b: Block) {
  into.boxes.push(...b.boxes);
  into.lines.push(...b.lines);
  for (const [k, [mn, mx]] of b.out) {
    const a = into.out.get(k);
    if (!a) into.out.set(k, [mn, mx]);
    else {
      if (mn < a[0]) a[0] = mn;
      if (mx > a[1]) a[1] = mx;
    }
  }
  into.bottom = Math.max(into.bottom, b.bottom);
}

/** One person alone, at the row of their generation. */
function single(t: Tree, id: string, gen: number): Block {
  const w = t.width(id), y = gen * ROW;
  const out: Outline = new Map();
  mark(out, 0, w, y, y + boxH);
  return { boxes: [{ id, x: 0, y, w }], lines: [], out, ax: w / 2, top: y, bottom: y + boxH, small: true, leaf: true };
}

/** Childless brothers and sisters in a list: a line down their leading side, a short one to each. */
function list(t: Tree, ids: string[], gen: number): Block {
  const w = Math.max(...ids.map(id => t.width(id)));
  const y0 = gen * ROW;
  const out: Outline = new Map();
  const boxes: Box[] = [], lines: Line[] = [];
  ids.forEach((id, i) => {
    const y = y0 + i * PITCH;
    boxes.push({ id, x: GUT, y, w, list: true, more: i > 0 });
    lines.push({ of: id, pts: [[0, y0], [0, y + boxH / 2], [GUT, y + boxH / 2]] });
  });
  const bottom = y0 + (ids.length - 1) * PITCH + boxH;
  mark(out, GUT, GUT + w, y0, bottom);
  vline(out, 0, y0, bottom - boxH / 2);
  return { boxes, lines, out, ax: 0, top: y0, bottom, small: true, leaf: true };
}

/** How wide blocks stand, packed side by side. */
function spread(items: Block[]): number {
  const offs = pack(items);
  let mn = Infinity, mx = -Infinity;
  items.forEach((b, i) => {
    for (const [a, c] of b.out.values()) {
      mn = Math.min(mn, a + offs[i]);
      mx = Math.max(mx, c + offs[i]);
    }
  });
  return mx - mn;
}

/** The children's blocks in groups, in order, each as wide as it may be (one group: no folding). */
function fold(items: Block[], most: number, always = false): Block[][] {
  if (!Number.isFinite(most) || (!always && spread(items) <= most)) return [items];
  const groups: Block[][] = [];
  let cur: Block[] = [];
  for (const b of items) {
    if (cur.length && spread([...cur, b]) > most) {
      groups.push(cur);
      cur = [b];
    } else cur.push(b);
  }
  groups.push(cur);
  return groups;
}

const snap = (y: number) => Math.ceil(y / Q) * Q;

function extent(bs: Block[]): [number, number] {
  let mn = Infinity, mx = -Infinity;
  for (const b of bs)
    for (const [a, c] of b.out.values()) {
      mn = Math.min(mn, a);
      mx = Math.max(mx, c);
    }
  return [mn, mx];
}

/** Per step across, the lowest (or highest) thing there. */
type Sky = Map<number, number>;
const QX = 0.5;

function edge(boxes: Box[], lines: Line[], low: boolean): Sky {
  const sky: Sky = new Map();
  const put = (x1: number, x2: number, y: number) => {
    for (let k = Math.floor(x1 / QX); k < Math.ceil(x2 / QX); k++) {
      const v = sky.get(k);
      if (v === undefined || (low ? y > v : y < v)) sky.set(k, y);
    }
  };
  for (const b of boxes) put(b.x, b.x + b.w, low ? b.y + boxH : b.y);
  for (const l of lines)
    for (let i = 1; i < l.pts.length; i++) {
      const [x1, y1] = l.pts[i - 1], [x2, y2] = l.pts[i];
      put(Math.min(x1, x2) - LW, Math.max(x1, x2) + LW, low ? Math.max(y1, y2) : Math.min(y1, y2));
    }
  return sky;
}

/** How far down `top` must move to clear `sky` by `gap`. */
function clear(sky: Sky, top: Sky, gap: number): number {
  let d = -Infinity;
  for (const [k, y] of top) {
    const v = sky.get(k);
    if (v !== undefined) d = Math.max(d, v + gap - y);
  }
  return d;
}

/**
 * A folded family, and the folded ones under it, on one trunk: each person on
 * it in the middle, below the last of his elder's families; his children's
 * families hang from it, each on whichever side lets it sit higher (the right
 * when even: the left here, before the mirror), tucked under the ones above as
 * far as their outlines allow.
 */
function trunk(parts: Parts): Block {
  const boxes: Box[] = [], lines: Line[] = [];
  const sky: Sky = new Map();
  const add = (bs: Box[], ls: Line[]) => {
    boxes.push(...bs);
    lines.push(...ls);
    for (const [k, y] of edge(bs, ls, true)) sky.set(k, Math.max(sky.get(k) ?? -Infinity, y));
  };
  let p: Parts | undefined = parts;
  let y = parts.y;
  let prevEnd: { id: string; from: number } | null = null;
  while (p) {
    // the person, on the trunk, clear of everything above
    const me: Box = { id: p.id, x: -p.w / 2, y, w: p.w };
    const d = clear(sky, edge([{ ...me, x: me.x - GAP, w: me.w + 2 * GAP }], [], false), drop / 2);
    if (Number.isFinite(d) && d > 0) me.y = snap(y + d);
    if (prevEnd) lines.push({ of: p.id, pts: [[0, prevEnd.from], [0, me.y]] });
    add([me], []);
    const start = me.y + boxH + drop / 2;
    let last = me.y + boxH;
    for (const g of p.groups) {
      const offs = pack(g);
      const fam = g.map((b, k) => moved(b, offs[k]));
      const [mn, mx] = extent(fam);
      const top = Math.min(...fam.map(b => b.top));
      let best: { dx: number; dy: number; bar: number } | null = null;
      for (const side of [0, 1]) {
        const dx = side === 0 ? -GAP * 2 - mx : GAP * 2 - mn;
        const bar0 = top - drop / 2;
        const shape = fam.map(b => moved(b, dx));
        const far = side === 0 ? Math.min(...shape.map(b => b.ax)) : Math.max(...shape.map(b => b.ax));
        const bs = shape.flatMap(b => b.boxes), ls = shape.flatMap(b => b.lines);
        // the bar from just off the trunk, so the two sides' bars may stand level
        const off = side === 0 ? -QX * 1.5 : QX * 1.5;
        ls.push({ of: '', pts: [[off, bar0], [far, bar0]] }, ...shape.map(b => ({ of: '', pts: [[b.ax, bar0], [b.ax, b.top]] as [number, number][] })));
        const dy = snap(Math.max(start - bar0, clear(sky, edge(bs, ls, false), drop * 0.7)));
        const bar = bar0 + dy;
        if (!best || bar < best.bar - 1e-6) best = { dx, dy, bar };
      }
      const at = best!;
      const placed = fam.map(b => moved(b, at.dx, at.dy));
      const ls: Line[] = [];
      // the farthest first, so each stretch of the bar shows the colour of the family beyond it
      for (const b of [...placed].sort((u, v) => Math.abs(v.ax) - Math.abs(u.ax))) ls.push({ of: b.boxes[0].id, pts: [[0, at.bar], [b.ax, at.bar], [b.ax, b.top]] });
      add(
        placed.flatMap(b => b.boxes),
        [...ls, ...placed.flatMap(b => b.lines)],
      );
      last = Math.max(last, at.bar);
    }
    lines.push({ of: p.id, pts: [[0, me.y + boxH], [0, last]] });
    prevEnd = { id: p.id, from: last };
    p = p.next;
    if (p) y = last + drop / 2;
  }
  const out: Outline = new Map();
  for (const b of boxes) mark(out, b.x, b.x + b.w, b.y, b.y + boxH);
  for (const l of lines)
    for (let i = 1; i < l.pts.length; i++) {
      const [x1, y1] = l.pts[i - 1], [x2, y2] = l.pts[i];
      mark(out, Math.min(x1, x2) - LW, Math.max(x1, x2) + LW, Math.min(y1, y2) - LW, Math.max(y1, y2) + LW);
    }
  const bottom = Math.max(...boxes.map(b => b.y + boxH));
  return { boxes, lines, out, ax: 0, top: parts.y, bottom, small: false, leaf: false, parts };
}

/** A father's children's families in groups for the two sides: none wider than `half`, and never just one when two would balance. */
function sides(items: Block[], half: number): Block[][] {
  const groups = fold(items, half, true);
  if (groups.length === 1 && groups[0].length > 1) {
    const g = groups[0];
    let best = 1, diff = Infinity;
    for (let i = 1; i < g.length; i++) {
      const d = Math.abs(spread(g.slice(0, i)) - spread(g.slice(i)));
      if (d < diff) [best, diff] = [i, d];
    }
    return [g.slice(0, best), g.slice(best)];
  }
  return groups;
}

export function layout(t: Tree, shape: Shape = SHAPE): Chart {
  let folds = 0;
  drop = shape.drop ?? DROP;
  boxH = shape.years ? BOX_H_YEARS : BOX_H;
  ROW = boxH + drop;
  // lists open up a little with the rows, never as much
  PITCH = boxH + 0.4 + (drop - DROP) * 0.15;
  const build = (id: string, gen: number): Block => {
    const kids = t.kids(id);
    if (!kids.length) return single(t, id, gen);
    const tip = (k: string) => t.kids(k).length === 0;
    // the children as blocks, in order: families, single tips, and lists of tips
    const items: Block[] = [];
    const lists = (run: string[]) => {
      if (run.length < shape.listFrom) run.forEach(k => items.push(single(t, k, gen + 1)));
      else {
        const cols = Math.ceil(run.length / shape.listRows);
        const per = Math.ceil(run.length / cols);
        for (let i = 0; i < run.length; i += per) items.push(list(t, run.slice(i, i + per), gen + 1));
      }
    };
    if (shape.gather) {
      kids.filter(k => !tip(k)).forEach(k => items.push(build(k, gen + 1)));
      lists(kids.filter(tip));
    } else {
      let run: string[] = [];
      for (const k of kids) {
        if (tip(k)) run.push(k);
        else {
          lists(run);
          run = [];
          items.push(build(k, gen + 1));
        }
      }
      lists(run);
    }
    // many small families: every other one a level lower, its line passing between the upper ones
    const small = items.filter(b => b.small);
    let lower = new Set<Block>();
    if (small.length >= shape.lanesFrom) {
      let flip = false;
      for (const b of items) {
        if (!b.small) {
          flip = false;
          continue;
        }
        if (flip) lower.add(b);
        flip = !flip;
      }
    }
    const upperDepth = Math.max(0, ...items.filter(b => b.small && !lower.has(b)).map(b => b.bottom - b.top));
    const dy = Math.ceil((upperDepth + GAP * 1.6) / Q) * Q;
    const barY = (gen + 1) * ROW - drop / 2;
    const placed = items.map(b => {
      if (!lower.has(b)) return b;
      const m = moved(b, 0, dy);
      // its line down from the bar, through the upper level
      vline(m.out, m.ax, barY, m.top);
      return m;
    });
    const w = t.width(id), y = gen * ROW;
    if (Number.isFinite(shape.foldAbove) && (items.some(b => b.parts) || (items.length > 1 && spread(placed) > shape.foldAbove))) {
      const folded = items.filter(b => b.parts);
      const size = (b: Block) => extent([b])[1] - extent([b])[0];
      const heavy = folded.length ? folded.reduce((u, v) => (size(v) > size(u) ? v : u)) : null;
      const rest = items.filter(b => b !== heavy);
      folds++;
      return trunk({ id, w, y, groups: rest.length ? sides(rest, shape.foldAbove / 2) : [], next: heavy?.parts });
    }
    const offs = pack(placed, shape.columns);
    const fam = placed.map((b, i) => moved(b, offs[i]));
    const first = fam[0].ax, last = fam[fam.length - 1].ax;
    const cx = (first + last) / 2;
    const block: Block = { boxes: [{ id, x: cx - w / 2, y, w }], lines: [], out: new Map(), ax: cx, top: y, bottom: y + boxH, small: false, leaf: false };
    mark(block.out, cx - w / 2, cx + w / 2, y, y + boxH);
    vline(block.out, cx, y + boxH, barY);
    mark(block.out, Math.min(first, cx) - LW, Math.max(last, cx) + LW, barY - LW, barY + LW);
    // the father's line down to the bar, then each child's: along the bar and down,
    // the farthest first, so each stretch of the bar shows the colour of the child beyond it
    block.lines.push({ of: id, pts: [[cx, y + boxH], [cx, barY]] });
    for (const b of [...fam].sort((p, q) => Math.abs(q.ax - cx) - Math.abs(p.ax - cx))) {
      block.lines.push({ of: b.boxes[0].id, from: id, pts: [[cx, barY], [b.ax, barY], [b.ax, b.top]] });
      vline(block.out, b.ax, barY, b.top);
      merge(block, b);
    }
    block.small = items.every(b => b.leaf);
    return block;
  };
  const b = build(t.root, 0);
  // eldest on the right, as Arabic reads
  const boxes = b.boxes.map(x => ({ ...x, x: -x.x - x.w }));
  const lines = b.lines.map(l => ({ ...l, pts: l.pts.map(([x, y]) => [-x, y] as [number, number]) }));
  let minX = Infinity, maxX = -Infinity, height = 0;
  for (const x of boxes) {
    minX = Math.min(minX, x.x);
    maxX = Math.max(maxX, x.x + x.w);
    height = Math.max(height, x.y + boxH);
  }
  return { boxes, lines, minX, maxX, height, folds, boxH };
}
