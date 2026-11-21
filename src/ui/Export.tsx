// Exporting the tree (design document, Section 9): a poster, or sheets to lay
// side by side, drawn on this phone from what it sees, with a watermark and a
// code that the family's log records before the file is made. For the key
// holders of gold (their own main branch) and above.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { nameOf, recordExport, set, toast, type State } from '../data/store';
import { branchOf } from '../data/governance';
import type { ExportRec, ExportWhat } from '../data/types';
import { defaultTitle, exporterName, exportScope, mayExport, prepare, today, type ExportOpts, type Paper, type Prepared } from '../export/build';
import { paint, pdfOf, svgOf } from '../export/pen';
import { shaper, type Shaper } from '../export/text';
import { Seg } from './common';
import { useBack } from './back';

const num = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 1 });

export function ExportSheet({ s }: { s: State }) {
  const f = s.exportFor!;
  const g = s.graph;
  const close = () => set({ exportFor: null });
  useBack(close);
  const founder = g.nodes.get(f.from)?.familyRoot;
  const [look, setO] = useState<Omit<ExportOpts, 'from' | 'kind'>>(() => ({
    mode: 'poster',
    paper: f.kind === 'up' ? 'A4' : 'A3',
    pt: 10,
    women: 'daughter',
    years: true,
    cal: s.settings.cal,
    dead: true,
    depth: null,
    scheme: 'colour',
    cream: true,
    title: '',
  }));
  // whom it is of, and which way, live in the state: the picker below and the search change them
  const o: ExportOpts = { ...look, from: f.from, kind: f.kind };
  const up = (patch: Partial<ExportOpts>) => {
    const { from, kind, ...rest } = patch;
    if (from !== undefined || kind !== undefined) set({ exportFor: { from: from ?? f.from, kind: kind ?? f.kind } });
    setO(x => ({ ...x, ...rest }));
  };
  // a title typed was for whom it was of: another choice starts from its own
  useEffect(() => setO(x => (x.title ? { ...x, title: '' } : x)), [f.from, f.kind]);
  const [sh, setSh] = useState<Shaper | null>(null);
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState<number | null>(0);
  const [sheet, setSheet] = useState(0);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    shaper()
      .then(setSh)
      .catch(() => toast('تعذّر تحميل خطوط التصدير، تحقق من الاتصال'));
  }, []);
  // laid out again whenever what it shows or where it goes changes (the title and the look need no new layout)
  const key = JSON.stringify([o.from, o.kind, o.mode, o.paper, o.pt, o.women, o.years, o.cal, o.dead, o.depth, o.scheme]);
  useEffect(() => {
    if (!sh) return;
    let stale = false;
    setBusy(0);
    prepare(s, o, sh, d => !stale && setBusy(d))
      .then(p => {
        if (stale) return;
        setPrep(p);
        setSheet(0);
        setBusy(null);
      })
      .catch(e => !stale && (toast('تعذّر رسم الشجرة: ' + (e instanceof Error ? e.message : String(e))), setBusy(null)));
    return () => {
      stale = true;
    };
    // the family as this phone sees it, too: a change in the tree, or a woman's key opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sh, key, g, s.opened.size]);
  const title = o.title.trim() || defaultTitle(s, o.from, o.kind, o.women);
  const pages = useMemo(() => (prep && sh ? prep.pages({ code: '••••-••••', by: exporterName(s), date: today() }, { title, cream: o.cream }) : null), [prep, sh, title, o.cream]);
  const svg = useMemo(() => (pages && sh ? svgOf(pages[Math.min(sheet, pages.length - 1)], sh) : ''), [pages, sheet]);
  const small = !!prep && prep.pt < 7;
  const image = o.mode === 'poster' && (o.paper === 'A4' || o.paper === 'A3');

  const go = async (as: 'pdf' | 'png') => {
    if (!prep || !sh || working) return;
    if (o.women === 'names' && !confirm('تظهر في الملف أسماء البنات اللاتي يفتح هاتفك تفاصيلهن وسنواتهن، والملف غير مشفر: يراها كل من يرى اللوحة. متابعة؟')) return;
    setWorking(true);
    try {
      const what: ExportWhat = { from: o.from, kind: o.kind, mode: o.mode, paper: o.paper, sheets: prep.sheets, women: o.women, years: o.years };
      // the record first: no file without it
      const code = await recordExport(what);
      const final = prep.pages({ code, by: exporterName(s), date: today() }, { title, cream: o.cream });
      const name = `${title} ${code}`.replace(/[\\/:*?"<>|]/g, ' ');
      if (as === 'pdf') await deliver(await pdfOf(final, sh, { title }), name + '.pdf');
      else {
        const p = final[0];
        // as sharp as a phone can draw: 300 dpi, within 16 megapixels
        const px = Math.floor(Math.min((p.w / 25.4) * 300, Math.sqrt((16e6 * p.w) / p.h)));
        const c = document.createElement('canvas');
        c.width = px;
        c.height = Math.round((px * p.h) / p.w);
        paint(p, sh, c.getContext('2d')!, px);
        const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
        if (!blob) throw new Error('الصورة');
        await deliver(blob, name + '.png');
      }
      toast(`صُدّرت. رمز النسخة ${code}`);
    } catch (e) {
      toast('تعذّر التصدير: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setWorking(false);
    }
  };

  const papers: [Paper, string][] = (o.mode === 'sheets' ? ['A4', 'A3'] : ['A4', 'A3', 'A2', 'A1', 'A0']).map(p => [p as Paper, p]);
  return (
    <div class="overlay full">
      <div class="addsheet exp">
        <div class="ahead">
          <button class="link" onClick={close}>
            إغلاق
          </button>
          <b>تصدير الشجرة</b>
          <span />
        </div>
        <div class="who2">
          <div>
            <b>{title}</b>
            <small>{prep ? `${num(prep.count)} في الشجرة` : ' '}</small>
          </div>
        </div>

        <Pick s={s} from={o.from} kind={o.kind} onPick={from => up({ from, kind: g.nodes.get(from)?.familyRoot ? 'down' : o.kind })} />

        <div class="expv">
          {svg ? <div class="expsvg" dangerouslySetInnerHTML={{ __html: svg }} /> : <div class="expwait">يُرتّب الشجرة…</div>}
          {busy !== null && svg && <div class="expbusy">يُرتّب الشجرة… {Math.round(busy * 100)}٪</div>}
        </div>
        {prep && (
          <div class="expinfo">
            <span>
              الأسماء {num(prep.pt)} نقطة
              {o.mode === 'sheets' && ` · ${num(prep.sheets)} ${prep.sheets > 10 ? 'لوحة' : 'لوحات'} ${o.paper}`}
            </span>
            {pages && pages.length > 1 && (
              <span class="pager">
                <button class="link" disabled={sheet === 0} onClick={() => setSheet(sheet - 1)}>
                  السابقة
                </button>
                {num(sheet + 1)} / {num(pages.length)}
                <button class="link" disabled={sheet >= pages.length - 1} onClick={() => setSheet(sheet + 1)}>
                  التالية
                </button>
              </span>
            )}
          </div>
        )}
        {small && <div class="warnbox">الأسماء صغيرة على هذا الورق: اختر ورقًا أكبر، أو لوحات متجاورة.</div>}

        {!founder && (
          <>
            <div class="q small">ماذا تُظهر</div>
            <Seg
              value={o.kind}
              options={[
                ['down', 'الذرية'],
                ['up', 'النسب إلى الجد'],
              ]}
              onChange={kind => up({ kind, mode: kind === 'up' ? 'poster' : o.mode, paper: kind === 'up' ? 'A4' : o.paper })}
            />
          </>
        )}
        {o.kind === 'down' && (
          <>
            <div class="q small">الشكل</div>
            <Seg
              value={o.mode}
              options={[
                ['poster', 'لوحة واحدة'],
                ['sheets', 'لوحات متجاورة'],
              ]}
              onChange={mode => up({ mode, paper: mode === 'sheets' && !['A4', 'A3'].includes(o.paper) ? 'A3' : o.paper })}
            />
            <div class="qh">{o.mode === 'poster' ? 'الشجرة كلها على ورقة واحدة بأكبر خط يسعه الورق.' : 'تُقطع الشجرة عند نهايات الأسر على أوراق تُصفّ جنبًا إلى جنب، وتمتد أسطر الأجيال مستوية عبرها.'}</div>
          </>
        )}
        <div class="q small">الورق</div>
        <Seg value={o.paper} options={papers} onChange={paper => up({ paper })} />
        {o.mode === 'sheets' && (
          <>
            <div class="q small">حجم الأسماء</div>
            <Seg value={String(o.pt)} options={[8, 10, 12, 14].map(n => [String(n), `${num(n)} نقطة`] as [string, string])} onChange={v => up({ pt: Number(v) })} />
          </>
        )}
        <div class="q small">البنات</div>
        <Seg
          value={o.women}
          options={[
            ['daughter', '«ابنة»'],
            ['names', 'بأسمائهن'],
            ['none', 'دونهن'],
          ]}
          onChange={women => up({ women })}
        />
        <div class="qh">{o.women === 'names' ? 'باسم كل بنت يفتح هاتفك تفاصيلها، و«ابنة» لغيرها. والملف غير مشفر.' : o.women === 'daughter' ? 'تظهر كل بنت بكلمة «ابنة»، بلا اسم ولا سنوات.' : 'لا تظهر البنات ولا من في الشجرة عن طريق أمه.'}</div>
        <div class="q small">السنوات</div>
        <Seg
          value={o.years ? o.cal : 'off'}
          options={[
            ['g', 'ميلادية'],
            ['h', 'هجرية'],
            ['off', 'بلا سنوات'],
          ]}
          onChange={v => up(v === 'off' ? { years: false } : { years: true, cal: v as 'g' | 'h' })}
        />
        {o.kind === 'down' && (
          <>
            <div class="q small">من يظهر</div>
            <Seg
              value={o.dead ? 'all' : 'living'}
              options={[
                ['all', 'الجميع'],
                ['living', 'الأحياء وأصولهم'],
              ]}
              onChange={v => up({ dead: v === 'all' })}
            />
            <div class="q small">الأجيال</div>
            <Seg value={o.depth === null ? 'all' : String(o.depth)} options={[['all', 'كلها'], ...[2, 3, 4, 5].map(n => [String(n), num(n)] as [string, string])]} onChange={v => up({ depth: v === 'all' ? null : Number(v) })} />
          </>
        )}
        <div class="q small">الألوان</div>
        <Seg
          value={o.scheme}
          options={[
            ['colour', 'لكل بيت لون'],
            ['branch', 'لكل فرع لون'],
            ['mono', 'أبيض وأسود'],
          ]}
          onChange={scheme => up({ scheme })}
        />
        <Seg
          cls="paper"
          value={o.cream ? 'cream' : 'white'}
          options={[
            ['cream', 'ورق عاجي'],
            ['white', 'ورق أبيض'],
          ]}
          onChange={v => up({ cream: v === 'cream' })}
        />
        <div class="q small">العنوان</div>
        <input class="bigin" placeholder={defaultTitle(s, o.from, o.kind, o.women)} value={o.title} maxLength={80} onInput={e => up({ title: (e.target as HTMLInputElement).value })} />
        <p class="hint">
          تُرسم الشجرة على هذا الجهاز مما يراه، ولا يُرسل منها شيء. يُسجَّل التصدير في سجل العائلة قبل أن يُنشأ الملف، باسمك ورمز يُطبع على اللوحة وفي علامتها المائية: من وجد لوحة عرف من صدّرها.
        </p>
        <div class="foot">
          {image && (
            <button class="btn" disabled={!prep || busy !== null || working || !s.online} onClick={() => void go('png')}>
              صورة
            </button>
          )}
          <button class="btn primary" disabled={!prep || busy !== null || working || !s.online} onClick={() => void go('pdf')}>
            {working ? 'يُصدّر…' : !s.online ? 'يحتاج اتصالًا' : 'تصدير PDF للطباعة'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Whom the chart is of: the line from the founder down to them, each step that
 * this phone may export a tap away; the houses under them; or anyone, found by
 * name. A gold's choices stay inside his branch.
 */
function Pick({ s, from, kind, onPick }: { s: State; from: string; kind: 'down' | 'up'; onPick: (id: string) => void }) {
  const g = s.graph;
  const line: string[] = [];
  for (let c: string | null = from; c; c = g.nodes.get(c)?.parent ?? null) line.unshift(c);
  // the houses under them: down a single line to where the family really splits (as the colours do), its lines there
  const lines = (id: string) => g.nodes.get(id)!.kids.filter(k => g.nodes.get(k)!.kids.length > 0);
  let at = from;
  for (let ls = lines(at); ls.length === 1; ls = lines(at)) at = ls[0];
  const houses = kind === 'down' ? lines(at).filter(k => mayExport(s, k)) : [];
  const word = (id: string) => (g.nodes.get(id)!.familyRoot ? 'الأسرة كاملة' : nameOf(s, id));
  return (
    <>
      <div class="q small">{kind === 'up' ? 'نسب من' : 'شجرة من'}</div>
      <div class="exppath">
        {line.map((id, i) => (
          <>
            {i > 0 && <span class="sep">›</span>}
            {id === from ? (
              <b>{word(id)}</b>
            ) : mayExport(s, id) && !(kind === 'up' && g.nodes.get(id)!.familyRoot) ? (
              <button class="link" onClick={() => onPick(id)}>
                {word(id)}
              </button>
            ) : (
              <span class="mut">{word(id)}</span>
            )}
          </>
        ))}
      </div>
      {houses.length > 0 && (
        <>
          <div class="qh">{g.nodes.get(from)!.familyRoot ? 'أو فرع منها:' : 'أو بيت منها:'}</div>
          <div class="chips2">
            {houses.map(h => (
              <button class="chip" onClick={() => onPick(h)}>
                {(g.branches.includes(h) ? 'فرع ' : 'بيت ') + nameOf(s, h)}
              </button>
            ))}
          </div>
        </>
      )}
      <button class="link exppick" onClick={() => set({ searchOpen: 'export' })}>
        اختيار شخص آخر…
      </button>
    </>
  );
}

/** Hands the file over: the share sheet on a phone (to save it or send it), a download elsewhere. */
async function deliver(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/** The exports this phone may see: every one for the root admin and the platinum holder, a gold's own branch's for a gold. */
export function visibleExports(s: State): ExportRec[] {
  const sc = exportScope(s);
  if (!sc) return [];
  return s.exports.filter(x => 'all' in sc || (s.graph.nodes.has(x.what.from) && branchOf(s.graph, x.what.from) === sc.branch));
}

/** One export, in words: what, how, by whom, when. */
export function describe(s: State, x: ExportRec): { what: string; how: string; who: string; when: string } {
  const n = s.graph.nodes.get(x.what.from);
  const what = !n ? 'شخص لم يعد في الشجرة' : x.what.kind === 'up' ? 'نسب ' + nameOf(s, x.what.from) : n.familyRoot ? 'شجرة الأسرة كاملة' : (s.graph.branches.includes(x.what.from) ? 'فرع ' : 'بيت ') + nameOf(s, x.what.from);
  const how = [x.what.mode === 'sheets' ? `${num(x.what.sheets)} لوحات ${x.what.paper}` : `لوحة ${x.what.paper}`, x.what.women === 'names' ? 'بأسماء البنات' : '', x.what.years ? '' : 'بلا سنوات'].filter(Boolean).join('، ');
  const who = x.by && s.graph.nodes.has(x.by) ? (x.via ? 'مشرف العائلة بصفة ' : '') + nameOf(s, x.by) : 'مشرف العائلة';
  const when = new Date(x.at).toLocaleDateString('ar-SA-u-ca-gregory-nu-arab', { day: 'numeric', month: 'long', year: 'numeric' });
  return { what, how, who, when };
}

/** Exporting, in «الإدارة» (or «أنا» for a gold): the button, a code looked up, and the exports so far. */
export function ExportLog({ s }: { s: State }) {
  const sc = exportScope(s);
  const [code, setCode] = useState('');
  if (!sc) return null;
  const list = visibleExports(s);
  const want = code.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const found = want.length >= 8 ? list.filter(x => x.code.replace('-', '') === want.slice(0, 8)) : [];
  const from = 'all' in sc ? s.graph.root : sc.branch;
  const row = (x: ExportRec) => {
    const d = describe(s, x);
    return (
      <div class="prow static" key={x.code + x.at}>
        <span class="pt">
          <b>
            {d.what} <small class="mut" dir="ltr">{x.code}</small>
          </b>
          <small>
            {d.how} · {d.who} · {d.when}
            {!x.ok && ' · بلا صلاحية'}
          </small>
        </span>
      </div>
    );
  };
  return (
    <section>
      <h3>تصدير الشجرة</h3>
      <p class="hint">{'all' in sc ? 'لوحة للطباعة أو لوحات متجاورة، لأي فرع أو بيت أو للأسرة كاملة. ويُصدّر من صفحة أي شخص ذريتُه أو نسبُه.' : 'لوحة للطباعة أو لوحات متجاورة لفرعك. ويُصدّر من صفحة أي شخص في فرعك ذريتُه أو نسبُه.'}</p>
      <button class="btn wide" onClick={() => set({ exportFor: { from, kind: 'down' } })}>
        {'all' in sc ? 'تصدير شجرة الأسرة' : 'تصدير شجرة فرعي'}
      </button>
      <div class="q small">من صدّر هذه اللوحة؟</div>
      <input class="bigin" dir="ltr" placeholder="رمز النسخة المطبوع عليها" value={code} onInput={e => setCode((e.target as HTMLInputElement).value)} />
      {want.length >= 8 && (found.length ? <div class="card list">{found.map(row)}</div> : <div class="warnbox">لا تصدير بهذا الرمز {'all' in sc ? 'في سجل العائلة' : 'في فرعك'}.</div>)}
      {list.length > 0 && (
        <>
          <div class="q small">آخر ما صُدّر</div>
          <div class="card list">{[...list].reverse().slice(0, 20).map(row)}</div>
        </>
      )}
    </section>
  );
}
