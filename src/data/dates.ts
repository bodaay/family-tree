// Gregorian is the main calendar; Hijri (Umm al-Qura) is one tap away.
// Years are stored as entered and shown in the other calendar as a range.
import type { Cal, Year } from './types';

let fmt: Intl.DateTimeFormat | null = null;
try {
  fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric' });
} catch {
  fmt = null;
}

function hijriOf(d: Date): number {
  if (fmt) {
    const n = parseInt(fmt.format(d), 10);
    if (!Number.isNaN(n)) return n;
  }
  // Arithmetic fallback: close enough for year ranges.
  const days = (d.getTime() - Date.UTC(622, 6, 16)) / 86400000;
  return Math.floor(days / 354.36707) + 1;
}

/** Hijri years overlapping a Gregorian year. */
export function gToH(g: number): [number, number] {
  return [hijriOf(new Date(Date.UTC(g, 0, 1, 12))), hijriOf(new Date(Date.UTC(g, 11, 31, 12)))];
}

/** Gregorian years overlapping a Hijri year. */
export function hToG(h: number): [number, number] {
  const g0 = Math.round(h * 0.970224 + 621.5774);
  const ys: number[] = [];
  for (let g = g0 - 2; g <= g0 + 2; g++) {
    const [a, b] = gToH(g);
    if (a <= h && h <= b) ys.push(g);
  }
  return ys.length ? [ys[0], ys[ys.length - 1]] : [g0, g0];
}

function range([a, b]: [number, number]): string {
  return a === b ? String(a) : `${a}–${b}`;
}

/** Primary and secondary text for a year, in the viewer's calendar. */
export function showYear(y: Year | undefined, cal: Cal): { main: string; alt: string } {
  if (!y) return { main: '—', alt: '' };
  const c = y.approx ? 'حوالي ' : '';
  if (y.cal === cal) {
    const other = y.cal === 'g' ? range(gToH(y.v)) + ' هـ' : range(hToG(y.v)) + ' م';
    return { main: c + y.v + (cal === 'h' ? ' هـ' : ''), alt: other };
  }
  if (cal === 'h') return { main: c + range(gToH(y.v)) + ' هـ', alt: y.v + ' م' };
  return { main: c + range(hToG(y.v)), alt: y.v + ' هـ' };
}

/** A Gregorian year for sorting and ages. */
export function gYear(y: Year | undefined): number | null {
  if (!y) return null;
  return y.cal === 'g' ? y.v : hToG(y.v)[0];
}

export const THIS_YEAR = new Date().getFullYear();

/** A year typed by hand (Arabic or Latin digits), or null when it is not a plausible year. */
export function parseYear(t: string, cal: Cal, approx?: boolean): Year | null {
  const v = parseInt(t.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))), 10);
  const max = cal === 'g' ? THIS_YEAR : gToH(THIS_YEAR)[1];
  return v > (cal === 'g' ? 1600 : 1000) && v <= max ? { v, cal, ...(approx ? { approx: true } : {}) } : null;
}
