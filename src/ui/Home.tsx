import { useEffect, useRef, useState } from 'preact/hooks';
import { set, toast, getState, viewer, canSee, nameOf, isMinorViewer, MINOR_NOTE, canAsk, asksNote, type State } from '../data/store';
import { ancestorsOf } from '../data/graph';
import { TreeCanvas } from '../tree/TreeCanvas';
import { ChartCanvas } from '../tree/ChartCanvas';
import { FamilyCard } from './FamilyCard';
import type { Label } from '../tree/render';
import { branchColor } from '../tree/render';
import type { Coloring } from '../tree/colors';
import { degreeWord } from '../data/kinship';
import { Icon } from './icons';
import { Avatar, PANEL, SeatBadge, Seg, deadMark, genLabel, isWide, kidsCount, lineOf, themeOf, yearShort, YearText } from './common';
import { useBack } from './back';

export function Home({ s }: { s: State }) {
  const g = s.graph;
  const theme = themeOf(s);
  const v = viewer(s);
  const [levels, setLevels] = useState<number[]>([]);
  // the lines coloured in the 3D view right now (they change as you zoom)
  const [colors, setColors] = useState<Coloring | null>(null);
  // several people under one tap: a small list to choose from
  const [many, setMany] = useState<{ ids: string[]; x: number; y: number } | null>(null);
  const lines = (colors && g.nodes.has(colors.top) ? colors.groups.filter(id => g.nodes.get(id)?.kids.length) : g.houses).filter(id => g.nodes.has(id));
  const lineColor = (id: string) => colors?.color.get(id) ?? branchColor(g, id, theme);
  const focus = s.focus && g.nodes.has(s.focus) ? s.focus : null;
  // back closes the list under a tap, then lets go of the person in focus
  useBack(() => set({ focus: null }), !!focus);
  useBack(() => setMany(null), !!many);
  const is2d = s.settings.view === '2d';
  const visible = (id: string) => canSee(s, id);
  // a generation chosen on the rail, with those after it (the default) or before it
  const span = s.settings.genSpan;
  const shown = s.gen == null ? [] : [...Array(g.maxGen + 1).keys()].filter(i => (span === 'down' ? i >= s.gen! : span === 'up' ? i <= s.gen! : i === s.gen));
  const name = (id: string) => nameOf(s, id);

  const labels: Label[] = [
    { id: g.root, text: g.family.name + ' · الجد الجامع', big: true, force: true },
    ...g.branches.map(b => ({ id: b, dot: true, force: true })),
    ...lines.filter(h => !g.branches.includes(h)).map(h => ({ id: h, dot: true })),
  ];
  if (v && g.nodes.has(v)) labels.push({ id: v, text: 'أنت', accent: true, force: true });
  const railRect = levels.length ? [[322, levels[0] - 34, 400, levels[levels.length - 1] + 26] as [number, number, number, number]] : [];
  const W = typeof window !== 'undefined' ? window.innerWidth : 390;
  const avoid: [number, number, number, number][] = [[0, 0, W, 226], [0, window.innerHeight - (s.gen != null ? 215 : 150), W, 4000], ...railRect.map(r => [W - 70, r[1], W, r[3]] as [number, number, number, number])];

  // only the generations whose level is on screen (zooming moves them), and not under the generation's panel
  const railStops = levels.map((y, i) => ({ y, i })).filter(l => l.y > 250 && l.y < window.innerHeight - (s.gen != null ? 240 : 165));
  const people = g.members;

  return (
    <div class={'home' + (focus ? ' focused' : '') + (!focus && !is2d && s.gen != null ? ' gen' : '')}>
      {is2d ? (
        <ChartCanvas
          graph={g}
          theme={theme}
          me={v}
          selected={focus}
          target={focus}
          centerX={focus && isWide() ? (W - PANEL) / 2 / W : 0.5}
          centerY={focus ? (isWide() ? 0.45 : 0.32) : 0.45}
          visible={visible}
          nameOf={name}
          yearOf={id => yearShort(s, id)}
          onTap={id => set({ focus: id })}
        />
      ) : (
      <TreeCanvas
        graph={g}
        theme={theme}
        mode={focus ? 'focus' : 'home'}
        target={focus}
        me={v}
        selected={focus}
        gens={s.gen != null && !focus ? shown : null}
        genSel={s.gen != null && !focus ? s.gen : null}
        focusSet={focus ? [focus] : undefined}
        labels={focus ? [] : labels}
        autoLabel={s.gen != null && !focus ? { g: s.gen, max: 14 } : undefined}
        zoomLabels={!focus && s.gen == null}
        avoid={avoid}
        visible={visible}
        nameOf={name}
        spin={!focus && s.gen == null}
        className={focus ? 'blurred' : ''}
        centerX={focus && isWide() ? (window.innerWidth - PANEL) / 2 / window.innerWidth : 0.5}
        centerY={focus && isWide() ? 0.47 : undefined}
        onTap={id => id && set({ focus: id })}
        onTapMany={(ids, x, y) => setMany({ ids, x, y })}
        onLevels={setLevels}
        onColors={setColors}
      />
      )}

      {many && (
        <div class="pickmany-bg" onClick={() => setMany(null)}>
          <div class="pickmany glass" style={{ top: Math.min(many.y + 12, window.innerHeight - 180 - many.ids.length * 56) + 'px', left: Math.max(12, Math.min(many.x - 130, window.innerWidth - 272)) + 'px' }}>
            <small>من تقصد؟</small>
            {many.ids.map(id => (
              <button class="prow" onClick={() => { setMany(null); set({ focus: id }); }}>
                <Avatar id={id} s={s} size={34} />
                <span class="pt">
                  <b>{name(id)}</b>
                  <small>{yearShort(s, id) || genLabel(g.nodes.get(id)!.gen)}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {!focus && (
        <>
          <header class="top">
            <div>
              <div class="eyebrow">
                شجرة العائلة{s.isSample ? ' · عائلة تجريبية' : ''}
                {!s.isSample && s.mode === 'remote' && !s.online && <span class="offline"> · بلا اتصال: آخر ما قُرئ على هذا الجهاز</span>}
              </div>
              <h1>{g.family.name}</h1>
              <div class="sub">
                <b>{people.toLocaleString('en')}</b> فردًا · <b>{g.maxGen + 1}</b> أجيال
              </div>
            </div>
            <button class="round glass" onClick={() => set({ tab: 'me' })} aria-label="أنا">
              {v ? <Avatar id={v} s={s} size={36} /> : <Icon name="user" />}
            </button>
          </header>
          <button class="search glass" onClick={() => set({ searchOpen: 'focus' })}>
            <Icon name="search" />
            ابحث بالاسم…
          </button>
          <div class="side">
            <button
              class="round glass"
              title={is2d ? 'الشجرة ثلاثية الأبعاد' : 'المشجرة (عرض مسطّح)'}
              onClick={() => set({ settings: { ...getState().settings, view: is2d ? '3d' : '2d' }, gen: null })}
            >
              <b style="font-size:13px">{is2d ? '3D' : '2D'}</b>
            </button>
            <button class="round glass" title="مكاني" onClick={() => (v ? set({ focus: v }) : set({ tab: 'me' }))}>
              <Icon name="locate" />
            </button>
          </div>
          {!is2d && railStops.length > 0 && (
            <>
              <div class="railcap" style={{ top: railStops[0].y - 41 + 'px' }}>الأجيال</div>
              <div class="rail glass" style={{ top: railStops[0].y - 22 + 'px', height: railStops[railStops.length - 1].y - railStops[0].y + 44 + 'px' }}>
                {railStops.map(({ y, i }) => (
                  <button class={'gstop' + (s.gen === i ? ' on' : shown.includes(i) ? ' in' : '')} style={{ top: y - railStops[0].y + 9 + 'px' }} onClick={() => set({ gen: s.gen === i ? null : i })}>
                    {i + 1}
                  </button>
                ))}
              </div>
            </>
          )}
          {!is2d && s.gen != null ? (
            <div class="gflag glass">
              <span class="gn">{s.gen + 1}</span>
              <span>
                <b>{genLabel(s.gen)}</b>
                <small>{genInfo(s, shown)}</small>
              </span>
              <button class="x" onClick={() => set({ gen: null })} aria-label="إلغاء التصفية">
                <Icon name="x" size={16} />
              </button>
              <Seg
                cls="span"
                value={span}
                options={[['up', 'وما قبله'], ['only', 'وحده'], ['down', 'وما بعده']]}
                onChange={genSpan => set({ settings: { ...getState().settings, genSpan } })}
              />
            </div>
          ) : (
            <div class="chips">
              {(is2d ? g.houses : lines).map(h => (
                <button class="chip glass" onClick={() => set({ focus: h })}>
                  <i style={{ '--c': is2d ? branchColor(g, h, theme) : lineColor(h) }} />
                  بيت {g.nodes.get(h)!.name}
                  <em>{g.nodes.get(h)!.desc + 1}</em>
                </button>
              ))}
            </div>
          )}
          {!s.guest && !isMinorViewer(s) && (!v || canAsk(s, v)) && (
            <button class="fab" onClick={() => addFor(s, v)} aria-label="إضافة">
              <Icon name="plus" size={26} />
            </button>
          )}
        </>
      )}

      {focus && <Focus s={s} id={focus} bloom={!is2d} />}
    </div>
  );
}

function genInfo(s: State, gens: number[]): string {
  const list = [...s.graph.nodes.values()].filter(n => gens.includes(n.gen) && !n.external);
  const ys = list.map(n => n.by).filter((y): y is number => y != null).sort((a, b) => a - b);
  const span = ys.length ? ` · مواليد ${ys[Math.floor(ys.length * 0.05)]}–${ys[Math.floor(ys.length * 0.95)]}` : '';
  const n = list.length;
  return (n === 1 ? 'فرد واحد' : n === 2 ? 'فردان' : n <= 10 ? n + ' أفراد' : n + ' فردًا') + span;
}

export function addFor(s: State, id: string | null) {
  if (s.guest) return toast('دعوتك للمشاهدة فقط');
  if (isMinorViewer(s)) return toast(MINOR_NOTE);
  if (!viewer(s) && !(s.rootAdmin && !s.isSample)) {
    toast('اختر من تكون من تبويب «أنا» أولًا');
    set({ tab: 'me' });
    return;
  }
  if (!id) return;
  if (!canAsk(s, id)) return toast(asksNote(s));
  set({ addFor: id });
}

/** Adding a wife or husband: anyone who may propose; the root admin records it directly. */
export function addSpouseFor(s: State, id: string) {
  if (s.guest) return toast('دعوتك للمشاهدة فقط');
  if (isMinorViewer(s)) return toast(MINOR_NOTE);
  if (!viewer(s) && !(s.rootAdmin && !s.isSample)) {
    toast('اختر من تكون من تبويب «أنا» أولًا');
    set({ tab: 'me' });
    return;
  }
  if (!canAsk(s, id)) return toast(asksNote(s));
  set({ spouseFor: id, spousePick: null });
}

function Focus({ s, id, bloom }: { s: State; id: string; bloom: boolean }) {
  const g = s.graph;
  const n = g.nodes.get(id)!;
  const chain = [...ancestorsOf(g, id)].reverse();
  const vis = canSee(s, id);
  const crumbs = useRef<HTMLDivElement>(null);
  useEffect(() => crumbs.current?.querySelector('.cur')?.scrollIntoView({ inline: 'end', block: 'nearest' }), [id]);
  return (
    <>
      {bloom && (
        <div class="fzone" style={{ bottom: (isWide() ? 110 : 345) + 'px', right: isWide() ? PANEL + 'px' : '0' }}>
          <FamilyCard s={s} id={id} onPick={x => set({ focus: x })} />
        </div>
      )}
      <div class="searchbar">
        <button class="round glass" onClick={() => set({ focus: null })} aria-label="رجوع">
          <Icon name="chevR" />
        </button>
        <button class="search glass" onClick={() => set({ searchOpen: 'focus' })}>
          <Icon name="search" />
          ابحث بالاسم…
        </button>
      </div>
      <div class="crumbs glass" ref={crumbs}>
        {chain.map(a => (
          <>
            <button onClick={() => set({ focus: a })}>{nameOf(s, a)}</button>
            <Icon name="chevL" size={13} />
          </>
        ))}
        <button class="cur">{nameOf(s, id)}</button>
      </div>
      <div class="sheet glass">
        <div class="grab" />
        <div class="who">
          <Avatar id={id} s={s} size={60} />
          <div>
            <h2>
              {nameOf(s, id)} {n.dead && !n.familyRoot && <small class="rip">{deadMark(s, id)}</small>}
            </h2>
            <div class="ns">{vis ? lineOf(s, id) : 'تظهر تفاصيلها للأقارب حتى الدرجة ' + degreeWord(s.reach ?? 3)}</div>
          </div>
        </div>
        <div class="facts2">
          {vis && n.birth && (
            <span>
              <YearText s={s} y={n.birth} />
            </span>
          )}
          <span>{genLabel(n.gen)}</span>
          {n.kids.length > 0 && <span>{kidsCount(n.kids.length)}</span>}
          {n.uncertain && <span class="warn">ارتباط غير مؤكد</span>}
          <SeatBadge s={s} id={id} />
        </div>
        <div class="acts">
          <button class="btn primary" onClick={() => set({ profile: id })}>
            الملف الكامل
          </button>
          <button class="btn sq" aria-label="صلة القرابة" onClick={() => set({ tab: 'relation', relB: id, relA: viewer(s) ?? s.relA })}>
            <Icon name="route" />
          </button>
          {!s.guest && !isMinorViewer(s) && canAsk(s, id) && (
            <button class="btn sq" aria-label="إضافة ابن" onClick={() => addFor(s, id)}>
              <Icon name="plus" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
