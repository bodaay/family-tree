// The export's layout (src/export), checked on trees of every shape and on the
// family's own: every person drawn once, no two names overlapping, a family
// folded onto a trunk still whole, and sheets cut where no name is.
//   node scripts/test-export.ts
import fs from 'node:fs';
import { layout, type Chart, type Shape, type Tree } from '../src/export/layout.ts';
import { cut } from '../src/export/sheets.ts';
import { visualRuns } from '../src/export/text.ts';

let failed = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) {
    failed++;
    console.log('FAIL ' + what);
  }
  return cond;
};

let seed = 1;
const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);

/** A tree of `n` people: some families large, many childless, a few deep lines. */
function randomTree(n: number): { kids: Map<string, string[]>; root: string } {
  const kids = new Map<string, string[]>([['r', []]]);
  const ids = ['r'];
  for (let i = 1; i < n; i++) {
    // later people more often hang from recent ones: deep lines and wide generations both
    const p = ids[Math.max(0, ids.length - 1 - rnd(Math.min(ids.length, 1 + rnd(40))))];
    const id = 'p' + i;
    kids.get(p)!.push(id);
    kids.set(id, []);
    ids.push(id);
  }
  return { kids, root: 'r' };
}

function check(name: string, t: Tree, shape: Shape, people: number): Chart {
  const c = layout(t, shape);
  const seen = new Map<string, number>();
  for (const b of c.boxes) seen.set(b.id, (seen.get(b.id) ?? 0) + 1);
  ok(seen.size === people && [...seen.values()].every(v => v === 1), `${name}: everyone drawn once (${seen.size}/${people})`);
  // no two boxes overlap (sorted sweep)
  const bs = [...c.boxes].sort((a, b) => a.x - b.x);
  let overlaps = 0;
  for (let i = 0; i < bs.length; i++)
    for (let j = i + 1; j < bs.length && bs[j].x < bs[i].x + bs[i].w - 1e-6; j++)
      if (Math.abs(bs[j].y - bs[i].y) < c.boxH - 1e-6) overlaps++;
  ok(overlaps === 0, `${name}: no names overlap (${overlaps})`);
  // every line that leads to someone ends at their box (a father's own line, down from his box to the bar, aside)
  const at = new Map(c.boxes.map(b => [b.id, b]));
  let loose = 0;
  for (const l of c.lines) {
    const b = at.get(l.of);
    if (!b) {
      loose++;
      continue;
    }
    const [x0, y0] = l.pts[0];
    if (Math.abs(y0 - (b.y + c.boxH)) < 1e-3 && x0 >= b.x - 1e-3 && x0 <= b.x + b.w + 1e-3) continue;
    const [x, y] = l.pts[l.pts.length - 1];
    // a list's line ends beside the name (its tick), a child's on top of the box
    if (x < b.x - 1 || x > b.x + b.w + 1 || y < b.y - 1e-3 || y > b.y + c.boxH + 1e-3) loose++;
  }
  ok(loose === 0, `${name}: every line reaches its box (${loose} do not)`);
  return c;
}

const shapes: [string, Shape][] = [
  ['plain', { listFrom: Infinity, listRows: 99, gather: false, lanesFrom: Infinity, foldAbove: Infinity }],
  ['lists', { listFrom: 2, listRows: 6, gather: false, lanesFrom: Infinity, foldAbove: Infinity }],
  ['lists gathered, two levels', { listFrom: 2, listRows: 4, gather: true, lanesFrom: 3, foldAbove: Infinity }],
  ['folded', { listFrom: 2, listRows: 8, gather: true, lanesFrom: Infinity, foldAbove: 60 }],
  ['folded tight, years', { listFrom: 3, listRows: 12, gather: false, lanesFrom: Infinity, foldAbove: 30, years: true }],
  ['columns, opened up', { listFrom: 2, listRows: 5, gather: false, lanesFrom: Infinity, foldAbove: Infinity, columns: true, drop: 3.4 }],
];

const trees: { name: string; kids: Map<string, string[]>; root: string }[] = [];
for (const n of [1, 2, 7, 40, 300, 900]) trees.push({ name: `random ${n}`, ...randomTree(n) });
// the test family's shape, and a real family's if this copy has one (no names read)
for (const [name, file] of [['the test family', 'tests/e2e/fixture/family.json'], ['the family', 'data/family/family.json']]) {
  if (!fs.existsSync(file)) continue;
  const f = JSON.parse(fs.readFileSync(file, 'utf8'));
  const kids = new Map<string, string[]>([[f.root.id, []]]);
  for (const p of f.people) kids.set(p.id, kids.get(p.id) ?? []);
  for (const p of f.people) if (p.parent && kids.has(p.parent)) kids.get(p.parent)!.push(p.id);
  trees.push({ name, kids, root: f.root.id });
}

for (const tr of trees) {
  const count = (id: string): number => 1 + tr.kids.get(id)!.reduce((n, k) => n + count(k), 0);
  const people = count(tr.root);
  const t: Tree = { root: tr.root, kids: id => tr.kids.get(id) ?? [], width: id => 2.4 + (id.length % 5) * 0.7 };
  for (const [sn, shape] of shapes) {
    const c = check(`${tr.name}, ${sn}`, t, shape, people);
    if (shape.columns) {
      // sheets: no name across an edge, and the sheets cover the chart
      const order = new Map<string, number>();
      const walk = (id: string) => (order.set(id, order.size), t.kids(id).forEach(walk));
      walk(tr.root);
      for (const width of [40, 90]) {
        const r = cut(c, width, order);
        const across = r.chart.boxes.filter(b => r.sheets.some(([l]) => b.x < l - 1e-6 && b.x + b.w > l + 1e-6)).length;
        ok(across === 0, `${tr.name}, sheets ${width} wide: no name across an edge (${across})`);
        ok(r.sheets.length >= 1 && r.chart.minX >= r.sheets[r.sheets.length - 1][0] - 1e-6, `${tr.name}, sheets ${width} wide: they cover it (${r.sheets.length})`);
        const ids = new Set(r.chart.boxes.map(b => b.id));
        ok(ids.size === people, `${tr.name}, sheets ${width} wide: nobody lost`);
      }
    }
  }
}

// the order a line of the poster is seen in: right to left, numbers and Latin left to right
const seen = (s: string) => visualRuns(s).map(r => r.text).join('|');
ok(seen('١٩٢٠ – ١٩٩٥') === '١٩٩٥| – |١٩٢٠', 'years from–to: the birth on the right');
ok(seen('رمز النسخة 7K4Q-M29X') === '7K4Q-M29X|رمز النسخة ', 'a Latin code keeps its order, on the left');
ok(seen('اللوحة ٣ من ١٠') === '١٠| من |٣|اللوحة ', 'sheet n of m');
ok(seen('ت ١٩٩٥') === '١٩٩٥|ت ', 'death year only');

console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
