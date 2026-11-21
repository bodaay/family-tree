// Exporting the tree (design document 1.30). The root admin exports the whole
// family as a PDF, someone's lineage as a picture, and the family as sheets side
// by side; each export is in the log before its file, with the code printed on
// it, and «الإدارة» finds who made it from that code. A gold exports his own
// branch only; a member without a seat cannot; an export entry written by
// someone who may not is kept, marked as such.
//   OUT=<dir for files> node export.mjs BASE admin-link-file
import { setup, click, wait } from './mar-lib.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const t = setup();
const { ok } = t;
const out = process.env.OUT;
fs.mkdirSync(out, { recursive: true });
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const build = (p, fn, arg) => mod(p, '/src/export/build.ts', (B, x) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts') ?? '/src/data/store.ts').then(S => new Function('B', 'S', 'a', 'return (' + x.src + ')(B, S, a)')(B, S, x.arg)), { src: fn.toString(), arg });
const until = async (fn, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(500)) if (await fn().catch(() => false)) return true;
  return false;
};
const tab = async (p, name) => { await p.evaluate(n => [...document.querySelectorAll('.tab')].find(e => e.textContent.includes(n))?.click(), name); await wait(600); };
const lastLink = p => p.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}'); const sk = Object.values(inv).pop(); return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null; });
const invite = async (A, id) => {
  await store(A, (m, id) => m.createInvite(id, 'x', true), id);
  await wait(1200);
  await store(A, m => m.set({ inviteOpen: null }));
  return lastLink(A);
};
/** Files of a kind that appeared in `out` since `before`. */
const newFile = async (ext, before, ms = 60000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(400)) {
    const f = fs.readdirSync(out).find(x => x.endsWith(ext) && !before.includes(x) && !x.endsWith('.crdownload'));
    if (f) return f;
  }
  return null;
};
const downloads = async p => {
  const cdp = await p.target().createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: out });
  // no share sheet in a headless browser: the download path
  await p.evaluate(() => { navigator.canShare = () => false; });
};
/** Opens the export sheet for a person and waits for its preview. */
const openExport = async (p, from, kind) => {
  await store(p, (m, a) => m.set({ exportFor: a }), { from, kind });
  return until(() => p.evaluate(() => !!document.querySelector('.expsvg svg') && !document.querySelector('.expbusy')), 90000);
};
const seg = async (p, label) => {
  const r = await p.evaluate(l => { const b = [...document.querySelectorAll('.exp .seg button')].find(x => x.textContent.trim() === l); b?.click(); return !!b; }, label);
  // the new layout starts after the next render
  await wait(400);
  return r;
};
const ready = p => until(() => p.evaluate(() => !!document.querySelector('.expsvg svg') && !document.querySelector('.expbusy')), 90000);
const press = (p, label) => p.evaluate(l => { const b = [...document.querySelectorAll('.foot button')].find(x => x.textContent.includes(l) && !x.disabled); b?.click(); return !!b; }, label);
const pages = f => Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [out + '/' + f]).toString())?.[1] ?? 0);

