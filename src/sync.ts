/* Encrypted GitHub-gist sync. Credentials { pat, gistId, key } live in
   localStorage in the clear (it's the user's own machine); only the gist
   payload is AES-GCM encrypted. */

import { CONFIG, applyConfig, setImporting, importing, editMode, rerender, saveLocal } from './state';
import { embedAllIcons } from './icons';
import { errMsg } from './util';
import type { Config, SyncCreds } from './types';

/** The three choices offered by the sync-conflict dialog. */
type ConflictAction = 'upload' | 'download' | 'later';

const SYNC_KEY  = 'crtl-sync';
const READY_KEY = 'crtl-sync-ready'; // gistId this machine has imported
const BASE_KEY  = 'crtl-sync-base';  // gist version our local edits descend from
const GIST_FILE = 'crtl.config.enc';
// Legacy gist filename (pre-CRTL rename). loadFromGist reads it as a fallback and
// saveToGist deletes it after writing the new file, so existing gists migrate on
// first sync. Remove once all installs have migrated. See migrate.ts.
const OLD_GIST_FILE = 'startpage.config.enc';
let oldGistFileSeen = false;

/* ---- credentials ---- */

export function getSync(): SyncCreds | null {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_KEY) ?? 'null') as SyncCreds | null;
    return (s && s.pat && s.gistId && s.key) ? s : null;
  } catch { return null; }
}

export function setSync(s: SyncCreds | null): void {
  if (s) localStorage.setItem(SYNC_KEY, JSON.stringify(s));
  else { localStorage.removeItem(SYNC_KEY); localStorage.removeItem(READY_KEY); localStorage.removeItem(BASE_KEY); }
}

/* ---- import gate ----
   A machine may only WRITE to the gist after it has IMPORTED the current gist
   (or created it). We record the gistId that's been imported here; sync is
   "ready" only while that matches the configured gist. A freshly-pasted setup
   blob points at a gist this machine hasn't imported yet, so it stays read-only
   until importFromGist() succeeds - that's what stops a new machine from
   overwriting the real data. */

export function isSyncReady(): boolean {
  const s = getSync();
  return !!s && localStorage.getItem(READY_KEY) === s.gistId;
}
// Mark the configured gist as imported on this machine. (createGist sets
// READY_KEY directly instead of calling this, because at create time setSync()
// hasn't run yet so getSync() can't return the new id.)
function markSyncReady(): void {
  const s = getSync();
  if (s) localStorage.setItem(READY_KEY, s.gistId);
}

/* Base version: the gist version this machine's local config is known to descend
   from. It's set whenever local and gist are in sync (after adopt/save/create)
   and stays put as local edits bump CONFIG.version ahead of it - so the flush
   path can tell "my edits on top of the current gist" (base === remote.version,
   safe to push) from "someone else pushed in the meantime" (base mismatch). */
function getBase(): number | null { const v = Number(localStorage.getItem(BASE_KEY)); return Number.isFinite(v) && v > 0 ? v : null; }
function setBase(v: number): void { if (v) localStorage.setItem(BASE_KEY, String(v)); }
// Local == gist right now -> record the common version as the new base.
const markSynced = () => setBase(CONFIG.version);

/** A config payload without the local icon cache - the portable shape shared by
   gist sync and the encrypted backup file. The cache bloats the gist / file and
   pollutes revision history; icons rebuild locally from their `bi:`/`svg:` ids
   after import. */
export const stripIconCache = (c: Config): Omit<Config, 'iconCache'> => { const { iconCache, ...rest } = c; return rest; };

/** The gist payload: this machine's live config, minus the icon cache. */
const gistPayload = (): Omit<Config, 'iconCache'> => stripIconCache(CONFIG);

/** Base64 blob bundling all three secrets, for moving to a new machine. */
export function exportSyncBlob(): string {
  const s = getSync();
  return s ? btoa(JSON.stringify(s)) : '';
}
export function importSyncBlob(blob: string): SyncCreds {
  const s = JSON.parse(atob(blob.trim())) as SyncCreds;
  if (!s.pat || !s.gistId || !s.key) throw new Error('Blob missing pat/gistId/key');
  setSync(s);
  return s;
}

let syncError: string | null = null;
export const getSyncError = (): string | null => syncError;

// Broadcast so the gear indicator + open options modal can reflect sync health.
const emitStatus = () => { try { window.dispatchEvent(new CustomEvent('sync-status')); } catch {} };

