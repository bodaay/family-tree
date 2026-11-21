import { useEffect, useMemo, useState } from 'preact/hooks';
import { set, viewer, canSee, nameOf, type State } from '../data/store';
import { degreeText, degreeWord, headline, routes, type Route } from '../data/kinship';
import { TreeCanvas } from '../tree/TreeCanvas';
import { Icon } from './icons';
import { Avatar, PANEL, Seg, isWide, themeOf, yearShort } from './common';

/**
 * How two people are related: every way, not only the closest (design document
 * 1.33). The headline names each relation at the closest degree («ابن عم، وابن
 * خالة»); below it every route, the closest first; the ladder and the tree show
 * the route chosen.
 */
export function Relation({ s }: { s: State }) {
  const g = s.graph;
  const a = s.relA ?? viewer(s);
  const b = s.relB;
  const rs = useMemo(() => (a && b && g.nodes.has(a) && g.nodes.has(b) ? routes(g, a, b) : []), [g, a, b]);
  const [pick, setPick] = useState(0);
  useEffect(() => setPick(0), [a, b]);
  const r: Route | null = rs[Math.min(pick, rs.length - 1)] ?? null;
  const v = viewer(s);
  // the path as a ladder by default; the same path in the 3D tree on request
  const [map, setMap] = useState(false);
  const H = window.innerHeight, W = window.innerWidth;
  const who = (id: string) => (id === v ? 'أنت' : nameOf(s, id));
  const deg = rs.length ? Math.min(...rs.map(x => x.deg)) : 0;
  const route = (
    <div class={'route glass' + (r && !map ? ' inline' : '')}>
      <div class="t">كيف نحن أقارب؟</div>
      <button class="rrow" onClick={() => set({ searchOpen: 'relationA' })}>
        <span class="dot f" />
        {a ? who(a) : 'اختر الشخص الأول'}
        <small>{a && a === v ? nameOf(s, a) : ''}</small>
      </button>
      <button class="rrow" onClick={() => set({ searchOpen: 'relation' })}>
        <span class="dot" />
        {b ? nameOf(s, b) : 'اختر شخصًا للمقارنة…'}
      </button>
      <button class="swap" onClick={() => set({ relA: b, relB: a })} aria-label="تبديل">
        <Icon name="swap" size={18} />
      </button>
    </div>
  );
  const tops = (x: Route) => x.top.map(id => nameOf(s, id)).join(' و');
  // where the two lines meet: their parents (brothers and sisters), or a common ancestor
  const topWord = (x: Route) =>
    x.up.length === 1 && x.down.length === 1 ? (x.top.length > 1 ? 'الأبوان' : g.nodes.get(x.top[0])?.sex === 'f' ? 'الأم' : 'الأب') : x.top.length > 1 ? 'الجدّان المشتركان' : 'الجد المشترك';
  // which parent of each it goes through: «عن طريق أبيك وأم فهد» (design document 1.34)
  const sides = (x: Route) => {
    if (!a || !b) return '';
    // a first step from a nursed child to a milk parent says so (design document 1.36)
    const byMilk = (from: string, line: string[]) => !!x.milk?.some(([c, p]) => c === from && (p === (line[1] ?? x.top[0]) || x.top.includes(p)));
    const ma = byMilk(a, x.up) ? ' من الرضاعة' : '', mb = byMilk(b, x.down) ? ' من الرضاعة' : '';
    const mine = x.side && (a === v ? (x.side === 'f' ? 'أبيك' : 'أمك') + ma : `${x.side === 'f' ? 'أبي' : 'أم'} ${nameOf(s, a)}${ma}`);
    const theirs = x.bside && `${x.bside === 'f' ? 'أبي' : 'أم'} ${nameOf(s, b)}${mb}`;
    const both = [mine, theirs].filter(Boolean).join(' و');
    return both ? ` · عن طريق ${both}` : '';
  };
  const answer = r && a && b && (
    <>
      <small>
        {nameOf(s, b)} بالنسبة {a === v ? 'لك' : 'إلى ' + nameOf(s, a)}
      </small>
      <h2>{headline(rs)}</h2>
      <div class="deg">
        <span class="n">{deg}</span>
        <span>
          {degreeText(deg)}
          {rs.length === 1 && r.top.length > 0 && (
            <>
              <br />
              {topWord(r)}: <b>{tops(r)}</b>
            </>
          )}
        </span>
      </div>
      <Seg cls="relview" value={map ? 'map' : 'ladder'} options={[['ladder', 'المسار'], ['map', 'في الشجرة']]} onChange={x => setMap(x === 'map')} />
    </>
  );
  // more than one way: each a row, the one shown marked
  const list = rs.length > 1 && (
    <div class="card list kinroutes">
      <div class="kinhead">{rs.length === 2 ? 'طريقان للقرابة' : `${rs.length} طرق للقرابة`}</div>
      {rs.map((x, i) => (
        <button class={'prow' + (x === r ? ' on' : '')} onClick={() => setPick(i)}>
          <span class="kdeg">{x.deg}</span>
          <span class="pt">
            <b>{x.term}</b>
            <small>
              {x.kind === 'spouse'
                ? 'زواج'
                : x.kind === 'inlaw'
                  ? `بالمصاهرة، عن طريق ${nameOf(s, x.via!)}`
                  : `الدرجة ${degreeWord(x.deg)}${sides(x)} · ${topWord(x).replace(' المشترك', '').replace(' المشتركان', '')}: ${tops(x)}`}
            </small>
          </span>
        </button>
      ))}
    </div>
  );

  if (r && a && b && !map) {
    return (
      <div class="page relation">
        {route}
        <div class="card relsum">{answer}</div>
        {list}
        <Ladder s={s} r={r} a={a} b={b} who={who} />
      </div>
    );
  }
  return (
    <div class="home">
      <TreeCanvas
        graph={g}
        theme={themeOf(s)}
        mode={r ? 'path' : 'home'}
        path={r?.path}
        me={r ? null : v}
        labels={r ? r.path.map(id => (id === v ? { id, text: 'أنت', accent: true, force: true } : { id, force: true, text: nameOf(s, id) })) : []}
        avoid={isWide() ? [[W - PANEL - 20, 0, W, H], [0, H - 110, W, H]] : [[0, 0, W, 214], [0, H - 310, W, 4000]]}
        centerY={isWide() ? 0.5 : 0.46}
        centerX={isWide() ? (W - PANEL) / 2 / W : 0.5}
        visible={id => canSee(s, id)}
        nameOf={id => nameOf(s, id)}
        zoomLabels={!r}
        onTap={id => id && set({ relB: id })}
      />
      {route}
      <div class="result glass">
        {answer || (
          <>
            <h2 style="font-size:22px">اختر شخصين</h2>
            <p class="hint">أو اضغط على أي شخص في الشجرة. يظهر المسار بينكما، ودرجة القرابة، والجد المشترك؛ وإن كان بينكما أكثر من طريق ظهرت كلها.</p>
          </>
        )}
        {map && rs.length > 1 && (
          <div class="kinpick">
            {rs.map((x, i) => (
              <button class={'chip' + (x === r ? ' on' : '')} onClick={() => setPick(i)}>
                {x.term} · {x.deg}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One route between two people as a ladder: the common ancestor at the top (or
 * the couple, side by side) and each one's line coming down beside the other, a
 * generation per step, so it reads the same at any depth. A marriage, or a
 * route through one, as steps one under another.
 */
function Ladder({ s, r, a, b, who }: { s: State; r: Route; a: string; b: string; who: (id: string) => string }) {
  // a nursed child whose step up is to a milk parent says so (design document 1.36)
  const nursed = new Set((r.milk ?? []).map(([c]) => c));
  const rung = (id: string, top = false) => (
    <button class={'rung' + (id === a || id === b ? ' end' : top ? ' lca' : '')} onClick={() => set({ profile: id })}>
      <Avatar id={id} s={s} size={34} />
      <span>
        <b>{who(id)}</b>
        <small>{[yearShort(s, id), nursed.has(id) ? 'بالرضاعة' : ''].filter(Boolean).join(' · ') || ' '}</small>
      </span>
    </button>
  );
  const leg = (ids: string[], tops: string[] = []) => (
    <div class="leg">
      {ids.map((id, k) => (
        <>
          {k > 0 && <i class="stem" />}
          {rung(id, tops.includes(id))}
        </>
      ))}
    </div>
  );
  if (r.kind !== 'blood' && r.kind !== 'milk') return <div class="ladder">{leg(r.path, r.top)}</div>;
  // the first person's line on the right (read first), the second's on the left
  const mine = [...r.up].reverse();
  const theirs = [...r.down].reverse();
  const both = mine.length > 0 && theirs.length > 0;
  return (
    <div class="ladder">
      <div class={r.top.length > 1 ? 'pair' : 'leg'}>{r.top.map(id => rung(id, true))}</div>
      <i class="stem" />
      {both && <i class="fork" />}
      <div class={'legs' + (both ? '' : ' one')}>
        {mine.length > 0 && leg(mine)}
        {theirs.length > 0 && leg(theirs)}
      </div>
    </div>
  );
}
