// One drawing, three ways: as SVG for the preview on screen, as a PDF to print,
// and on a canvas for a picture to send. The poster draws through a Pen and
// does not know which; letters are outlines (text.ts), so all three are the
// same drawing, to the hair. Paths are SVG path data with absolute M, L, H, V,
// Q, C and Z only.
import type { Run, Shaper } from './text';

export interface Style {
  fill?: string;
  stroke?: string;
  /** Line width, in the units being drawn in. */
  width?: number;
  /** 0 to 1, for fill and stroke alike. */
  opacity?: number;
}

export interface Pen {
  path(d: string, st: Style): void;
  /** A shaped run of text: x its left edge, y its baseline, size its em. */
  text(run: Run, x: number, y: number, size: number, fill: string, opacity?: number): void;
  save(): void;
  restore(): void;
  /** Concatenated with the one in force, until the matching restore. */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  /** Drawing stays inside this rectangle until the matching restore. */
  clip(x: number, y: number, w: number, h: number): void;
}

/** A page: its size in mm and how to draw it (in mm, y down). */
export interface Page {
  w: number;
  h: number;
  draw(pen: Pen): void;
}

const f = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

type Seg = ['M' | 'L', number, number] | ['C', number, number, number, number, number, number] | ['Z'];

/** Path data as moves, lines and cubic curves (quadratics raised to cubics). */
export function segments(d: string): Seg[] {
  const out: Seg[] = [];
  const tok = d.match(/[MLHVQCZmlhvqcz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
  const n = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++].toUpperCase();
    if (cmd === 'Z') {
      out.push(['Z']);
      [x, y] = [sx, sy];
      continue;
    }
    if (cmd === 'M') {
      [x, y] = [n(), n()];
      [sx, sy] = [x, y];
      out.push(['M', x, y]);
      cmd = 'L';
    } else if (cmd === 'L') {
      [x, y] = [n(), n()];
      out.push(['L', x, y]);
    } else if (cmd === 'H') {
      x = n();
      out.push(['L', x, y]);
    } else if (cmd === 'V') {
      y = n();
      out.push(['L', x, y]);
    } else if (cmd === 'C') {
      const s: Seg = ['C', n(), n(), n(), n(), n(), n()];
      out.push(s);
      [x, y] = [s[5], s[6]];
    } else if (cmd === 'Q') {
      const [qx, qy, ex, ey] = [n(), n(), n(), n()];
      out.push(['C', x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey]);
      [x, y] = [ex, ey];
    } else i++;
  }
  return out;
}

/** A rectangle with rounded corners, as path data (the corners cubic quarter-circles). */
export function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const k = r * 0.5523;
  return [
    `M${f(x + r)} ${f(y)}`,
    `L${f(x + w - r)} ${f(y)}`,
    `C${f(x + w - r + k)} ${f(y)} ${f(x + w)} ${f(y + r - k)} ${f(x + w)} ${f(y + r)}`,
    `L${f(x + w)} ${f(y + h - r)}`,
    `C${f(x + w)} ${f(y + h - r + k)} ${f(x + w - r + k)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)}`,
    `L${f(x + r)} ${f(y + h)}`,
    `C${f(x + r - k)} ${f(y + h)} ${f(x)} ${f(y + h - r + k)} ${f(x)} ${f(y + h - r)}`,
    `L${f(x)} ${f(y + r)}`,
    `C${f(x)} ${f(y + r - k)} ${f(x + r - k)} ${f(y)} ${f(x + r)} ${f(y)}`,
    'Z',
  ].join(' ');
}

// ---- SVG: the preview

