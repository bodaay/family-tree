// Recording a death as a request: «تسجيل وفاة» on a living person's profile
// (never one's own, nor for the root admin, who uses «تعديل»), the year if
// known, never the cause or place; two silvers of the branch approve it, and
// the current marriages become widowhood in that year. A key holder's death is
// never two silvers' to decide: it needs the whole trunk, or the root admin,
// and empties the seat. Undoing a death needs the same as recording it.
//   node death.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const shots = process.argv[4];
const shot = async (p, name) => { if (shots) await p.screenshot({ path: shots + '/' + name + '.png' }); };
const MEMBER = ['مشاري', '1985'];
const until = async (fn, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(500)) if (await fn()) return true;
  return false;
};
const tab = async (p, name) => { await p.evaluate(n => [...document.querySelectorAll('.tab')].find(e => e.textContent.includes(n))?.click(), name); await wait(600); };
const invite = async (A, name, year) => {
  await tab(A, 'الإدارة');
  await click(A, 'دعوة فرد', '.page button', 600);
  await A.type('.sfield input', name, { delay: 8 });
  await wait(600);
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y))?.click(), String(year));
  await wait(1500);
  const link = await A.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}'); const sk = Object.values(inv).pop(); return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null; });
  await click(A, 'إغلاق', '.mhead button', 400);
  return link;
};
// what a profile offers about a death
const offer = async (p, id) => {
  await store(p, (m, id) => m.set({ profile: id }), id); await wait(800);
  const r = await p.evaluate(() => ({ button: !!document.querySelector('.page.profile .deathlink'), waiting: [...document.querySelectorAll('.page.profile p.hint')].some(x => x.textContent.includes('طلب وفاة بانتظار')) }));
  await store(p, m => m.set({ profile: null })); await wait(300);
  return r;
};
// the sheet: year, then send; returns its note and button
const sheet = async (p, id, year, send = true) => {
  await store(p, (m, id) => m.set({ profile: id }), id); await wait(800);
  await p.evaluate(() => document.querySelector('.page.profile .deathlink')?.click()); await wait(700);
  if (year) await p.type('.addsheet .bigin', String(year), { delay: 8 });
  await wait(300);
  const r = await p.evaluate(() => ({ open: !!document.querySelector('.addsheet'), title: document.querySelector('.addsheet .ahead b')?.textContent ?? '', hint: [...document.querySelectorAll('.addsheet p.hint')].pop()?.textContent ?? '', button: document.querySelector('.addsheet .foot .btn.primary')?.textContent.trim() ?? '', widow: [...document.querySelectorAll('.addsheet .qh')].some(x => x.textContent.includes('ترمّل')) }));
  if (send) { await p.evaluate(() => document.querySelector('.addsheet .foot .btn.primary')?.click()); await wait(1500); }
  else await p.evaluate(() => [...document.querySelectorAll('.addsheet .ahead button')].find(b => b.textContent.includes('إلغاء'))?.click());
  await store(p, m => m.set({ profile: null })); await wait(300);
  return r;
};
const txAbout = (p, id) => store(p, (m, id) => { const x = m.getState().txs.filter(t => t.ops.some(o => o.op === 'updatePerson' && o.id === id && 'deceased' in o.after)).pop(); return x ? { id: x.id, level: x.level, status: x.status, approvals: x.approvals.length, revertOf: x.revertOf ?? null } : null; }, id);
const press = (p, txId, label) => p.evaluate((id, l) => { const c = [...document.querySelectorAll('.requests .card.req')].find(x => x.dataset.id === id || x.querySelector('h4')?.innerText.includes(id)); const b = c && [...c.querySelectorAll('.acts button')].find(x => x.textContent.includes(l)); b?.click(); return !!b; }, txId, label);
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await click(A, 'تصفّح أولًا', 'button', 500);

  const B = await t.phone('B', await invite(A, ...MEMBER));
  await B.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'the member joins');
  const me = await store(B, m => m.getState().me);
  // in his branch: a living married man (to die), a living man (the second silver), and a living man to stay
  const P = await store(A, (m, me) => {
    const g = m.getState().graph;
    const mine = g.nodes.get(me);
    const live = [...g.nodes.values()].filter(n => !n.dead && !n.familyRoot && !n.external && n.sex === 'm' && n.branch === mine.branch && n.id !== me && !g.branches.includes(n.id) && n.birth && n.birth.v < 2000);
    const married = live.find(n => g.marriages.some(x => x.husband === n.id && x.status === 'married'));
    const second = live.find(n => n.id !== married?.id && n.birth.cal === 'g');
    const third = live.find(n => n.id !== married?.id && n.id !== second?.id);
    return { branch: mine.branch, married: married?.id, wife: g.marriages.find(x => x.husband === married?.id && x.status === 'married')?.id, second: second?.id, secondName: second?.name, secondYear: second?.birth?.v, third: third?.id };
  }, me);
  ok(P.married && P.second && P.third, 'in his branch: a married man, and two more living men · ' + JSON.stringify(P));

  // never his own, never the root admin's (who has «تعديل»)
  ok(!(await offer(B, me)).button, 'no «تسجيل وفاة» on his own profile');
  ok(!(await offer(A, P.married)).button, 'nor for the root admin');
  ok((await offer(B, P.married)).button, 'on a living relative\'s profile: «تسجيل وفاة»');

  // a member with no key: a request for two silvers
  let x = await sheet(B, P.married, 2024, false);
  ok(x.open && x.title === 'تسجيل وفاة' && x.widow && x.hint.includes('مفتاحان فضيان') && x.button === 'إرسال للاعتماد', 'the sheet: the year, the widowhood, two silvers of his branch · ' + x.hint);
  if (shots) { await store(B, (m, id) => m.set({ profile: id }), P.married); await wait(700); await B.evaluate(() => document.querySelector('.page.profile .deathlink')?.scrollIntoView({ block: 'center' })); await shot(B, 'death-profile'); await B.evaluate(() => document.querySelector('.page.profile .deathlink')?.click()); await wait(600); await B.type('.addsheet .bigin', '2024'); await shot(B, 'death-sheet'); await B.evaluate(() => [...document.querySelectorAll('.addsheet .ahead button')].find(b => b.textContent.includes('إلغاء'))?.click()); await store(B, m => m.set({ profile: null })); await wait(300); }
  await sheet(B, P.married, 2024);
  await until(() => txAbout(A, P.married));
  let r = await txAbout(A, P.married);
  ok(r && r.level === 'death' && r.status === 'pending' && r.approvals === 0, 'it waits on the root admin\'s phone, at the death level · ' + JSON.stringify(r));
  ok((await offer(B, P.married)).waiting, 'his profile says a death request is waiting, with no second button');

  // two silvers: him, then another man of the branch on his own phone
  await store(A, (m, a) => m.appoint('silver', a.branch, a.me), { branch: P.branch, me }); await wait(1800);
  const C = await t.phone('C', await invite(A, P.secondName, P.secondYear));
  ok(await click(C, 'نعم، أنا', '.join button', 2000), 'a second man of the branch joins');
  const c = await store(C, m => m.getState().me);
  await store(A, (m, a) => m.appoint('silver', a.branch, a.c), { branch: P.branch, c }); await wait(1800);
  ok(await until(() => store(B, m => m.getState().seats.filter(x => x.tier === 'silver').length === 2)), 'two silver keys in the branch');
  await tab(B, 'الشجرة'); await tab(B, 'الطلبات');
  ok(await B.evaluate(() => { const c = [...document.querySelectorAll('.requests .card.req')].find(x => x.querySelector('h4')?.innerText.includes('وفاة')); const b = c && [...c.querySelectorAll('.acts button')].find(x => x.textContent.includes('اعتماد')); b?.click(); return !!b; }), 'he approves it with his silver key');
  ok(await until(() => txAbout(A, P.married).then(r => r?.approvals === 1 && r.status === 'pending')), 'one of two: it still waits');
  await tab(C, 'الشجرة'); await tab(C, 'الطلبات');
  ok(await C.evaluate(() => { const c = [...document.querySelectorAll('.requests .card.req')].find(x => x.querySelector('h4')?.innerText.includes('وفاة')); const b = c && [...c.querySelectorAll('.acts button')].find(x => x.textContent.includes('اعتماد')); b?.click(); return !!b; }), 'the second silver approves it');
  ok(await until(() => txAbout(A, P.married).then(r => r?.status === 'approved')), 'two silvers: approved');
  // after the move to per-person keys (MOVE=1) a silver without the widow's key sends it without her end year: the root admin's phone puts it in
  const look = () => store(A, (m, a) => { const g = m.getState().graph; const n = g.nodes.get(a.id); const w = g.marriages.find(x => x.id === a.wife); return { dead: n.dead, death: n.death ?? null, wife: w ? { status: w.status, end: w.end ?? null } : null }; }, { id: P.married, wife: P.wife });
  await until(async () => (await look()).wife?.end?.v === 2024);
  const after = await look();
  ok(after.dead && after.death?.v === 2024 && after.wife?.status === 'widowed' && after.wife.end?.v === 2024, 'he is recorded dead in 2024, and his marriage is widowhood ending that year · ' + JSON.stringify(after));
  ok(!(await offer(B, P.married)).button, 'no «تسجيل وفاة» for the departed');

  // undoing it: the same two silvers. His own key gives one, and it waits for the second
  await store(B, m => m.set({ profile: null }));
  const undo = await store(B, (m, id) => { const t = m.getState().txs.find(t => t.status === 'approved' && t.ops.some(o => o.op === 'updatePerson' && o.id === id && 'deceased' in o.after)); m.proposeRevert(t.id); return t.id; }, P.married);
  ok(await until(() => store(A, (m, u) => m.getState().txs.some(t => t.revertOf === u && t.level === 'death' && t.status === 'pending' && t.approvals.length === 1), undo)), 'undoing it is a death request too: his approval sent with it, one of two');

  // a key holder's death: not two silvers' to decide
  x = await sheet(B, c, null, false);
  ok(x.hint.includes('يحمل مفتاحًا') && x.button === 'إرسال للاعتماد', 'the sheet for a key holder says only the trunk or the root admin decide it · ' + x.hint);
  await sheet(B, c, null);
  await until(() => txAbout(A, c));
  r = await txAbout(A, c);
  ok(r && r.level === 'trunk' && r.status === 'pending' && r.approvals === 0, 'his death request about the other silver: the trunk level, his own key counts nothing · ' + JSON.stringify(r));
  await tab(A, 'الشجرة'); await tab(A, 'الطلبات');
  ok(await A.evaluate(() => { const c = [...document.querySelectorAll('.requests .card.req')].find(x => x.querySelector('h4')?.innerText.includes('وفاة') && x.querySelector('.lvl')?.textContent === 'الجذع'); const b = c && [...c.querySelectorAll('.acts button')].find(x => x.textContent.includes('اعتماد')); b?.click(); return !!b; }), 'the root admin approves it');
  ok(await until(() => store(A, (m, c) => m.getState().graph.nodes.get(c)?.dead && !m.getState().seats.some(x => x.holder === c), c)), 'he is recorded dead, and his seat is empty');
  await t.finish();
} catch (e) { await t.crash(e); }
