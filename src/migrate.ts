/* One-time migration of persisted state from the old "StartPage" brand to CRTL.
   Copies each legacy `startpage-*` localStorage key to its `crtl-*` name and
   drops the old one; safe to run on every startup (it no-ops once migrated).
   The gist file rename (startpage.config.enc -> crtl.config.enc) is handled in
   sync.ts via read-with-fallback. Remove this shim once all installs have
   migrated. See the `crtl-storage-keys` project memory. */

const KEY_MAP: Record<string, string> = {
  'startpage-config':     'crtl-config',
  'startpage-location':   'crtl-location',
  'startpage-manual':     'crtl-manual',
  'startpage-theme':      'crtl-theme',
  'startpage-sync':       'crtl-sync',
  'startpage-sync-ready': 'crtl-sync-ready',
  'startpage-sync-base':  'crtl-sync-base',
};

export function migrateStorage(): void {
  try {
    for (const [oldKey, newKey] of Object.entries(KEY_MAP)) {
      const val = localStorage.getItem(oldKey);
      if (val === null) continue;
      // Don't clobber a value already written under the new key.
      if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, val);
      localStorage.removeItem(oldKey);
    }
  } catch { /* private mode / no storage - nothing to migrate */ }
}
