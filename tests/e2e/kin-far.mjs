// The relation screen for a cousin through his mother who is related again through his father (made-up family, design document 1.34).
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
const out = process.env.OUT;
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
try {
  await t.launch();
  const A = await t.phone('A', t.base + '/');
  await click(A, 'جرّب العائلة التجريبية', 'button', 1500);
  await click(A, 'تصفّح', 'button', 800);
  // the founder سالم; his sons حمد and ناصر; حمد's son راشد has a son ماجد and a daughter هيا;
  // ناصر's grandson زيد marries هيا; ماجد's son خالد and زيد's son ثامر; ثامر marries خالد's sister نورة
  const people = `A حمد m R
B ناصر m R
G راشد m A
P ماجد m G
Q هيا f G
J سعد m B
L زيد m J
M منيرة f
K خالد m P M
S نورة f P M
F ثامر m L Q`.split('\n').map(l => { const [id, name, sex, father, mother] = l.split(' '); return { id, name, sex, ...(father ? { father } : {}), ...(mother ? { mother } : {}) }; });
  const graph = await mod(A, '/src/data/graph.ts', (m, a) => (window.__g = m.buildGraph(a), true), { family: { name: 'ت' }, root: 'R', people: [{ id: 'R', name: 'سالم', sex: 'm', familyRoot: true }, ...people], marriages: [['P', 'M'], ['L', 'Q'], ['F', 'S']].map(([husband, wife], i) => ({ id: 'm' + i, husband, wife, status: 'married' })) });
  ok(graph, 'a made-up family in the page');
  await mod(A, '/src/data/store.ts', m => m.set({ graph: window.__g, relA: 'K', relB: 'F', tab: 'relation' }));
  await wait(1200);
  const h = await A.evaluate(() => document.querySelector('.relsum h2')?.textContent);
  ok(h === 'زوج أخت شقيقة، وابن عمة', 'the headline: his sister\'s husband, and his cousin: ' + h);
  const rows = await A.evaluate(() => [...document.querySelectorAll('.kinroutes .prow')].map(r => r.innerText.replace(/\n/g, ' | ')));
  console.log('   rows:', JSON.stringify(rows));
  ok(rows.length === 3 && rows[1].startsWith('4') && rows[2].startsWith('8'), 'three routes: the marriage, the cousin, and the long one');
  ok(/أبي خالد وأم ثامر|أبي خالد و أم ثامر/.test(rows[1]) && /أبي خالد وأبي ثامر/.test(rows[2]), 'each names the parent it goes through on both sides: ' + rows[1] + ' / ' + rows[2]);
  ok(/سالم/.test(rows[2]), 'the long one meets at the founder');
  await A.evaluate(() => document.querySelectorAll('.kinroutes .prow')[2].click());
  await wait(500);
  const top = await A.evaluate(() => [...document.querySelectorAll('.ladder .rung.lca b')].map(b => b.textContent));
  ok(top.join() === 'سالم', 'the long route drawn, the founder at the top: ' + top.join());
  await A.screenshot({ path: out + '/far1.png', fullPage: true });
} catch (e) {
  ok(false, 'threw: ' + (e?.stack ?? e));
}
await t.finish();
