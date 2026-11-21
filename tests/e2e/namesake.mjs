// Brothers of the same name (one died young, the next was named after him):
// with the duplicate check off (CHECK_DUPLICATES) the second is added straight
// on and «للتمييز» marks both from the editor; search finds each, the editor
// changes the mark; and compound names read as one person in a lineage, in
// brackets. dupcheck-on/ has the version where «لا، أخ آخر بالاسم نفسه» marks both.
// Needs a fresh local family.  node namesake.mjs BASE admin-link-file [shots]
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok, shot } = t;
const store = (p, fn, arg) => p.evaluate((src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts') ?? '/src/data/store.ts').then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), fn.toString(), arg);
const next = (p, pause = 500) => click(p, 'التالي', '.addsheet .foot button', pause);
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  // a father with no wife recorded, whose eldest son has a one-word name, no mark yet
  const pick = await store(A, m => {
    const g = m.getState().graph;
    for (const n of g.nodes.values()) {
      if (n.familyRoot || n.sex !== 'm' || g.marriages.some(x => x.husband === n.id)) continue;
      const son = n.kids.map(k => g.nodes.get(k)).find(k => k.sex === 'm' && !k.suffix && !/\s/.test(k.name) && n.kids.filter(x => g.nodes.get(x).name === k.name).length === 1);
      if (son) return { father: n.id, son: son.id, name: son.name, fatherName: n.name };
    }
    return null;
  });
  ok(!!pick, 'a father and son to test with · ' + JSON.stringify(pick));
  await store(A, (m, id) => m.set({ profile: id }), pick.father); await wait(900);
  await click(A, 'إضافة ابن أو ابنة', '.page.profile button.link');
  await click(A, 'ابن', '.addsheet .bigchoice button', 300);
  await next(A);
  await A.type('.addsheet input.bigin', pick.name, { delay: 8 });
  await next(A, 700);
  ok(!(await A.evaluate(() => !!document.querySelector('.modal.dups'))), 'no duplicate question: straight on');
  await A.evaluate(() => [...document.querySelectorAll('.addsheet label.opt')].find(l => l.innerText.includes('غير معروفة'))?.querySelector('input').click());
  await next(A, 500);
  await click(A, 'إضافة إلى الشجرة', '.addsheet .foot button', 2200);
  const kin = () => store(A, (m, p) => { const g = m.getState().graph; return g.nodes.get(p.father).kids.map(k => g.nodes.get(k)).filter(k => k.name === p.name).map(k => ({ id: k.id, suffix: k.suffix ?? null })); }, pick);
  // «للتمييز» from the editor: the first «الأول», the new one «الثاني»
  const mark = async (id, w) => {
    await store(A, (m, id) => m.set({ profile: id }), id); await wait(900);
    await click(A, 'تعديل البيانات', '.page.profile button', 700);
    await click(A, w, '.chips2 .chip', 300);
    await click(A, 'حفظ', '.addsheet .foot button', 2000);
  };
  const added = (await kin()).find(x => x.id !== pick.son);
  ok(!!added, 'the second brother is added');
  await mark(pick.son, 'الأول');
  await mark(added.id, 'الثاني');
  await store(A, m => m.set({ profile: null }));
  const marks = await kin();
  ok(marks.length === 2 && marks.find(x => x.id === pick.son)?.suffix === 'الأول' && marks.find(x => x.id !== pick.son)?.suffix === 'الثاني', 'saved: «الأول» and «الثاني» · ' + JSON.stringify(marks));
  const second = marks.find(x => x.id !== pick.son).id;
  // search: by the mark, and by name and father
  await store(A, m => m.set({ profile: null, searchOpen: 'focus' })); await wait(500);
  await A.type('.sfield input', pick.name + ' الثاني', { delay: 8 }); await wait(700);
  const found = await A.evaluate(() => [...document.querySelectorAll('.results .prow b')].map(b => b.textContent.replace(/\s+/g, ' ').trim()));
  ok(found.some(x => x.startsWith(pick.name + ' الثاني')), '«' + pick.name + ' الثاني» finds him · ' + found.slice(0, 3).join(' | '));
  await A.evaluate(() => { const i = document.querySelector('.sfield input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await A.type('.sfield input', pick.name + ' ' + pick.fatherName, { delay: 8 }); await wait(700);
  const both = await A.evaluate(() => [...document.querySelectorAll('.results .prow b')].map(b => b.textContent.replace(/\s+/g, ' ').trim()));
  ok(both.filter(x => x.includes(' الأول ') || x.includes(' الثاني ')).length >= 2, 'name and father find both brothers · ' + both.slice(0, 4).join(' | '));
  await shot(A, 'namesake-search.png');
  await store(A, m => m.set({ searchOpen: false }));
  // the editor: the mark can be changed
  await store(A, (m, id) => m.set({ profile: id }), second); await wait(900);
  const title = await A.evaluate(() => document.querySelector('.page.profile h1')?.textContent.trim());
  ok(title?.startsWith(pick.name + ' الثاني'), 'his profile reads «' + pick.name + ' الثاني» · ' + title);
  await click(A, 'تعديل البيانات', '.page.profile button', 700);
  const field = await A.evaluate(() => { const qs = [...document.querySelectorAll('.addsheet .q')]; const q = qs.find(x => x.textContent === 'للتمييز'); const inp = q?.nextElementSibling?.nextElementSibling; return inp?.value ?? null; });
  ok(field === 'الثاني', 'the editor shows «للتمييز»: الثاني');
  await click(A, 'الصغير', '.chips2 .chip', 300);
  await click(A, 'حفظ', '.addsheet .foot button', 2000);
  const after = await store(A, (m, id) => m.getState().graph.nodes.get(id).suffix, second);
  ok(after === 'الصغير', 'changed to «الصغير»');
  // a compound name in a lineage reads as one person
  const comp = await store(A, m => { const g = m.getState().graph; const f = [...g.nodes.values()].find(n => /\s/.test(n.name) && !n.external && n.kids.length); return f ? { kid: f.kids[0], name: f.name } : null; });
  if (comp) {
    await store(A, (m, id) => m.set({ profile: id }), comp.kid); await wait(900);
    const ns = await A.evaluate(() => document.querySelector('.page.profile .ns')?.textContent ?? '');
    ok(ns.includes('(' + comp.name + ')'), 'a compound name in a lineage is in brackets · ' + ns);
    await shot(A, 'compound-profile.png');
  } else ok(false, 'no compound name with children to check');
  await t.finish();
} catch (e) { await t.crash(e); }
