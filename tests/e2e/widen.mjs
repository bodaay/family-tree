// A woman's details seen wider than the family's rule (design document 1.29):
// run after the move (MOVE=1). The root admin widens one woman's details to the
// whole family and names a member for another; his phone hands their keys out,
// and the member opens them. Someone else unnamed still does not; who may set it
// is checked as the replay does; the profile shows the section.
//   FT_REPO=<worktree> node widen.mjs BASE admin-link-file
import { setup, click, wait } from './mar-lib.mjs';
const { readWith } = await import('./pkeys-read.mts');
const t = setup();
const { ok } = t;
const shots = process.argv[4];
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const until = async (fn, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(500)) if (await fn().catch(() => false)) return true;
  return false;
};
const tab = async (p, name) => { await p.evaluate(n => [...document.querySelectorAll('.tab')].find(e => e.textContent.includes(n))?.click(), name); await wait(600); };
const lastLink = p => p.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}'); const sk = Object.values(inv).pop(); return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null; });
const invite = async (A, name, year) => {
  await tab(A, 'الإدارة');
  await click(A, 'دعوة فرد', '.page button', 600);
  await A.type('.sfield input', name, { delay: 8 });
  await wait(600);
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y))?.click(), String(year));
  await wait(1500);
  const link = await lastLink(A);
  await click(A, 'إغلاق', '.mhead button', 400);
  return link;
};
// what a phone holds of these women: opened (with her key), and the name its tree carries
const holds = (p, ids) => store(p, (m, ids) => { const s = m.getState(); return { era: s.sealedEra, before: s.before.length, opened: s.opened.size, of: ids.map(id => ({ id, opened: s.opened.has(id), name: s.graph.nodes.get(id)?.name ?? null, shown: m.nameOf(s, id) })) }; }, ids);
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  const B = await t.phone('B', await invite(A, 'مشاري', 1985));
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'B joins');
  const bMe = await store(B, m => m.getState().me);
  const P = await mod(A, '/src/data/kinship.ts', (K, me) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(S => {
    const g = S.getState().graph;
    const men = [...g.nodes.values()].filter(n => n.sex === 'm').map(n => n.name);
    const ok = n => n.name.length >= 3 && !men.some(m => m.includes(n.name));
    const women = [...g.nodes.values()].filter(n => n.sex === 'f' && !n.familyRoot && !n.external && ok(n));
    const deg = id => K.kin(g, me, id)?.deg ?? 99;
    const far = women.filter(n => deg(n.id) >= 6).slice(0, 4);
    const c = [...g.nodes.values()].find(n => n.sex === 'm' && !n.dead && n.birth && n.id !== me && n.branch === g.nodes.get(me).branch && deg(n.id) >= 5 && !g.marriages.some(x => x.husband === n.id));
    return { far: far.map(n => n.id), farNames: far.map(n => n.name), c: c?.id, cName: c?.name, cYear: c?.birth?.v, cToW2: c ? (K.kin(g, c.id, far[1]?.id)?.deg ?? 99) : 0 };
  }), bMe);
  ok(P.far.length >= 2 && P.c, `two women far from B, and a man to invite`);
  const [W, W2] = P.far;
  await until(() => store(B, m => m.getState().opened.size > 0), 30000);
  const b0 = await holds(B, [W, W2]);
  ok(b0.of.every(x => !x.opened && x.name === ''), 'B does not see them');
  ok(!(await store(B, (m, w) => m.mayWiden(m.getState(), w), W)), 'B may not set it for them (not close to them, no key)');
  ok(await store(A, (m, w) => m.mayWiden(m.getState(), w), W), 'the root admin may');

  // the root admin widens W to the whole family, and names B for W2
  ok(await store(A, (m, w) => m.widen(w, { reach: 'all', people: [] }, 'حُفظ'), W), 'W\'s details: to the whole family');
  ok(await store(A, (m, a) => m.widen(a.w, { reach: 'family', people: [a.b] }, 'حُفظ'), { w: W2, b: bMe }), 'W2\'s: B by name');
  ok(await until(async () => { const x = await holds(B, [W, W2]); return x.of.every(y => y.opened); }, 30000), "the root admin's phone hands their keys to B");
  const b1 = await holds(B, [W, W2]);
  ok(b1.of[0].name === P.farNames[0] && b1.of[1].name === P.farNames[1], 'B reads both names');
  ok(await store(B, (m, ids) => ids.every(id => m.canSee(m.getState(), id)), [W, W2]), 'and his phone shows them');

  // C, invited after: W (everyone) yes; W2 (B by name) no
  const C = await t.phone('C', await invite(A, P.cName, P.cYear));
  ok(await click(C, 'نعم، أنا', '.join button', 2000), 'C joins');
  ok(await until(async () => (await holds(C, [W])).of[0].opened, 30000), 'C opens W (her details reach everyone)');
  const c1 = await holds(C, [W2]);
  ok(P.cToW2 <= 3 || (!c1.of[0].opened && !(await store(C, (m, w) => m.canSee(m.getState(), w), W2))), 'and not W2: she named B only');

  // back to the family's rule: B keeps the key he was handed (an honest limit), nobody new gets it
  ok(await store(A, (m, w) => m.widen(w, { reach: 'family', people: [] }, 'حُفظ'), W), 'W back to the family rule');
  ok(await until(() => store(A, (m, w) => !m.getState().own.has(w), W)), 'the setting is gone');
  ok(await until(async () => !(await store(B, (m, w) => m.canSee(m.getState(), w), W))), 'B\'s phone no longer shows her (it keeps her key: what it read stays read)');

  // the section on her profile, for whoever may set it
  await A.evaluate(w => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(m => m.set({ profile: w })), W2);
  await wait(800);
  const sec = await A.evaluate(() => [...document.querySelectorAll('.page.profile h3')].find(h => h.textContent.includes('من يرى تفاصيلها'))?.closest('section')?.innerText ?? '');
  ok(sec.includes('كالعائلة') && sec.includes('الكل') && sec.includes('إزالة'), 'her profile shows «من يرى تفاصيلها», with B named');
  if (shots) { await A.evaluate(() => [...document.querySelectorAll('.page.profile h3')].find(h => h.textContent.includes('من يرى تفاصيلها'))?.scrollIntoView({ block: 'start' })); await wait(300); await A.screenshot({ path: shots + '/widen.png' }); }
  await t.finish();
} catch (e) { await t.crash(e); }
