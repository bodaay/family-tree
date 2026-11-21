// The poster's lettering, drawn as outlines rather than as text: shaped by
// HarfBuzz from the app's own fonts (public/fonts/export, the same Almarai and
// Noto Kufi the app shows, as TTF), so a PDF looks the same on any printer and
// carries no fonts of its own, and the preview on screen is the very same
// drawing. Loaded only when the export opens.
import type { Font } from 'harfbuzzjs';

export type Face = 'regular' | 'bold' | 'title';

/** Each face: its Arabic file and its Latin one (spaces, Latin letters and digits, dashes). */
const FILES: Record<Face, [string, string]> = {
  regular: ['almarai-400-arabic', 'almarai-400-latin'],
  bold: ['almarai-800-arabic', 'almarai-800-latin'],
  title: ['noto-kufi-800-arabic', 'noto-kufi-800-latin'],
};

/** One glyph: which font file, which glyph, where (in em: x from the run's left edge, y up from its baseline). */
export interface Glyph {
  f: string;
  id: number;
  x: number;
  y: number;
}

/** A line of text, shaped and laid out left to right as it is seen. */
export interface Run {
  width: number;
  glyphs: Glyph[];
}

export interface Shaper {
  shape(text: string, face: Face): Run;
  /** A glyph's outline: SVG path data in font units, y up. */
  outline(f: string, id: number): string;
  /** Font units per em (the same for every file). */
  upem: number;
  /** How far above the baseline a face's middle is, in em: to centre a line in a box. */
  mid(face: Face): number;
}

let loading: Promise<Shaper> | null = null;

export function shaper(): Promise<Shaper> {
  return (loading ??= load().catch(e => {
    loading = null;
    throw e;
  }));
}

async function load(): Promise<Shaper> {
  const hb = await import('harfbuzzjs');
  const fonts = new Map<string, Font>();
  await Promise.all(
    Object.values(FILES)
      .flat()
      .map(async name => {
        const r = await fetch(`/fonts/export/${name}.ttf`);
        if (!r.ok) throw new Error('الخط ' + name);
        fonts.set(name, new hb.Font(new hb.Face(new hb.Blob(await r.arrayBuffer()), 0)));
      }),
  );
  const upem = fonts.get(FILES.regular[0])!.face.upem;
  const mids = new Map<Face, number>();
  for (const face of Object.keys(FILES) as Face[]) {
    const e = fonts.get(FILES[face][0])!.hExtents();
    mids.set(face, (e.ascender + e.descender) / 2 / upem);
  }
  const outlines = new Map<string, string>();
  const shaped = new Map<string, Run>();

  /** One piece of one direction in one font, its glyphs from x on. */
  const piece = (text: string, file: string, rtl: boolean, x: number, out: Glyph[]): number => {
    const font = fonts.get(file)!;
    const buf = new hb.Buffer();
    buf.addText(text);
    buf.guessSegmentProperties();
    buf.setDirection(rtl ? hb.Direction.RTL : hb.Direction.LTR);
    hb.shape(font, buf);
    for (const g of buf.getGlyphInfosAndPositions()) {
      out.push({ f: file, id: g.codepoint, x: x + (g.xOffset ?? 0) / upem, y: (g.yOffset ?? 0) / upem });
      x += (g.xAdvance ?? 0) / upem;
    }
    return x;
  };

  return {
    upem,
    mid: face => mids.get(face)!,
    outline(f, id) {
      const k = f + ':' + id;
      let d = outlines.get(k);
      if (d === undefined) outlines.set(k, (d = fonts.get(f)!.glyphToPath(id)));
      return d;
    },
    shape(text, face) {
      const key = face + '\u0000' + text;
      const hit = shaped.get(key);
      if (hit) return hit;
      const [ar, la] = FILES[face];
      const arabic = fonts.get(ar)!;
      const glyphs: Glyph[] = [];
      let x = 0;
      // the runs as seen, right to left; each in the font that has its letters
      for (const run of visualRuns(text)) {
        const cps = [...run.text];
        const pieces: { text: string; file: string }[] = [];
        for (const c of cps) {
          const cp = c.codePointAt(0)!;
          const file = cp > 0x7f && arabic.nominalGlyph(cp) ? ar : la;
          const last = pieces[pieces.length - 1];
          if (last?.file === file) last.text += c;
          else pieces.push({ text: c, file });
        }
        // a right-to-left run's pieces are seen in the reverse of their order in the text
        if (run.rtl) pieces.reverse();
        for (const p of pieces) x = piece(p.text, p.file, run.rtl, x, glyphs);
      }
      const r = { width: x, glyphs };
      shaped.set(key, r);
      return r;
    },
  };
}