export function reportSyncError(err: unknown): void {
  syncError = errMsg(err);
  console.warn('[crtl sync]', syncError);
  emitStatus();
}
function clearSyncError(): void { if (syncError !== null) { syncError = null; emitStatus(); } }

/* ---- AES-GCM ---- */

export const b64encode = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const b64decode = (str: string) => Uint8Array.from(atob(str), c => c.charCodeAt(0));

/** Fresh 256-bit key, base64 (raw) for storage. */
export async function generateKeyB64(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return b64encode(await crypto.subtle.exportKey('raw', key));
}

const importKey = (keyB64: string) =>
  crypto.subtle.importKey('raw', b64decode(keyB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

/** Encrypt -> base64(iv || ciphertext). */
export async function encryptStr(plaintext: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return b64encode(out);
}

/** Decrypt base64(iv || ciphertext) -> string. */
export async function decryptStr(payload: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const bytes = b64decode(payload);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return new TextDecoder().decode(pt);
}

/* ---- gist API ---- */

const gistHeaders = (pat: string): Record<string, string> => ({
  'Authorization': 'Bearer ' + pat,
  'Accept': 'application/vnd.github+json',
  'Content-Type': 'application/json'
});

/** Encrypt CONFIG and PATCH it into the gist. Internal - callers go through
   commitToGist (conflict-checked) or handleConflict. */
async function saveToGist(): Promise<void> {
  const s = getSync();
  if (!s) return;
  // Guard: never write before this machine has imported the gist.
  if (!isSyncReady()) { console.warn('[crtl sync] save skipped - gist not imported yet'); return; }
  const ver = CONFIG.version;                      // version captured in this payload
  const enc = await encryptStr(JSON.stringify(gistPayload()), s.key);
  const res = await fetch('https://api.github.com/gists/' + s.gistId, {
    method: 'PATCH',
    headers: gistHeaders(s.pat),
    body: JSON.stringify({ files: { [GIST_FILE]: { content: enc } } })
  });
  if (!res.ok) throw new Error('Gist save failed: HTTP ' + res.status);
  // Migration: once the new file is written, drop the legacy StartPage file.
  // Best-effort and separate so a cleanup failure never fails the real save.
  if (oldGistFileSeen) {
    oldGistFileSeen = false;
    try {
      await fetch('https://api.github.com/gists/' + s.gistId, {
        method: 'PATCH', headers: gistHeaders(s.pat),
        body: JSON.stringify({ files: { [OLD_GIST_FILE]: null } })
      });
    } catch { /* stale file lingers; harmless (loadFromGist prefers the new one) */ }
  }
  setBase(ver);                                    // gist now holds this version
  clearSyncError();
}

/** Fetch + decrypt the gist config, or null if empty/absent. */
async function loadFromGist(signal?: AbortSignal): Promise<Config | null> {
  const s = getSync();
  if (!s) return null;
  const res = await fetch('https://api.github.com/gists/' + s.gistId, {
    method: 'GET', headers: gistHeaders(s.pat), cache: 'no-store', signal
  });
  if (!res.ok) throw new Error('Gist load failed: HTTP ' + res.status);
  const gist = await res.json();
  let file = gist.files && gist.files[GIST_FILE];
  if (!file && gist.files && gist.files[OLD_GIST_FILE]) { // legacy StartPage gist
    file = gist.files[OLD_GIST_FILE];
    oldGistFileSeen = true;
  }
  if (!file) return null;
  let content = file.content;
  if (file.truncated && file.raw_url) content = await (await fetch(file.raw_url, { signal })).text();
  if (!content) return null;
  return JSON.parse(await decryptStr(content, s.key)) as Config;
}

/** Create a new private gist seeded with the current (encrypted) config. */
export async function createGist(pat: string, keyB64: string): Promise<string> {
  const ver = CONFIG.version;
  const enc = await encryptStr(JSON.stringify(gistPayload()), keyB64);
  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: gistHeaders(pat),
    body: JSON.stringify({
      description: 'CRTL config (encrypted)',
      public: false,
      files: { [GIST_FILE]: { content: enc } }
    })
  });
  if (!res.ok) throw new Error('Gist create failed: HTTP ' + res.status);
  const id = (await res.json()).id as string;
  // We just seeded it from our own config, so this machine is authoritative.
  localStorage.setItem(READY_KEY, id);
  setBase(ver);
  return id;
}

/* ---- shared adopt ----
   Every path that replaces CONFIG with an untrusted config (gist adopt, conflict
   download, gist import, backup import) runs the same sequence: normalize+apply,
   re-embed icons from their ids, persist, and repaint. Factored here so the lock
   and the ordering can't drift between call sites. `finalize` is the one knob
   that differs - markSynced for a gist adopt (local now equals the gist),
   persist for a backup import (a real edit that bumps the version + marks the
   gist dirty). */
