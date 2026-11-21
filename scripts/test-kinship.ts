// Every path between two people (src/data/kinship.ts, routes; design document
// 1.33), on small families made for it: double cousins through the fathers and
// through the mothers; brothers of both parents, of one, and of the mother; a
// wife who is also a cousin; in-laws both ways; a family married within itself
// for generations. And kin, the closest path, as it was.
//   node scripts/test-kinship.ts
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import type { FamilyData, Marriage, Person } from '../src/data/types.ts';

// the app's own modules, through Vite (they import one another without extensions)
const vite = await createServer({ configFile: false, root: path.resolve('.'), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
const { buildGraph } = await vite.ssrLoadModule('/src/data/graph.ts');
const { headline, kin, milkProblem, routes, termFor } = await vite.ssrLoadModule('/src/data/kinship.ts');
type Routes = { term: string; deg: number; top: string[]; kind: string; side: string | null; bside: string | null; via?: string; up: string[]; down: string[] }[];

let failed = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) failed++;
  console.log((cond ? 'PASS ' : 'FAIL ') + what);
};

/** A family from lines «id sex father mother», marriages «husband wife» and milk records «child nurse [father]» (an outside person: «id sex - - x»). */
function family(people: string, marriages: string[] = [], milk: string[] = []) {
  const ps: Person[] = [{ id: 'R', name: 'R', sex: 'm', familyRoot: true }];
  for (const line of people.trim().split('\n')) {
    const [id, sex, father, mother, ext] = line.trim().split(/\s+/);
    ps.push({ id, name: id, sex: sex as 'm' | 'f', ...(father && father !== '-' ? { father } : {}), ...(mother && mother !== '-' ? { mother } : {}), ...(ext === 'x' ? { external: true } : {}) });
  }
  const ms: Marriage[] = marriages.map((m, i) => {
    const [husband, wife] = m.split(' ');
    return { id: 'm' + i, husband, wife, status: 'married' };
  });
  const data: FamilyData = { family: { name: 'T' }, root: 'R', people: ps, marriages: ms, milk: milk.map((x, i) => { const [child, nurse, father] = x.split(' '); return { id: 'k' + i, child, nurse, ...(father ? { father } : {}) }; }) };
  return buildGraph(data);
}
const show = (rs: Routes) => rs.map(r => `${r.term}/${r.deg}${r.top.length ? '@' + r.top.join('+') : ''}`).join(' ; ');

// the founder R; his sons F1 and F2; F3, from outside, the father of two sisters W1 and W2
// F1 marries W1, F2 marries W2: their children C1 and C2 are double cousins
{
  const g = family(
    `F1 m R
     F2 m R
     F3 m
     W1 f F3
     W2 f F3
     C1 m F1 W1
     C2 m F2 W2
     C3 m F1 W1
     H1 m F1 X1
     X1 f -`,
    ['F1 W1', 'F2 W2', 'F1 X1'],
  );
  const rs: Routes = routes(g, 'C1', 'C2');
  ok(rs.filter(r => r.kind === 'blood').length === 2, 'double cousins: two blood routes: ' + show(rs));
  ok(rs.some(r => r.term === 'ابن عم' && r.deg === 4 && r.side === 'f') && rs.some(r => r.term === 'ابن خالة' && r.deg === 4 && r.side === 'm'), 'one «ابن عم» through the fathers, one «ابن خالة» through the mothers');
  ok(rs[0].term === 'ابن عم', 'the fathers\' line first');
  ok(headline(rs) === 'ابن عم، وابن خالة', 'headline: ' + headline(rs));
  // brothers of both parents: one route, through the couple
  const sib: Routes = routes(g, 'C1', 'C3');
  ok(sib.length === 1 && sib[0].term === 'أخ شقيق' && sib[0].top.join('+') === 'F1+W1', 'full brothers: one route through the couple: ' + show(sib));
  // of the father only
  const half: Routes = routes(g, 'C1', 'H1');
  ok(half.filter(r => r.kind === 'blood').length === 1 && half[0].term === 'أخ' && half[0].top.join() === 'F1', 'a brother through the father: ' + show(half));
  // kin, the closest, as before
  const k = kin(g, 'C1', 'C2')!;
  ok(k.deg === 4 && termFor(g, 'C1', 'C2', k) === 'ابن عم', 'kin: the closest path, as before');
}

