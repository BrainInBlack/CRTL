/* Update check for the local build.

   The downloaded CRTL.html is a frozen copy - nothing tells its owner a newer
   release exists. This asks GitHub's releases API for the latest tag and, when
   it's newer than APP_VERSION, points at that release's CRTL.html asset. The
   hosted build is always current, so it never checks.

   It is a network call, and the README promises none happen on a normal load
   without opting in - so it only runs when the user presses "Check now" or has
   turned on the device-local "check on startup" (at most once a day; the result
   is cached so the notice survives reloads without re-asking GitHub).

   The API response is untrusted: only a strict X.Y.Z tag is accepted, and the
   download URL is built from it rather than taken from the payload. */

import { APP_VERSION, IS_WEB } from './build';

const REPO          = 'BrainInBlack/CRTL';
const RELEASE_API   = `https://api.github.com/repos/${REPO}/releases/latest`;
const ASSET_NAME    = 'CRTL.html';
const AUTO_KEY      = 'crtl-update-auto';  // '1' = check on startup
const CACHE_KEY     = 'crtl-update-cache'; // last check: { at, version, url }
const CHECK_EVERY   = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 10000;

export interface Release { version: string; url: string; }

/** Only the local build can go stale. */
export const UPDATES_SUPPORTED = !IS_WEB;

function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? m.slice(1).map(Number) : null;
}

/** Is `latest` a strictly higher X.Y.Z than `current`? Unparseable -> false. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Reduce a releases/latest payload to { version, url }, or null if it isn't
   a plain X.Y.Z release. Links the CRTL.html asset when the release has one,
   else the release page. */
export function parseRelease(data: unknown): Release | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { tag_name?: unknown; assets?: unknown; draft?: unknown; prerelease?: unknown };
  if (d.draft || d.prerelease || typeof d.tag_name !== 'string') return null;
  const nums = parseVersion(d.tag_name);
  if (!nums) return null;
  const tag = d.tag_name.trim();
  const hasAsset = Array.isArray(d.assets) && d.assets.some(a => a && (a as { name?: unknown }).name === ASSET_NAME);
  return {
    version: nums.join('.'),
    url: hasAsset
      ? `https://github.com/${REPO}/releases/download/${tag}/${ASSET_NAME}`
      : `https://github.com/${REPO}/releases/tag/${tag}`
  };
}

async function fetchLatest(): Promise<Release> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(RELEASE_API, {
      signal: ctrl.signal,
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(res.status === 403 ? 'GitHub rate limit - try again later' : `GitHub answered ${res.status}`);
    const rel = parseRelease(await res.json());
    if (!rel) throw new Error('no usable release found');
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), ...rel })); } catch {}
    return rel;
  } finally {
    clearTimeout(t);
  }
}

function cached(): (Release & { at: number }) | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    // file:// pages can share one localStorage, so re-check what we link to.
    const ok = c && typeof c.at === 'number' && parseVersion(String(c.version))
      && typeof c.url === 'string' && c.url.startsWith(`https://github.com/${REPO}/releases/`);
    return ok ? c : null;
  } catch { return null; }
}

function announce(rel: Release): Release | null {
  if (!isNewer(rel.version, APP_VERSION)) return null;
  window.dispatchEvent(new CustomEvent<Release>('update-available', { detail: rel }));
  return rel;
}

/** "Check now": always asks GitHub. Resolves the newer release, or null when
   this copy is current; rejects if the check itself failed. */
export async function checkForUpdate(): Promise<Release | null> {
  return announce(await fetchLatest());
}

/** Startup check: only when opted in, and reuses a check younger than a day.
   Failures stay silent - this is a nicety, not something to alert about. */
export async function autoCheckForUpdate(): Promise<Release | null> {
  if (!UPDATES_SUPPORTED || !getAutoCheck()) return null;
  const c = cached();
  // A future `at` (checked while the clock ran ahead) counts as stale, else it
  // would pin the cache until the clock caught up.
  const age = c ? Date.now() - c.at : -1;
  if (c && age >= 0 && age < CHECK_EVERY) return announce(c);
  try { return announce(await fetchLatest()); } catch { return null; }
}

export function getAutoCheck(): boolean {
  try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; }
}

export function setAutoCheck(on: boolean): void {
  try {
    if (on) localStorage.setItem(AUTO_KEY, '1');
    else localStorage.removeItem(AUTO_KEY);
  } catch {}
}
