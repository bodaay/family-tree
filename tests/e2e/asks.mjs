// About whom a member may send requests, for the whole family: anyone until the
// root admin (or the platinum key holder) sets «حدود الطلبات» in «الإدارة» to a
// degree, or to no one. Beyond it a profile has no request buttons and says why;
// a request sent anyway (a modified app) counts on no phone; one sent before the
// limit stays. A key holder asks freely in their own branch.
//   node asks.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
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
const section = p => p.evaluate(() => { const h = [...document.querySelectorAll('.page.admin h3')].find(x => x.textContent.includes('حدود الطلبات')); const sec = h?.closest('section'); return sec ? { on: sec.querySelector('.seg.asks button.on')?.textContent ?? '', opts: [...sec.querySelectorAll('.seg.asks button')].map(b => b.textContent), note: [...sec.querySelectorAll('p.hint')].pop()?.textContent ?? '' } : null; });
const choose = async (p, label) => {
  await tab(p, 'الإدارة');
  const done = await p.evaluate(l => { const b = [...document.querySelectorAll('.page.admin .seg.asks button')].find(x => x.textContent === l); b?.click(); return !!b; }, label);
  await wait(1800);
  return done;
};
// what the profile offers: «إضافة ابن أو ابنة», «إضافة زوج/زوجة», and the note
const offers = async (p, id) => {
  await store(p, (m, id) => m.set({ profile: id }), id); await wait(800);
  const r = await p.evaluate(() => ({ add: [...document.querySelectorAll('.page.profile button.link')].some(b => b.textContent.includes('إضافة ابن أو ابنة')), spouse: !!document.querySelector('.page.profile button.addsp'), note: document.querySelector('.page.profile .asksnote')?.textContent ?? '' }));
  await store(p, m => m.set({ profile: null })); await wait(300);
  return r;
};
const ask = (p, parent, name) => store(p, (m, a) => !!m.addChildTx(a.parent, { name: a.name, sex: 'm' }, false, null), { parent, name });
const pending = (p, name) => store(p, (m, name) => m.getState().txs.some(t => t.status === 'pending' && t.ops.some(o => o.op === 'addPerson' && o.person.name === name)), name);
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);

  // the member
  await tab(A, 'الإدارة');
  await click(A, 'دعوة فرد', '.page button', 600);
  await A.type('.sfield input', MEMBER[0], { delay: 8 });
  await wait(600);
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y))?.click(), MEMBER[1]);
  await wait(1500);
  const link = await A.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}'); const sk = Object.values(inv).pop(); return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null; });
  await click(A, 'إغلاق', '.mhead button', 400);
  const B = await t.phone('B', link);
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'the member joins');
  const me = await store(B, m => m.getState().me);

  // people at each distance from him: his father (1st), someone at the 3rd, and men far
  // away (5th or further), in his own main branch and in another
  const P = await mod(A, '/src/data/kinship.ts', (K, me) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(S => {
    const g = S.getState().graph;
    const mine = g.nodes.get(me);
    const out = { father: mine.father ?? null, d3: null, farIn: null, farOut: null };
    for (const n of g.nodes.values()) {
      if (n.familyRoot || n.external || n.sex !== 'm' || !n.branch) continue;
      const d = K.kin(g, me, n.id)?.deg ?? 99;
      if (d === 3 && !out.d3) out.d3 = n.id;
      if (d >= 5 && n.branch === mine.branch && !out.farIn) out.farIn = n.id;
      if (d >= 5 && n.branch !== mine.branch && !out.farOut) out.farOut = n.id;
    }
    return { ...out, branch: mine.branch };
  }), me);
  ok(P.father && P.d3 && P.farIn && P.farOut, 'his father, a man at the 3rd degree, and men far away in his branch and in another');

  // no limit to begin with
  await tab(A, 'الإدارة');
  let sec = await section(A);
  ok(sec && sec.on === 'بلا حد' && sec.opts.join(',') === 'لا أحد,الأولى,الثانية,الثالثة,الرابعة,الخامسة,السادسة,بلا حد', 'the root admin sees «حدود الطلبات»: no one, 1st to 6th, or no limit · ' + sec?.opts.join(','));
  ok(sec?.note.includes('ما لم تُغيَّر'), 'never changed yet: no limit');
  let o = await offers(B, P.farOut);
  ok(o.add && o.spouse && !o.note, 'at first he may ask about anyone, a man far away in another branch too');
  ok(await ask(B, P.farOut, 'قبل_الحد'), 'he sends a request about him');
  ok(await until(() => pending(A, 'قبل_الحد')), 'it waits on the root admin\'s phone');

  // the 2nd degree
  ok(await choose(A, 'الثانية'), 'the root admin picks the 2nd');
  sec = await section(A);
  ok(sec?.on === 'الثانية' && sec.note.includes('غيّرها مشرف العائلة'), 'it is set, and says by whom · ' + sec?.note);
  if (shots) { await A.evaluate(() => [...document.querySelectorAll('.page.admin h3')].find(x => x.textContent.includes('حدود الطلبات'))?.scrollIntoView({ block: 'start' })); await wait(300); await A.screenshot({ path: shots + '/asks-admin.png' }); }
  ok(await until(() => store(B, m => m.getState().asks === 2)), 'the member\'s phone has the 2nd degree');
  o = await offers(B, P.farOut);
  ok(!o.add && !o.spouse && o.note.includes('حتى الدرجة الثانية'), 'far away: no request buttons, and the profile says why · ' + o.note);
  if (shots) { await store(B, (m, id) => m.set({ profile: id }), P.farOut); await wait(800); await B.evaluate(() => document.querySelector('.page.profile .asksnote')?.scrollIntoView({ block: 'center' })); await B.screenshot({ path: shots + '/asks-profile.png' }); await store(B, m => m.set({ profile: null })); }
  o = await offers(B, P.d3);
  ok(!o.add, 'the 3rd degree is beyond it too');
  o = await offers(B, P.father);
  ok(o.add && !o.note, 'his father: he may ask');
  ok(!(await ask(B, P.farOut, 'بعد_الحد')), 'a request about someone far is refused on his phone');
  ok(await ask(B, P.father, 'ضمن_الحد'), 'one about his father is sent');
  ok(await until(() => pending(A, 'ضمن_الحد')), 'and waits on the root admin\'s phone');
  ok(await pending(A, 'قبل_الحد'), 'the request sent before the limit still waits');

  // a modified app sends one anyway: no phone counts it
  ok(await store(B, (m, parent) => { m.set({ asks: null }); return !!m.addChildTx(parent, { name: 'تحايل', sex: 'm' }, false, null); }, P.farOut), 'a phone that ignores the limit writes the request');
  await wait(4500);
  ok(!(await pending(A, 'تحايل')) && !(await store(A, m => m.getState().txs.some(t => t.ops.some(o => o.op === 'addPerson' && o.person.name === 'تحايل')))), 'the root admin\'s phone never shows it');
  await B.reload({ waitUntil: 'networkidle0' }); await wait(2500);
  ok((await store(B, m => m.getState().asks)) === 2 && !(await store(B, m => m.getState().txs.some(t => t.ops.some(o => o.op === 'addPerson' && o.person.name === 'تحايل')))), 'nor his own, once it reads the family log again');

  // a key holder asks freely in his own branch
  await store(A, (m, a) => m.appoint('silver', a.branch, a.me), { branch: P.branch, me }); await wait(1800);
  ok(await until(() => store(B, m => m.getState().seats.some(x => x.tier === 'silver'))), 'the member now holds a silver key in his branch');
  o = await offers(B, P.farIn);
  ok(o.add, 'far away in his own branch: he may ask');
  o = await offers(B, P.farOut);
  ok(!o.add, 'in another branch: still not');
  ok(await ask(B, P.farIn, 'حامل_مفتاح'), 'he sends one in his branch');
  ok(await until(() => store(A, m => m.getState().txs.some(t => t.status === 'approved' && t.ops.some(o => o.op === 'addPerson' && o.person.name === 'حامل_مفتاح')))), 'and his own key approves it as he sends it');
  await store(A, (m, id) => m.vacate(id), me); await wait(1800);
  ok(await until(() => store(B, m => !m.getState().seats.length)), 'the seat is emptied');

  // no one
  ok(await choose(A, 'لا أحد'), 'the root admin picks «لا أحد»');
  ok(await until(() => store(B, m => m.getState().asks === 0)), 'the member\'s phone has it');
  o = await offers(B, me);
  ok(!o.add && o.note.includes('لا يرسل الأفراد طلبات'), 'not even about himself · ' + o.note);
  await tab(B, 'الشجرة');
  ok(!(await B.evaluate(() => !!document.querySelector('.fab'))), 'the tree has no «+»');

  // no limit again
  ok(await choose(A, 'بلا حد'), 'the root admin picks «بلا حد»');
  ok(await until(() => store(B, m => m.getState().asks === null)), 'the member\'s phone has no limit');
  o = await offers(B, P.farOut);
  ok(o.add && o.spouse, 'he may ask about anyone again');
  await t.finish();
} catch (e) { await t.crash(e); }
