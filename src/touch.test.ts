/* touch.ts - the manual override, how it reaches CSS, and where it is stored.
   (Auto follows a media query; happy-dom reports no coarse pointer, which is
   the "desktop" baseline these assert against.) */

import { describe, it, expect } from 'vitest';
import { isTouch, getTouchMode, setTouchMode } from './touch';

const MODE_KEY = 'crtl-touch';

describe('touch mode', () => {
  it('starts on auto and follows the pointer the device reports', () => {
    expect(getTouchMode()).toBe('auto');
    expect(isTouch).toBe(false);
    expect(document.body.classList.contains('touch')).toBe(false);
  });

  it('overrides detection, mirrors onto <body>, and announces the change', () => {
    const seen: string[] = [];
    window.addEventListener('touch-mode', () => seen.push(getTouchMode()));

    setTouchMode('on');
    expect(isTouch).toBe(true);
    expect(document.body.classList.contains('touch')).toBe(true);

    setTouchMode('off');
    expect(isTouch).toBe(false);
    expect(document.body.classList.contains('touch')).toBe(false);

    expect(seen).toEqual(['on', 'off']);
  });

  it('persists device-locally, under its own key and never in CONFIG', () => {
    setTouchMode('on');
    expect(localStorage.getItem(MODE_KEY)).toBe('on');
    // The config is what syncs to the gist - the input mode must stay out of it.
    expect(localStorage.getItem('crtl-config') ?? '').not.toContain(MODE_KEY);

    setTouchMode('auto'); // back to detection: the key goes away entirely
    expect(localStorage.getItem(MODE_KEY)).toBe(null);
  });

  it('ignores a no-op change', () => {
    let fired = 0;
    window.addEventListener('touch-mode', () => fired++);
    setTouchMode(getTouchMode());
    expect(fired).toBe(0);
  });
});
