// Choosing what to export, in the export sheet itself (design document 1.31):
// the line from the founder down to the choice, the branches or houses under
// it, and anyone found by name. The root admin goes from the whole family to a
// branch, to a house, and back; a title typed is dropped with another choice; a
// gold's choices stay inside his branch.
//   node export-pick.mjs BASE admin-link-file
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const until = async (fn, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(400)) if (await fn().catch(() => false)) return true;
  return false;
};
const tab = async (p, name) => { await p.evaluate(n => [...document.querySelectorAll('.tab')].find(e => e.textContent.includes(n))?.click(), name); await wait(600); };
const lastLink = p => p.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}'); const sk = Object.values(inv).pop(); return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null; });
const invite = async (A, id) => {
  await store(A, (m, id) => m.createInvite(id, 'x', true), id);
  await wait(1200);
  await store(A, m => m.set({ inviteOpen: null }));
  return lastLink(A);
};
const title = p => p.evaluate(() => document.querySelector('.exp .who2 b')?.textContent ?? '');
const path = p => p.evaluate(() => [...document.querySelectorAll('.exp .exppath > *')].filter(e => !e.classList.contains('sep')).map(e => (e.tagName === 'BUTTON' ? 'link:' : e.tagName === 'B' ? 'cur:' : 'text:') + e.textContent));
const chips = p => p.evaluate(() => [...document.querySelectorAll('.exp .chips2 .chip')].map(c => c.textContent));
const tapChip = (p, text) => p.evaluate(t => { const c = [...document.querySelectorAll('.exp .chips2 .chip')].find(x => x.textContent === t); c?.click(); return !!c; }, text);
const tapPath = (p, text) => p.evaluate(t => { const c = [...document.querySelectorAll('.exp .exppath button')].find(x => x.textContent === t); c?.click(); return !!c; }, text);
const settle = p => until(() => p.evaluate(() => !!document.querySelector('.expsvg svg') && !document.querySelector('.expbusy')), 90000);

