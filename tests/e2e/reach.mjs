// How far a woman's details are seen, for the whole family: the 3rd degree until
// the root admin or the platinum key holder sets the 4th, 5th, 6th or no limit,
// from «الإدارة». Every phone follows it; a setting signed by anyone else counts nowhere.
//   node reach.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait } from './mar-lib.mjs';
const { forgeReach } = await import('./decide-forge.mts');
const t = setup();
const { ok } = t;
// run fn(module, arg) in the page with one of the app's own modules
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const shots = process.argv[4];
const MEMBER = ['مشاري', '1985'];
const until = async (fn, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(500)) if (await fn()) return true;
  return false;
};
const tab = async (p, name) => {
  const has = await p.evaluate(n => { const b = [...document.querySelectorAll('.tab')].find(e => e.textContent.includes(n)); b?.click(); return !!b; }, name);
  await wait(600);
  return has;
};
const sees = (p, ids) => store(p, (m, ids) => Object.fromEntries(Object.entries(ids).map(([d, id]) => [d, id ? m.canSee(m.getState(), id) : null])), ids);
const section = p => p.evaluate(() => { const h = [...document.querySelectorAll('.page.admin h3')].find(x => x.textContent.includes('خصوصية النساء')); const sec = h?.closest('section'); return sec ? { on: sec.querySelector('.seg.reach button.on')?.textContent ?? '', opts: [...sec.querySelectorAll('.seg.reach button')].map(b => b.textContent), note: [...sec.querySelectorAll('p.hint')].pop()?.textContent ?? '' } : null; });
const choose = (p, label) => p.evaluate(l => { const b = [...document.querySelectorAll('.page.admin .seg.reach button')].find(x => x.textContent === l); b?.click(); return !!b; }, label);
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);

  // the member, and a woman at each degree from him
  await tab(A, 'الإدارة');
  await click(A, 'دعوة فرد', '.page button', 600);
  await A.type('.sfield input', MEMBER[0], { delay: 8 });
  await wait(600);
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y))?.click(), MEMBER[1]);
  await wait(1500);
  const link = await A.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('ft-family'));
    const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}');
    const sk = Object.values(inv).pop();
    return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null;
  });
  await click(A, 'إغلاق', '.mhead button', 400);
  const B = await t.phone('B', link);
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'the member joins');
  const me = await store(B, m => m.getState().me);
  const W = await mod(A, '/src/data/kinship.ts', (K, me) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts') ?? '/src/data/store.ts').then(S => {
    const g = S.getState().graph;
    const out = { 3: null, 4: null, 5: null, 6: null, far: null };
    for (const n of g.nodes.values()) {
      if (n.sex !== 'f' || n.familyRoot) continue;
      const k = K.kin(g, me, n.id);
      const d = k ? k.deg : 99;
      const slot = d > 6 ? 'far' : d >= 3 ? d : null;
      if (slot && !out[slot]) out[slot] = n.id;
    }
    return out;
  }), me);
  ok(Object.values(W).every(Boolean), 'women at the 3rd, 4th, 5th and 6th degree from him, and one further · ' + Object.values(W).filter(Boolean).length + '/5');

  // the 3rd degree to begin with
  let v = await sees(B, W);
  ok(v[3] && !v[4] && !v[5] && !v[6] && !v.far, 'at first he sees the 3rd degree only · ' + JSON.stringify(v));
  ok((await store(B, (m, id) => m.nameOf(m.getState(), id), W[4])) !== (await store(A, (m, id) => m.nameOf(m.getState(), id), W[4])), 'her name is hidden on his phone');
  await store(B, (m, id) => m.set({ profile: id }), W[4]); await wait(700);
  ok((await B.evaluate(() => document.querySelector('.page.profile .ns')?.textContent ?? '')).includes('حتى الدرجة الثالثة'), 'her profile says the 3rd degree');
  await store(B, m => m.set({ profile: null }));
  ok(!(await tab(B, 'الإدارة')), 'a member has no «الإدارة»');

  // the root admin's «الإدارة»
  await tab(A, 'الإدارة');
  let sec = await section(A);
  ok(sec && sec.on === 'الثالثة' && sec.opts.join(',') === 'الثالثة,الرابعة,الخامسة,السادسة,بلا حد', 'the root admin sees «خصوصية النساء»: 3rd to 6th, or no limit · ' + sec?.opts.join(','));
  ok(sec?.note.includes('ما لم تُغيَّر'), 'never changed yet');
  await A.evaluate(() => [...document.querySelectorAll('.page.admin h3')].find(x => x.textContent.includes('خصوصية النساء'))?.scrollIntoView({ block: 'start' }));
  ok(await choose(A, 'الخامسة'), 'he picks the 5th');
  await wait(1800);
  sec = await section(A);
  ok(sec?.on === 'الخامسة' && sec.note.includes('غيّرها مشرف العائلة'), 'it is set, and says by whom · ' + sec?.note);
  if (shots) { await wait(300); await A.screenshot({ path: shots + '/reach-admin.png' }); }

  // his phone follows
  ok(await until(() => store(B, m => m.getState().reach === 5)), 'the member\'s phone has the 5th degree');
  v = await sees(B, W);
  ok(v[3] && v[4] && v[5] && !v[6] && !v.far, 'he now sees up to the 5th · ' + JSON.stringify(v));
  await store(B, (m, id) => m.set({ profile: id }), W[6]); await wait(700);
  ok((await B.evaluate(() => document.querySelector('.page.profile .ns')?.textContent ?? '')).includes('حتى الدرجة الخامسة'), 'a woman further out says the 5th degree');
  await store(B, m => m.set({ profile: null }));

  // no limit
  ok(await choose(A, 'بلا حد'), 'he picks no limit');
  await wait(1800);
  ok(await until(() => store(B, m => m.getState().reach === null)), 'the member\'s phone has no limit');
  v = await sees(B, W);
  ok(Object.values(v).every(Boolean), 'he sees every woman · ' + JSON.stringify(v));

  // the platinum key holder may set it too
  await store(A, (m, id) => m.appoint('platinum', null, id), me); await wait(1800);
  ok(await until(() => store(B, m => m.getState().seats.some(x => x.tier === 'platinum'))), 'the member now holds the platinum key');
  await B.reload({ waitUntil: 'networkidle0' }); await wait(2000);
  ok(await tab(B, 'الإدارة'), 'the platinum holder has «الإدارة»');
  ok((await section(B))?.on === 'بلا حد', 'with «خصوصية النساء»');
  ok(await choose(B, 'الرابعة'), 'he picks the 4th');
  await wait(1800);
  ok(await until(() => store(A, m => m.getState().reach === 4)), 'the root admin\'s phone has the 4th');
  const name = await store(A, (m, id) => m.nameOf(m.getState(), id), me);
  await tab(A, 'أنا'); await tab(A, 'الإدارة');
  sec = await section(A);
  ok(sec?.on === 'الرابعة' && sec.note.includes('غيّرها ' + name), 'it says the platinum holder changed it · ' + sec?.note);

  // signed by anyone else: stored, counted nowhere
  const fid = t.adminLink.match(/join=([a-z0-9]+)\./)[1];
  const famKey = await A.evaluate(() => JSON.parse(localStorage.getItem('ft-family')).key);
  const s1 = await forgeReach(t.base, fid, famKey, null, me);
  const s2 = await forgeReach(t.base, fid, famKey, 6, null);
  ok([s1, s2].every(x => x === 200 || x === 201), 'the server stores two forged settings (it cannot read them) · ' + s1 + ',' + s2);
  await wait(4500);
  ok((await store(A, m => m.getState().reach)) === 4 && (await store(B, m => m.getState().reach)) === 4, 'neither counts: in the platinum holder\'s name from another device, or from no one');

  // once the seat is emptied, he can no longer set it
  await store(A, (m, id) => m.vacate(id), me); await wait(1800);
  ok(await until(() => store(B, m => !m.getState().seats.length)), 'the seat is emptied');
  await B.reload({ waitUntil: 'networkidle0' }); await wait(2000);
  ok(!(await tab(B, 'الإدارة')), 'no «الإدارة» for him any more');
  await store(B, m => m.setReach(3)); await wait(1500);
  ok((await store(A, m => m.getState().reach)) === 4, 'his phone cannot change it');
  v = await sees(B, W);
  ok(v[3] && v[4] && !v[5] && !v[6] && !v.far, 'he sees up to the 4th · ' + JSON.stringify(v));
  await t.finish();
} catch (e) { await t.crash(e); }
