/* URL classification + reachability probing (no-cors fetch with a timeout). */

import { CONFIG } from './state';
import { IS_WEB } from './build';
import type { Link, LocationState } from './types';

export const PROBE_TIMEOUT_MS         = 2500;  // home-detection probe timeout
export const SERVICE_PROBE_TIMEOUT_MS = 2500;  // per-service health probe timeout

/**
 * Can this build actually reach `url`? The hosted (https) build can't fetch
 * http LAN targets - browsers block https->http as mixed content - so only
 * https URLs are probeable there. The local build (file:// or http://) can
 * reach anything, so every URL counts.
 */
export function isProbeable(url: string): boolean {
  if (!IS_WEB) return true;
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}

/** Home probes this build can actually use (see isProbeable). */
function usableHomeProbes(): string[] {
  return (CONFIG.homeProbes || []).filter(isProbeable);
}

/**
 * Whether auto Home/Away detection can run. Always on the local build; on the
 * hosted build only when at least one https-reachable probe (a "beacon") is
 * configured - otherwise the pill degrades to a manual Home/Away toggle.
 */
export function canAutoDetect(): boolean {
  return !IS_WEB || usableHomeProbes().length > 0;
}

/** True if the host is only reachable from home. Loopback is excluded. */
export function isInternal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host.endsWith('.home') || host.endsWith('.local')
      || /^10\./.test(host) || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  } catch { return false; }
}

/** Home: original order. Away: non-internal links first. */
export function orderLinks(links: Link[], away: boolean): Link[] {
  if (!away) return links.slice();
  return [...links.filter(l => !isInternal(l.url)), ...links.filter(l => isInternal(l.url))];
}

/**
 * Single fetch with timeout. Resolves true on any HTTP response, false on a
 * network-layer failure. no-cors so opaque responses still count as reachable.
 */
async function probe(url: string, timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(url, { mode: 'no-cors', signal: ctrl.signal, cache: 'no-store' });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Race all home probes; 'home' the moment any succeeds, else 'away'. */
export function probeHome(): Promise<LocationState> {
  return new Promise(resolve => {
    const probes = usableHomeProbes();
    if (!probes.length) { resolve('home'); return; }
    let remaining = probes.length, done = false;
    probes.forEach(url => probe(url, PROBE_TIMEOUT_MS).then(ok => {
      if (done) return;
      if (ok) { done = true; resolve('home'); }
      else if (--remaining === 0) resolve('away');
    }));
  });
}

export async function probeService(url: string): Promise<'up' | 'down'> {
  return (await probe(url, SERVICE_PROBE_TIMEOUT_MS)) ? 'up' : 'down';
}
