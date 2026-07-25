/* Touch mode: is the primary pointer a finger?

   Detection is capability-based, never device-based. `(pointer: coarse)` says
   the primary pointer is imprecise - which is the thing the UI actually needs
   to know, and the one question a UA string can't answer (iPadOS Safari reports
   itself as desktop Safari, and a laptop with a touchscreen is neither one nor
   the other). Handlers that need finer detail branch on `e.pointerType` per
   event instead, so a hybrid gets the right behaviour per interaction.

   The mode is device-local: CONFIG is shared across machines via the gist, so a
   phone's touch setting must not follow the user to their desktop. It lives in
   its own localStorage key, like the theme. */

const MODE_KEY = 'crtl-touch';

/** 'auto' follows the pointer media query; 'on'/'off' are the manual override. */
export type TouchMode = 'auto' | 'on' | 'off';

// Guarded: happy-dom (tests) and ancient browsers may not implement matchMedia.
const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;

function readMode(): TouchMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch { return 'auto'; }
}

let mode: TouchMode = readMode();

/** Live binding - import it and read at call time, never destructure at module scope. */
export let isTouch = false;

export const getTouchMode = (): TouchMode => mode;

/** Recompute and mirror onto <body> so CSS can switch on the same source as JS
   (including the manual override, which a bare media query can't see). */
function apply(): void {
  isTouch = mode === 'auto' ? !!coarse?.matches : mode === 'on';
  document.body.classList.toggle('touch', isTouch);
}

/** Announce a mode change. main.ts re-renders on this: touch affordances (drag
   handles, the context menu) are rendered, not just styled, so a repaint is
   needed - the event keeps this module free of a state.ts import cycle. */
const announce = () => window.dispatchEvent(new Event('touch-mode'));

export function setTouchMode(next: TouchMode): void {
  if (next === mode) return;
  mode = next;
  try {
    if (next === 'auto') localStorage.removeItem(MODE_KEY);
    else localStorage.setItem(MODE_KEY, next);
  } catch {}
  apply();
  announce();
}

// An iPad gaining a trackpad (or a phone docking to a mouse) flips the primary
// pointer mid-session; follow it while the mode is 'auto'.
coarse?.addEventListener('change', () => {
  if (mode !== 'auto') return;
  apply();
  announce();
});

apply();
