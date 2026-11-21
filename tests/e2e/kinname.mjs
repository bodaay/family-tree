// A daughter's children named like anyone's: with a husband from outside, a child
// takes the given name alone and his father's full name follows it, everywhere
// (the profile, lists, search); a child linked later with «ربط أبناء» follows it
// too, and a name typed in full stays as typed. And a spouse typed «من خارج
// العائلة» whose name is someone's in the tree offers that person, to choose
// from the family instead; on a member's phone, never a woman hidden from him.
// Needs a fresh local family.  node kinname.mjs BASE admin-link-file [shots]
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok, shot } = t;
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const next = (p, pause = 500) => click(p, 'التالي', '.addsheet .foot button', pause);
const text = (p, sel) => p.evaluate(s => document.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() ?? '', sel);
const HUSBAND = 'سعد بن محمد القحطاني';
const kidOf = (p, mother, name) => store(p, (m, a) => [...m.getState().graph.nodes.values()].find(n => n.mother === a.mother && n.name === a.name)?.id ?? null, { mother, name });
const nasabOf = (p, id) => mod(p, '/src/data/graph.ts', (G, id) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(S => G.nasab(S.getState().graph, id, 4)), id);
const openLink = async (p, who, spouseName) => {
  await store(p, (m, id) => m.set({ profile: id }), who); await wait(800);
  const found = await p.evaluate(n => { const c = [...document.querySelectorAll('.page.profile .card.fam')].find(x => x.textContent.includes(n)); const b = c && [...c.querySelectorAll('button.link')].find(x => x.textContent.includes('ربط أبناء')); b?.click(); return !!b; }, spouseName);
  await wait(700);
  return found;
};
const tickRow = (p, name) => p.evaluate(n => { const b = [...document.querySelectorAll('.addsheet .parentpick .brow')].find(x => x.querySelector('b').textContent === n); if (b && !b.classList.contains('on')) b.click(); return !!b; }, name);
const likely = p => p.evaluate(() => [...document.querySelectorAll('.addsheet .likely .prow')].map(r => r.innerText.replace(/\s+/g, ' ').trim()));
const typeName = async (p, v) => {
  await p.evaluate(() => { const i = document.querySelector('.addsheet input.bigin'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.type('.addsheet input.bigin', v, { delay: 6 });
  await wait(500);
};
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);

  // a daughter with no marriage, and a husband from outside for her
  const D = await store(A, m => { const g = m.getState().graph; return [...g.nodes.values()].find(n => n.sex === 'f' && !n.external && !n.familyRoot && n.by && n.by > 1960 && n.by < 1995 && !g.marriages.some(x => x.wife === n.id) && !n.kids.length)?.id; });
  ok(!!D, 'a daughter of the family to test with');
  await store(A, (m, id) => m.set({ spouseFor: id, spousePick: null }), D); await wait(700);
  await typeName(A, HUSBAND);
  ok((await likely(A)).length === 0, 'a name from another family offers no one');
  await click(A, 'حفظ', '.addsheet .foot button', 1500);
  const H = await store(A, (m, id) => { const g = m.getState().graph; const x = g.marriages.find(x => x.wife === id); return x ? x.husband : null; }, D);
  ok(!!H, 'her husband from outside is recorded');

  // a son: the given name alone
  await store(A, (m, id) => m.set({ spouseFor: null, profile: id }), D); await wait(900);
  await click(A, 'إضافة ابن أو ابنة', '.page.profile button.link');
  ok((await text(A, '.addsheet .card.list .brow.on b')).includes('سعد'), 'the father is chosen: her husband');
  await next(A);
  await click(A, 'ابن', '.addsheet .bigchoice button', 300);
  await next(A);
  ok((await text(A, '.addsheet .q')) === 'ما اسمه؟' && (await text(A, '.addsheet .qh')).includes('الاسم الأول فقط'), 'it asks the given name only · ' + (await text(A, '.addsheet .qh')));
  await A.type('.addsheet input.bigin', 'سلمان', { delay: 8 });
  await wait(300);
  const chain = await text(A, '.addsheet .who2 b');
  ok(chain === 'سلمان بن ' + HUSBAND, 'the name is built from his father\'s · ' + chain);
  ok((await text(A, '.addsheet .who2 small')).startsWith('الأم: '), 'and names the mother under it');
  if (process.argv[4]) await A.screenshot({ path: process.argv[4] + '/kinname-step.png' });
  await next(A, 600);
  await A.evaluate(() => [...document.querySelectorAll('.addsheet label.opt')].find(l => l.innerText.includes('غير معروفة'))?.querySelector('input').click());
  await next(A, 500);
  ok((await text(A, '.addsheet .card.review')).includes('سلمان بن ' + HUSBAND), 'the review shows the whole name');
  await click(A, 'إضافة إلى الشجرة', '.addsheet .foot button', 2200);
  const S = await kidOf(A, D, 'سلمان');
  const rec = await store(A, (m, id) => { const n = m.getState().graph.nodes.get(id); return { father: n.father, mother: n.mother, parent: n.parent }; }, S);
  ok(S && rec.father === H && rec.mother === D && rec.parent === D, 'saved as «سلمان», his father recorded, in the tree under his mother');
  ok((await nasabOf(A, S)) === 'بن ' + HUSBAND, 'his nasab is his father\'s full name');
  await store(A, (m, id) => m.set({ profile: id }), S); await wait(900);
  const ns = await text(A, '.page.profile .ns');
  ok(ns.startsWith('بن ' + HUSBAND) && ns.includes('أمه '), 'his profile: his father, then his mother · ' + ns);
  if (process.argv[4]) await A.screenshot({ path: process.argv[4] + '/kinname-profile.png' });
  await store(A, m => m.set({ profile: null, searchOpen: 'focus' })); await wait(500);
  await A.type('.sfield input', 'سلمان سعد', { delay: 8 }); await wait(700);
  const found = await A.evaluate(() => [...document.querySelectorAll('.results .prow')].map(r => r.innerText.replace(/\s+/g, ' ')));
  ok(found.some(x => x.includes('سلمان') && x.includes('بن ' + HUSBAND)), 'search «سلمان سعد» finds him, his father\'s name in the list · ' + found.slice(0, 2).join(' | '));
  await store(A, m => m.set({ searchOpen: false }));

  // children added before their father was: linked with «ربط أبناء»
  await store(A, (m, id) => m.addChildTx(id, { name: 'نورة', sex: 'f' }, true, null), D); await wait(1200);
  await store(A, (m, id) => m.addChildTx(id, { name: 'فهد بن سعد القحطاني', sex: 'm' }, true, null), D); await wait(1200);
  const N = await kidOf(A, D, 'نورة'), F = await kidOf(A, D, 'فهد بن سعد القحطاني');
  ok((await nasabOf(A, N)) === '', 'with no father recorded, her name stands alone');
  ok(await openLink(A, D, 'سعد'), 'her card for her husband has «ربط أبناء»');
  await tickRow(A, 'سلمان'); await tickRow(A, 'نورة'); await tickRow(A, 'فهد بن سعد القحطاني');
  await click(A, 'حفظ', '.addsheet .foot button', 1500);
  ok((await store(A, (m, a) => a.map(id => m.getState().graph.nodes.get(id).father), [S, N, F])).every(x => x === H), 'all three now have him as their father');
  ok((await nasabOf(A, N)) === 'بنت ' + HUSBAND, 'linked later, her name follows her father\'s');
  ok((await nasabOf(A, F)) === '', 'a name typed in full stays as typed, his father not added twice');
  const titles = await store(A, (m, ids) => m.getState().txs.filter(t => t.ops.some(o => o.op === 'addPerson' && ids.includes(o.person.id))).map(t => t.title), [S, F]);
  ok(titles.some(x => x.startsWith('إضافة ابن: سلمان بن ' + HUSBAND)) && titles.some(x => x.startsWith('إضافة ابن: فهد بن سعد القحطاني ·')), 'the record titles: «سلمان» with his father, the full name as typed · ' + titles.join(' | '));
  await store(A, (m, id) => m.set({ profile: id }), N); await wait(900);
  ok((await text(A, '.page.profile .ns')).startsWith('بنت ' + HUSBAND), 'her profile reads «بنت ' + HUSBAND + '»');
  await store(A, m => m.set({ profile: null }));

  // a wife typed from outside who is in the tree: offered, and chosen from the family
  const pair = await mod(A, '/src/data/marriages.ts', M => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(S => {
    const g = S.getState().graph;
    const men = [...g.nodes.values()].filter(n => n.sex === 'm' && !n.external && !n.familyRoot && n.by && n.by > 1950 && n.by < 1995 && !g.marriages.some(x => x.husband === n.id));
    const women = [...g.nodes.values()].filter(n => n.sex === 'f' && !n.external && !n.familyRoot && n.by && n.by > 1960 && n.by < 1998 && n.parent && n.parent === n.father && !g.marriages.some(x => x.wife === n.id));
    for (const w of women) for (const m of men) if (!M.spouseProblem(g, m.id, w.id, 'married')) return { m: m.id, w: w.id, typed: w.name + ' بنت ' + g.nodes.get(w.parent).name + ' ' + g.family.name, first: w.name, father: g.nodes.get(w.parent).name };
    return null;
  }));
  ok(!!pair, 'a man and a woman of the family who may marry');
  await store(A, (m, id) => m.set({ spouseFor: id, spousePick: null }), pair.m); await wait(700);
  await typeName(A, pair.first);
  ok((await likely(A)).length === 0, 'her given name alone offers no one (too many share it)');
  await typeName(A, pair.first + ' بنت ' + pair.father.slice(0, -1));
  ok((await likely(A)).length === 0, 'a father\'s name still being typed offers no one');
  await typeName(A, pair.typed);
  let rows = await likely(A);
  ok(rows.length >= 1 && rows.some(r => r.includes(pair.first) && r.includes('بنت ' + pair.father)), 'her name with her father\'s and the family\'s offers her · ' + rows.slice(0, 2).join(' | '));
  ok((await text(A, '.addsheet .warnbox')).includes('في الشجرة من تحمل هذا الاسم'), 'with «في الشجرة من تحمل هذا الاسم»');
  if (process.argv[4]) await A.screenshot({ path: process.argv[4] + '/kinname-likely.png' });
  await A.evaluate(f => { const r = [...document.querySelectorAll('.addsheet .likely .prow')].find(x => x.innerText.includes(f)); r?.click(); }, 'بنت ' + pair.father);
  await wait(600);
  ok((await text(A, '.addsheet .seg button.on')) === 'من العائلة' && (await store(A, m => m.getState().spousePick)) === pair.w, 'a tap chooses her from the family');
  ok((await text(A, '.addsheet .picked1')).includes(pair.first), 'and shows her as chosen');
  await click(A, 'من خارج العائلة', '.addsheet .seg button', 400);
  await typeName(A, 'هيا بنت سعد العتيبي');
  ok((await likely(A)).length === 0, 'a name from another family offers no one');
  await click(A, 'إلغاء', '.addsheet .foot button', 500);

  // a member's phone: never a woman hidden from him
  await store(A, m => m.set({ spouseFor: null }));
  await A.evaluate(() => [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة'))?.click()); await wait(600);
  await click(A, 'دعوة فرد', '.page button', 600);
  await A.type('.sfield input', 'مشاري', { delay: 8 }); await wait(600);
  await A.evaluate(() => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes('1985'))?.click()); await wait(1500);
  const link = await A.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}'); const sk = Object.values(inv).pop(); return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null; });
  await click(A, 'إغلاق', '.mhead button', 400);
  const B = await t.phone('B', link);
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'a member joins');
  const me = await store(B, m => m.getState().me);
  // at the 3rd degree every woman he sees is too close to marry: the family sets the 5th
  await store(A, m => m.setReach(5)); await wait(1500);
  for (let i = 0; i < 20 && (await store(B, m => m.getState().reach)) !== 5; i++) await wait(500);
  const two = await mod(B, '/src/data/marriages.ts', (M, me) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(S => {
    const s = S.getState(), g = s.graph;
    const ok = n => n.sex === 'f' && !n.external && !n.familyRoot && n.parent && n.parent === n.father && !M.spouseProblem(g, me, n.id, 'divorced');
    const all = [...g.nodes.values()].filter(ok);
    const hid = all.find(n => !S.canSee(s, n.id));
    const vis = all.find(n => S.canSee(s, n.id));
    return { hid: hid?.id, vis: vis?.id };
  }), me);
  const typed = id => store(A, (m, id) => { const g = m.getState().graph; const n = g.nodes.get(id); return n.name + ' بنت ' + g.nodes.get(n.parent).name; }, id);
  ok(two.hid && two.vis, 'a woman hidden from him, and one he sees');
  await store(B, (m, id) => m.set({ spouseFor: id, spousePick: null }), me); await wait(700);
  await typeName(B, await typed(two.hid));
  // what matches her name, and what of it his phone may offer
  const m2 = await mod(B, '/src/data/names.ts', (N, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(S => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/marriages.ts')).then(M => {
    const s = S.getState(), g = s.graph;
    const all = N.namedLike(g, a.typed, 'f').filter(x => !M.spouseProblem(g, a.me, x, 'divorced'));
    return { matches: all.includes(a.hid), may: all.filter(x => S.canSee(s, x)).length, all: all.length };
  })), { typed: await typed(two.hid), me, hid: two.hid });
  rows = await likely(B);
  // after the move to per-person keys her name is not on his phone at all: nothing to match, nothing offered
  const moved = await store(B, m => m.getState().sealedEra);
  ok(moved ? !m2.matches && rows.length === 0 : m2.matches && rows.length === Math.min(5, m2.may) && m2.may < m2.all, (moved ? 'her name is not on his phone at all, so she is not offered · ' : 'her name matches her, but she is not offered on his phone · ') + rows.length + ' shown, ' + m2.all + ' match');
  ok(!rows.some(r => /^(ابنة|امرأة)\b/.test(r)), 'no hidden woman in the list');
  await typeName(B, await typed(two.vis));
  ok((await likely(B)).length >= 1, 'a woman he sees is offered');
  await t.finish();
} catch (e) { await t.crash(e); }
