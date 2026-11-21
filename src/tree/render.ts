// Draws the 3D tree on a 2D canvas with its own perspective projection.
import type { Graph } from '../data/graph';
import { levelY, ringR, type P3 } from './layout';
import { FONT } from '../font';

export interface Cam {
  yaw: number;
  pitch: number;
  dist: number;
  f: number;
  tx: number;
  ty: number;
  tz: number;
  cx: number;
  cy: number;
}

export type Rect = [number, number, number, number];

export interface Label {
  id: string;
  text?: string;
  big?: boolean;
  accent?: boolean;
  dot?: boolean;
  below?: boolean;
  force?: boolean;
  small?: boolean;
}

export interface RenderOpts {
  theme: 'dark' | 'light';
  cam: Cam;
  me?: string | null;
  selected?: string | null;
  path?: string[];
  gens?: number[] | null;
  /** The generation chosen on the rail, drawn larger; the rest of `gens` is lit at its usual size. */
  genSel?: number | null;
  focus?: string[];
  labels?: Label[];
  autoLabel?: { g: number; max: number };
  /** Name the people the camera is close to: more names appear as you zoom in. */
  zoomLabels?: boolean;
  avoid?: Rect[];
  levels?: boolean;
  visible: (id: string) => boolean;
  nameOf: (id: string) => string;
  /** Colours that follow the view; by default each house keeps its colour. */
  colorOf?: (id: string) => string;
}

export interface Rendered {
  pr: Map<string, [number, number, number, number]>;
  levels: number[];
  radius: (id: string) => number;
  /** Each name drawn, where it was drawn: a tap on it is that person. */
  tags: { id: string; r: Rect }[];
  /** People not drawn (outside the chosen generations): nothing to tap or zoom to. */
  hidden: Set<string>;
}

export const PALETTE = {
  dark: ['#A595FF', '#5EA8FF', '#FF8CCB', '#FFC766', '#5FE1EE', '#B5E06A'],
  light: ['#6A5AE0', '#2F7FE0', '#D9479A', '#C9821A', '#0E9DB0', '#5E9A1C'],
};
export const ROOT = { dark: '#FFFFFF', light: '#1C2033' };
export const NONE = { dark: '#B9BDD3', light: '#8A90A8' };
/** People outside the lines being coloured: they recede. */
export const OUT = { dark: '#5D6384', light: '#B4B9CC' };
const NODE = [2.7, 1.8, 1.42, 1.15, 0.95, 0.8, 0.68, 0.58, 0.5, 0.45];
const LINK = [0, 0.95, 0.6, 0.42, 0.31, 0.24, 0.19, 0.15, 0.13, 0.12];

/**
 * The departed: a black mourning band across a node's upper corner, as on the
 * avatars. `r` is the node's outer radius; `edge` the width of its light rim.
 */
export function mourningBand(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, edge = 1) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(x - r * 0.45, y - r * 0.45);
  ctx.rotate(-Math.PI / 4);
  const h = r * 0.32;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(-r * 1.3, -h / 2 - edge, r * 2.6, h + edge * 2);
  ctx.fillStyle = '#15161B';
  ctx.fillRect(-r * 1.3, -h / 2, r * 2.6, h);
  ctx.restore();
}

