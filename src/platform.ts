// Which system and how the app runs: in a browser, or installed on the home
// screen. Nothing else is imported here, so any module can ask.

/** The app as installed on the home screen (or the dock), not a browser tab. */
export function isInstalled(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** An iPhone or iPad (an iPad says it is a Mac, with a touch screen). */
export function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * An iPhone or iPad in a browser (Safari, or another app's), not the app on the
 * Home Screen. The family never opens there (design document 1.38): Safari
 * erases a site's storage, the family's keys with it, after seven days without a
 * visit, which an app on the Home Screen is spared; and the two never share what
 * they store, so moving between them made another device every time.
 */
export function inBrowserOnIPhone(): boolean {
  return isIOS() && !isInstalled();
}
