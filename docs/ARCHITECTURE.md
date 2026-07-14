# Architecture

This document describes CRTL's architecture, conventions, and the reasoning
behind its trickier subsystems. Read it before changing persistence, gist sync,
or anything that ingests remote data (icon fetches, gist payloads).

## What this is

A phosphor / CRT-styled homelab dashboard that runs entirely in the browser -
no backend, no accounts, no telemetry. It ships as one self-contained
`CRTL.html` with all JS, CSS, fonts, and curated icons inlined, so it works
fully offline from `file://`. Config lives in the browser's `localStorage`, with
optional encrypted sync to a GitHub gist. Target user: someone linking their own
home or lab services, not a hosted multi-user portal.

## Commands

```sh
npm install        # one-time
npm run dev        # Vite dev server on :5173 with HMR (loads src/ via index.html)
npm run typecheck  # tsc --noEmit (strict)
npm test           # vitest, single pass
npm run build      # tsc --noEmit, then inline everything -> dist/CRTL.html
npm run build:web  # same, the hosted web build -> dist-web/index.html
npm run build:all  # both the local and web builds
npm run gen-icons  # rebuild src/icons.bundled.js from src/icon-list.js
```

CRTL builds **two targets from one source**, selected by the `BUILD_TARGET`
environment variable (`local` by default, `web` for `npm run build:web`): the
downloadable single file `dist/CRTL.html`, and the hosted `dist-web/index.html`.
`vite.config.ts` injects two compile-time constants via `define` -
`__APP_VERSION__` (from `package.json`) and `__BUILD_TARGET__` - surfaced through
`src/build.ts` as `APP_VERSION` and `IS_WEB`. It wires up
[`vite-plugin-singlefile`](https://github.com/richardtallent/vite-plugin-singlefile)
to inline all assets; a post plugin renames the emitted `index.html` chunk to
`CRTL.html` for the local build (the web build keeps `index.html`, which a static
host serves by default). Both `dist/` and `dist-web/` are git-ignored build
outputs; the shipped local artifact is attached to a GitHub release, not
committed.

The target only gates the few behaviours that differ. A hosted `https` page
can't probe an `http` LAN (mixed content), so on the web build `src/probes.ts`
probes only `https` targets, and `canAutoDetect()` is false when none are
configured - the Home/Away pill then falls back to a manual toggle and health
dots show only for `https` services (`isProbeable`). The local build probes
everything. The active build and version appear in the Help modal.

Tests run on **vitest** with the **happy-dom** environment (`vitest.config.ts`);
test files are `src/**/*.test.ts`, focused on the pure / pure-ish modules
(`probes`, `sync` crypto/blob, `icons` key resolution, `state` config load). DOM-
and pointer-heavy code (render, dnd, modals, edit) is verified by hand. There's no
linter beyond `tsc` - `tsconfig.json` runs `strict`, `noUnusedLocals`, and
`noUnusedParameters`, so a clean `npm run typecheck` plus passing `npm test` is the
bar. Source is 2-space indented (`.editorconfig`).

## High-level architecture

Vanilla-TypeScript ES-module SPA, single entry at `src/main.ts`. No framework.
Shared data-model types live in `src/types.ts`; state in module-scope variables in
`src/state.ts`; the DOM is the renderer.

`index.html` holds only the static chrome (location pill, gear, theme toggle,
help button, and an empty `#container`) plus an inline head script that applies
the stored dark-theme class before first paint to avoid a light flash. Everything
else is built by JS.

### Modules

| Module | Responsibility |
| --- | --- |
| `main.ts` | Entry point: imports styles/fonts, wires the chrome (gear menu, theme, dismissal), and runs the startup sequence (render -> probe -> sync pull -> icon backfill -> periodic refresh). |
| `types.ts` | Shared data-model types (`Config`, `Group`, `Entry`, `Link`, `SyncCreds`) and dnd helper types. |
| `build.ts` | Build-time constants injected by Vite `define`: `APP_VERSION` and `IS_WEB` (local vs hosted build). |
| `state.ts` | Single source of truth. Holds `CONFIG` (probes + groups + icon cache) and UI flags (`currentState`, `manualOverride`, `editMode`, ...). Owns persistence: `persist()`, `flushGist()`, `saveLocal()`, `applyConfig()`. |
| `config.ts` | First-run seed only - `DEFAULT_HOME_PROBES` and `DEFAULT_GROUPS`. Never read again once a config exists in `localStorage`/the gist. |
| `probes.ts` | URL classification (`isInternal`), Away-mode link ordering, reachability probing (`no-cors` fetch with a timeout), and the web-build gating (`isProbeable`, `canAutoDetect`). |
| `location.ts` | The Home/Away pill and its three-state click cycle (auto -> lock -> switch -> auto). |
| `render.ts` | DOM rendering: groups, entries, the long-press slide-out overlay, and per-service health dots. |
| `icons.ts` | Icon resolution and the fetch/embed pipeline (bundled -> cache -> CDN). |
| `icons.bundled.js` | Generated (stays `.js`). The curated Bootstrap Icons set as `{ 'bi:<name>': '<data-uri>' }`. Rebuilt by `scripts/gen-icons.mjs`. |
| `icon-list.js` | The curated icon name lists that feed `gen-icons` (stays `.js` so the Node script can import it). |
| `edit.ts` / `modals.ts` / `dnd.ts` | Edit mode: inline group/entry editing, dialogs (entry editor, Global options, help), and drag-and-drop reordering. |
| `sync.ts` | Encrypted GitHub-gist sync (see below). |
| `globals.d.ts` | Ambient `HTMLElement` augmentation for the two ad-hoc element props (`_onClose`, `_hAnim`). |
| `styles.css` | The whole theme, with the CRT palette exposed as CSS variables in `:root`. |

### State flow

`src/state.ts` is the single source of truth. `CONFIG` loads from `localStorage`
(seeded from `config.ts` defaults, tolerating older/partial shapes) and, when
sync is on, is reconciled against the gist.

```
user action  ->  caller mutates CONFIG  ->  persist()  ->  localStorage (now)
                                                      \->  mark gist dirty
leave edit mode / save options  ->  flushGist()  ->  one gist revision
```

Edits persist to `localStorage` immediately but only *mark* the gist dirty;
`flushGist()` coalesces a whole edit session into a single gist PATCH so GitHub's
revision history stays clean. `persist({ bumpVersion, toGist })` bumps
`CONFIG.version` (a wall-clock timestamp) on real edits; `saveLocal()` writes
without a version bump (used to persist the icon cache).

## Home / Away detection

At startup and every 60 seconds (`SERVICE_REFRESH_MS` in `main.ts`), `probeHome()`
races the configured `homeProbes` with `no-cors` fetches: the first success means
**Home**, all-failed means **Away**. Because the responses are opaque, a probe
resolves `true` on *any* HTTP response and `false` only on a network-layer
failure - enough to tell whether a host is reachable.

A URL is considered **internal** (for Away-mode reordering/dimming) if its host
ends in `.home`/`.local` or falls in an RFC1918 range (`10.x`, `192.168.x`,
`172.16-31.x`). Loopback is treated as always-reachable, not internal. In Away
mode `orderLinks()` moves non-internal links first and `render.ts` dims entries
whose primary link is internal.

The pill (`location.ts`) supports a manual override with a three-state cycle:
auto-detect -> lock the current state -> switch to the other -> resume auto. The
override is sticky in `localStorage` so a manual choice survives reloads.

Because probes are `http://` requests to LAN hosts, serving the page over
`https://` makes browsers block them as mixed content and everything reads as
down / Away. The **local** build is therefore meant to run over `file://` or
plain `http://`. The **web** build is served over `https://` on purpose (for
devices that can't open a local file); it probes only `https` targets and, with
none configured, drops to a manual Home/Away toggle - a single `https`-reachable
"beacon" in the Home probes restores auto-detection (see the README).

## Icons

Icons are referenced as `bi:<name>` (Bootstrap Icons) or `svg:<name>` (brand
icons). Resolution order:

1. **Bundled** - the curated set baked into `icons.bundled.js` at build time,
   generated by `scripts/gen-icons.mjs` from `icon-list.js`. No network.
2. **Local cache** - `CONFIG.iconCache`, icons this machine has fetched before.
3. **CDN fetch** - any brand icon or non-curated Bootstrap icon is fetched once
   (iconify / unpkg), embedded as a data URI, cached, and never re-fetched.

The icon cache is deliberately **kept out of the gist** (it would bloat the
payload and its revision history). Each machine rebuilds the icons it needs from
their `bi:`/`svg:` ids after an import - `embedAllIcons()` on startup backfills
anything missing and persists it, so the page renders offline thereafter.

To change the curated set, edit `src/icon-list.js` and run `npm run gen-icons`;
CI fails if the committed `icons.bundled.js` is stale.

## Encrypted gist sync

Optional and opt-in (`src/sync.ts`). Credentials `{ pat, gistId, key }` live in
`localStorage` **in the clear** - it's the user's own machine - but the gist
payload itself is **AES-GCM encrypted** with the local key before upload. The
payload excludes the icon cache (rebuilt locally per machine).

Two invariants keep multi-machine sync from corrupting data:

- **Import gate** (`READY_KEY`): a machine may only *write* to the gist after it
  has *imported* the current gist (or created it). A freshly-pasted setup blob
  points at a gist this machine hasn't imported yet, so it stays read-only until
  `importFromGist()` succeeds - that's what stops a new machine from clobbering
  the real data with its seed defaults.
- **Base version** (`BASE_KEY`): the gist version the local config is known to
  descend from. On flush, `commitToGist()` checks the gist hasn't moved
  underneath us (someone else pushed) before writing.

Sync is **last-write-wins** on wall-clock `version` timestamps - fine for one
active machine at a time; concurrent edits on two machines can lose the older
write, and clock skew decides ties. Sync failures tint the gear icon (a
`sync-status` window event drives the indicator in `main.ts`).

## Security surface

CRTL has no backend, but it does render user-controlled config and ingest
remote data. The places with security weight:

- **User fields -> DOM** - entry names, link labels, URLs, and group names are
  rendered by `render.ts`; anything user-controlled that reaches the DOM must be
  handled safely.
- **Fetched icons** - brand/custom SVGs pulled from a CDN and embedded into
  config and the DOM.
- **Gist payload** - decrypted from `api.github.com` and applied to `CONFIG`.

See [`.github/SECURITY.md`](../.github/SECURITY.md) for the reporting process and
the in/out-of-scope list.
