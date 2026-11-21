// A newer version of the app on the site. Full screen there is no address bar
// to reload from, so the page compares the script it loaded with the one the
// site serves now, says when they differ, and reloads in one tap.
import { useEffect, useState } from 'preact/hooks';

/** The app's script as this page loaded it: /assets/index-<hash>.js on the live site, none in development. */
function loaded(): string | null {
  const src = document.querySelector('script[src*="/assets/index-"]')?.getAttribute('src');
  return src ? new URL(src, location.href).pathname : null;
}

export async function newerVersion(): Promise<boolean> {
  const mine = loaded();
  if (!mine) return false;
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text();
    const now = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
    return !!now && now !== mine;
  } catch {
    return false;
  }
}

/**
 * Reloads the app: the newest version, the family opened again from this
 * phone. From the page's own history entry: a reload on one of back's entries
 * (src/ui/back.ts) would leave entries of the old page behind it.
 */
export function reloadApp() {
  const n = typeof history.state?.back === 'number' ? history.state.back : 0;
  if (!n) return location.reload();
  addEventListener('popstate', () => location.reload(), { once: true });
  history.go(-n);
}

/** Whether a newer version is out: checked soon after opening, when the app comes back to the screen, and every 10 minutes. */
export function useNewerVersion(): boolean {
  const [due, setDue] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => void newerVersion().then(x => alive && x && setDue(true));
    const first = setTimeout(check, 4000);
    const every = setInterval(check, 10 * 60 * 1000);
    const shown = () => !document.hidden && check();
    document.addEventListener('visibilitychange', shown);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(every);
      document.removeEventListener('visibilitychange', shown);
    };
  }, []);
  return due;
}
