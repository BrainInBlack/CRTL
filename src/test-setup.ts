/* vitest setup (happy-dom).

   1. location.ts wires the Home/Away pill at module-eval time, so the elements
      it grabs must exist before any module that transitively imports it loads.
   2. state.ts reads the bare `localStorage` global at module-eval time. In this
      env `window === globalThis` and happy-dom leaves no localStorage on it, so
      the global resolves to Node 22+'s experimental webstorage - which doesn't
      work and warns on *access*. Install a clean in-memory Storage instead.
      We only ever *assign* the global (never read it), so the experimental
      getter - and its warning - is never triggered. */

document.body.innerHTML = `
  <div id="location-pill"><span id="location-text"></span></div>
`;

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return store.size; },
  clear: () => store.clear(),
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  key: (i: number) => [...store.keys()][i] ?? null,
  removeItem: (k: string) => { store.delete(k); },
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
};