type Kind = 'R' | 'L' | 'EN' | 'AN' | 'N';

function kindOf(cp: number): Kind {
  if ((cp >= 0x30 && cp <= 0x39) || (cp >= 0x6f0 && cp <= 0x6f9)) return 'EN';
  if (cp >= 0x660 && cp <= 0x669) return 'AN';
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0xc0 && cp <= 0x24f)) return 'L';
  if (cp === 0x60c || cp === 0x61b || cp === 0x61f || cp === 0x66b || cp === 0x66c) return 'N';
  if ((cp >= 0x590 && cp <= 0x8ff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) return 'R';
  return 'N';
}

/**
 * A line of an Arabic poster in the order it is seen, as runs of one
 * direction: the Unicode bidirectional rules, as far as a poster needs them (a
 * right-to-left line, Arabic words, numbers in either kind of digits, a Latin
 * code). Numbers and Latin read left to right inside the line; a separator
 * between two digits belongs to the number; spaces and punctuation between two
 * Latin pieces stay with them, and otherwise follow the line.
 */
export function visualRuns(text: string): { text: string; rtl: boolean }[] {
  const cps = [...text];
  const k: Kind[] = cps.map(c => kindOf(c.codePointAt(0)!));
  // a single separator between two numbers of one kind joins them (W4: plus and minus only between European digits)
  for (let i = 1; i < k.length - 1; i++)
    if (k[i] === 'N' && k[i - 1] === k[i + 1] && ((k[i - 1] === 'EN' && '-+,./:'.includes(cps[i])) || (k[i - 1] === 'AN' && ',./:'.includes(cps[i])))) k[i] = k[i - 1];
  // European digits after Latin letters are Latin (W7)
  let strong: Kind = 'R';
  for (let i = 0; i < k.length; i++) {
    if (k[i] === 'L' || k[i] === 'R') strong = k[i];
    else if (k[i] === 'EN' && strong === 'L') k[i] = 'L';
  }
  // levels: right to left 1, left to right (Latin and numbers) 2; spaces and
  // punctuation take their neighbours' direction when both sides agree (N1, numbers counting as right to left), else the line's
  const dir = (x: Kind | undefined) => (x === 'L' ? 'L' : 'R');
  const lvl: number[] = k.map(x => (x === 'L' || x === 'EN' || x === 'AN' ? 2 : 1));
  for (let i = 0; i < k.length; ) {
    if (k[i] !== 'N') {
      i++;
      continue;
    }
    let j = i;
    while (j < k.length && k[j] === 'N') j++;
    const before = dir(i > 0 ? k[i - 1] : undefined), after = dir(j < k.length ? k[j] : undefined);
    const l = before === 'L' && after === 'L' ? 2 : 1;
    for (let m = i; m < j; m++) lvl[m] = l;
    i = j;
  }
  // runs of one level, in the order of the text; seen right to left, so in reverse
  const runs: { text: string; rtl: boolean }[] = [];
  cps.forEach((c, i) => {
    const rtl = lvl[i] === 1;
    const last = runs[runs.length - 1];
    if (last && last.rtl === rtl) last.text += c;
    else runs.push({ text: c, rtl });
  });
  return runs.reverse();
}
