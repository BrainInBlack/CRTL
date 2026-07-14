/* Icons, all rendered as CSS-mask <span>s so they theme via currentColor.

   Resolution: bundled curated set -> CONFIG.iconCache -> CDN (fetched & embedded
   on save). Schemes in an entry's `icon` field:
     bi:<name> / bi-<name> / bare  -> Bootstrap Icons
     svg:<name>                    -> brand glyph (Iconify: simple-icons / cbi)
     data:...                        -> already-embedded SVG */

import { CONFIG } from './state';
import { BUNDLED_ICONS } from './icons.bundled';

/** True if a caught value looks like an AbortError (abort of a fetch/import). */
const isAbort = (e: unknown): boolean => !!e && (e as { name?: string }).name === 'AbortError';

// Iconify serves the brand sets from three interchangeable hosts; if one 404s
// or flakes for an icon that exists, the next is tried (they mirror the same
// data). This is what the official Iconify client does for redundancy.
const ICONIFY_HOSTS = ['https://api.iconify.design', 'https://api.simplesvg.com', 'https://api.unisvg.com'];
// Bootstrap tail. jsDelivr resolves a floating tag server-side and serves the
// file directly (200, clean CORS) - so `@latest` stays current with no manual
// version pin. (unpkg can't be used with a tag: its `@latest`/unversioned paths
// 302-redirect, and browsers refuse to follow that cross-origin redirect.)
// Use `@1` instead of `@latest` to stay within the current major if a future
// v2 ever renames icons.
const BI_CDN  = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@latest/icons';
// Brand names span several Iconify collections (e.g. gitea/homeassistant live in
// simple-icons, ubiquiti/proxmox in cbi), so svg: names are resolved across these
// monochrome brand sets in order. Iconify sends permissive CORS (dl.svgcdn.com doesn't).
const BRAND_SETS = ['simple-icons', 'cbi'];

/** Canonical bootstrap cache/bundle key for any bi form or bare name. */
export const biKey = (icon: string): string =>
  icon.startsWith('bi:') ? icon : 'bi:' + (icon.startsWith('bi-') ? icon.slice(3) : icon);

const biCdnUrl  = (name: string) => `${BI_CDN}/${name}.svg`;
const brandUrl  = (set: string, name: string, host = ICONIFY_HOSTS[0]) => `${host}/${set}/${name}.svg`;

/** GET an Iconify brand SVG across the redundant hosts; null if none serve it.
   `credentials: 'omit'` keeps wildcard-CORS responses valid even through a redirect. */
async function iconifyFetch(set: string, name: string, signal?: AbortSignal): Promise<Response | null> {
  for (const host of ICONIFY_HOSTS) {
    try {
      const res = await fetch(brandUrl(set, name, host), { cache: 'no-store', credentials: 'omit', signal });
      if (res.ok) return res;
    } catch (e) {
      if (isAbort(e)) throw e; // a cancelled import shouldn't fall through
    }
  }
  return null;
}

/** Parse svg:<name> (try all brand sets) or svg:<set>/<name> (that set only). */
export function parseSvgRef(icon: string): { sets: string[]; name: string } {
  const ref = icon.slice(4);
  const i = ref.indexOf('/');
  return i > 0 ? { sets: [ref.slice(0, i)], name: ref.slice(i + 1) } : { sets: BRAND_SETS, name: ref };
}

/** Resolve an icon string to a mask URL (bundled -> cache -> CDN best-guess). */
function iconUri(icon: string): string {
  if (!icon) return BUNDLED_ICONS['bi:question-circle'];
  if (icon.startsWith('data:')) return icon;
  if (icon.startsWith('svg:')) {
    if (CONFIG.iconCache[icon]) return CONFIG.iconCache[icon];
    const { sets, name } = parseSvgRef(icon);
    return brandUrl(sets[0], name); // best-guess for preview; embed resolves the real set
  }
  const key = biKey(icon);
  return BUNDLED_ICONS[key] || CONFIG.iconCache[key] || biCdnUrl(key.slice(3));
}

/** Fetch the SVG text from the first brand set that has the name. */
async function fetchBrandSvg(icon: string, signal?: AbortSignal): Promise<string> {
  const { sets, name } = parseSvgRef(icon);
  for (const s of sets) {
    const res = await iconifyFetch(s, name, signal); // tries each host
    if (!res) continue;
    const svg = await res.text();
    if (svg.includes('<svg')) return svg;
  }
  throw new Error('Brand icon not found: ' + name);
}