interface AdoptOpts {
  onIconProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  finalize?: () => void;
}

/** The adopt core WITHOUT the importing lock - for callers that already hold it
   (importFromGist owns the lock across its network load, the backup import holds
   it across decrypt + confirm). */
export async function applyAndEmbed(next: Config, opts: AdoptOpts = {}): Promise<void> {
  applyConfig(next);                              // normalize + merge local icon cache
  await embedAllIcons(opts.onIconProgress, opts.signal);
  saveLocal();                                    // persist the freshly-fetched icons
  opts.finalize?.();                              // markSynced (gist) | persist (backup)
  rerender();                                     // repaint with the now-cached icons
}

/** applyAndEmbed under the importing write-lock - for callers that don't already
   hold it (background gist adopt, conflict download). */
export async function adoptConfig(next: Config, opts: AdoptOpts = {}): Promise<void> {
  setImporting(true);
  try { await applyAndEmbed(next, opts); } finally { setImporting(false); }
}

/** Background pull. Adopts the gist when it's newer; when THIS machine is newer
   (unsynced local edits) it asks the user whether to overwrite the gist or
   discard local. No-ops until this machine has imported the gist. */
export async function syncFromGist(): Promise<void> {
  if (!getSync() || !isSyncReady()) return;
  // Don't pull (adopt or prompt) out from under an open editor, active drag, or
  // a running import - in edit mode local IS the working copy and is expected
  // to be newer; mid-import CONFIG is being replaced.
  if (editMode || importing || document.querySelector('.modal-backdrop') || document.querySelector('.dragging')) return;
  try {
    const remote = await loadFromGist();
    clearSyncError();
    // Re-check after the network await: an import that started meanwhile owns
    // CONFIG now - adopting the gist on top of it would clobber the import.
    if (importing) return;
    if (!remote || !remote.version) return;
    if (remote.version === CONFIG.version) {        // already in sync
      deferredConflict = null;
      markSynced();                               // confirm the base matches the gist
      return;
    }
    // Gist newer -> adopt it, UNLESS this machine has unsynced edits the user
    // deferred on: that's now a two-way divergence, so re-ask instead of
    // silently clobbering the local changes.
    if (remote.version > CONFIG.version && !deferredConflict) {
      await adoptConfig(remote, { finalize: markSynced }); // locked: CONFIG replaced over an await
      return;
    }
    await handleConflict(remote);                   // local newer, or a deferred divergence
  } catch (err) {
    reportSyncError(err);
  }
}

/** Flush pending local edits to the gist, but first confirm the gist hasn't
   moved since we synced. Safe to push when the gist is empty or still at our
   base version; if another machine pushed in the meantime (base mismatch) we
   ask the user instead of overwriting their changes. Called on edit-mode exit. */
export async function commitToGist(): Promise<void> {
  if (!getSync() || !isSyncReady()) return;
  try {
    const remote = await loadFromGist();
    clearSyncError();
    const base = getBase();
    // Empty gist, or unchanged since we last synced -> our edits sit cleanly on top.
    if (!remote || !remote.version || (base != null && remote.version === base)) {
      await saveToGist();
      return;
    }
    if (remote.version === CONFIG.version) { markSynced(); return; } // identical, nothing to do
    await handleConflict(remote);                   // gist moved underneath us -> ask
  } catch (err) {
    reportSyncError(err);
  }
}

/* ---- newer-local conflict ---- */

let conflictOpen = false;
let deferredConflict: { remoteVer: number; localVer: number } | null = null; // the user chose "Later" on

const fmtTime = (ms: number) => { try { return new Date(ms).toLocaleString(); } catch { return String(ms); } };

async function handleConflict(remote: Config): Promise<void> {
  const localVer = CONFIG.version, remoteVer = remote.version;
  if (conflictOpen) return;
  // Don't nag every interval for the same unchanged standoff.
  if (deferredConflict && deferredConflict.remoteVer === remoteVer && deferredConflict.localVer === localVer) return;
  conflictOpen = true;
  let act: ConflictAction;
  try { act = await showConflictDialog(localVer, remoteVer); }
  finally { conflictOpen = false; }
  if (act === 'upload') {            // overwrite the gist with local
    deferredConflict = null;
    await saveToGist();
  } else if (act === 'download') {   // discard local, adopt the gist
    deferredConflict = null;
    await adoptConfig(remote, { finalize: markSynced }); // locked: CONFIG replaced over an await
  } else {                           // Later - remind only if something changes
    deferredConflict = { remoteVer, localVer };
  }
}

