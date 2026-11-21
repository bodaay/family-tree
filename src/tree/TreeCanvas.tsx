// The interactive 3D tree: drag sideways to turn it around its trunk (it keeps
// turning a little after you let go), drag up or down to tilt, pinch or scroll
// to zoom, tap a person. Colours follow the view (see colors.ts).
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { Graph } from '../data/graph';
import { layout, levelY, LEVEL, type P3 } from './layout';
import { render, hitTestAll, branchColor, type Cam, type Label, type Rect, type Rendered } from './render';
import { coloring, dominantAncestor, mix, type Coloring } from './colors';

export interface TreeProps {
  graph: Graph;
  theme: 'dark' | 'light';
  /** home: whole tree; focus: fly to one person; path: fit a relationship path */
  mode: 'home' | 'focus' | 'path';
  target?: string | null;
  me?: string | null;
  selected?: string | null;
  path?: string[];
  gens?: number[] | null;
  genSel?: number | null;
  focusSet?: string[];
  labels?: Label[];
  autoLabel?: { g: number; max: number };
  zoomLabels?: boolean;
  avoid?: Rect[];
  /** fraction of the height where the tree's centre sits */
  centerY?: number;
  /** fraction of the width where the tree's centre sits (wide screens keep a side panel) */
  centerX?: number;
  visible: (id: string) => boolean;
  nameOf: (id: string) => string;
  onTap?: (id: string | null) => void;
  /** Several people under the finger: let the person choose (screen point given). */
  onTapMany?: (ids: string[], x: number, y: number) => void;
  onLevels?: (levels: number[]) => void;
  /** The lines that are coloured now, as the view changes. */
  onColors?: (c: Coloring) => void;
  spin?: boolean;
  className?: string;
}

