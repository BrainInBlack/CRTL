/* Single source of truth: CONFIG (probes + groups + icon cache) plus the
   app-wide UI flags. CONFIG loads from localStorage (seeded from defaults) and,
   when sync is on, is reconciled against an encrypted gist. */

import { DEFAULT_HOME_PROBES, DEFAULT_GROUPS } from './config';
import { getSync, isSyncReady, commitToGist, reportSyncError } from './sync';
import { render } from './render';
import { migrateStorage } from './migrate';
import type { Config, Group, LocationState } from './types';

// Rename legacy startpage-* keys before the first read below (this is the
// earliest-evaluated module that touches persistence).
migrateStorage();

const CONFIG_KEY  = 'crtl-config';
export const STORAGE_KEY = 'crtl-location';
const MANUAL_KEY = 'crtl-manual'; // sticky manual Home/Away override

const clone = <T>(x: T): T =>
  typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x));

function defaultConfig(): Config {
  return { version: Date.now(), homeProbes: clone(DEFAULT_HOME_PROBES), groups: clone(DEFAULT_GROUPS), iconCache: {}, colorBlind: false };
}

// Non-null object (not array) - the only record shape render() can consume.
const isRecord = (x: unknown): boolean => !!x && typeof x === 'object' && !Array.isArray(x);

/** Deep-coerce untrusted `groups`: drop non-object groups/entries/links so a
   crafted payload can't crash render()/orderLinks() with a null record, and
   coerce non-string icons - iconUri() requires a string ('' renders the
   question-mark fallback). */
function normalizeGroups(raw: unknown): Group[] {
  if (!Array.isArray(raw)) return clone(DEFAULT_GROUPS);
  return (raw as Group[]).filter(isRecord).map(g => ({
    ...g,
    entries: Array.isArray(g.entries)
      ? g.entries.filter(isRecord).map(e => ({
          ...e,
          icon: typeof e.icon === 'string' ? e.icon : '',
          checkUrl: typeof e.checkUrl === 'string' ? e.checkUrl : undefined,
          links: Array.isArray(e.links) ? e.links.filter(isRecord) : []
        }))
      : []
  }));
}

/** Coerce an untrusted config (localStorage, gist, or backup file) into a valid
   shape so a corrupt/hostile payload - e.g. `groups` as a non-array, nulls
   inside `groups`/`entries`/`links`, or non-string icons/cache values - can't
   brick render(). Remaining scalar fields (names, urls, labels) are safe at
   their use sites (textContent / safeUrl). */
function normalizeConfig(raw: Partial<Config> | null | undefined): Config {
  const c = raw ?? {};
  return {
    version:    typeof c.version === 'number' ? c.version : Date.now(),
    homeProbes: Array.isArray(c.homeProbes) ? c.homeProbes.filter(p => typeof p === 'string') : clone(DEFAULT_HOME_PROBES),
    groups:     normalizeGroups(c.groups),
    iconCache:  c.iconCache && isRecord(c.iconCache)
      ? Object.fromEntries(Object.entries(c.iconCache).filter(([, v]) => typeof v === 'string'))
      : {},
    colorBlind: c.colorBlind === true
  };
}

export function loadLocalConfig(): Config {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return defaultConfig();
    return normalizeConfig(JSON.parse(raw) as Partial<Config>);
  } catch { return defaultConfig(); }
}

export let CONFIG: Config = loadLocalConfig();

/* App-wide UI state - read the live exports, mutate via the setters. */
export let currentState   = (localStorage.getItem(STORAGE_KEY) || 'home') as LocationState;
export let manualOverride = localStorage.getItem(MANUAL_KEY) === '1';
export let editMode       = false;
export let openWrap: HTMLElement | null = null;
// True while a gist import is in flight - editing is locked so a half-loaded
// config can't be mutated or saved back over the gist mid-import.
export let importing      = false;

export const setImporting      = (v: boolean) => { importing = v; };
export const setCurrentState   = (s: LocationState) => { currentState = s; };
export const setManualOverride = (v: boolean) => {
  manualOverride = v;
  try { v ? localStorage.setItem(MANUAL_KEY, '1') : localStorage.removeItem(MANUAL_KEY); } catch {}
};
export const setEditModeFlag   = (v: boolean) => { editMode = v; };
export const setOpenWrap       = (w: HTMLElement | null) => { openWrap = w; };

export const isAway   = () => currentState === 'away';
export const rerender = () => render(isAway());

/** Persist locally now; defer the gist write until flushGist().
   Each edit saves to localStorage immediately but only marks the gist dirty -
   GitHub keeps a revision per PATCH, so a whole edit session is coalesced into
   one push (on leaving edit mode / a deliberate options save) to cut noise. */
let pendingGistSave = false;
export function persist({ bumpVersion = true, toGist = true }: { bumpVersion?: boolean; toGist?: boolean } = {}): void {
  if (bumpVersion) CONFIG.version = Date.now();
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(CONFIG)); } catch {}
  // Only ever write to the gist once this machine has imported it (isSyncReady):
  // a freshly-set-up machine must not push its local config until the current
  // gist has been pulled, or it would clobber the real data.
  if (toGist && getSync() && isSyncReady()) pendingGistSave = true;
}

/** Push accumulated edits to the gist as a single revision, if any are pending.
   commitToGist first checks the gist hasn't moved underneath us (conflict). */
export function flushGist(): void {
  if (!pendingGistSave) return;
  pendingGistSave = false;
  if (getSync() && isSyncReady()) commitToGist().catch(reportSyncError);
}

/** Write CONFIG to localStorage only (no version bump, no gist). Used to persist
   the icon cache after an adopt/import embeds icons, so they survive a reload
   instead of being re-fetched every time. */
export function saveLocal(): void {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(CONFIG)); } catch {}
}

/** Replace the whole config (e.g. adopted from the gist) and re-render.
   Icons are never stored in the gist, so the local iconCache is carried over
   (and any gaps are re-fetched + persisted by the import flow). */
export function applyConfig(next: Config): void {
  const n = normalizeConfig(next);
  n.iconCache = { ...n.iconCache, ...(CONFIG.iconCache || {}) };
  CONFIG = n;
  saveLocal();
  rerender();
}