function showConflictDialog(localVer: number, remoteVer: number): Promise<ConflictAction> {
  return new Promise((resolve) => {
    const lead = localVer > remoteVer
      ? 'This machine has changes that are newer than the gist and were never synced.'
      : 'The gist has newer changes, but this machine also has unsynced local changes that would be lost.';
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop open';
    backdrop.innerHTML =
      '<div class="modal">' +
        '<div class="modal-header">Sync conflict</div>' +
        '<div class="modal-body">' +
          '<p class="conflict-msg">' + lead + '</p>' +
          '<div class="hint">This machine: <b>' + fmtTime(localVer) + '</b><br>Gist: <b>' + fmtTime(remoteVer) + '</b></div>' +
          '<p class="conflict-msg">Upload local to overwrite the gist, or discard local changes and use the gist?</p>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button class="btn" data-act="later">Later</button>' +
          '<button class="btn" data-act="download">Use gist</button>' +
          '<button class="btn primary" data-act="upload">Upload local</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    let settled = false;
    const done = (act: ConflictAction) => { if (settled) return; settled = true; backdrop.remove(); resolve(act); };
    // Escape routes through main.js closeModal -> _onClose; resolve as "Later"
    // so the promise (and conflictOpen) never gets stuck unresolved.
    backdrop._onClose = () => done('later');
    backdrop.querySelectorAll<HTMLElement>('[data-act]').forEach(b => b.addEventListener('click', () => done(b.dataset.act as ConflictAction)));
    backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) done('later'); });
  });
}

/* ---- progress overlay ---- */

interface ImportUI {
  set(text?: string | null, pct?: number | null): void;
  remove(): void;
}

function showImportOverlay(onCancel?: () => void): ImportUI {
  const el = document.createElement('div');
  el.className = 'import-overlay';
  el.innerHTML =
    '<div class="import-box">' +
      '<div class="import-title">Importing config</div>' +
      '<div class="import-stage">Connecting...</div>' +
      '<div class="import-track"><div class="import-fill"></div></div>' +
      '<div class="import-actions"><button class="btn" data-act="cancel">Cancel</button></div>' +
    '</div>';
  document.body.appendChild(el);
  const stage = el.querySelector<HTMLElement>('.import-stage')!;
  const fill  = el.querySelector<HTMLElement>('.import-fill')!;
  if (onCancel) el.querySelector('[data-act="cancel"]')!.addEventListener('click', onCancel);
  return {
    set(text, pct) { if (text != null) stage.textContent = text; if (pct != null) fill.style.width = pct + '%'; },
    remove() { el.remove(); }
  };
}

/** Force-adopt the current gist onto this machine, then unlock writes.
   This is the one-time (per machine) import: it overwrites local config with
   the gist regardless of version, rebuilds the local icon cache, and only then
   marks sync ready so edits may be saved back. Editing is locked throughout.
   `silent` skips the overlay (used for quiet background retries). */
export async function importFromGist({ silent = false }: { silent?: boolean } = {}): Promise<void> {
  const s = getSync();
  if (!s) return;
  if (importing) return; // another import (gist or backup) already owns the lock
  setImporting(true);
  // Bound the import so a hung request can't lock the UI forever; Cancel aborts too.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const ui = silent ? null : showImportOverlay(() => controller.abort());
  try {
    ui && ui.set('Connecting...', 8);
    const remote = await loadFromGist(controller.signal);
    if (remote && remote.version) {
      ui && ui.set('Decrypting...', 25);
      // Already holds the lock (set above), so use the un-locked core.
      await applyAndEmbed(remote, {
        onIconProgress: (done, total) =>
          ui && ui.set(total ? `Loading icons (${done}/${total})...` : 'Loading icons...',
            30 + (total ? Math.round((done / total) * 65) : 65)),
        signal: controller.signal,
        finalize: markSynced                     // local now equals the gist
      });
    } else {
      // Empty gist: keep local config and seed the gist from it on first save.
      ui && ui.set('No remote config - keeping local', 95);
    }
    markSyncReady();
    clearSyncError();
    ui && ui.set('Done', 100);
  } catch (err) {
    reportSyncError(err);
    ui && ui.set('Import failed: ' + errMsg(err), 100);
    throw err;
  } finally {
    clearTimeout(timer);
    setImporting(false);
    if (ui) setTimeout(() => ui.remove(), 600);
  }
}