/** A page as SVG, the letters as shared outlines (one definition per glyph, used where it appears). */
export function svgOf(page: Page, sh: Shaper): string {
  const body: string[] = [];
  const defs = new Map<string, string>();
  const open: number[] = [0];
  let clips = 0;
  const pen: Pen = {
    path(d, st) {
      body.push(
        `<path d="${d}" fill="${st.fill ?? 'none'}"${st.stroke ? ` stroke="${st.stroke}" stroke-width="${f(st.width ?? 1)}"` : ''}${st.opacity !== undefined && st.opacity < 1 ? ` opacity="${f(st.opacity)}"` : ''}/>`,
      );
    },
    text(run, x, y, size, fill, opacity) {
      const s = size / sh.upem;
      body.push(`<g fill="${fill}"${opacity !== undefined && opacity < 1 ? ` fill-opacity="${f(opacity)}"` : ''}>`);
      for (const g of run.glyphs) {
        const id = `g${g.f.replace(/[^a-z0-9]/g, '')}-${g.id}`;
        if (!defs.has(id)) defs.set(id, `<path id="${id}" d="${sh.outline(g.f, g.id)}"/>`);
        body.push(`<use href="#${id}" transform="matrix(${f(s)} 0 0 ${f(-s)} ${f(x + g.x * size)} ${f(y - g.y * size)})"/>`);
      }
      body.push('</g>');
    },
    save() {
      open.push(0);
    },
    restore() {
      body.push('</g>'.repeat(open.pop() ?? 0));
    },
    transform(a, b, c, d, e, g) {
      body.push(`<g transform="matrix(${[a, b, c, d, e, g].map(f).join(' ')})">`);
      open[open.length - 1]++;
    },
    clip(x, y, w, h) {
      const id = `clip${++clips}`;
      defs.set(id, `<clipPath id="${id}"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"/></clipPath>`);
      body.push(`<g clip-path="url(#${id})">`);
      open[open.length - 1]++;
    },
  };
  page.draw(pen);
  body.push('</g>'.repeat(open.pop() ?? 0));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(page.w)}mm" height="${f(page.h)}mm" viewBox="0 0 ${f(page.w)} ${f(page.h)}" stroke-linecap="round" stroke-linejoin="round"><defs>${[...defs.values()].join('')}</defs>${body.join('')}</svg>`;
}

// ---- a canvas: the picture to send

/** Draws a page onto a canvas `px` pixels wide. */
export function paint(page: Page, sh: Shaper, ctx: CanvasRenderingContext2D, px: number) {
  const k = px / page.w;
  const glyphs = new Map<string, Path2D>();
  ctx.save();
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pen: Pen = {
    path(d, st) {
      const p = new Path2D(d);
      ctx.save();
      if (st.opacity !== undefined) ctx.globalAlpha *= st.opacity;
      if (st.fill && st.fill !== 'none') {
        ctx.fillStyle = st.fill;
        ctx.fill(p);
      }
      if (st.stroke) {
        ctx.strokeStyle = st.stroke;
        ctx.lineWidth = st.width ?? 1;
        ctx.stroke(p);
      }
      ctx.restore();
    },
    text(run, x, y, size, fill, opacity) {
      ctx.save();
      if (opacity !== undefined) ctx.globalAlpha *= opacity;
      ctx.fillStyle = fill;
      const s = size / sh.upem;
      for (const g of run.glyphs) {
        const key = g.f + ':' + g.id;
        let p = glyphs.get(key);
        if (!p) glyphs.set(key, (p = new Path2D(sh.outline(g.f, g.id))));
        ctx.save();
        ctx.transform(s, 0, 0, -s, x + g.x * size, y - g.y * size);
        ctx.fill(p);
        ctx.restore();
      }
      ctx.restore();
    },
    save: () => ctx.save(),
    restore: () => ctx.restore(),
    transform: (a, b, c, d, e, g) => ctx.transform(a, b, c, d, e, g),
    clip(x, y, w, h) {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
    },
  };
  page.draw(pen);
  ctx.restore();
}

// ---- PDF: to print

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(v => f(v)).join(' ');
};

/**
 * Pages as a PDF file: vector throughout, each glyph drawn once (a form object)
 * and placed wherever it appears; in millimetres, y down, like the other two.
 */
