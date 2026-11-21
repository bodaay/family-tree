// The poster's colours. Each house (a son of a main branch's founder, or of
// whoever the chart starts from) gets its own hue; the houses of one main
// branch take neighbouring hues, so a branch reads as one family of colours and
// its houses can still be told apart. Hues are spaced evenly in OKLCH, where
// equal steps look equal, at a lightness that prints well on light paper.

export interface Tone {
  /** Lines, box borders. */
  ink: string;
  /** Box fill. */
  fill: string;
  /** Text on the fill. */
  text: string;
}

/** OKLCH to #rrggbb (clipped to sRGB). */
export function oklch(l: number, c: number, h: number): string {
  const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3, M = m_ ** 3, S = s_ ** 3;
  const rgb = [4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S, -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S, -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S];
  const g = (x: number) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return '#' + rgb.map(g).join('');
}

export const TRUNK: Tone = { ink: '#2A2F3A', fill: '#2A2F3A', text: '#F7F1E3' };
export const GOLD = '#A8843A';

export type Scheme = 'colour' | 'branch' | 'mono';

const MONO: Tone = { ink: '#3A3F4A', fill: '#F3F1EC', text: '#1E222B' };

function tone(hue: number, l = 0.47): Tone {
  return { ink: oklch(l, 0.125, hue), fill: oklch(0.955, 0.028, hue), text: oklch(0.3, 0.07, hue) };
}

/**
 * The colours of a chart. `branches`: the main branches in order, each with its
 * houses in order, each house with its own houses (sons' lines) in order. The
 * hue wheel is shared out by houses, a gap between branches; a house's own
 * houses take shades around its hue. A branch of one person takes no hue.
 */
export function tones(branches: { id: string; houses: { id: string; subs: string[] }[] }[], scheme: Scheme): Map<string, Tone> {
  const out = new Map<string, Tone>();
  const real = branches.filter(b => b.houses.length);
  const total = real.reduce((n, b) => n + b.houses.length, 0);
  const gap = real.length > 1 ? 0.8 : 0;
  const slots = Math.max(1, total + gap * real.length);
  // round the wheel from a deep teal, through blue, violet, rose and amber, short of the yellow-greens
  const hueAt = (t: number) => (195 + (t / slots) * 300) % 360;
  let at = 0;
  for (const b of real) {
    const n = b.houses.length;
    out.set(b.id, scheme === 'mono' ? MONO : tone(hueAt(at + (n - 1) / 2), 0.42));
    b.houses.forEach((h, i) => {
      const hue = hueAt(scheme === 'branch' ? at + (n - 1) / 2 : at + i);
      out.set(h.id, scheme === 'mono' ? MONO : tone(hue));
      // a house's own houses: shades either side of its hue, and lighter and darker
      const m = h.subs.length;
      const step = Math.min(14, (300 / slots) * 0.7 / Math.max(1, m - 1));
      h.subs.forEach((x, j) => out.set(x, scheme === 'mono' ? MONO : tone(hue + (j - (m - 1) / 2) * step, 0.43 + ((j % 3) - 1) * -0.045)));
    });
    at += n + gap;
  }
  return out;
}
