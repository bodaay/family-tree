// The poster itself, in millimetres: a frame whose border is a line of tiny
// text (the export's code, over and over), the title, the houses' colours, the
// chart scaled to fill what is left, a faint diagonal watermark behind it, and
// at the foot who exported it, when, and its code. Drawn through a Pen (pen.ts),
// so the preview, the PDF and the picture are one drawing.
import type { Chart } from './layout';
import { GOLD, TRUNK, type Tone } from './palette';
import { roundRect, type Page, type Pen } from './pen';
import type { Face, Shaper } from './text';

export interface Who {
  name: string;
  sex: 'm' | 'f';
  dead?: boolean;
  /** The founder at the top, drawn in ink and gold, larger. */
  root?: boolean;
  /** On a trunk or a house's line: its colour, solid. */
  head?: boolean;
  /** Under the name: «١٩٢٠ – ١٩٩٥», «١٩٦٥», «ت ١٩٩٥». */
  years?: string;
  /** Picked out: the one a lineage is drawn for. */
  mark?: boolean;
}

export interface Stamp {
  /** e.g. «شجرة أسرة آل سالم». */
  title: string;
  subtitle: string;
  /** Short words for the watermark: the family's name. */
  family: string;
  code: string;
  by: string;
  date: string;
}

export interface PosterIn {
  chart: Chart;
  who(id: string): Who;
  tone(id: string): Tone;
  /** The paper in mm, either way round: the poster picks the way the chart fits best. */
  paper: [number, number];
  stamp: Stamp;
  legend: { name: string; tone: Tone }[];
  cream: boolean;
}

/** A page with the size its names came out at. */
export type Sheet = Page & { pt: number };

/** The founder at the top is drawn this much larger, growing upwards from his row. */
export const ROOT_SCALE = 1.7;
/** The founder's box: one line, larger; it rises above his row by `lift`. */
const ROOT_H = 1.75 * ROOT_SCALE;
const lift = (c: Chart) => Math.max(0, ROOT_H - c.boxH);

/** A chart's size on paper, in em, the founder's larger box included. */
export const size = (c: Chart): [number, number] => [c.maxX - c.minX, c.height + lift(c)];