// a wife who is also a cousin; and in-laws both ways
{
  const g = family(
    `A m R
     B m R
     M m A
     N f B
     K m M N
     S f B
     T m - S`,
    ['M N'],
  );
  const rs: Routes = routes(g, 'M', 'N');
  ok(rs[0].kind === 'spouse' && rs.some(r => r.kind === 'blood' && r.term === 'بنت عم'), 'a wife who is also a cousin: both: ' + show(rs));
  ok(headline(rs) === 'زوجة، وبنت عم', 'headline: ' + headline(rs));
  // through a marriage: the wife's sister is «أخت الزوجة»
  const inlaw: Routes = routes(g, 'M', 'S');
  ok(inlaw.some(r => r.kind === 'inlaw' && r.term === 'أخت الزوجة' && r.via === 'N'), 'her sister, through the marriage: ' + show(inlaw));
  ok(inlaw.some(r => r.kind === 'blood' && r.term === 'بنت عم'), 'and his cousin by blood as well');
}

// a cousin through his mother, related again through his father (design document 1.34):
// the founder's sons A and B; A's son G has a son P and a daughter Q; B's grandson L
// marries Q; P's son K and L's son F are cousins through G, and through L's line to
// the founder as well, though K's line passes G, whom F also comes from (by his mother)
{
  const g = family(
    `A m R
     B m R
     G m A
     P m G
     Q f G
     J m B
     L m J
     M f
     K m P M
     S f P M
     F m L Q
     F2 m L Q`,
    ['P M', 'L Q', 'F S'],
  );
  const rs: Routes = routes(g, 'K', 'F');
  const blood = rs.filter(r => r.kind === 'blood');
  ok(blood.length === 2, 'a cousin through his mother and his father: two blood routes: ' + show(rs));
  ok(blood[0].term === 'ابن عمة' && blood[0].deg === 4 && blood[0].bside === 'm', 'the closer through his mother: «ابن عمة»');
  const far = blood[1];
  ok(far && far.deg === 8 && far.top.join() === 'R' && far.down[1] === 'L' && far.side === 'f' && far.bside === 'f', 'the other through his father, to the founder: ' + (far ? `${far.deg} ${far.up.join('>')} | ${far.down.join('>')}` : 'none'));
  ok(headline(rs) === 'زوج أخت شقيقة، وابن عمة', 'headline: the marriage, then the closest blood: ' + headline(rs));
  // his brother: the brother first; his parents' own relation after, and the headline only the brother
  const sib: Routes = routes(g, 'F', 'F2');
  ok(sib.filter(r => r.kind === 'blood').length === 1 && sib[0].term === 'أخ شقيق' && headline(sib) === 'أخ شقيق', 'a brother whose parents are related: one blood route, the brother; how the parents are related is not a route between them: ' + show(sib));
  // half-brothers through the father whose mothers are sisters: cousins as well, a route of its own
  const h: Routes = routes(family('X m\nY1 f X\nY2 f X\nP m R\nH1 m P Y1\nH2 m P Y2', ['P Y1', 'P Y2']), 'H1', 'H2');
  ok(h.filter(r => r.kind === 'blood').map(r => r.term).join() === 'أخ,ابن خالة', 'half-brothers whose mothers are sisters: «أخ» and «ابن خالة»: ' + show(h));
  const k = kin(g, 'K', 'F')!;
  ok(k.deg === 2 && k.kind === 'inlaw', 'kin: still the closest, the marriage to his sister');
}

