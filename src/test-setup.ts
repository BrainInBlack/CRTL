/* vitest setup (happy-dom).

   1. location.ts wires the Home/Away pill at module-eval time, so the elements
      it grabs must exist before any module that transitively imports it loads.
   2. state.ts reads the bare `localStorage` global at module-eval time, and we
      want a clean in-memory Storage per test file rather than whatever the env
      supplies (older vitest left the global resolving to Node 22+'s
      experimental webstorage, which warns on *access*; vitest 5's happy-dom
      env defines a getter-only `localStorage` on the window). A plain
      assignment throws against that getter, so define the property instead -
      that works in both environments. */

document.body.innerHTML = `
  <div id="location-pill"><span id="location-text"></span></div>
`;

const store = new Map<string, string>();
const storage: Storage = {
  get length() { return store.size; },
  clear: () => store.clear(),
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  key: (i: number) => [...store.keys()][i] ?? null,
  removeItem: (k: string) => { store.delete(k); },
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
  writable: true,
});
