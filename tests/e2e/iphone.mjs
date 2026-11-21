// iPhone and iPad: the family opens only in its app on the Home Screen (design
// document 1.38). The browser's user agent says iPhone; `navigator.standalone`
// says the app on the Home Screen; each phone is its own storage, as Safari and
// the installed app are.
//   node iphone.mjs <BASE url> <admin-link file>
// - An invite opened in Safari: not taken up (nothing of the family kept), only
//   copied; the app pastes it with «لصق رابط» and joins.
// - A member already in Safari (from before): «نقل حسابي إلى التطبيق» gives a
//   one-time link; the app joins with it as another device of theirs and removes
//   Safari from their devices; Safari, opened again, says the access moved and
//   keeps nothing; the family key is renewed.
// - The root admin already in Safari: copies the admin link (the same key), then
//   removes the admin's access from Safari.
// - A recovery link opened in Safari is only copied; with nothing to carry,
//   Safari shows the steps, and the sample family still opens there.
import {
  IPHONE, adminLink, base, check, run, wait, until, phone, click, closeApp, reopen, keysOf, store, shot,
} from './multidev-lib.mjs';

const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const st = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const gate = p => p.evaluate(() => {
  const g = document.querySelector('.join.homescreen');
  return g ? { text: g.innerText.replace(/\s+/g, ' '), carry: !!g.querySelector('.card.carry'), buttons: [...g.querySelectorAll('button')].map(b => b.textContent.trim()) } : null;
});
const copied = async p => {
  await p.evaluate(() => { window.__copied = null; });
  await click(p, 'نسخ الرابط', '.join.homescreen .card.carry button', 600);
  return p.evaluate(() => window.__copied);
};
const hasFamily = p => p.evaluate(() => !!localStorage.getItem('ft-family'));

async function inviteFor(A, id) {
  await st(A, (m, id) => m.createInvite(id), id);
  await wait(2000);
  return st(A, (m, id) => {
    const s = m.getState();
    const saved = JSON.parse(localStorage.getItem('ft-invites:' + m.currentMembership().fid) ?? '{}');
    const key = s.invites.filter(i => i.person === id && i.status === 'pending').map(i => i.key).find(x => saved[x]);
    m.set({ inviteOpen: null });
    return key ? m.inviteLinkFor(saved[key]) : null;
  }, id);
}
/** The app on the Home Screen pastes a link with «لصق رابط». */
async function paste(P, link) {
  await P.evaluate(t => { window.__paste = t; }, link);
  return click(P, 'لصق رابط', '.join button', 3000);
}