try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  const P = await store(A, m => {
    const g = m.getState().graph;
    const [B, S] = [...g.branches].sort((a, b) => g.nodes.get(b).desc - g.nodes.get(a).desc);
    const G = [...g.nodes.values()].find(n => n.sex === 'm' && !n.dead && n.birth && n.birth.v < 1995 && n.branch === B && n.id !== B && n.kids.length >= 2);
    const inS = [...g.nodes.values()].find(n => n.branch === S && n.id !== S && n.sex === 'm' && n.kids.length);
    const inB = [...g.nodes.values()].find(n => n.branch === B && n.id !== B && n.sex === 'm' && n.kids.length && n.id !== G.id);
    return { B, bName: g.nodes.get(B).name, S, G: G.id, inS: inS.id, inSName: inS.name, inB: inB.id, inBName: inB.name };
  });

  // the root admin, from «الإدارة»: the whole family, its branches to choose from
  await tab(A, 'الإدارة');
  await click(A, 'تصدير شجرة الأسرة', '.page button', 600);
  ok(await settle(A), 'the whole family drawn');
  ok((await path(A)).join('|') === 'cur:الأسرة كاملة', 'the line: the whole family, chosen');
  const c0 = await chips(A);
  ok(c0.includes('فرع ' + P.bName) && c0.every(c => c.startsWith('فرع ')), 'the branches offered: ' + c0.length);
  ok(await tapChip(A, 'فرع ' + P.bName), 'the big branch chosen');
  ok(await settle(A), 'drawn again');
  ok((await title(A)).startsWith('فرع ' + P.bName), 'titled as the branch: ' + (await title(A)));
  ok((await path(A)).join('|') === `link:الأسرة كاملة|cur:${P.bName}`, 'the line: the family (a tap away), then the branch');
  const c1 = await chips(A);
  ok(c1.length > 0 && c1.every(c => c.startsWith('بيت ')), 'its houses offered: ' + c1.length);
  ok(await tapChip(A, c1[0]), 'a house chosen');
  ok(await settle(A), 'drawn again');
  ok((await title(A)).startsWith(c1[0]), 'titled as the house');
  const hp = await path(A);
  ok(hp.length >= 3 && hp[0] === 'link:الأسرة كاملة' && hp[1] === 'link:' + P.bName && hp[hp.length - 1] === 'cur:' + c1[0].replace('بيت ', ''), 'the line: family, branch, … house: ' + hp.join('|'));
  // a title typed goes with another choice
  await A.evaluate(() => { const i = document.querySelector('.exp input.bigin'); i.value = 'عنوان خاص'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(300);
  ok((await title(A)) === 'عنوان خاص', 'a title typed');
  ok(await tapPath(A, P.bName), 'back to the branch from the line');
  await wait(400);
  ok((await title(A)).startsWith('فرع ' + P.bName), 'the title is the branch\'s again');
  ok(await tapPath(A, 'الأسرة كاملة'), 'and up to the whole family');
  await wait(400);
  ok((await title(A)).startsWith('شجرة أسرة'), 'titled as the family');
  // anyone, by name: the search opens over the sheet
  await click(A, 'اختيار شخص آخر…', '.exp button', 500);
  ok(await A.evaluate(() => document.querySelector('.searchpage .shead')?.textContent.includes('تصدير شجرة من')), 'the search opens, over the sheet');
  await A.type('.sfield input', P.inSName, { delay: 10 });
  await wait(700);
  ok(await A.evaluate(id => { const r = [...document.querySelectorAll('.results .prow')]; r[0]?.click(); return r.length > 0; }, P.inS), 'found by name');
  await wait(600);
  ok(await settle(A), 'drawn for whom was picked');
  ok(!(await A.evaluate(() => !!document.querySelector('.searchpage'))), 'the search closed, the sheet stays');

  // a gold: his branch's line and houses only
  await store(A, (m, a) => m.appoint('gold', a.B, a.G), P);
  ok(await until(() => store(A, (m, a) => m.getState().seats.some(x => x.tier === 'gold' && x.holder === a.G), P)), 'G is gold of the big branch');
  const G = await t.phone('G', await invite(A, P.G));
  ok(await click(G, 'نعم، أنا', '.join button', 2000), 'G joins');
  await tab(G, 'أنا');
  await click(G, 'تصدير شجرة فرعي', '.page button', 600);
  ok(await settle(G), "G's branch drawn");
  const gp = await path(G);
  ok(gp[0] === 'text:الأسرة كاملة' && gp[1] === 'cur:' + P.bName, 'the family above his branch is shown, not offered: ' + gp.join('|'));
  ok((await chips(G)).every(c => c.startsWith('بيت ')), 'only houses of his branch offered');
  await click(G, 'اختيار شخص آخر…', '.exp button', 500);
  await G.type('.sfield input', P.inSName, { delay: 10 });
  await wait(700);
  // the names are made up and repeat across branches: whatever the search offers him, picking it stays in his branch
  const offered = await G.evaluate(() => [...document.querySelectorAll('.results .prow')].length);
  if (offered) {
    await G.evaluate(() => document.querySelector('.results .prow').click());
    await wait(600);
  } else await click(G, '', '.shead button.round', 400);
  ok(await store(G, (m, a) => { const s = m.getState(); return s.graph.nodes.get(s.exportFor.from).branch === a.B; }, P), `the search offers only his branch (${offered} found for a name from the other)`);
  await click(G, 'اختيار شخص آخر…', '.exp button', 500);
  await G.type('.sfield input', P.inBName, { delay: 10 });
  await wait(700);
  ok((await G.evaluate(() => [...document.querySelectorAll('.results .prow')].length)) > 0, 'someone in his branch is found');
  await G.evaluate(() => document.querySelector('.results .prow')?.click());
  await wait(600);
  ok(await settle(G), 'and drawn');
} catch (e) {
  ok(false, 'threw: ' + (e?.stack ?? e));
}
await t.finish();
