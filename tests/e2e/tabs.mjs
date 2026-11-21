// The bottom tab bar answers every real tap: over each page, over an open profile,
// with a toast showing, and with the «من تقصد؟» backdrop up.
//   node tabs.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
const store = (p, fn, arg) => p.evaluate((src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts') ?? '/src/data/store.ts').then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), fn.toString(), arg);
const shots = process.argv[4];
const LABELS = ['الشجرة', 'القرابة', 'الطلبات', 'الإدارة', 'أنا'];
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await click(A, 'تصفّح أولًا', 'button', 500);
  // what a finger at the middle of each tab would touch
  const hits = () => A.evaluate(labels => labels.map(l => {
    const b = [...document.querySelectorAll('.tabs .tab')].find(x => x.textContent.includes(l));
    if (!b) return l + ':missing';
    const r = b.getBoundingClientRect();
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return b.contains(e) ? 'ok' : l + ':' + (e?.className || e?.tagName);
  }), LABELS);
  const tap = async label => {
    const r = await A.evaluate(l => { const b = [...document.querySelectorAll('.tabs .tab')].find(x => x.textContent.includes(l)); const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; }, label);
    await A.touchscreen.tap(r[0], r[1]);
    await wait(700);
  };
  const where = () => store(A, m => { const s = m.getState(); return { tab: s.tab, profile: s.profile, focus: s.focus }; });
  const covered = h => h.filter(x => x !== 'ok');

  for (const l of LABELS) {
    await tap(l);
    const h = await hits();
    ok(covered(h).length === 0, 'on «' + l + '» every tab is reachable · ' + covered(h).join(' '));
  }

  // a profile open, from the tree: the tab bar sits over it
  const person = await store(A, m => [...m.getState().graph.nodes.values()].find(n => !n.familyRoot && n.kids.length > 2).id);
  await tap('الشجرة');
  await store(A, (m, id) => m.set({ focus: id }), person); await wait(900);
  await click(A, 'الملف الكامل', 'button', 900);
  ok(await A.evaluate(() => !!document.querySelector('.page.profile')), 'the profile is open');
  ok(covered(await hits()).length === 0, 'over the profile every tab is reachable');
  if (shots) await A.screenshot({ path: shots + '/tabs-profile.png' });
  await tap('القرابة');
  let w = await where();
  ok(w.tab === 'relation' && !w.profile && await A.evaluate(() => !document.querySelector('.page.profile') && !!document.querySelector('.route')), 'tapping «القرابة» over a profile shows the relation page · ' + JSON.stringify(w));

  // a profile opened from the relation page, then its own tab: back to the page
  await store(A, (m, id) => m.set({ profile: id }), person); await wait(700);
  await tap('القرابة');
  w = await where();
  ok(w.tab === 'relation' && !w.profile, 'the tab already shown closes the profile on it · ' + JSON.stringify(w));

  // each tab from a profile
  for (const l of LABELS) {
    await store(A, (m, id) => m.set({ profile: id }), person); await wait(600);
    await tap(l);
    w = await where();
    ok(!w.profile && !(await A.evaluate(() => !!document.querySelector('.page.profile'))), 'from a profile, «' + l + '» shows its page · ' + w.tab);
  }

  // the tree tab on the tree: from a family card back to the whole tree
  await tap('الشجرة');
  await store(A, (m, id) => m.set({ focus: id }), person); await wait(900);
  ok(await A.evaluate(() => !!document.querySelector('.fcard')), 'a family card is open');
  await tap('الشجرة');
  w = await where();
  ok(w.tab === 'tree' && !w.focus && await A.evaluate(() => !document.querySelector('.fcard')), 'tapping «الشجرة» again returns to the whole tree · ' + JSON.stringify(w));

  // a toast showing
  await store(A, m => m.toast('اختبار')); await wait(300);
  ok(covered(await hits()).length === 0, 'with a toast showing every tab is reachable');

  // the «من تقصد؟» backdrop (drawn the way Home draws it)
  await A.evaluate(() => { const d = document.createElement('div'); d.className = 'pickmany-bg'; d.id = 'fakebg'; document.querySelector('.app').appendChild(d); });
  const h = await hits();
  ok(covered(h).length === 0, 'with the «من تقصد؟» backdrop up every tab is reachable · ' + covered(h).join(' '));
  await A.evaluate(() => document.getElementById('fakebg').remove());
  await t.finish();
} catch (e) { await t.crash(e); }
