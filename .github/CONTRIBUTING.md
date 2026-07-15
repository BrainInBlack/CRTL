# Contributing to CRTL

CRTL is a vanilla-TypeScript single-page app - no framework. It's built with
[Vite](https://vitejs.dev/), type-checked with `tsc` (strict), styled with plain
CSS, and stores everything in the browser's `localStorage`; there's no backend.
State lives in module-scope variables and the DOM is the renderer.

This file covers building and developing CRTL. For end-user instructions,
see [README.md](../README.md). For the full architecture and conventions, see
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or newer (current LTS).

Node is only needed to **build or develop** CRTL - not to run a built copy.
The output is a single self-contained `CRTL.html` that runs in any modern
browser, straight off `file://`.

## Setup

```sh
npm install
```

## Development

```sh
npm run dev        # Vite dev server at http://localhost:5173 with hot reload (local build)
npm run dev:web    # same, previewing the hosted web build (BUILD_TARGET=web)
```

The dev server loads the modular source from `src/` via `index.html`. This is a
live preview only - the shipped artifact is the inlined single file.

> If you commit a change that deletes or renames a module, restart `npm run dev`
> - Vite's HMR can't always reconcile a moved module graph and the page may go
> blank until a fresh start. It's not a code bug.

## Building

```sh
npm run build      # type-check (tsc), then inline all JS/CSS/fonts/icons -> dist/CRTL.html
npm run build:web  # same, but the hosted web build -> dist-web/index.html
npm run build:all  # both the local and web builds
npm run typecheck  # tsc --noEmit only (no build)
npm run gen-icons  # rebuild src/icons.bundled.js after editing src/icon-list.js
```

`npm run build` first runs `tsc --noEmit`, then writes the single self-contained
app to `dist/CRTL.html` (see `vite.config.ts`). `dist/` is a build output -
it's git-ignored and not committed; the released `CRTL.html` is attached to
a GitHub release, so you don't need to commit the artifact when you change `src/`.

CRTL builds two targets from the same `src/`, selected by the `BUILD_TARGET` env
var (`local` by default, `web` for `build:web`): the downloadable single-file
`dist/CRTL.html` and the hosted `dist-web/index.html`. The target only gates the
few behaviours that differ - the hosted `https` build can't probe `http` LAN
hosts, so it falls back to a manual Home/Away toggle (see `src/probes.ts`).
`dist-web/` is git-ignored like `dist/`.

If you change the curated icon lists in `src/icon-list.js`, run `npm run gen-icons`
to regenerate `src/icons.bundled.js`, then rebuild. Unlike the build artifact,
`src/icons.bundled.js` **is** committed - CI fails if it doesn't match a fresh
`gen-icons` run.

## Tests & quality bar

```sh
npm test           # vitest, single pass
npm run test:watch # vitest in watch mode
npm run typecheck  # tsc --noEmit
```

The bar for a change is a **clean `npm run typecheck`** and **passing `npm test`**,
plus a successful `npm run build`. `tsconfig.json` runs with `strict`,
`noUnusedLocals`, and `noUnusedParameters`, so the compiler is the linter - there's
no separate lint step.

Tests run on vitest with the happy-dom environment; test files are `src/**/*.test.ts`.
Coverage focuses on the pure / pure-ish modules (`probes` URL logic, `sync` crypto +
blob round-trip, `icons` key resolution, `state` config load). DOM- and
pointer-heavy code (render, dnd, modals, edit) is verified by hand in the browser.

Also verify in the browser: open the built file over `file://`, and - since
Home/Away detection and health dots depend on `http://` LAN probes - remember that
a page served over `https://` reads everything as down (mixed-content blocking).

## Project layout

Single entry point at `src/main.ts`. Shared types live in `src/types.ts`; state in
`src/state.ts`; rendering in `src/render.ts`; the probe/location logic in
`src/probes.ts` and `src/location.ts`; edit UI and dialogs in `src/edit.ts`,
`src/modals.ts`, and `src/dnd.ts`; encrypted gist sync in `src/sync.ts`. The two
icon data files (`src/icon-list.js`, generated `src/icons.bundled.js`) stay `.js`
so the Node `gen-icons` script can import them. The detailed map lives in
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) - start there before changing
persistence, sync, or anything that ingests remote data (icon fetches, gist
payloads).

## Branches & pull requests

The repo has two long-lived branches:

- `main` - stable releases
- `develop` - active development

Create your own branch for your work, then open a pull request into `develop`
(or `main` for an urgent fix). Before you open it:

- `npm run build` succeeds and the built `dist/CRTL.html` works,
- if you touched `src/icon-list.js`, `src/icons.bundled.js` is regenerated and committed,
- you've added a note under `## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md).

The [pull request template](PULL_REQUEST_TEMPLATE.md) has the full checklist.

## License

By contributing you agree your contributions are licensed under
[MIT + Commons Clause](../LICENSE).
