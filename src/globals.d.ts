/* Ad-hoc properties the app stashes directly on DOM elements. Declaring them
   here keeps the call sites unchanged (no WeakMaps / casts) under strict TS. */

export {};

declare global {
  /** Injected by Vite `define` at build time - see build.ts / vite.config.ts. */
  const __APP_VERSION__: string;
  const __BUILD_TARGET__: 'local' | 'web';

  interface HTMLElement {
    /** Modal backdrops: invoked on close (Esc / backdrop click). See modals.ts. */
    _onClose?: () => void;
    /** Group elements: the in-flight FLIP height animation. See dnd.ts. */
    _hAnim?: Animation | null;
  }
}