export function branchColor(g: Graph, id: string, theme: 'dark' | 'light'): string {
  const n = g.nodes.get(id);
  if (!n || n.familyRoot) return ROOT[theme];
  const i = n.house ? g.houses.indexOf(n.house) : -1;
  return i >= 0 ? PALETTE[theme][i % PALETTE[theme].length] : NONE[theme];
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function mixWhite(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const m = (v: number) => Math.round(v + (255 - v) * k);
  return `rgb(${m(n >> 16)},${m((n >> 8) & 255)},${m(n & 255)})`;
}

const sprites = new Map<string, HTMLCanvasElement>();
function glow(color: string): HTMLCanvasElement {
  let c = sprites.get(color);
  if (c) return c;
  if (sprites.size > 120) sprites.clear(); // colours blend while the view recolours
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, rgba(color, 1));
  g.addColorStop(1, rgba(color, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  sprites.set(color, c);
  return c;
}

export function render(ctx: CanvasRenderingContext2D, W: number, H: number, g: Graph, pos: Map<string, P3>, o: RenderOpts): Rendered {
  const dark = o.theme === 'dark';
  const cam = o.cam;
  const colorOf = o.colorOf ?? ((id: string) => branchColor(g, id, o.theme));
  const cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const proj = (x: number, y: number, z: number): [number, number, number, number] => {
    x -= cam.tx; y -= cam.ty; z -= cam.tz;
    const x1 = x * cyw - z * syw, z1 = x * syw + z * cyw;
    const y2 = y * cp + z1 * sp, z2 = -y * sp + z1 * cp;
    const zc = z2 + cam.dist, s = cam.f / Math.max(zc, 0.01);
    return [cam.cx * W + x1 * s, cam.cy * H - y2 * s, zc, s];
  };

  // background
  if (dark) {
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 10, W * 0.5, H * 0.5, H * 0.75);
    bg.addColorStop(0, '#1B1E3B'); bg.addColorStop(0.45, '#0E1022'); bg.addColorStop(1, '#06070D');
    ctx.fillStyle = bg;
  } else {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#FBFBFE'); bg.addColorStop(1, '#ECEEF6');
    ctx.fillStyle = bg;
  }
  ctx.fillRect(0, 0, W, H);

  const pathSet = new Set(o.path ?? []);
  const gens = o.gens && o.gens.length ? new Set(o.gens) : null;
  const lit = new Set<string>([...(o.path ?? []), ...(o.focus ?? [])]);
  if (gens) for (const n of g.nodes.values()) if (gens.has(n.gen)) lit.add(n.id);
  const dim = lit.size > 0;
  // generations chosen on the rail: the others are not drawn, neither their people nor their names;
  // only a faint trace of their lines keeps the tree's shape
  const hidden = new Set<string>();
  if (gens) for (const n of g.nodes.values()) if (!gens.has(n.gen)) hidden.add(n.id);
  const placed: Rect[] = (o.avoid ?? []).map(r => [...r] as Rect);
  const hit = (r: Rect) => r[0] < 4 || r[1] < 4 || r[2] > W - 4 || r[3] > H - 4 || placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);

  const pr = new Map<string, [number, number, number, number]>();
  let zmin = Infinity, zmax = -Infinity;
  for (const [id, p] of pos) {
    const q = proj(p.x, p.y, p.z);
    pr.set(id, q);
    if (q[2] > 0) { zmin = Math.min(zmin, q[2]); zmax = Math.max(zmax, q[2]); }
  }
  const fog = (z: number) => 1 - 0.7 * Math.min(1, Math.max(0, (z - zmin) / (zmax - zmin || 1)));

  // halo behind the founder
  const rq = pr.get(g.root)!;
  if (!hidden.has(g.root)) {
    const rr = 34 * rq[3];
    const halo = ctx.createRadialGradient(rq[0], rq[1], 0, rq[0], rq[1], rr);
    halo.addColorStop(0, dark ? 'rgba(170,155,255,0.28)' : 'rgba(90,80,200,0.10)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(rq[0], rq[1], rr, 0, Math.PI * 2); ctx.fill();
  }

  // generation rings; the bar lines up with each ring's front edge
  const levels: number[] = [];
  for (let gi = 0; gi <= g.maxGen; gi++) {
    let m = -Infinity;
    const R = ringR(gi, g.maxGen);
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      m = Math.max(m, proj(R * Math.cos(t), levelY(gi), R * Math.sin(t))[1]);
    }
    levels.push(m);
  }
  if (o.levels) {
    for (let gi = 1; gi <= g.maxGen; gi++) {
      const R = ringR(gi, g.maxGen) * 1.08 + 1.5;
      const sel = gens?.has(gi);
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const t = (i / 96) * Math.PI * 2;
        const q = proj(R * Math.cos(t), levelY(gi), R * Math.sin(t));
        if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
      }
      ctx.strokeStyle = sel ? (dark ? 'rgba(182,169,255,0.55)' : 'rgba(91,76,240,0.45)') : dark ? 'rgba(200,205,255,0.09)' : 'rgba(30,35,80,0.08)';
      ctx.lineWidth = sel ? 1.5 : 1;
      ctx.setLineDash(sel ? [] : [2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // links
  type L = { id: string; parent: string; pts: [number, number, number, number][]; z: number };
  const links: L[] = [];
  for (const n of g.nodes.values()) {
    if (!n.parent) continue;
    const p = pos.get(n.id), q = pos.get(n.parent);
    if (!p || !q) continue;
    const dy = p.y - q.y;
    const b = [[q.x, q.y, q.z], [q.x, q.y + dy * 0.55, q.z], [q.x + (p.x - q.x) * 0.6, p.y - dy * 0.12, q.z + (p.z - q.z) * 0.6], [p.x, p.y, p.z]];
    const pts: [number, number, number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, u = 1 - t;
      const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      pts.push(proj(
        k[0] * b[0][0] + k[1] * b[1][0] + k[2] * b[2][0] + k[3] * b[3][0],
        k[0] * b[0][1] + k[1] * b[1][1] + k[2] * b[2][1] + k[3] * b[3][1],
        k[0] * b[0][2] + k[1] * b[1][2] + k[2] * b[2][2] + k[3] * b[3][2]));
    }
    links.push({ id: n.id, parent: n.parent, pts, z: pts[5][2] });
  }
  links.sort((a, b) => b.z - a.z);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const line = (pts: [number, number, number, number][]) => {
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.stroke();
  };
  for (const L of links) {
    if (pathSet.has(L.id) && pathSet.has(L.parent)) continue;
    const n = g.nodes.get(L.id)!;
    const on = lit.has(L.id) && (lit.has(L.parent) || !!gens);
    const f = dim ? (on ? 1 : (gens ? 0.05 : 0.12) * fog(L.z)) : fog(L.z);
    const w = Math.max(0.55, (LINK[n.gen] ?? 0.12) * L.pts[5][3]);
    const col = colorOf(L.id);
    const parentRoot = g.nodes.get(L.parent)!.familyRoot;
    if (parentRoot) {
      const a0 = L.pts[0], a1 = L.pts[L.pts.length - 1];
      const gr = ctx.createLinearGradient(a0[0], a0[1], a1[0], a1[1]);
      gr.addColorStop(0, rgba(ROOT[o.theme], (dark ? 0.62 : 0.5) * f));
      gr.addColorStop(1, rgba(col, (dark ? 0.5 : 0.42) * f));
      ctx.strokeStyle = gr;
    } else ctx.strokeStyle = rgba(col, (dark ? 0.52 : 0.44) * f);
    ctx.lineWidth = w;
    const dashed = n.uncertain || (!!n.mother && n.parent === n.mother);
    ctx.setLineDash(dashed ? [Math.max(2, w * 2), Math.max(3, w * 3)] : []);
    line(L.pts);
  }
  ctx.setLineDash([]);

  // nodes: size follows generation
  const radius = (id: string) => {
    const n = g.nodes.get(id)!;
    return (NODE[n.gen] ?? 0.45) * (n.sex === 'f' ? 0.9 : 1) * (gens && gens.has(n.gen) && (o.genSel == null || o.genSel === n.gen) ? 1.6 : 1);
  };
  const order = [...pos.keys()].sort((a, b) => pr.get(b)![2] - pr.get(a)![2]);
  for (const id of order) {
    const n = g.nodes.get(id)!;
    const q = pr.get(id)!;
    if (q[2] <= 1 || hidden.has(id)) continue;
    const on = lit.has(id);
    const f = dim ? (on ? 1 : 0.2 * fog(q[2])) : fog(q[2]);
    // very close up, cap the size so a few people don't wash out the screen
    const r = Math.min(26, Math.max(1.1, radius(id) * q[3]));
    const col = colorOf(id);
    const soft = n.dead && !n.familyRoot ? 0.55 : 1;
    if (dark && (!dim || on)) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.32 * f * soft;
      const R = Math.min(r * 3.4, 64);
      ctx.drawImage(glow(col), q[0] - R, q[1] - R, R * 2, R * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = f * (n.dead && !n.familyRoot ? 0.8 : 1);
    ctx.beginPath();
    ctx.arc(q[0], q[1], r, 0, Math.PI * 2);
    if (n.sex === 'f') {
      ctx.fillStyle = dark ? 'rgba(10,11,20,0.9)' : '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = dark ? mixWhite(col, 0.35) : col;
      ctx.lineWidth = Math.max(1, r * 0.45);
      ctx.stroke();
    } else {
      ctx.fillStyle = dark ? mixWhite(col, n.dead ? 0.15 : 0.45) : col;
      ctx.fill();
      if (!dark) { ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(0.8, r * 0.3); ctx.stroke(); }
    }
    // close enough to carry it: the mourning band
    if (n.dead && !n.familyRoot && r >= 4.5) mourningBand(ctx, q[0], q[1], n.sex === 'f' ? r + Math.max(1, r * 0.45) / 2 : r);
    ctx.globalAlpha = 1;
  }

  // highlighted path on top
  if (pathSet.size && o.path) {
    const accent = dark ? '#B6A9FF' : '#5B4CF0';
    for (let i = 0; i < o.path.length - 1; i++) {
      const a = o.path[i], b = o.path[i + 1];
      // only a step from a child to the parent it hangs from is a line in the tree (not a marriage, nor a milk step)
      const child = g.nodes.get(a)?.parent === b ? a : g.nodes.get(b)?.parent === a ? b : null;
      if (!child) continue;
      const L = links.find(l => l.id === child);
      if (!L) continue;
      if (dark) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(160,140,255,0.25)'; ctx.lineWidth = 10; line(L.pts);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.strokeStyle = accent; ctx.lineWidth = 3; line(L.pts);
    }
    for (const id of o.path) {
      const q = pr.get(id);
      if (!q) continue;
      ctx.beginPath(); ctx.arc(q[0], q[1], 6, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = accent; ctx.stroke();
    }
  }

  const ring = (id: string, color: string) => {
    const q = pr.get(id);
    if (!q) return;
    ([[9, 0.95, 2], [16, 0.35, 1.5], [24, 0.14, 1]] as const).forEach(([r, a, w]) => {
      ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(color, a); ctx.lineWidth = w; ctx.stroke();
    });
  };
  if (o.me && pos.has(o.me) && !hidden.has(o.me)) ring(o.me, dark ? '#FFFFFF' : '#5B4CF0');
  if (o.selected && o.selected !== o.me && pos.has(o.selected) && !hidden.has(o.selected)) ring(o.selected, dark ? '#FFD27A' : '#C9821A');

  // labels: highest priority first, placed where they don't collide
  const named = new Set<string>();
  const tags: { id: string; r: Rect }[] = [];
  const place = (L: Label): boolean => {
    if (named.has(L.id) || hidden.has(L.id)) return false;
    const q = pr.get(L.id);
    if (!q || q[2] <= 1) return false;
    if (!L.text && !o.visible(L.id)) return false;
    const r = Math.max(1.1, radius(L.id) * q[3]);
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.font = `${L.big ? '700 15px' : L.small ? '400 11.5px' : '400 13px'} ${FONT}`;
    const text = L.text ?? o.nameOf(L.id);
    const dot = L.dot ? 12 : 0;
    const w = ctx.measureText(text).width + (L.small ? 14 : 20) + dot, h = L.big ? 30 : L.small ? 21 : 25, gap = r + (L.small ? 3 : 5);
    const cands: [number, number][] = [[q[0] - w / 2, q[1] - gap - h], [q[0] - w / 2, q[1] + gap], [q[0] + gap, q[1] - h / 2], [q[0] - gap - w, q[1] - h / 2]];
    if (L.below) cands.unshift(cands.splice(1, 1)[0]);
    const free = ([x, y]: [number, number]) => !hit([x - 2, y - 2, x + w + 2, y + h + 2]);
    let posn = cands.find(free);
    let lead = false;
    if (!posn) {
      if (!L.force) return false;
      // a name that must show never covers another: look further out, step by
      // step, and draw a thin line back to its person
      outer: for (let k = 1; k <= 9 && !posn; k++) {
        const d = k * 13;
        const far: [number, number][] = [
          [q[0] - w / 2, q[1] - gap - h - d], [q[0] - w / 2, q[1] + gap + d],
          [q[0] + gap + d, q[1] - h / 2], [q[0] - gap - w - d, q[1] - h / 2],
          [q[0] + gap + d * 0.7, q[1] - gap - h - d * 0.7], [q[0] - gap - w - d * 0.7, q[1] - gap - h - d * 0.7],
          [q[0] + gap + d * 0.7, q[1] + gap + d * 0.7], [q[0] - gap - w - d * 0.7, q[1] + gap + d * 0.7],
        ];
        for (const c of far) if (free(c)) { posn = c; lead = true; break outer; }
      }
      posn ??= cands[0];
    }
    const [x, y] = posn;
    placed.push([x - 2, y - 2, x + w + 2, y + h + 2]);
    named.add(L.id);
    tags.push({ id: L.id, r: [x, y, x + w, y + h] });
    if (lead) {
      // from the person to the nearest edge of the name
      const ex = Math.max(x, Math.min(q[0], x + w)), ey = Math.max(y, Math.min(q[1], y + h));
      ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(ex, ey);
      ctx.strokeStyle = L.accent ? (dark ? 'rgba(182,169,255,0.8)' : 'rgba(91,76,240,0.75)') : dark ? 'rgba(220,224,255,0.45)' : 'rgba(30,35,80,0.35)';
      ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fillStyle = L.accent ? (dark ? '#8E7CFF' : '#5B4CF0') : dark ? 'rgba(14,16,30,0.8)' : 'rgba(255,255,255,0.94)';
    ctx.fill();
    if (!L.accent) { ctx.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(20,25,60,0.10)'; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.fillStyle = L.accent ? '#FFFFFF' : dark ? '#EEF0FA' : '#171A2E';
    ctx.fillText(text, x + (w - dot) / 2, y + h / 2 + (L.big ? 5 : L.small ? 3.5 : 4));
    if (L.dot) {
      ctx.beginPath(); ctx.arc(x + w - 10, y + h / 2, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = colorOf(L.id); ctx.fill();
    }
    return true;
  };
  const labs = (o.labels ?? []).slice().sort((a, b) => (b.accent ? 2 : b.big ? 1 : 0) - (a.accent ? 2 : a.big ? 1 : 0));
  labs.forEach(place);
  if (o.autoLabel) {
    const A = o.autoLabel;
    const cand = [...g.nodes.values()]
      .filter(n => n.gen === A.g && n.id !== o.me && o.visible(n.id))
      .map(n => n.id)
      .filter(id => { const q = pr.get(id); return !!q && q[0] > 0 && q[0] < W && q[1] > 0 && q[1] < H; })
      .sort((a, b) => pr.get(a)![2] - pr.get(b)![2]);
    let k = 0;
    for (const id of cand) {
      if (k >= A.max) break;
      if (place({ id })) k++;
    }
  }
  if (o.zoomLabels) {
    // the nearest people first; a label only goes where it fits, so more names
    // appear as the camera gets closer
    const cand = [...pos.keys()]
      .filter(id => {
        const q = pr.get(id)!;
        if (q[2] <= 1 || q[0] < 8 || q[0] > W - 8 || q[1] < 8 || q[1] > H - 8) return false;
        const n = g.nodes.get(id)!;
        if (n.familyRoot || !o.visible(id)) return false;
        return radius(id) * q[3] >= 3 && fog(q[2]) > 0.45;
      })
      .sort((a, b) => pr.get(a)![2] - pr.get(b)![2]);
    let k = 0;
    for (const id of cand) {
      if (k >= 70) break;
      if (place({ id, small: true })) k++;
    }
  }
  return { pr, levels, radius, tags, hidden };
}

/** Everyone under the finger, nearest (and frontmost) first. */
export function hitTestAll(r: Rendered, x: number, y: number): { id: string; d: number }[] {
  // a name says who it is: a tap on it (or a finger's edge from it) is that
  // person alone, the last drawn on top
  for (let i = r.tags.length - 1; i >= 0; i--) {
    const [x0, y0, x1, y1] = r.tags[i].r;
    if (x >= x0 - 4 && x <= x1 + 4 && y >= y0 - 4 && y <= y1 + 4) return [{ id: r.tags[i].id, d: 0 }];
  }
  const out: { id: string; d: number; score: number }[] = [];
  for (const [id, q] of r.pr) {
    if (q[2] <= 1 || r.hidden.has(id)) continue;
    const rad = Math.max(13, r.radius(id) * q[3] + 8);
    const d = Math.hypot(q[0] - x, q[1] - y);
    if (d <= rad) out.push({ id, d, score: d + q[2] * 0.05 });
  }
  return out.sort((a, b) => a.score - b.score);
}

export function hitTest(r: Rendered, x: number, y: number): string | null {
  return hitTestAll(r, x, y)[0]?.id ?? null;
}
