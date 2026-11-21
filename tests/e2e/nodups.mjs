// The "already in the tree?" question is off: names repeat in the family, so
// adding goes straight on. A brother by the same name, a cousin by the same
// name and father's name born the same year, and a line of names from «إضافة
// سلسلة نسب»: no sheet, no warning, each added; «للتمييز» stays in the editor.
// Needs a fresh local family.  node nodups.mjs BASE admin-link-file [shots]
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok, shot } = t;
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const next = (p, pause = 500) => click(p, 'التالي', '.addsheet .foot button', pause);
const asked = p => p.evaluate(() => !!document.querySelector('.modal.dups') || !!document.querySelector('.addsheet .warnbox'));
const sons = (p, father, name) => store(p, (m, a) => { const g = m.getState().graph; return g.nodes.get(a.father).kids.map(k => g.nodes.get(k)).filter(k => k.name === a.name).map(k => ({ id: k.id, suffix: k.suffix ?? null })); }, { father, name });
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  ok((await mod(A, '/src/ui/Duplicates.tsx', m => m.CHECK_DUPLICATES)) === false, 'the check is switched off, its code kept');

  // a brother by the same name
  const pick = await store(A, m => {
    const g = m.getState().graph;
    for (const n of g.nodes.values()) {
      if (n.familyRoot || n.sex !== 'm' || g.marriages.some(x => x.husband === n.id)) continue;
      const son = n.kids.map(k => g.nodes.get(k)).find(k => k.sex === 'm' && !k.suffix && !/\s/.test(k.name) && n.kids.filter(x => g.nodes.get(x).name === k.name).length === 1);
      if (son) return { father: n.id, son: son.id, name: son.name };
    }
    return null;
  });
  ok(!!pick, 'a father and son to test with');
  const would = await mod(A, '/src/data/names.ts', (m, p) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(S => m.likelyDuplicates(S.getState().graph, p.name, { id: p.father }, undefined, 'm')), pick);
  ok(would.includes(pick.son), 'the old check would have asked about his brother');
  await store(A, (m, id) => m.set({ profile: id }), pick.father); await wait(900);
  await click(A, 'إضافة ابن أو ابنة', '.page.profile button.link');
  await click(A, 'ابن', '.addsheet .bigchoice button', 300);
  await next(A);
  await A.type('.addsheet input.bigin', pick.name, { delay: 8 });
  await wait(400);
  ok(!(await asked(A)), 'typing his brother\'s name: no warning');
  await next(A, 700);
  ok(!(await asked(A)) && (await A.evaluate(() => document.querySelector('.addsheet .q')?.textContent.includes('متى'))), '«التالي» goes straight to the birth year');
  await A.evaluate(() => [...document.querySelectorAll('.addsheet label.opt')].find(l => l.innerText.includes('غير معروفة'))?.querySelector('input').click());
  await next(A, 500);
  const review = await A.evaluate(() => document.querySelector('.addsheet .card.review')?.innerText.replace(/\s+/g, ' ') ?? '');
  ok(!review.includes('يصبح'), 'the review marks no one');
  await click(A, 'إضافة إلى الشجرة', '.addsheet .foot button', 2200);
  ok(!(await asked(A)), 'adding asks nothing');
  const two = await sons(A, pick.father, pick.name);
  ok(two.length === 2 && two.every(x => !x.suffix), 'both brothers are in the tree, unmarked');
  ok(!(await A.evaluate(() => !!document.querySelector('.overlay.full .addsheet'))), 'and the form is closed');

  // a cousin: the same name and father's name, born the same year
  const c = await mod(A, '/src/data/names.ts', m => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(S => {
    const g = S.getState().graph;
    for (const x of g.nodes.values()) {
      if (x.familyRoot || x.sex !== 'm' || x.by == null || !x.parent || x.suffix) continue;
      const fk = m.keysOf(g.nodes.get(x.parent));
      const q = [...g.nodes.values()].find(q => q.id !== x.parent && q.sex === 'm' && !q.familyRoot && !q.external && [...m.keysOf(q)].some(k => fk.has(k)) && !q.kids.some(k => g.nodes.get(k).name === x.name));
      if (q && m.likelyDuplicates(g, x.name, { id: q.id }, { v: x.by, cal: 'g' }, 'm').includes(x.id)) return { x: x.id, name: x.name, by: x.by, q: q.id };
    }
    return null;
  }));
  ok(!!c, 'a cousin the old check would have asked about');
  await store(A, (m, id) => m.set({ profile: id }), c.q); await wait(900);
  await click(A, 'إضافة ابن أو ابنة', '.page.profile button.link');
  await click(A, 'ابن', '.addsheet .bigchoice button', 300);
  await next(A);
  await A.type('.addsheet input.bigin', c.name, { delay: 8 });
  await next(A, 700);
  await A.evaluate(async y => {
    const seg = [...document.querySelectorAll('.addsheet .bigseg button')].find(b => b.textContent === 'ميلادي');
    seg?.click();
    await new Promise(r => setTimeout(r, 200));
    const r = document.querySelector('.addsheet input.range');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, String(y));
    r.dispatchEvent(new Event('input', { bubbles: true }));
  }, c.by);
  await wait(300);
  await next(A, 500);
  await click(A, 'إضافة إلى الشجرة', '.addsheet .foot button', 2200);
  ok(!(await asked(A)), 'adding him asks nothing');
  ok((await sons(A, c.q, c.name)).length === 1, 'and he is in the tree');
  await shot(A, 'nodups-added.png');

  // «إضافة سلسلة نسب»: the first name a son already there
  await store(A, (m, id) => m.set({ profile: null, lineFrom: id }), pick.father); await wait(700);
  await A.type('.addsheet .linerow input.bigin', pick.name, { delay: 8 });
  await A.evaluate(() => { const b = document.querySelector('.addsheet label.opt input'); if (b?.checked) b.click(); });
  await click(A, 'إضافة إلى الشجرة', '.addsheet .foot button', 2200);
  ok(!(await A.evaluate(() => !!document.querySelector('.modal.dups'))), 'a line of names asks nothing');
  ok((await sons(A, pick.father, pick.name)).length === 3, 'and is added');

  // «للتمييز» is still set from the editor
  await store(A, (m, id) => m.set({ lineFrom: null, profile: id }), two.find(x => x.id !== pick.son).id); await wait(900);
  await click(A, 'تعديل البيانات', '.page.profile button', 700);
  await click(A, 'الثاني', '.chips2 .chip', 300);
  await click(A, 'حفظ', '.addsheet .foot button', 2000);
  ok((await store(A, (m, id) => m.getState().graph.nodes.get(id).suffix, two.find(x => x.id !== pick.son).id)) === 'الثاني', '«للتمييز» set from the editor');
  await t.finish();
} catch (e) { await t.crash(e); }
