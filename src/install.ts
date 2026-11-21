// Installing the app on the home screen. Chromium browsers (Chrome, Brave, Edge)
// announce that it can be installed; we keep that until the person taps our
// button. Elsewhere, and on iPhone, the app shows the browser's own steps.
import { set } from './data/store';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallEvent | null = null;

export function isInstalled(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferred = e as InstallEvent;
  set({ installable: true });
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  set({ installable: false });
});

export async function install(): Promise<void> {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice;
  deferred = null;
  set({ installable: false });
}
