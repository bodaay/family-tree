// The app's font, chosen in settings. Pages follow the CSS variable --font; the
// canvases read FONT each time they draw names.
export type FontKey = 'almarai' | 'tajawal' | 'kufi';

export const FONTS: Record<FontKey, { label: string; family: string }> = {
  almarai: { label: 'المراعي', family: 'Almarai' },
  tajawal: { label: 'تجوال', family: 'Tajawal' },
  kufi: { label: 'نوتو كوفي', family: '"Noto Kufi Arabic"' },
};

const FALLBACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export let FONT = `${FONTS.almarai.family}, ${FALLBACK}`;

export function applyFont(key: FontKey) {
  const f = FONTS[key] ?? FONTS.almarai;
  const stack = `${f.family}, ${FALLBACK}`;
  if (stack === FONT && document.documentElement.style.getPropertyValue('--font')) return;
  FONT = stack;
  document.documentElement.style.setProperty('--font', stack);
  // the canvases draw with it too: redraw them once it has loaded
  document.fonts?.load(`400 16px ${f.family}`).then(() => window.dispatchEvent(new Event('resize')));
}
