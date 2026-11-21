// A chart too long for one sheet, on sheets to lay side by side: the unfolded
// chart, every generation on one row, cut into widths of the sheet. A cut never
// runs through a name: where one would, everything after it in the family's
// order (that person, the families younger than theirs, and so on up) moves on
// to the next sheet, and the bars over the cut stretch to meet it. So each
// sheet ends where a family does, and laid edge to edge the sheets make one
// chart, its rows level from the first sheet to the last.
import type { Chart } from './layout';

const GAP = 0.8;

/** The chart with its cuts made, and each sheet's span, right to left (Arabic order). */
export function cut(c: Chart, width: number, order: Map<string, number>): { chart: Chart; sheets: [number, number][] } {
  const boxes = c.boxes.map(b => ({ ...b }));
  const lines = c.lines.map(l => ({ ...l, pts: l.pts.map(p => [...p] as [number, number]) }));
  const pre = (id: string) => order.get(id) ?? 0;
  const sheets: [number, number][] = [];
  let right = c.maxX;
  for (let guard = 0; guard < 500; guard++) {
    const left = right - width;
    const minX = Math.min(...boxes.map(b => b.x));
    if (minX >= left - 1e-6) {
      sheets.push([left, right]);
      break;
    }
    // a father the edge runs through: only his own box moves, to the nearer side;
    // his line comes down to the bar from wherever he stands
    const fathers = new Set(lines.filter(l => l.from).map(l => l.from!));
    for (const b of boxes) {
      if (!(b.x < left && b.x + b.w > left) || !fathers.has(b.id)) continue;
      const toLeft = b.x + b.w + GAP / 2 - left, toRight = left + GAP / 2 - b.x;
      const d = toLeft <= toRight ? -toLeft : toRight;
      b.x += d;
      for (const l of lines) {
        if (l.of === b.id && !l.from) l.pts.forEach(p => (p[0] += d));
        else if (l.from === b.id) l.pts[0][0] += d;
      }
    }
    // the first, in the family's order, of the other names the edge would run through
    let k = Infinity;
    for (const b of boxes) if (b.x < left && b.x + b.w > left) k = Math.min(k, pre(b.id));
    // never between names of one list: the list moves whole
    if (Number.isFinite(k)) {
      const first = boxes.filter(b => !b.more && pre(b.id) <= k).reduce((a, b) => (pre(b.id) > pre(a.id) ? b : a));
      k = pre(first.id);
      const reach = Math.max(...boxes.filter(b => pre(b.id) >= k).map(b => b.x + b.w));
      const d = Math.max(0, reach + GAP - left);
      if (d > 0) {
        for (const b of boxes) if (pre(b.id) >= k) b.x -= d;
        for (const l of lines)
          l.pts.forEach((p, i) => {
            const who = i === 0 && l.from ? l.from : l.of;
            if (pre(who) >= k) p[0] -= d;
          });
      }
    }
    sheets.push([left, right]);
    right = left;
  }
  const minX = Math.min(...boxes.map(b => b.x)), maxX = Math.max(...boxes.map(b => b.x + b.w));
  return { chart: { ...c, boxes, lines, minX, maxX }, sheets };
}