/** Which brand sets contain `name` (all polled in parallel) - for the chooser. */
export async function findBrandSets(name: string): Promise<string[]> {
  const hits = await Promise.all(BRAND_SETS.map(async (s) => {
    try { return (await iconifyFetch(s, name)) ? s : null; } catch { return null; }
  }));
  return hits.filter((s): s is string => s !== null);
}

/** Bare mask <span> for any icon string. */
export function iconEl(icon: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'svgicon';
  // Escape the CSS-string terminators (" and \) so a hand-crafted data: icon
  // can't break out of url("...") into the --icon custom property. Normal
  // bundled/CDN/encodeURIComponent'd URIs contain neither, so this is a no-op.
  const uri = iconUri(icon).replace(/["\\]/g, c => (c === '"' ? '%22' : '%5C'));
  el.style.setProperty('--icon', `url("${uri}")`);
  return el;
}

/** Entry icon (adds the row spacing class). */
export function iconMarkup(icon: string): HTMLSpanElement {
  const el = iconEl(icon);
  el.classList.add('entry-icon');
  return el;
}

/** Fixed-UI glyph span for a bundled `bi` name (gear, trash, ...). */
export const iconSpan = (name: string): HTMLSpanElement => iconEl('bi:' + name);

/** Mask URL for a bundled `bi` name - for filling static [data-bi] chrome icons. */
export const biUri = (name: string): string => BUNDLED_ICONS['bi:' + name] || biCdnUrl(name);

/**
 * Ensure a non-bundled icon is embedded in CONFIG.iconCache. No-ops for data:,
 * bundled bi:, or already-cached. Fetches the SVG once; returns true if added.
 */
export async function embedIcon(icon: string, signal?: AbortSignal): Promise<boolean> {
  if (!icon || icon.startsWith('data:')) return false;
  let key: string, svg: string;
  if (icon.startsWith('svg:')) {
    key = icon;
    if (CONFIG.iconCache[key]) return false;
    svg = await fetchBrandSvg(icon, signal);    // tries each brand set, validates <svg>
  } else {
    key = biKey(icon);
    if (BUNDLED_ICONS[key] || CONFIG.iconCache[key]) return false;
    const res = await fetch(biCdnUrl(key.slice(3)), { cache: 'no-store', credentials: 'omit', signal });
    if (!res.ok) throw new Error('Icon fetch failed: HTTP ' + res.status);
    svg = await res.text();
    if (!svg.includes('<svg')) throw new Error('Not an SVG');
  }
  // Loose sniff is enough: the SVG is only ever used as a CSS mask URL, never
  // inserted as DOM HTML, so any embedded script can't execute.
  CONFIG.iconCache[key] = 'data:image/svg+xml,' + encodeURIComponent(svg);
  return true;
}

/** All cache keys an entry references (svg: as-is, bi forms canonicalised). */
function referencedIconKeys(): string[] {
  const keys: string[] = [];
  CONFIG.groups.forEach(g => g.entries.forEach(e => {
    if (!e.icon || e.icon.startsWith('data:')) return;
    keys.push(e.icon);
  }));
  return keys;
}

/**
 * Fetch + embed every referenced icon that isn't already bundled or cached, so
 * it renders offline and is never re-fetched. Used both after adopting a gist
 * config and as a startup backfill - icons are never stored in the gist, and the
 * render path streams an uncached icon live from the CDN without caching it, so
 * each machine must embed what it references exactly once. Reports
 * onProgress(done, total); a single icon failing is tolerated (it just keeps
 * falling back to the CDN at render time). An aborted `signal` stops the run.
 * Returns the number of icons actually embedded.
 */
export async function embedAllIcons(onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<number> {
  const missing = referencedIconKeys().filter(icon => {
    if (icon.startsWith('svg:')) return !CONFIG.iconCache[icon];
    const key = biKey(icon);
    return !BUNDLED_ICONS[key] && !CONFIG.iconCache[key];
  });
  const total = missing.length;
  if (onProgress) onProgress(0, total);
  let done = 0, added = 0;
  for (const icon of missing) {
    if (signal && signal.aborted) break;
    try { if (await embedIcon(icon, signal)) added++; }
    catch (e) { if (isAbort(e)) break; /* else tolerate; render falls back to CDN */ }
    done++;
    if (onProgress) onProgress(done, total);
  }
  return added;
}

/** Drop cache entries no entry references any more. */
export function pruneIconCache(): void {
  const used = new Set<string>();
  CONFIG.groups.forEach(g => g.entries.forEach(e => {
    if (!e.icon || e.icon.startsWith('data:')) return;
    used.add(e.icon.startsWith('svg:') ? e.icon : biKey(e.icon));
  }));
  Object.keys(CONFIG.iconCache).forEach(k => { if (!used.has(k)) delete CONFIG.iconCache[k]; });
}