export function TreeCanvas(p: TreeProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pos = useMemo<Map<string, P3>>(() => layout(p.graph), [p.graph]);
  const st = useRef({
    cam: null as Cam | null,
    goal: null as Partial<Cam> | null,
    dirty: true,
    raf: 0,
    last: null as Rendered | null,
    pointers: new Map<number, { x: number; y: number }>(),
    downAt: 0,
    moved: 0,
    idleSince: performance.now(),
    explored: false,
    levelsKey: '',
    /** gesture: '' until the finger has moved enough to tell sideways (h) from up/down (v) */
    axis: '' as '' | 'h' | 'v' | 'b',
    ax: 0,
    ay: 0,
    vel: 0,
    lastMove: 0,
    inertia: 0,
    lastFrame: 0,
    coloring: null as Coloring | null,
    /** the family the colours were picked for */
    colorGraph: null as Graph | null,
    colorFrom: '',
    prevColors: null as Map<string, string> | null,
    colorsAt: 0,
    needColor: true,
    props: p,
    pos: null as unknown as Map<string, P3>,
  });
  st.current.props = p;
  // the animation loop may run a frame scheduled before the family changed:
  // it must read the current layout, not the one it was created with
  st.current.pos = pos;

  // camera goal for the current mode
  useEffect(() => {
    const s = st.current;
    const c = ref.current;
    if (!c) return;
    const W = c.clientWidth || 390, H = c.clientHeight || 844;
    const f = Math.min(W, 520) * 1.85;
    const g = p.graph;
    const faceYaw = (id: string) => -Math.PI / 2 - (pos.get(id)?.a ?? 0);
    let goal: Partial<Cam>;
    if (p.mode === 'focus' && p.target && pos.has(p.target)) {
      const t = pos.get(p.target)!;
      goal = { tx: t.x, ty: t.y, tz: t.z, dist: 75, pitch: 0.25, yaw: faceYaw(p.target) + 0.5, cy: p.centerY ?? 0.42, cx: p.centerX ?? 0.5, f };
    } else if (p.mode === 'path' && p.path && p.path.length > 1) {
      const pts = p.path.map(id => pos.get(id)!).filter(Boolean);
      const ys = pts.map(q => q.y);
      const mid = pts.reduce((a, q) => ({ x: a.x + q.x / pts.length, y: a.y + q.y / pts.length, z: a.z + q.z / pts.length }), { x: 0, y: 0, z: 0 });
      const span = Math.max(30, Math.max(...ys) - Math.min(...ys) + 25);
      const areaW = W * Math.min(1, 2 * (p.centerX ?? 0.5));
      const wide = Math.max(...pts.map(q => Math.hypot(q.x - mid.x, q.z - mid.z))) * 2 + 24;
      const a = p.path.reduce((s2, id) => s2 + (pos.get(id)?.a ?? 0), 0) / p.path.length;
      const dist = Math.max((f * span) / (H * 0.34), (f * wide) / (areaW * 0.8));
      goal = { tx: mid.x, ty: (Math.max(...ys) + Math.min(...ys)) / 2, tz: mid.z, dist, pitch: 0.28, yaw: -Math.PI / 2 - a, cy: p.centerY ?? 0.45, cx: p.centerX ?? 0.5, f };
    } else {
      const height = LEVEL * g.maxGen + 30;
      goal = { tx: 0, ty: levelY(g.maxGen / 2), tz: 0, dist: (f * height) / (H * (W >= 720 ? 0.62 : 0.5)), pitch: 0.2, cy: p.centerY ?? 0.53, cx: p.centerX ?? 0.5, f };
      if (!s.cam && p.me && pos.has(p.me)) goal.yaw = faceYaw(p.me) + 0.4;
    }
    if (!s.cam) s.cam = { yaw: 0.6, pitch: 0.2, dist: 300, f, tx: 0, ty: levelY(g.maxGen / 2), tz: 0, cx: 0.5, cy: 0.53, ...goal } as Cam;
    s.goal = goal;
    s.explored = false;
    s.dirty = true;
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.mode, p.target, p.path?.join(','), p.graph, p.centerY, p.centerX]);

  useEffect(() => {
    const s = st.current;
    s.coloring = null;
    s.prevColors = null;
    s.needColor = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.graph, p.theme]);

  useEffect(() => {
    st.current.dirty = true;
    kick();
  });

  /** Turns the tree around its own trunk, whatever the camera is looking at. */
  function turn(d: number) {
    const cam = st.current.cam;
    if (!cam) return;
    cam.yaw += d;
    const c = Math.cos(d), sn = Math.sin(d), x = cam.tx, z = cam.tz;
    cam.tx = x * c + z * sn;
    cam.tz = -x * sn + z * c;
  }

  /** Picks the colours for what is on screen now; they blend in over 0.6 s. */
  function recolor(W: number, H: number, now: number) {
    const s = st.current;
    if (!s.last) return;
    const P = s.props;
    // what you are looking at: the line that holds most of the people in the
    // middle of the screen
    const cam = s.cam!;
    const mx = cam.cx * W, my = cam.cy * H;
    const onScreen: string[] = [], ids: string[] = [];
    for (const [id, q] of s.last.pr) {
      if (q[2] <= 1 || q[0] < W * 0.04 || q[0] > W * 0.96 || q[1] < H * 0.15 || q[1] > H * 0.85) continue;
      onScreen.push(id);
      if (Math.abs(q[0] - mx) < W * 0.32 && Math.abs(q[1] - my) < H * 0.25) ids.push(id);
    }
    const from = dominantAncestor(P.graph, ids.length >= 4 ? ids : onScreen);
    s.needColor = false;
    if (s.coloring && from === s.colorFrom) return;
    s.colorFrom = from;
    const c = coloring(P.graph, from, P.theme);
    if (s.coloring && c.top === s.coloring.top) return;
    s.prevColors = s.coloring ? s.coloring.color : null;
    s.coloring = c;
    s.colorGraph = P.graph;
    s.colorsAt = now;
    P.onColors?.(c);
  }

  function kick() {
    const s = st.current;
    if (!s.raf) s.raf = requestAnimationFrame(frame);
  }

  function frame() {
    const s = st.current;
    s.raf = 0;
    const c = ref.current;
    if (!c || !s.cam) return;
    const P = s.props;
    let moving = false;
    const now = performance.now();
    const dt = Math.min(64, now - (s.lastFrame || now));
    s.lastFrame = now;
    if (s.goal) {
      const cam = s.cam as unknown as Record<string, number>;
      const goal = s.goal as Record<string, number>;
      for (const k of Object.keys(goal)) {
        let d = goal[k] - cam[k];
        if (k === 'yaw') {
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
        }
        if (Math.abs(d) > 1e-3) { cam[k] += d * 0.14; moving = true; } else cam[k] = cam[k] + d;
      }
      if (!moving) {
        s.goal = null;
        s.needColor = true;
      }
    }
    if (s.inertia && s.pointers.size === 0) {
      turn(s.inertia * dt);
      s.inertia *= Math.pow(0.94, dt / 16.7);
      if (Math.abs(s.inertia) < 0.00003) {
        s.inertia = 0;
        s.needColor = true;
      }
      s.idleSince = now;
      moving = true;
    }
    if (P.spin && !s.explored && !s.goal && !s.inertia && s.pointers.size === 0 && now - s.idleSince > 2500 && !document.hidden) {
      turn(0.0016);
      moving = true;
    }
    // recolour once the view has settled (or right away the first time)
    if (s.needColor && s.last && s.pointers.size === 0 && !s.goal && !s.inertia && (!s.coloring || now - s.idleSince > 250)) {
      recolor(c.clientWidth, c.clientHeight, now);
    }
    // a frame can run after the family changed (someone added) but before its
    // colours are reset: those colours do not know the new people
    if (s.coloring && s.colorGraph !== P.graph) {
      s.coloring = null;
      s.prevColors = null;
      s.needColor = true;
    }
    let colorOf: ((id: string) => string) | undefined;
    if (s.coloring) {
      const cur = s.coloring.color, prev = s.prevColors;
      const t = prev ? Math.min(1, (now - s.colorsAt) / 600) : 1;
      if (t >= 1) s.prevColors = null;
      else moving = true;
      const q = Math.round(t * 6) / 6; // a few steps, so the glow sprites stay few
      // a frame may run before the colours are picked again for someone just added
      const own = (id: string) => cur.get(id) ?? branchColor(P.graph, id, P.theme);
      colorOf = s.prevColors ? id => mix(prev!.get(id) ?? own(id), own(id), q) : own;
    }
    if (s.dirty || moving) {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.last = render(ctx, W, H, P.graph, s.pos, {
        theme: P.theme, cam: s.cam, me: P.me, selected: P.selected, path: P.path, gens: P.gens, genSel: P.genSel, focus: P.focusSet,
        labels: P.labels, autoLabel: P.autoLabel, zoomLabels: P.zoomLabels, avoid: P.avoid, levels: true, visible: P.visible, nameOf: P.nameOf, colorOf,
      });

      const key = s.last.levels.map(v => Math.round(v)).join(',');
      if (key !== s.levelsKey) {
        s.levelsKey = key;
        P.onLevels?.(s.last.levels);
      }
      s.dirty = false;
    }
    if (moving || s.goal) kick();
    else if (s.needColor) setTimeout(kick, 260);
    else if (P.spin) setTimeout(kick, 400);
  }

  useEffect(() => {
    const c = ref.current!;
    const ro = new ResizeObserver(() => { st.current.dirty = true; kick(); });
    ro.observe(c);
    return () => { ro.disconnect(); cancelAnimationFrame(st.current.raf); st.current.raf = 0; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- gestures
  /** Zoom by a factor, moving the target toward the person nearest the screen point. */
  const zoomAt = (factor: number, sx: number, sy: number) => {
    const s = st.current;
    if (!s.cam || !s.last) return;
    const old = s.cam.dist;
    const next = Math.max(14, Math.min(900, old * factor));
    if (next < old) {
      let best: string | null = null, bd = 120;
      for (const [id, q] of s.last.pr) {
        if (q[2] <= 1 || s.last.hidden.has(id)) continue;
        const d = Math.hypot(q[0] - sx, q[1] - sy);
        if (d < bd) { bd = d; best = id; }
      }
      const t = best ? s.pos.get(best) : null;
      if (t) {
        const k = 1 - next / old;
        s.cam.tx += (t.x - s.cam.tx) * k;
        s.cam.ty += (t.y - s.cam.ty) * k;
        s.cam.tz += (t.z - s.cam.tz) * k;
      }
    }
    s.cam.dist = next;
    s.explored = true;
  };
  const panBy = (dx: number, dy: number) => {
    const s = st.current;
    if (!s.cam) return;
    const k = s.cam.dist / s.cam.f;
    s.cam.tx -= Math.cos(s.cam.yaw) * dx * k;
    s.cam.tz += Math.sin(s.cam.yaw) * dx * k;
    s.cam.ty += dy * k;
    s.explored = true;
  };
  const onDown = (e: PointerEvent) => {
    const s = st.current;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (s.pointers.size === 1) {
      s.downAt = performance.now();
      s.moved = 0;
      s.axis = '';
      s.ax = s.ay = 0;
      s.vel = 0;
    }
    s.goal = null;
    s.inertia = 0;
    s.idleSince = performance.now();
  };
  const onMove = (e: PointerEvent) => {
    const s = st.current;
    const prev = s.pointers.get(e.pointerId);
    if (!prev || !s.cam) return;
    if (s.pointers.size === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      s.moved += Math.abs(dx) + Math.abs(dy);
      // decide once per gesture whether it turns, tilts or both, so a sideways
      // swipe never tilts the tree by accident
      if (!s.axis) {
        s.ax += dx;
        s.ay += dy;
        if (Math.hypot(s.ax, s.ay) > 7) s.axis = Math.abs(s.ax) > Math.abs(s.ay) * 1.3 ? 'h' : Math.abs(s.ay) > Math.abs(s.ax) * 1.3 ? 'v' : 'b';
      } else {
        const now = performance.now();
        if (s.axis !== 'v') {
          const d = -dx * 0.0065;
          turn(d);
          s.vel = s.vel * 0.5 + (d / Math.max(8, now - s.lastMove)) * 0.5;
        }
        if (s.axis !== 'h') s.cam.pitch = Math.max(0.02, Math.min(1.25, s.cam.pitch + dy * 0.003));
        s.lastMove = now;
      }
      if (s.moved > 8) s.explored = true;
    } else if (s.pointers.size === 2) {
      const other = [...s.pointers.entries()].find(([k]) => k !== e.pointerId)![1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
      const mx = (e.clientX + other.x) / 2 - r.left, my = (e.clientY + other.y) / 2 - r.top;
      if (d0 > 0 && d1 > 0) zoomAt(d0 / d1, mx, my);
      // the midpoint moves by half of this finger's movement
      panBy((e.clientX - prev.x) / 2, (e.clientY - prev.y) / 2);
      s.moved += 99;
    }
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    s.idleSince = performance.now();
    s.dirty = true;
    kick();
  };
  const onUp = (e: PointerEvent) => {
    const s = st.current;
    const wasSingle = s.pointers.size === 1;
    s.pointers.delete(e.pointerId);
    s.idleSince = performance.now();
    s.needColor = true;
    // a flick keeps the tree turning for a moment
    if (wasSingle && s.axis && s.axis !== 'v' && performance.now() - s.lastMove < 80 && Math.abs(s.vel) > 0.0002) {
      s.inertia = Math.max(-0.006, Math.min(0.006, s.vel));
      kick();
    }
    if (wasSingle && s.moved < 8 && performance.now() - s.downAt < 500 && s.last) {
      const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const hits = hitTestAll(s.last, x, y);
      // nearly as close as the nearest: ask instead of guessing
      const close = hits.filter(h => h.d <= hits[0].d + 9 && s.props.visible(h.id)).slice(0, 6).map(h => h.id);
      if (close.length > 1 && s.props.onTapMany) s.props.onTapMany(close, x, y);
      else s.props.onTap?.(hits[0]?.id ?? null);
    }
  };
  const onWheel = (e: WheelEvent) => {
    const s = st.current;
    if (!s.cam) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    zoomAt(Math.exp(e.deltaY * 0.0012), e.clientX - r.left, e.clientY - r.top);
    s.goal = null;
    s.inertia = 0;
    s.needColor = true;
    s.idleSince = performance.now();
    s.dirty = true;
    kick();
  };

  return (
    <canvas
      ref={ref}
      class={'tree ' + (p.className ?? '')}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      // a tap acts on pointerup; the click a phone sends after it would land on
      // what that tap just opened (the family card) and choose someone else
      onTouchEnd={e => e.preventDefault()}
      onWheel={onWheel}
    />
  );
}
