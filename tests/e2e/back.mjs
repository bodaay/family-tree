// The phone's back steps back through what is open, as in any app: search,
// a profile and the ones opened from it, a tab, «إضافة ابن» page by page, a
// sheet, the person in focus; closing in the app keeps the history in step,
// as does a reload; with nothing open, back leaves. A newer version shows a
// bar that reloads, and «أنا» has «تحديث».
//   node back.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const shots = process.argv[4];
const st = (p, keys) => store(p, (m, k) => Object.fromEntries(k.map(x => [x, m.getState()[x]])), keys);
const depth = p => p.evaluate(() => history.state?.back ?? 0);
const mark = p => p.evaluate(() => { window.__m = 1; });
const here = p => p.evaluate(() => window.__m === 1 && !!document.querySelector('nav.tabs'));
const back = async p => { await p.goBack({ timeout: 4000 }).catch(() => {}); await wait(500); };
const tab = async (p, name) => { await p.evaluate(n => [...document.querySelectorAll('.tab')].find(e => e.textContent.includes(n))?.click(), name); await wait(500); };
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  await mark(A);
  const url = A.url();
  ok((await depth(A)) === 0, 'nothing open: no entries of ours');

  // search
  await A.click('button.search');
  await wait(500);
  ok(await A.evaluate(() => !!document.querySelector('.overlay.full .searchpage')), 'search opens');
  ok((await depth(A)) === 1, 'one entry for it');
  await back(A);
  ok(!(await A.evaluate(() => !!document.querySelector('.overlay.full'))) && (await here(A)) && A.url() === url, 'back closes search, and the app stays');

  // a profile, and one opened from it
  const P = await store(A, m => { const g = m.getState().graph; return [...g.nodes.values()].find(n => !n.familyRoot && !n.external && n.father && n.kids.length >= 2 && n.kids.some(k => g.nodes.get(k).kids.length))?.id; });
  await store(A, (m, id) => m.set({ profile: id }), P); await wait(600);
  const K = await A.evaluate(() => { const b = document.querySelector('.page.profile .fkids .fp'); b?.click(); return !!b; });
  await wait(600);
  const k1 = (await st(A, ['profile'])).profile;
  ok(K && k1 && k1 !== P, 'a child opens from his profile');
  ok((await depth(A)) === 2, 'two entries: the profile, and the step to the child');
  await back(A);
  ok((await st(A, ['profile'])).profile === P && (await here(A)), 'back returns to the father\'s profile');
  await back(A);
  ok(!(await st(A, ['profile'])).profile && (await here(A)), 'back again closes the profile');

  // the profile's own back arrow takes the same steps
  await store(A, (m, id) => m.set({ profile: id }), P); await wait(600);
  await A.evaluate(() => document.querySelector('.page.profile .fkids .fp')?.click()); await wait(600);
  await A.evaluate(() => document.querySelector('.page.profile .navbtns button[aria-label="رجوع"]')?.click()); await wait(600);
  ok((await st(A, ['profile'])).profile === P, 'the arrow returns to the father');
  await A.evaluate(() => document.querySelector('.page.profile .navbtns button[aria-label="رجوع"]')?.click()); await wait(600);
  ok(!(await st(A, ['profile'])).profile && (await depth(A)) === 0, 'and then closes, the history back in step');

  // tabs
  await tab(A, 'الطلبات');
  await back(A);
  ok((await st(A, ['tab'])).tab === 'tree' && (await here(A)), 'back from another tab returns to the tree');
  await tab(A, 'الطلبات');
  await store(A, (m, id) => m.set({ profile: id }), P); await wait(600);
  await back(A);
  let x = await st(A, ['tab', 'profile']);
  ok(x.tab === 'requests' && !x.profile, 'a profile over a tab closes first');
  await back(A);
  ok((await st(A, ['tab'])).tab === 'tree', 'then the tree');

  // «إضافة ابن», page by page
  await store(A, (m, id) => m.set({ addFor: id }), P); await wait(600);
  const page = () => A.evaluate(() => (document.querySelector('.overlay.full')?.innerText.match(/(\d+) من (\d+)/) ?? [])[1] ?? null);
  ok((await page()) === '1', 'the sheet opens on its first page');
  await click(A, 'التالي', '.overlay.full .foot button', 500);
  const p2 = await page();
  await back(A);
  ok(p2 === '2' && (await page()) === '1', 'back from the second page returns to the first · ' + p2);
  await back(A);
  ok(!(await st(A, ['addFor'])).addFor && (await here(A)), 'back from the first closes it');

  // a sheet (the recovery kit)
  await store(A, m => m.set({ kitOpen: true })); await wait(600);
  ok(await A.evaluate(() => !!document.querySelector('.modal.kit')), 'a sheet opens');
  await back(A);
  ok(!(await st(A, ['kitOpen'])).kitOpen && (await here(A)), 'back closes the sheet');

  // the person in focus
  await store(A, (m, id) => m.set({ focus: id }), P); await wait(700);
  await back(A);
  ok(!(await st(A, ['focus'])).focus && (await here(A)), 'back lets go of the person in focus');

  // closed in the app: the history follows
  await A.click('button.search'); await wait(500);
  await A.evaluate(() => document.querySelector('.searchpage .shead button.round')?.click()); await wait(400);
  ok((await depth(A)) === 0, 'search closed with its own button: our entry is taken back');
  await store(A, (m, id) => m.set({ profile: id }), P); await wait(600);
  await back(A);
  ok(!(await st(A, ['profile'])).profile && (await here(A)), 'and the next back closes the next thing, not a stale one');

  // a reload while things were open
  await store(A, (m, id) => m.set({ profile: id }), P); await wait(600);
  await A.evaluate(() => document.querySelector('.page.profile .fkids .fp')?.click()); await wait(600);
  // the browser's own reload, on our entry: the app returns to the page's own entry (loading once more)
  await Promise.all([A.waitForNavigation({ waitUntil: 'networkidle0' }), A.reload()]);
  await wait(2000);
  await click(A, 'تصفّح أولًا', 'button', 500);
  await mark(A);
  ok((await depth(A)) === 0, 'after a reload the history is brought back in step');
  await A.click('button.search'); await wait(500);
  await back(A);
  ok(!(await A.evaluate(() => !!document.querySelector('.overlay.full'))) && (await here(A)), 'and back still closes what is open');

  // a newer version: a bar that reloads
  await A.setRequestInterception(true);
  const onReq = r => (r.resourceType() === 'fetch' && new URL(r.url()).pathname === '/' ? r.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><script type="module" src="/assets/index-NEWER123.js"></script>' }) : r.continue());
  A.on('request', onReq);
  await A.evaluate(() => { const s = document.createElement('script'); s.type = 'text/plain'; s.setAttribute('src', '/assets/index-OLDER456.js'); document.head.append(s); document.dispatchEvent(new Event('visibilitychange')); });
  await wait(1200);
  const seen = await mod(A, '/src/update.ts', m => m.newerVersion());
  ok(await A.evaluate(() => document.querySelector('.updatebar')?.textContent.includes('تحديث')), 'a newer version on the site: the bar says so · check says ' + seen);
  if (shots) await A.screenshot({ path: shots + '/update-bar.png' });
  A.off('request', onReq);
  await A.setRequestInterception(false);
  await Promise.all([A.waitForNavigation({ waitUntil: 'networkidle0' }), A.click('.updatebar')]);
  await wait(2000);
  ok(!(await A.evaluate(() => window.__m === 1)) && (await A.evaluate(() => !!document.querySelector('nav.tabs'))), 'a tap on it reloads the app');
  ok(!(await A.evaluate(() => !!document.querySelector('.updatebar'))), 'no bar when the version is the same');

  // «أنا» › «تحديث»
  await mark(A);
  await tab(A, 'أنا');
  const btn = await A.evaluate(() => [...document.querySelectorAll('.page .srow')].some(r => r.textContent.includes('التطبيق') && r.querySelector('button')?.textContent.includes('تحديث')));
  ok(btn, '«أنا» has «تحديث»');
  await Promise.all([A.waitForNavigation({ waitUntil: 'networkidle0' }), A.evaluate(() => [...document.querySelectorAll('.page .srow button')].find(b => b.textContent.includes('تحديث'))?.click())]);
  await wait(2000);
  ok(!(await A.evaluate(() => window.__m === 1)) && (await A.evaluate(() => !!document.querySelector('nav.tabs'))), 'it reloads the app');

  // with nothing open, back leaves as usual
  await tab(A, 'الشجرة');
  await wait(400);
  const before = A.url();
  await back(A);
  ok(A.url() !== before, 'with nothing open, back leaves the app · ' + A.url().slice(0, 30));
  await t.finish();
} catch (e) { await t.crash(e); }
