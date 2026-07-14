/* Home / Away pill. Clicking cycles three states:
     auto-detect -> lock current -> switch to the other -> auto-detect
   A ring around the dot marks a locked (manual) state; in auto mode the dot
   pulses while probing. */

import {
  STORAGE_KEY, currentState, manualOverride,
  setCurrentState, setManualOverride
} from './state';
import { render } from './render';
import { probeHome, canAutoDetect } from './probes';
import type { LocationState } from './types';

const pill     = document.getElementById('location-pill')!;
const pillText = document.getElementById('location-text')!;

// The state we locked *from* - drives the cycle so a freshly-locked pill offers
// "switch to the other" and a switched pill offers "resume auto". Initialised
// lazily in setState (reading the imported currentState at module-eval time
// would hit its temporal dead zone via the circular import graph).
let lockedFrom: LocationState | null = null;

function updateTitle(): void {
  const other = currentState === 'home' ? 'Away' : 'Home';
  // Hosted build without a beacon: no auto-detect, so the pill is a plain toggle.
  if (!canAutoDetect()) {
    pill.title = `Manual mode - click to switch to ${other} (auto-detect needs the desktop version or an https beacon; see Help)`;
    return;
  }
  if (!manualOverride) { pill.title = 'Auto-detecting location - click to lock'; return; }
  const here = currentState === 'home' ? 'Home' : 'Away';
  pill.title = currentState === lockedFrom
    ? `Locked ${here} - click to switch to ${other}`
    : `Locked ${here} - click to resume auto-detect`;
}

export function setState(state: LocationState, { manual = false }: { manual?: boolean } = {}): void {
  if (lockedFrom === null) lockedFrom = state; // seed from the first (startup) state
  setCurrentState(state);
  if (manual) setManualOverride(true);
  localStorage.setItem(STORAGE_KEY, state);
  pill.classList.remove('checking', 'away');
  if (state === 'away') pill.classList.add('away');
  pill.classList.toggle('locked', manualOverride);
  pillText.textContent = state === 'away' ? 'Away' : 'Home';
  updateTitle();
  render(state === 'away');
}

/** Re-probe and switch unless the user has manually locked the state. */
export function recheckLocation(): void {
  // Hosted build without a usable probe: nothing to detect against. Sit in
  // manual mode showing the last-known state; the pill becomes a toggle.
  if (!canAutoDetect()) { setState(currentState, { manual: true }); return; }
  pill.classList.add('checking');
  pill.classList.toggle('locked', manualOverride);
  updateTitle();
  probeHome().then(d => {
    if (!manualOverride) setState(d);
    else pill.classList.remove('checking');
  });
}

// auto -> lock current -> switch to the other -> auto
pill.addEventListener('click', () => {
  // Hosted build without a beacon: a plain Home/Away toggle (no auto to resume).
  if (!canAutoDetect()) {
    setState(currentState === 'home' ? 'away' : 'home', { manual: true });
    return;
  }
  if (!manualOverride) {
    lockedFrom = currentState;
    setState(currentState, { manual: true });               // freeze what's shown
  } else if (currentState === lockedFrom) {
    setState(currentState === 'home' ? 'away' : 'home', { manual: true }); // flip
  } else {
    setManualOverride(false);
    recheckLocation();                                      // resume auto-detect
  }
});