try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  await downloads(A);
  // the big branch and the small one; in the big one a man with a family (G), another (M), and someone deep (D)
  const P = await store(A, m => {
    const g = m.getState().graph;
    const size = id => g.nodes.get(id).desc;
    const mains = [...g.branches].sort((a, b) => size(b) - size(a));
    const [B, S] = mains;
    const men = [...g.nodes.values()].filter(n => n.sex === 'm' && !n.dead && !n.external && n.birth && n.birth.v < 1995 && n.branch === B && n.id !== B);
    const G = men.find(n => n.kids.length >= 2);
    const M = men.find(n => n.id !== G.id && n.parent !== G.id && G.parent !== n.id);
    const D = [...g.nodes.values()].filter(n => n.branch === B && n.sex === 'm').sort((a, b) => b.gen - a.gen)[0];
    const inS = [...g.nodes.values()].find(n => n.branch === S && n.id !== S && n.kids.length);
    return { B, S, G: G.id, M: M.id, D: D.id, inS: inS.id, root: g.root };
  });
  ok(P.B && P.S && P.G && P.M && P.D && P.inS, 'people picked from the tree');

  // 1. the root admin: the whole family as a PDF on A3
  ok(await openExport(A, P.root, 'down'), 'the export sheet draws the whole family');
  const info = await A.evaluate(() => document.querySelector('.expinfo')?.textContent ?? '');
  ok(/الأسماء [٠-٩]/.test(info), 'it gives the names\' size: ' + info);
  ok(await A.evaluate(() => !!document.querySelector('.exp .warnbox')), 'and warns they are small on A3');
  await seg(A, 'A0');
  ok(await ready(A), 'laid out again for A0');
  ok(!(await A.evaluate(() => !!document.querySelector('.exp .warnbox'))), 'no warning on A0');
  let before = fs.readdirSync(out);
  ok(await press(A, 'PDF'), 'exported');
  const pdf1 = await newFile('.pdf', before);
  ok(!!pdf1, 'a PDF: ' + pdf1);
  const code1 = /([2-9A-Z]{4}-[2-9A-Z]{4})\.pdf$/.exec(pdf1 ?? '')?.[1];
  ok(!!code1 && pages(pdf1) === 1, 'one page, its code in the name: ' + code1);
  ok(/A0|1190\.55 x 1683\.78|1683\.78 x 1190\.55/.test(execFileSync('pdfinfo', [out + '/' + pdf1]).toString()), 'the page is A0');
  ok(await until(() => store(A, (m, c) => m.getState().exports.some(x => x.code === c && x.ok && x.what.paper === 'A0' && x.what.from === m.getState().graph.root), code1)), 'the log records it, allowed, before the file');

  // a title of one's own: on the page and in the file's name, without laying it out again
  await A.evaluate(() => { const i = document.querySelector('.exp input.bigin'); i.value = 'أسرتنا الكبيرة'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(500);
  ok(await A.evaluate(() => document.querySelector('.who2 b')?.textContent === 'أسرتنا الكبيرة' && !document.querySelector('.expbusy')), 'a title typed shows at once');
  before = fs.readdirSync(out);
  ok(await press(A, 'PDF'), 'exported with it');
  const pdfT = await newFile('.pdf', before);
  ok(!!pdfT && pdfT.startsWith('أسرتنا الكبيرة') && /Title:\s+أسرتنا الكبيرة/.test(execFileSync('pdfinfo', [out + '/' + pdfT]).toString()), 'the file carries it: ' + pdfT);
  await A.evaluate(() => { const i = document.querySelector('.exp input.bigin'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  // a daughter's lineage is not titled with her name while daughters show as «ابنة»
  const t2 = await build(A, (B, S) => { const s = S.getState(); const w = [...s.graph.nodes.values()].find(n => n.sex === 'f' && !n.familyRoot && !n.external && n.parent); return [B.defaultTitle(s, w.id, 'up', 'daughter'), B.defaultTitle(s, w.id, 'up', 'names'), w.name]; });
  ok(t2[0].startsWith('نسب ابنة ') && !t2[0].includes(t2[2] + ' من') && t2[1].includes(t2[2]), "a daughter's lineage: «نسب ابنة …» unless names are chosen");

  // 2. sheets side by side: as many pages as the sheet says
  await seg(A, 'لوحات متجاورة');
  ok(await ready(A), 'laid out as sheets');
  const nSheets = await A.evaluate(() => Number((document.querySelector('.expinfo')?.textContent.match(/· ([٠-٩]+)/)?.[1] ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
  ok(nSheets > 1, 'several sheets: ' + nSheets);
  before = fs.readdirSync(out);
  ok(await press(A, 'PDF'), 'exported');
  const pdf2 = await newFile('.pdf', before);
  ok(!!pdf2 && pages(pdf2) === nSheets, `a page for each sheet (${pdf2 && pages(pdf2)})`);
  await click(A, 'إغلاق', '.ahead button', 400);

  // 3. someone's lineage, as a picture
  ok(await openExport(A, P.D, 'up'), "a lineage's sheet");
  ok(await A.evaluate(() => [...document.querySelectorAll('.foot button')].some(b => b.textContent.includes('صورة'))), 'a picture is offered (A4)');
  before = fs.readdirSync(out);
  ok(await press(A, 'صورة'), 'exported as a picture');
  const png = await newFile('.png', before);
  ok(!!png && fs.readFileSync(out + '/' + png).subarray(1, 4).toString() === 'PNG', 'a PNG: ' + png);
  await click(A, 'إغلاق', '.ahead button', 400);

  // 4. a gold of the big branch, and a member with no seat
  ok(await store(A, (m, a) => (m.appoint('gold', a.B, a.G), true), P), 'G is made gold of the big branch');
  ok(await until(() => store(A, (m, a) => m.getState().seats.some(x => x.tier === 'gold' && x.holder === a.G), P)), 'his seat is in the log');
  const G = await t.phone('G', await invite(A, P.G));
  ok(await click(G, 'نعم، أنا', '.join button', 2000), 'G joins');
  const M = await t.phone('M', await invite(A, P.M));
  ok(await click(M, 'نعم، أنا', '.join button', 2000), 'M joins');
  await downloads(G);
  ok(await until(() => build(G, (B, S, a) => B.mayExport(S.getState(), a.B), P), 30000), 'G may export his branch');
  ok(await build(G, (B, S, a) => B.mayExport(S.getState(), a.D) && !B.mayExport(S.getState(), a.inS) && !B.mayExport(S.getState(), a.root), P), 'anyone in it; not the other branch, nor the whole family');
  ok(!(await build(M, (B, S, a) => B.mayExport(S.getState(), a.D), P)), 'M may not export at all');
  await tab(G, 'أنا');
  ok(await G.evaluate(() => [...document.querySelectorAll('.page button')].some(b => b.textContent.includes('تصدير شجرة فرعي'))), "G's «أنا» has «تصدير شجرة فرعي»");
  await tab(M, 'أنا');
  ok(!(await M.evaluate(() => [...document.querySelectorAll('.page h3')].some(h => h.textContent.includes('تصدير')))), "M's has no export");
  await store(G, (m, id) => m.set({ profile: id }), P.inS);
  await wait(700);
  ok(!(await G.evaluate(() => [...document.querySelectorAll('h3')].some(h => h.textContent.trim() === 'تصدير'))), "the other branch's profiles offer G no export");
  await store(G, m => m.set({ profile: null }));
  ok(await openExport(G, P.B, 'down'), "G's branch drawn");
  // the line above his branch: the founder and the branch's founder
  ok(await G.evaluate(() => /فرع /.test(document.querySelector('.who2 b')?.textContent ?? '')), 'titled as his branch');
  before = fs.readdirSync(out);
  ok(await press(G, 'PDF'), 'G exports it');
  const pdf3 = await newFile('.pdf', before);
  const code3 = /([2-9A-Z]{4}-[2-9A-Z]{4})\.pdf$/.exec(pdf3 ?? '')?.[1];
  ok(!!code3, 'a PDF: ' + pdf3);
  ok(await until(() => store(A, (m, a) => m.getState().exports.some(x => x.code === a.c && x.ok && x.by === a.G), { c: code3, G: P.G }), 30000), "on the root admin's phone: by G, allowed");

  // 5. entries written by those who may not: kept, marked
  const w = { from: P.inS, kind: 'down', mode: 'poster', paper: 'A3', sheets: 1, women: 'daughter', years: true };
  const forged1 = await store(G, (m, w) => m.recordExport(w), w);
  const forged2 = await store(M, (m, w) => m.recordExport({ ...w, from: m.getState().graph.root }), w);
  ok(await until(() => store(A, (m, a) => { const e = m.getState().exports; return e.some(x => x.code === a[0] && !x.ok) && e.some(x => x.code === a[1] && !x.ok); }, [forged1, forged2]), 30000), "G's export of the other branch and M's of the family: recorded, not allowed");

  // 6. «الإدارة»: the list, and a code looked up
  await tab(A, 'الإدارة');
  await A.evaluate(() => [...document.querySelectorAll('.page h3')].find(h => h.textContent.includes('تصدير الشجرة'))?.scrollIntoView());
  ok(await A.evaluate(() => [...document.querySelectorAll('.page .prow')].filter(r => r.textContent.includes('بلا صلاحية')).length === 2), 'the list marks the two');
  await A.type('input[placeholder="رمز النسخة المطبوع عليها"]', code3.toLowerCase().replace('-', ' '), { delay: 10 });
  await wait(500);
  const found = await A.evaluate(() => [...document.querySelectorAll('.page section')].find(x => x.querySelector('h3')?.textContent.includes('تصدير الشجرة'))?.querySelector('.card.list')?.textContent ?? '');
  const gName = await store(A, (m, g) => m.nameOf(m.getState(), g), P.G);
  ok(found.includes(gName) && found.includes(code3), 'the code (typed loosely) finds G\'s export');
  // a gold looks up only his branch's
  await tab(G, 'أنا');
  ok(await until(() => G.evaluate(() => [...document.querySelectorAll('.page .prow')].some(r => r.textContent.includes('فرع'))), 10000), "G's «أنا» lists his branch's exports");
  ok(!(await G.evaluate(c => document.body.textContent.includes(c), code1)), "and not the root admin's export of the family");
} catch (e) {
  ok(false, 'threw: ' + (e?.stack ?? e));
}
await t.finish();
