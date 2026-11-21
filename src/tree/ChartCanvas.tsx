// The 2D chart: pan with one finger, pinch or scroll to zoom, tap a person.
// Zoomed out it shows the shape of the family; zoomed in, names and years.
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { Graph } from '../data/graph';
import { chartLayout, chartBounds, BOX_W, ROW_H, type ChartPos } from './chart';
import { branchColor, mourningBand } from './render';
import { FONT } from '../font';

export interface ChartProps {
  graph: Graph;
  theme: 'dark' | 'light';
  me?: string | null;
  selected?: string | null;
  /** person to bring to the centre */
  target?: string | null;
  centerX?: number;
  centerY?: number;
  visible: (id: string) => boolean;
  nameOf: (id: string) => string;
  yearOf: (id: string) => string;
  onTap?: (id: string | null) => void;
}

interface View {
  s: number;
  tx: number;
  ty: number;
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

export function ChartCanvas(p: ChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pos = useMemo<Map<string, ChartPos>>(() => chartLayout(p.graph), [p.graph]);
  const st = useRef({
    view: null as View | null,
    goal: null as View | null,
    raf: 0,
    dirty: true,
    pointers: new Map<number, { x: number; y: number }>(),
    moved: 0,
    downAt: 0,
    props: p,
    pos: null as unknown as Map<string, ChartPos>,
  });
  st.current.props = p;
  // a frame scheduled before the family changed must draw the current layout
  st.current.pos = pos;

  const centerOn = (id: string | null | undefined, scale?: number, fy?: number) => {
    const s = st.current, c = ref.current;
    if (!c) return;
    const W = c.clientWidth, H = c.clientHeight;
    const q = (id && pos.get(id)) || pos.get(p.graph.root)!;
    const sc = scale ?? Math.max(s.view?.s ?? 0, W >= 720 ? 1 : 0.85);
    const goal = { s: sc, tx: W * (p.centerX ?? 0.5) - q.x * sc, ty: H * (fy ?? p.centerY ?? 0.45) - q.y * sc };
    if (!s.view) s.view = goal;
    s.goal = goal;
    kick();
  };

  useEffect(() => {
    // bring a chosen person to the centre; closing the card keeps the view where it is
    if (p.target) centerOn(p.target);
    else if (!st.current.view) {
      if (p.me) centerOn(p.me);
      else {
        // no place of one's own: open where the family is densest, the largest
        // family two generations above the youngest, its children and
        // grandchildren filling the screen below
        const g = p.graph, at = Math.max(1, g.maxGen - 2);
        const head = [...g.nodes.values()].filter(n => n.gen === at && pos.has(n.id)).sort((a, b) => b.desc - a.desc)[0];
        centerOn(head?.id ?? null, undefined, head ? 0.36 : undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.target, p.graph, p.centerX, p.centerY]);

  useEffect(() => {
    st.current.dirty = true;
    kick();
  });

  function kick() {
    const s = st.current;
    if (!s.raf) s.raf = requestAnimationFrame(frame);
  }

  function frame() {
    const s = st.current;
    s.raf = 0;
    const c = ref.current;
    if (!c || !s.view) return;
    let moving = false;
    if (s.goal) {
      const v = s.view, g = s.goal;
      const k = 0.18;
      const d = Math.abs(g.s - v.s) + Math.abs(g.tx - v.tx) + Math.abs(g.ty - v.ty);
      if (d < 0.5) { s.view = { ...g }; s.goal = null; }
      else { v.s += (g.s - v.s) * k; v.tx += (g.tx - v.tx) * k; v.ty += (g.ty - v.ty) * k; moving = true; }
    }
    if (s.dirty || moving) {
      draw(c, s.view);
      s.dirty = false;
    }
    if (moving) kick();
  }

  function draw(c: HTMLCanvasElement, v: View) {
    const P = st.current.props;
    const pos = st.current.pos;
    const g = P.graph, dark = P.theme === 'dark';
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (dark) {
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.3, 10, W * 0.5, H * 0.5, Math.max(W, H));
      bg.addColorStop(0, '#171A33'); bg.addColorStop(1, '#07080E');
      ctx.fillStyle = bg;
    } else ctx.fillStyle = '#F4F5FA';
    ctx.fillRect(0, 0, W, H);

    // faint generation rows
    const maxGen = g.maxGen;
    ctx.save();
    for (let gi = 0; gi <= maxGen; gi++) {
      const y = gi * ROW_H * v.s + v.ty;
      if (y < -ROW_H * v.s || y > H + ROW_H * v.s) continue;
      if (gi % 2 === 0) {
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.022)' : 'rgba(20,25,60,0.025)';
        ctx.fillRect(0, y - (ROW_H / 2) * v.s, W, ROW_H * v.s);
      }
    }
    ctx.restore();

    const wx0 = -v.tx / v.s - BOX_W, wx1 = (W - v.tx) / v.s + BOX_W;
    const wy0 = -v.ty / v.s - ROW_H, wy1 = (H - v.ty) / v.s + ROW_H;
    const inView = (q: ChartPos) => q.x > wx0 && q.x < wx1 && q.y > wy0 && q.y < wy1;

    // names, worked out first: a long one takes two lines rather than being cut,
    // and the lines to the children start beneath it
    const names = v.s >= 0.55, years = v.s >= 0.8;
    const room = Math.max(40, (BOX_W + 6) * v.s);
    const lines = new Map<string, string[]>();
    if (names) {
      ctx.font = `700 13px ${FONT}`;
      for (const n of g.nodes.values()) {
        const q = pos.get(n.id);
        if (q && inView(q) && !n.familyRoot) lines.set(n.id, wrap(ctx, P.visible(n.id) ? P.nameOf(n.id) : 'ابنة', room));
      }
    }
    const under = (id: string) => {
      const L = lines.get(id);
      return L ? (L.length * 15 + 4 + (years && P.visible(id) && P.yearOf(id) ? 14 : 0)) / v.s : 0;
    };

    // world transform
    ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.tx, dpr * v.ty);

    // the selected person's line up to the founder
    const line = new Set<string>();
    for (let c2 = P.selected ?? P.me ?? null; c2; c2 = g.nodes.get(c2)?.parent ?? null) line.add(c2);

    // the family view's look: glowing people, soft curved lines, names beneath
    const nr = (id: string) => {
      const n = g.nodes.get(id)!;
      return n.familyRoot ? 15 : Math.max(6.5, 11.5 - n.gen * 0.6) * (n.sex === 'f' ? 0.92 : 1);
    };
    const lw = Math.max(1.6, 1.3 / v.s);
    ctx.lineCap = 'round';
    for (const n of g.nodes.values()) {
      if (!n.kids.length) continue;
      const pp = pos.get(n.id)!;
      const xs = n.kids.map(k => pos.get(k)!.x);
      if (Math.max(...xs, pp.x) < wx0 || Math.min(...xs, pp.x) > wx1 || pp.y > wy1 || pp.y + ROW_H < wy0) continue;
      for (const k of n.kids) {
        const q = pos.get(k)!, kn = g.nodes.get(k)!;
        const onLine = line.has(n.id) && line.has(k);
        const y0 = pp.y + nr(n.id) + under(n.id), y1 = q.y - nr(k), dy = y1 - y0;
        const col = branchColor(g, k, P.theme);
        if (onLine) {
          ctx.strokeStyle = dark ? '#B6A9FF' : '#5B4CF0';
          ctx.lineWidth = Math.max(3, 2.6 / v.s);
        } else {
          const gr = ctx.createLinearGradient(pp.x, y0, q.x, y1);
          gr.addColorStop(0, rgba(n.familyRoot ? (dark ? '#FFFFFF' : '#5B6080') : branchColor(g, n.id, P.theme), dark ? 0.55 : 0.5));
          gr.addColorStop(1, rgba(col, dark ? 0.75 : 0.7));
          ctx.strokeStyle = gr;
          ctx.lineWidth = lw;
        }
        // dashed: a link not confirmed, or a child through the mother (the father is from outside)
        ctx.setLineDash(kn.uncertain || kn.parent === kn.mother ? [5, 5] : []);
        ctx.beginPath();
        ctx.moveTo(pp.x, y0);
        ctx.bezierCurveTo(pp.x, y0 + dy * 0.55, q.x, y1 - dy * 0.45, q.x, y1);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // people
    const shown: [string, number, number, number][] = [];
    for (const n of g.nodes.values()) {
      const q = pos.get(n.id);
      if (!q || !inView(q)) continue; // spouses from outside are not in the chart
      const col = n.familyRoot ? (dark ? '#FFFFFF' : '#1C2033') : branchColor(g, n.id, P.theme);
      const r = nr(n.id);
      if (dark) {
        ctx.globalCompositeOperation = 'lighter';
        const R = r * 3.4;
        const gl = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, R);
        gl.addColorStop(0, rgba(col, n.dead && !n.familyRoot ? 0.22 : 0.45));
        gl.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = gl;
        ctx.beginPath(); ctx.arc(q.x, q.y, R, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      if (n.sex === 'f') {
        ctx.fillStyle = dark ? '#0D0F1C' : '#FFFFFF';
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(2, r * 0.42);
        ctx.stroke();
      } else {
        ctx.globalAlpha = n.dead && !n.familyRoot ? 0.7 : 1;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // the departed: the mourning band, once the node is big enough on screen to carry it
      if (n.dead && !n.familyRoot && r * v.s >= 4) mourningBand(ctx, q.x, q.y, n.sex === 'f' ? r + Math.max(2, r * 0.42) / 2 : r, 1 / v.s);
      const ringCol = n.id === P.me ? (dark ? '255,255,255' : '91,76,240') : n.id === P.selected ? (dark ? '255,210,122' : '201,130,26') : null;
      if (ringCol) {
        ([[r + 5, 0.9, 2], [r + 12, 0.3, 1.5], [r + 21, 0.12, 1]] as const).forEach(([rr, a, w]) => {
          ctx.beginPath(); ctx.arc(q.x, q.y, rr, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${ringCol},${a})`;
          ctx.lineWidth = w / v.s; ctx.stroke();
        });
      }
      shown.push([n.id, q.x, q.y, r]);
    }

    // names in screen space, so they stay crisp and the same size at any zoom;
    // far out, only the shape of the family shows
    if (names) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      const fg = dark ? '#F1F2FA' : '#15182B', mut = dark ? 'rgba(200,204,230,0.75)' : 'rgba(70,75,105,0.85)';
      for (const [id, x, y, r] of shown) {
        const n = g.nodes.get(id)!;
        const sx = x * v.s + v.tx, sy = (y + r) * v.s + v.ty;
        const vis = P.visible(id);
        ctx.shadowColor = dark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)';
        ctx.shadowBlur = 6;
        if (n.familyRoot) {
          ctx.shadowBlur = 0;
          ctx.font = `800 15px ${FONT}`;
          const label = g.family.name + ' · الجد الجامع';
          const w = ctx.measureText(label).width + 26;
          ctx.beginPath(); ctx.roundRect(sx - w / 2, (y - r) * v.s + v.ty - 40, w, 30, 15);
          ctx.fillStyle = dark ? 'rgba(14,16,30,0.85)' : 'rgba(255,255,255,0.95)'; ctx.fill();
          ctx.fillStyle = fg; ctx.fillText(label, sx, (y - r) * v.s + v.ty - 20);
          continue;
        }
        ctx.font = `700 13px ${FONT}`;
        ctx.fillStyle = vis ? fg : mut;
        const L = lines.get(id) ?? [];
        L.forEach((t, i) => ctx.fillText(t, sx, sy + 17 + i * 15));
        const yr = years && vis ? P.yearOf(id) : '';
        if (yr) {
          ctx.font = `400 11px ${FONT}`;
          ctx.fillStyle = mut;
          ctx.fillText(fit(ctx, yr, room), sx, sy + 31 + (L.length - 1) * 15);
        }
        if (id === P.me) {
          ctx.shadowBlur = 0;
          ctx.font = `700 11px ${FONT}`;
          const tw = ctx.measureText('أنت').width + 14, ty = (y - r) * v.s + v.ty - 30;
          ctx.beginPath(); ctx.roundRect(sx - tw / 2, ty, tw, 19, 9.5);
          ctx.fillStyle = dark ? '#8E7CFF' : '#5B4CF0'; ctx.fill();
          ctx.fillStyle = '#fff'; ctx.fillText('أنت', sx, ty + 14);
        }
      }
      ctx.shadowBlur = 0;
    }

    // generation numbers, pinned to the screen edge (like the 3D bar)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = 'center';
    for (let gi = 0; gi <= maxGen; gi++) {
      const y = gi * ROW_H * v.s + v.ty;
      if (y < 236 || y > H - 160) continue;
      ctx.beginPath(); ctx.arc(W - 15, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = dark ? 'rgba(24,26,44,0.85)' : 'rgba(255,255,255,0.92)'; ctx.fill();
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(20,25,60,0.12)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = dark ? '#A3A8C6' : '#646A88';
      ctx.fillText(String(gi + 1), W - 15, y + 4);
    }
  }

  /** A name in one line, or two at a space; cut only if a single word is still too long. */
  function wrap(ctx: CanvasRenderingContext2D, t: string, max: number): string[] {
    if (ctx.measureText(t).width <= max || !t.includes(' ')) return [fit(ctx, t, max)];
    const w = t.split(' ');
    let best = 1, diff = Infinity;
    for (let i = 1; i < w.length; i++) {
      const d = Math.abs(ctx.measureText(w.slice(0, i).join(' ')).width - ctx.measureText(w.slice(i).join(' ')).width);
      if (d < diff) { diff = d; best = i; }
    }
    return [fit(ctx, w.slice(0, best).join(' '), max), fit(ctx, w.slice(best).join(' '), max)];
  }

  function fit(ctx: CanvasRenderingContext2D, t: string, max: number) {
    if (ctx.measureText(t).width <= max) return t;
    let s = t;
    while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
    return s + '…';
  }

  useEffect(() => {
    const c = ref.current!;
    const ro = new ResizeObserver(() => { st.current.dirty = true; kick(); });
    ro.observe(c);
    return () => { ro.disconnect(); cancelAnimationFrame(st.current.raf); st.current.raf = 0; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- gestures
  const zoomAt = (factor: number, sx: number, sy: number) => {
    const s = st.current;
    if (!s.view) return;
    const b = chartBounds(pos);
    const c = ref.current!;
    // never so far out that people shrink to nothing: the 3D tree is the overview
    const minS = Math.max(0.16, Math.min(0.9, (c.clientWidth * 0.9) / (b.x1 - b.x0), (c.clientHeight * 0.7) / (b.y1 - b.y0)));
    const ns = Math.max(minS, Math.min(2.4, s.view.s / factor));
    const wx = (sx - s.view.tx) / s.view.s, wy = (sy - s.view.ty) / s.view.s;
    s.view = { s: ns, tx: sx - wx * ns, ty: sy - wy * ns };
    s.goal = null;
    s.dirty = true;
    kick();
  };
  const onDown = (e: PointerEvent) => {
    const s = st.current;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (s.pointers.size === 1) { s.downAt = performance.now(); s.moved = 0; }
    s.goal = null;
  };
  const onMove = (e: PointerEvent) => {
    const s = st.current;
    const prev = s.pointers.get(e.pointerId);
    if (!prev || !s.view) return;
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    if (s.pointers.size === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      s.moved += Math.abs(dx) + Math.abs(dy);
      s.view.tx += dx;
      s.view.ty += dy;
    } else if (s.pointers.size === 2) {
      const other = [...s.pointers.entries()].find(([k]) => k !== e.pointerId)![1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (d0 > 0 && d1 > 0) zoomAt(d0 / d1, (e.clientX + other.x) / 2 - r.left, (e.clientY + other.y) / 2 - r.top);
      s.view.tx += (e.clientX - prev.x) / 2;
      s.view.ty += (e.clientY - prev.y) / 2;
      s.moved += 99;
    }
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    s.dirty = true;
    kick();
  };
  const onUp = (e: PointerEvent) => {
    const s = st.current;
    const single = s.pointers.size === 1;
    s.pointers.delete(e.pointerId);
    if (!single || s.moved > 8 || performance.now() - s.downAt > 500 || !s.view) return;
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const wx = (e.clientX - r.left - s.view.tx) / s.view.s, wy = (e.clientY - r.top - s.view.ty) / s.view.s;
    let best: string | null = null, bd = Infinity;
    const slack = Math.max(10, 16 / s.view.s);
    for (const [id, q] of pos) {
      // the dot and the name under it both count
      const dx = Math.abs(q.x - wx), dy = wy - q.y;
      if (dx <= BOX_W / 2 && dy >= -slack - 12 && dy <= 12 + 34 / s.view.s) {
        const d = dx + Math.abs(dy);
        if (d < bd) { bd = d; best = id; }
      }
    }
    s.props.onTap?.(best);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  };

  // no click after a tap: it would land on the family card the tap opened
  return <canvas ref={ref} class="tree" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onTouchEnd={e => e.preventDefault()} onWheel={onWheel} />;
}
