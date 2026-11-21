// The phone's back (the gesture, the button, or the browser's) steps back
// through what is open, as in any app: a sheet or menu closes, a profile
// returns to the one it was opened from, another tab returns to the tree.
// Each open layer is one entry in the browser's history, pushed when it opens
// (on the tap that opened it, so the browser keeps it) and taken back when it
// closes in the app; with nothing open, back leaves the app as usual.
import { useEffect, useRef } from 'preact/hooks';

const layers: { close: () => void }[] = [];
// our entries above the page's own, where the history stands now. After the
// browser reloaded the page on one of them, those below belong to the page
// before the reload: going back to its own entry loads the app once more.
let depth = typeof history.state?.back === 'number' ? history.state.back : 0;
let queued = false;
// our own step back (a layer closed in the app), on its way: the depth it lands on
let stepping: number | null = null;

/** A layer that back closes; returns the function that removes it (when it closes in the app). */
export function pushBack(close: () => void): () => void {
  const l = { close };
  layers.push(l);
  later();
  return () => {
    const i = layers.indexOf(l);
    if (i < 0) return;
    layers.splice(i, 1);
    later();
  };
}

// once a render has settled: one closing and another opening in the same tap leave the history as it is
function later() {
  if (queued) return;
  queued = true;
  setTimeout(sync, 30);
}

function sync() {
  queued = false;
  // a step back of ours not landed yet: wait for it (the browser takes it later)
  if (stepping !== null) return void setTimeout(sync, 30);
  while (depth < layers.length) history.pushState({ back: ++depth }, '');
  if (depth > layers.length) {
    const n = depth - layers.length;
    depth = layers.length;
    stepping = depth;
    history.go(-n);
  }
}

addEventListener('popstate', e => {
  const d = typeof e.state?.back === 'number' ? e.state.back : 0;
  // our own step back landing: what it stepped over is closed already, and a layer
  // opened since (a sheet that opened as another closed) stays open
  if (stepping !== null && d === stepping) {
    stepping = null;
    depth = d;
    later();
    return;
  }
  stepping = null;
  depth = d;
  // back (one step, or several from the browser's history list): close what is above
  for (let i = layers.length - 1; i >= d; i--) layers[i]?.close();
  // forward, past what is open: return to match
  if (d > layers.length) later();
});
if (depth) later();

/** While `on`, back calls `close` (which should close what called it). */
export function useBack(close: () => void, on = true) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => (on ? pushBack(() => ref.current()) : undefined), [on]);
}

/**
 * `n` steps inside one layer (a wizard's pages, profiles opened one from
 * another): back from step k goes to step k - 1, through `go(k - 1)`.
 */
export function useBackSteps(n: number, go: (k: number) => void) {
  const ref = useRef(go);
  ref.current = go;
  const offs = useRef<(() => void)[]>([]);
  useEffect(() => {
    const o = offs.current;
    while (o.length < n) {
      const k = o.length;
      o.push(pushBack(() => ref.current(k)));
    }
    while (o.length > n) o.pop()!();
  }, [n]);
  useEffect(
    () => () => {
      offs.current.forEach(off => off());
      offs.current = [];
    },
    [],
  );
}