await run(async () => {
  const A = await phone('A', adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  const people = await st(A, m => [...m.getState().graph.nodes.values()].filter(n => n.sex === 'm' && !n.external && !n.familyRoot && !n.dead && n.birth && n.birth.v < 1995 && n.birth.v > 1950).slice(0, 2).map(n => n.id));

  // ---- an invite opened in Safari
  const link1 = await inviteFor(A, people[0]);
  const S1 = await phone('S1', link1, { ua: IPHONE });
  let g = await gate(S1);
  check(!!g && g.text.includes('إضافة إلى الشاشة الرئيسية') && g.carry, 'Safari: the invite is not taken up; the steps, and the link to copy', g?.text.slice(0, 160));
  check(!(await hasFamily(S1)) && !(await S1.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent.startsWith('نعم')))), 'nothing of the family kept in Safari, and it cannot be accepted there');
  await shot(S1, 'iphone-invite-in-safari');
  const c1 = await copied(S1);
  check(c1 === link1, '«نسخ الرابط» copies the invite whole');
  check((await st(A, (m, id) => m.getState().invites.find(i => i.person === id)?.status, people[0])) === 'pending', 'the invite is still unused');

  const P1 = await phone('P1', null, { ua: IPHONE, installed: true });
  await P1.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await wait(1500);
  check(!(await gate(P1)) && (await P1.evaluate(() => [...document.querySelectorAll('.join button')].some(b => b.textContent.includes('لصق رابط')))), 'the app on the Home Screen: no such screen, and «لصق رابط»');
  await paste(P1, c1);
  check((await P1.evaluate(() => document.querySelector('.join h2')?.textContent)) === 'دعوة شخصية', 'pasted: the invite, to accept in the app');
  await click(P1, 'نعم، أنا', '.join button', 3000);
  check(!!(await until(() => P1.evaluate(() => !!document.querySelector('nav.tabs')))) && (await st(P1, m => m.getState().me)) === people[0], 'joined in the app');

  // ---- a member already in Safari, from before this rule
  const link2 = await inviteFor(A, people[1]);
  const S2a = await phone('S2', link2);
  await click(S2a, 'نعم، أنا', '.join button', 3000);
  check(!!(await until(() => S2a.evaluate(() => !!document.querySelector('nav.tabs')))), 'a member joined in a browser before (as Safari did until now)');
  const safariDevice = (await keysOf(S2a)).d.pk;
  const ctx2 = await closeApp(S2a);
  const S2 = await reopen(ctx2, 'S2b', { ua: IPHONE });
  g = await gate(S2);
  check(!!g && g.buttons.some(b => b.includes('نقل حسابي إلى التطبيق')), 'Safari on the iPhone now: «نقل حسابي إلى التطبيق» instead of the family', g?.buttons.join('، '));
  const v0 = await st(A, m => m.getState().familyKey.version);
  await shot(S2, 'iphone-move');
  await click(S2, 'نقل حسابي إلى التطبيق', '.join.homescreen button', 3000);
  await shot(S2, 'iphone-move-link');
  const c2 = await copied(S2);
  check(/#join=[a-z0-9]+\.[A-Za-z0-9_-]+\.i[0-9a-f]{64}\.m$/.test(c2 ?? ''), 'a one-time device link that moves the access', (c2 ?? '').length);
  const P2 = await phone('P2', null, { ua: IPHONE, installed: true });
  await P2.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await wait(1500);
  await paste(P2, c2);
  check((await P2.evaluate(() => document.querySelector('.join h2')?.textContent)) === 'إضافة جهاز', 'the app: another device of the same person');
  await click(P2, 'نعم، أنا', '.join button', 3000);
  check(!!(await until(() => P2.evaluate(() => !!document.querySelector('nav.tabs')))) && (await st(P2, m => m.getState().me)) === people[1], 'the app is in, as the same person');
  const gone = await until(() => st(A, (m, d) => !m.getState().devices.has(d), safariDevice), 20000);
  check(!!gone, 'and Safari is no longer one of his devices');
  check((await st(A, (m, id) => [...m.getState().devices.values()].filter(p => p === id).length, people[1])) === 1, 'his devices: the app alone');
  check((await store(P2, 'ft-family'))?.move === undefined, 'the app keeps nothing of the move once done');
  check(!!(await until(() => st(A, (m, v) => m.getState().familyKey.version > v, v0), 20000)), 'the family key is renewed, as for any removed device');
  const ctx2b = await closeApp(S2);
  const S2c = await reopen(ctx2b, 'S2c', { ua: IPHONE });
  const moved = await until(() => S2c.evaluate(() => document.querySelector('.join h2')?.textContent ?? ''), 15000);
  check(moved === 'نُقل دخولك إلى التطبيق' && !(await hasFamily(S2c)), 'Safari, opened again: the access moved to the app, nothing kept', moved);
  await shot(S2c, 'iphone-moved');

  // ---- the root admin already in Safari
  const R = await phone('R', adminLink);
  await click(R, 'تصفّح أولًا', 'button', 500);
  const ctxR = await closeApp(R);
  const R2 = await reopen(ctxR, 'R2', { ua: IPHONE });
  g = await gate(R2);
  await shot(R2, 'iphone-root');
  check(!!g && g.buttons.some(b => b.includes('نسخ رابط المشرف')) && g.buttons.some(b => b.includes('حذف دخول المشرف')), 'the root admin in Safari: copy the admin link, then remove it from here');
  await click(R2, 'نسخ رابط المشرف', '.join.homescreen button', 1500);
  const c3 = await copied(R2);
  const adminPart = l => (l ?? '').match(/#join=([a-z0-9]+)\.[A-Za-z0-9_-]+\.([0-9a-f]{64})$/)?.slice(1).join('.');
  check(!!adminPart(c3) && adminPart(c3) === adminPart(adminLink), 'the admin link: the same family and admin key');
  await click(R2, 'حذف دخول المشرف', '.join.homescreen button', 3000);
  check(!(await hasFamily(R2)) && !!(await until(() => gate(R2).then(x => x && !x.buttons.some(b => b.includes('المشرف'))))), 'removed: nothing of the family left in Safari');

  // ---- a recovery link, and nothing at all
  const S3 = await phone('S3', base + '/#restore=v1.AAAA', { ua: IPHONE });
  g = await gate(S3);
  check(!!g && g.carry && g.text.includes('الشاشة الرئيسية'), 'a recovery link in Safari: only to copy');
  const S4 = await phone('S4', null, { ua: IPHONE });
  await S4.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await wait(1500);
  g = await gate(S4);
  check(!!g && !g.carry && g.buttons.some(b => b.includes('جرّب العائلة التجريبية')), 'nothing to carry: the steps, and the sample family');
  await click(S4, 'جرّب العائلة التجريبية', '.join.homescreen button', 2500);
  check(await S4.evaluate(() => !!document.querySelector('nav.tabs')), 'the sample family opens in Safari');
});