export async function pdfOf(pages: Page[], sh: Shaper, meta: { title: string }): Promise<Blob> {
  const glyphIds = new Map<string, number>();
  const glyphObjs: { key: string; d: string }[] = [];
  const alphas = new Map<string, string>();
  const streams: string[] = [];
  for (const page of pages) {
    const ops: string[] = [];
    // millimetres, y down
    const k = 72 / 25.4;
    ops.push(`${f(k)} 0 0 ${f(-k)} 0 ${f(page.h * k)} cm 1 J 1 j`);
    const gs = (a: number | undefined) => {
      if (a === undefined || a >= 1) return '';
      const key = f(a);
      if (!alphas.has(key)) alphas.set(key, `A${alphas.size + 1}`);
      return `/${alphas.get(key)} gs `;
    };
    const pen: Pen = {
      path(d, st) {
        const fill = st.fill && st.fill !== 'none';
        const op = fill && st.stroke ? 'B' : fill ? 'f' : st.stroke ? 'S' : 'n';
        ops.push(
          `q ${gs(st.opacity)}${fill ? rgb(st.fill!) + ' rg ' : ''}${st.stroke ? `${rgb(st.stroke)} RG ${f(st.width ?? 1)} w ` : ''}${pdfPath(segments(d))} ${op} Q`,
        );
      },
      text(run, x, y, size, fill, opacity) {
        const s = size / sh.upem;
        const parts = [`q ${gs(opacity)}${rgb(fill)} rg`];
        for (const g of run.glyphs) {
          const key = g.f + ':' + g.id;
          let n = glyphIds.get(key);
          if (n === undefined) {
            n = glyphObjs.length;
            glyphIds.set(key, n);
            glyphObjs.push({ key, d: sh.outline(g.f, g.id) });
          }
          parts.push(`q ${f(s)} 0 0 ${f(-s)} ${f(x + g.x * size)} ${f(y - g.y * size)} cm /G${n} Do Q`);
        }
        parts.push('Q');
        ops.push(parts.join(' '));
      },
      save: () => ops.push('q'),
      restore: () => ops.push('Q'),
      transform: (a, b, c, d, e, g) => ops.push(`${[a, b, c, d, e, g].map(f).join(' ')} cm`),
      clip: (x, y, w, h) => ops.push(`${f(x)} ${f(y)} ${f(w)} ${f(h)} re W n`),
    };
    page.draw(pen);
    streams.push(ops.join('\n'));
  }

  // the file: catalog, pages, each page and its drawing, the glyphs, the shared resources
  const enc = new TextEncoder();
  const objs: (Uint8Array | string)[] = [];
  const add = (o: Uint8Array | string) => (objs.push(o), objs.length);
  const stream = async (dict: string, body: string) => {
    const raw = enc.encode(body);
    const z = await deflate(raw);
    const data = z ?? raw;
    const head = enc.encode(`<< ${dict} /Length ${data.length}${z ? ' /Filter /FlateDecode' : ''} >>\nstream\n`);
    const tail = enc.encode('\nendstream');
    const out = new Uint8Array(head.length + data.length + tail.length);
    out.set(head);
    out.set(data, head.length);
    out.set(tail, head.length + data.length);
    return out;
  };
  const catalog = add('');
  const pagesObj = add('');
  const glyphStart = objs.length + 1;
  for (const g of glyphObjs) add(await stream(`/Type /XObject /Subtype /Form /BBox [-2000 -2000 4000 3000]`, `${pdfPath(segments(g.d))} f`));
  const xo = glyphObjs.map((_, i) => `/G${i} ${glyphStart + i} 0 R`).join(' ');
  const ext = [...alphas].map(([a, name]) => `/${name} << /ca ${a} /CA ${a} >>`).join(' ');
  const res = add(`<< /XObject << ${xo} >> /ExtGState << ${ext} >> >>`);
  const kids: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const content = add(await stream('', streams[i]));
    const k = 72 / 25.4;
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${f(p.w * k)} ${f(p.h * k)}] /Resources ${res} 0 R /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title ${pdfText(meta.title)} /Producer (Family tree) >>`);

  const chunks: Uint8Array[] = [enc.encode('%PDF-1.7\n%âãÏÓ\n')];
  let at = chunks[0].length;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(at);
    const head = enc.encode(`${i + 1} 0 obj\n`);
    const body = typeof o === 'string' ? enc.encode(o) : o;
    const tail = enc.encode('\nendobj\n');
    chunks.push(head, body, tail);
    at += head.length + body.length + tail.length;
  });
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  chunks.push(enc.encode(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${at}\n%%EOF\n`));
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

/** A path as PDF operators. */
function pdfPath(segs: Seg[]): string {
  return segs.map(s => (s[0] === 'M' ? `${f(s[1])} ${f(s[2])} m` : s[0] === 'L' ? `${f(s[1])} ${f(s[2])} l` : s[0] === 'C' ? `${s.slice(1).map(v => f(v as number)).join(' ')} c` : 'h')).join(' ');
}

/** A string for the document's properties: UTF-16 with its byte order mark, in hex. */
function pdfText(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

/** zlib (what PDF's FlateDecode reads), where the browser can; otherwise the stream goes uncompressed. */
async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const s = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  } catch {
    return null;
  }
}