/** Millimetres in a point. */
export const PT = 0.3528;
const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** A line through points, its corners rounded. */
function rounded(pts: [number, number][], r: number): string {
  const p = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]);
  if (p.length < 2) return '';
  let d = `M${f(p[0][0])} ${f(p[0][1])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i], [x2, y2] = p[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0), l2 = Math.hypot(x2 - x1, y2 - y1);
    const k = Math.min(r, l1 / 2, l2 / 2);
    if (k < 1e-6) {
      d += ` L${f(x1)} ${f(y1)}`;
      continue;
    }
    const ax = x1 - ((x1 - x0) / l1) * k, ay = y1 - ((y1 - y0) / l1) * k;
    const bx = x1 + ((x2 - x1) / l2) * k, by = y1 + ((y2 - y1) / l2) * k;
    d += ` L${f(ax)} ${f(ay)} Q${f(x1)} ${f(y1)} ${f(bx)} ${f(by)}`;
  }
  const z = p[p.length - 1];
  return d + ` L${f(z[0])} ${f(z[1])}`;
}

const rect = (x: number, y: number, w: number, h: number) => `M${f(x)} ${f(y)} H${f(x + w)} V${f(y + h)} H${f(x)} Z`;

/**
 * Writes a line of text: `y` its middle, `x` where it is anchored: its right
 * edge (start, as Arabic starts), its middle, or its left edge (end).
 */
function write(pen: Pen, sh: Shaper, text: string, face: Face, size: number, x: number, y: number, align: 'start' | 'middle' | 'end', fill: string, opacity?: number) {
  const run = sh.shape(text, face);
  const w = run.width * size;
  pen.text(run, align === 'start' ? x - w : align === 'middle' ? x - w / 2 : x, y + sh.mid(face) * size, size, fill, opacity);
}

/** The page around a chart cw × ch em on this paper: which way round, and mm per em. */
export function page(cw: number, ch: number, paper: [number, number]) {
  const [a, b] = paper;
  const short = Math.min(a, b);
  const margin = Math.max(9, short * 0.03);
  const head = short * 0.075;
  const foot = short * 0.022;
  const fit = (W: number, H: number) => Math.min((W - 2 * margin - short * 0.02) / cw, (H - 2 * margin - head - foot - short * 0.02) / ch);
  const land = fit(Math.max(a, b), short) >= fit(short, Math.max(a, b));
  const W = land ? Math.max(a, b) : short, H = land ? short : Math.max(a, b);
  // never larger than a name needs to be: a small family sits in the middle
  const s = Math.min(fit(W, H), 30 * PT);
  return { W, H, s, short, margin, head, foot };
}

/** The chart's lines and boxes, in its own em units. */
function drawChart(pen: Pen, sh: Shaper, p: PosterIn, c: Chart) {
  const BOX_H = c.boxH;
  for (const l of c.lines) {
    const d = rounded(l.pts, 0.45);
    if (d) pen.path(d, { stroke: p.tone(l.of).ink, width: 0.085 });
  }
  for (const b of c.boxes) {
    const w = p.who(b.id), t = p.tone(b.id);
    // the founder: larger, on the same middle and the same bottom, so his line still meets it
    const k = w.root ? ROOT_SCALE : 1;
    const h = w.root ? ROOT_H : BOX_H;
    const x = k === 1 ? b : { ...b, x: b.x + (b.w * (1 - k)) / 2, w: b.w * k, y: b.y + BOX_H - ROOT_H };
    const rx = (w.sex === 'f' ? Math.min(BOX_H / 2, 0.9) : 0.42) * k;
    const strong = w.root || w.head;
    const fill = w.root ? TRUNK.fill : w.head ? t.ink : t.fill;
    const stroke = w.root || w.mark ? GOLD : t.ink;
    const text = w.root ? TRUNK.text : w.head ? '#FFFFFF' : t.text;
    pen.path(roundRect(x.x, x.y, x.w, h, rx), { fill, stroke, width: strong || w.mark ? 0.13 * k : 0.07 });
    if (w.mark) pen.path(roundRect(x.x - 0.22, x.y - 0.22, x.w + 0.44, h + 0.44, rx + 0.22), { stroke: GOLD, width: 0.06 });
    if (w.dead && !w.root) pen.path(`M${f(x.x + x.w - 0.95)} ${f(x.y)} L${f(x.x + x.w - 0.55)} ${f(x.y)} L${f(x.x + x.w)} ${f(x.y + 0.55)} L${f(x.x + x.w)} ${f(x.y + 0.95)} Z`, { fill: '#1E222B' });
    // the name, and under it the years when there are any, smaller and softer
    const two = !!w.years && BOX_H > 2;
    const cx = x.x + x.w / 2;
    write(pen, sh, w.name, strong ? 'bold' : 'regular', k, cx, two ? x.y + 0.92 * k : x.y + h / 2, 'middle', text);
    if (two) write(pen, sh, w.years!, 'regular', 0.62 * k, cx, x.y + 1.92 * k, 'middle', text, 0.8);
  }
}

interface Frame {
  W: number;
  H: number;
  short: number;
  margin: number;
  head: number;
  foot: number;
}

const num = (n: number) => n.toLocaleString('ar-SA');

/**
 * Everything on the page but the chart and the foot: the paper, the watermark,
 * the frame of tiny text, the title and the houses' colours (or, on a later
 * sheet, which sheet it is).
 */
function furniture(pen: Pen, sh: Shaper, p: PosterIn, fr: Frame, sheet?: { n: number; of: number }) {
  const { W, H, short, margin, head } = fr;
  pen.path(rect(0, 0, W, H), { fill: p.cream ? '#FBF7EE' : '#FFFFFF' });
  const fi = margin * 0.55, gap = Math.max(1.6, short * 0.0042);
  // the watermark: faint, diagonal, all over, under everything
  {
    const run = sh.shape(`${p.stamp.family} — ${p.stamp.code} — ${p.stamp.by}`, 'regular');
    const wm = short * 0.018;
    const dx = run.width * wm + wm * 6, dy = wm * 4.5;
    pen.save();
    pen.clip(fi, fi, W - 2 * fi, H - 2 * fi);
    const a = (-24 * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    pen.transform(cos, sin, -sin, cos, W / 2, H / 2);
    const R = Math.hypot(W, H) / 2 + dx;
    for (let row = -Math.ceil(R / dy), i = 0; row * dy <= R; row++, i++)
      for (let x = -R + ((i % 2) * dx) / 2; x <= R; x += dx) pen.text(run, x, row * dy, wm, '#7A6A4A', 0.075);
    pen.restore();
  }
  // the frame: a gold line, the tiny text, a finer gold line
  pen.path(rect(fi, fi, W - 2 * fi, H - 2 * fi), { stroke: GOLD, width: short * 0.0012 });
  pen.path(rect(fi + gap, fi + gap, W - 2 * fi - 2 * gap, H - 2 * fi - 2 * gap), { stroke: GOLD, width: short * 0.0005 });
  {
    const micro = gap * 0.62;
    const unit = sh.shape(`${p.stamp.code} ${p.stamp.family} · `, 'regular');
    const step = unit.width * micro;
    const c = fi + gap / 2;
    // each side along itself: the top left to right, down the right, back along the bottom, up the left
    const sides: [number, number, number, number][] = [
      [c, c, 0, W - 2 * c],
      [W - c, c, 90, H - 2 * c],
      [W - c, H - c, 180, W - 2 * c],
      [c, H - c, 270, H - 2 * c],
    ];
    for (const [x0, y0, deg, len] of sides) {
      const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
      pen.save();
      pen.transform(cos, sin, -sin, cos, x0, y0);
      for (let x = gap; x + step <= len - gap; x += step) pen.text(unit, x, sh.mid('regular') * micro, micro, GOLD);
      pen.restore();
    }
  }
  const tx = W - margin - short * 0.008;
  if (!sheet || sheet.n === 1) {
    // the title, on the right as Arabic starts
    write(pen, sh, p.stamp.title, 'title', head * 0.36, tx, margin + head * 0.36, 'start', TRUNK.ink);
    write(pen, sh, p.stamp.subtitle, 'regular', head * 0.17, tx, margin + head * 0.8, 'start', '#5B606C');
    // the houses' colours, on the left
    const sz = head * 0.13;
    const per = 4;
    const cols = Math.max(1, Math.ceil(p.legend.length / per));
    const colW = Math.min(W * 0.14, (W * 0.46) / cols);
    p.legend.forEach((l, i) => {
      const col = Math.floor(i / per), row = i % per;
      const x = margin + short * 0.01 + col * colW + colW, y = margin + head * 0.18 + row * sz * 1.75;
      pen.path(roundRect(x - sz * 1.4, y - sz * 0.5, sz * 1.4, sz, sz * 0.3), { fill: l.tone.fill, stroke: l.tone.ink, width: sz * 0.08 });
      write(pen, sh, l.name, 'regular', sz, x - sz * 1.8, y, 'start', l.tone.text);
    });
  } else write(pen, sh, p.stamp.title, 'title', head * 0.22, tx, margin + head * 0.55, 'start', TRUNK.ink);
  if (sheet) write(pen, sh, `اللوحة ${num(sheet.n)} من ${num(sheet.of)}`, 'bold', head * 0.2, margin + short * 0.01, margin + head * 0.55, 'end', GOLD);
  pen.path(`M${f(margin + short * 0.01)} ${f(margin + head)} H${f(W - margin - short * 0.01)}`, { stroke: GOLD, width: short * 0.0008 });
}

/** The foot: who exported it and when, that it is the family's, and its code. */
function foot(pen: Pen, sh: Shaper, p: PosterIn, fr: Frame) {
  const { W, H, short, margin } = fr;
  const y = H - margin - fr.foot * 0.45;
  const fs = fr.foot * 0.48;
  write(pen, sh, `صدّرها ${p.stamp.by} في ${p.stamp.date}`, 'regular', fs, W - margin - short * 0.008, y, 'start', '#6B6F78');
  write(pen, sh, 'نسخة خاصة بالعائلة، لا تُنشر', 'regular', fs, W / 2, y, 'middle', '#6B6F78');
  write(pen, sh, `رمز النسخة ${p.stamp.code}`, 'bold', fs, margin + short * 0.008, y, 'end', GOLD);
}

/** One poster: the chart as large as the paper allows, under the title. */
export function poster(p: PosterIn, sh: Shaper): Sheet {
  const c = p.chart;
  const [cw, ch] = size(c);
  const fr = page(cw, ch, p.paper);
  const { W, H, s, short, margin, head } = fr;
  const ox = W / 2 - (c.minX + cw / 2) * s;
  // under the title; a small family, which does not fill the page, in the middle of it
  const spare = H - 2 * margin - head - fr.foot - short * 0.03 - ch * s;
  const oy = margin + head + short * 0.012 + lift(c) * s + (spare > ch * s * 0.25 ? spare / 2 : Math.min(spare, short * 0.01));
  return {
    w: W,
    h: H,
    pt: s / PT,
    draw(pen) {
      furniture(pen, sh, p, fr);
      pen.save();
      pen.transform(s, 0, 0, s, ox, oy);
      drawChart(pen, sh, p, c);
      pen.restore();
      foot(pen, sh, p, fr);
    },
  };
}

/** The page's furniture and the band left for the chart, on a given way round. */
export function sheetFrame(paper: [number, number], landscape: boolean) {
  const [a, b] = paper;
  const short = Math.min(a, b);
  const W = landscape ? Math.max(a, b) : short, H = landscape ? short : Math.max(a, b);
  const margin = Math.max(9, short * 0.03);
  const head = short * 0.075, foot = short * 0.022;
  // the chart's band: the same on every sheet, so the rows run level across them
  const x0 = margin + short * 0.01, x1 = W - margin - short * 0.01;
  const y0 = margin + head + short * 0.012, y1 = H - margin - foot - short * 0.012;
  return { W, H, short, margin, head, foot, x0, x1, y0, y1 };
}

/** Sheets to lay side by side, right to left: the cut chart, each sheet showing its own span, with marks where to trim. */
export function sheetPages(p: PosterIn, sh: Shaper, sheets: [number, number][], s: number, landscape: boolean): Sheet[] {
  const fr = sheetFrame(p.paper, landscape);
  const { W, H, x0, x1, y0, y1 } = fr;
  const c = p.chart;
  return sheets.map(([left, right], i) => ({
    w: W,
    h: H,
    pt: s / PT,
    draw(pen) {
      furniture(pen, sh, p, fr, { n: i + 1, of: sheets.length });
      const ox = x1 - right * s;
      const oy = y0 + lift(c) * s + Math.max(0, (y1 - y0 - size(c)[1] * s) / 2);
      // only what falls on this sheet (the founder's larger box, a little either side)
      const pad = 3;
      const on = (a: number, b: number) => b >= left - pad && a <= right + pad;
      const part: Chart = {
        ...c,
        boxes: c.boxes.filter(b => on(b.x - b.w, b.x + 2 * b.w)),
        lines: c.lines.filter(l => on(Math.min(...l.pts.map(q => q[0])), Math.max(...l.pts.map(q => q[0])))),
      };
      pen.save();
      pen.clip(x0, y0 - 1, x1 - x0, y1 - y0 + 2);
      pen.transform(s, 0, 0, s, ox, oy);
      drawChart(pen, sh, p, part);
      pen.restore();
      // trim marks at the band's edges, above and below, where the next sheet meets this one
      const mk = (x: number) => {
        pen.path(`M${f(x)} ${f(y0 - fr.short * 0.012)} V${f(y0 - fr.short * 0.004)}`, { stroke: '#444444', width: 0.2 });
        pen.path(`M${f(x)} ${f(y1 + fr.short * 0.004)} V${f(y1 + fr.short * 0.012)}`, { stroke: '#444444', width: 0.2 });
      };
      if (i > 0) mk(x1);
      if (i < sheets.length - 1) mk(x0);
      foot(pen, sh, p, fr);
    },
  }));
}