// milk kinship (design document 1.36): X was nursed by W, F's wife; S and D are
// F and W's children; U is W's brother, his daughter V; Z is X's son; B is X's
// brother. Y, from another line, was nursed by W too. Q was nursed by O, a woman
// from outside married to no one in the tree.
{
  const g = family(
    `A m R
     C m R
     P m A
     X m P
     B m P
     Z m X
     F m C
     E m C
     W f E
     U m E
     V f U
     S m F W
     D f F W
     H m C
     Y m H
     Q m H
     O f - - x`,
    ['F W'],
    ['X W F', 'Y W', 'Q O'],
  );
  const one = (a: string, b: string) => (routes(g, a, b) as Routes).filter(r => r.kind === 'milk');
  const sib = one('X', 'S');
  ok(sib.length === 1 && sib[0].term === 'أخ من الرضاعة' && sib[0].deg === 2 && sib[0].top.join('+') === 'F+W', 'his milk brother: one route, through the milk parents: ' + show(sib));
  ok(one('X', 'D')[0]?.term === 'أخت من الرضاعة', 'his milk sister: «أخت من الرضاعة»');
  ok(one('X', 'W')[0]?.term === 'أم من الرضاعة' && one('X', 'F')[0]?.term === 'أب من الرضاعة', 'his milk mother and milk father');
  ok(one('X', 'U')[0]?.term === 'خال من الرضاعة' && one('X', 'U')[0]?.deg === 3, 'his milk mother\'s brother: «خال من الرضاعة»');
  ok(one('Z', 'D')[0]?.term === 'عمة من الرضاعة', 'his son, to his milk sister: «عمة من الرضاعة»: ' + show(one('Z', 'D')));
  ok(one('B', 'S').length === 0 && one('P', 'W').length === 0, 'his brother and his father are not related to them by milk');
  ok(one('X', 'Y')[0]?.term === 'أخ من الرضاعة' && one('X', 'Y')[0]?.top.join() === 'W', 'two nursed by the same woman: milk brothers, through her');
  const rs: Routes = routes(g, 'X', 'S');
  ok(headline(rs).startsWith('أخ من الرضاعة'), 'the headline names it: ' + headline(rs));
  ok(rs.some(r => r.kind === 'blood' && r.term === 'ابن ابن عم الأب'), 'and the blood route stays: ' + show(rs));
  // for privacy, his milk family counts as his own: for him only
  ok(kin(g, 'X', 'W')?.deg === 1 && kin(g, 'X', 'W')?.kind === 'milk', 'kin: he sees his milk mother as 1st degree');
  ok(kin(g, 'X', 'D')?.deg === 2 && kin(g, 'X', 'Y')?.deg === 2, 'kin: his milk sister and the other she nursed as 2nd degree');
  ok(kin(g, 'W', 'X')?.kind !== 'milk' && kin(g, 'B', 'W')?.kind !== 'milk', 'kin: not the other way, and not for his brother');
  // the marriage check: what would bar it by birth
  ok(!!milkProblem(g, 'X', 'D') && !!milkProblem(g, 'Z', 'D') && !!milkProblem(g, 'X', 'W'), 'a milk sister, a milk aunt, a milk mother: a warning');
  ok(!milkProblem(g, 'X', 'V') && !milkProblem(g, 'B', 'D'), 'a milk cousin, his brother and her: none');
  // a nurse from outside: in the tree by name only, a generation above the child
  ok(one('Q', 'O')[0]?.term === 'أم من الرضاعة' && g.nodes.get('O').gen === g.nodes.get('Q').gen - 1 && g.nodes.get('O').branch === g.nodes.get('Q').branch, 'a nurse from outside: his milk mother, placed with him');
}

// married within itself for generations: routes stay few, the closest first, none through another meeting
{
  let ppl = 'G0a m R\nG0b f R\n';
  // two lines, each generation's son marrying the other line's daughter
  for (let i = 1; i <= 7; i++) {
    ppl += `S${i} m ${i === 1 ? 'G0a' : 'S' + (i - 1)} ${i === 1 ? 'G0b' : 'D' + (i - 1)}\n`;
    ppl += `D${i} f ${i === 1 ? 'G0a' : 'S' + (i - 1)} ${i === 1 ? 'G0b' : 'D' + (i - 1)}\n`;
  }
  const mar = ['G0a G0b', ...Array.from({ length: 6 }, (_, i) => `S${i + 1} D${i + 1}`)];
  const g = family(ppl, mar);
  const t0 = performance.now();
  const rs: Routes = routes(g, 'S7', 'D7');
  const ms = performance.now() - t0;
  ok(rs.length >= 1 && rs.length <= 12 && rs[0].deg === 2, `brother and sister of a family married within itself: ${rs.length} routes, the closest first (${show(rs.slice(0, 3))}), ${ms.toFixed(1)} ms`);
  ok(rs.filter(r => r.kind === 'blood').every(r => r.top.length > 0 && !r.up.some(x => r.down.includes(x))), 'no route touches itself below its top');
  // a son of the last couple and his father's sister's son, in that family: several real routes, each meeting lowest
  const g2 = family(ppl + 'Z m S7 D7\nQ m X D6\nX m -\n', mar);
  const rq: Routes = routes(g2, 'Z', 'Q');
  ok(rq.filter(r => r.kind === 'blood').length >= 2 && rq.every(r => r.kind !== 'blood' || !r.up.some(x => r.down.includes(x))), `a cousin through both sides there: ${show(rq)}`);
}

// the test family's shape (tests/e2e/fixture, 800 people): every pair of a sample stays quick
{
  const raw = JSON.parse(fs.readFileSync('tests/e2e/fixture/family.json', 'utf8'));
  const people: Person[] = [{ ...raw.root }, ...raw.people.map((p: Record<string, unknown>) => ({ id: p.id, name: 'x', sex: p.sex, ...(p.parent ? { father: p.parent } : {}), ...(p.mother ? { mother: p.mother } : {}) }))];
  const g = buildGraph({ family: { name: 'x' }, root: raw.root.id, people, marriages: raw.marriages });
  const ids = [...g.nodes.keys()].filter((_, i) => i % 23 === 0);
  const t0 = performance.now();
  let pairs = 0, many = 0;
  for (const a of ids) for (const b of ids) if (a < b) { pairs++; if ((routes(g, a, b) as Routes).filter(r => r.kind === 'blood').length > 1) many++; }
  const ms = performance.now() - t0;
  ok(ms / pairs < 20, `the family's shape: ${pairs} pairs in ${ms.toFixed(0)} ms (${many} with more than one blood route)`);
}

await vite.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
