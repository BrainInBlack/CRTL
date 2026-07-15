# Changelog

All notable changes to CRTL are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Encrypted local backup.** Global options can now export the config as a
  passphrase-encrypted file and import it on another machine - no GitHub
  account needed. The key is derived per export via PBKDF2-SHA256 (600k
  iterations, random salt); the payload is AES-GCM encrypted and mirrors the
  gist payload: groups, links, and probes only - no icon cache (icons re-embed
  from their `bi:`/`svg:` ids on import) and never any sync credentials. Like
  gist sync it needs a secure context (`file://` or `https://`).

### Changed

- **Deep config sanitization.** `normalizeConfig` now also drops null/non-object
  records inside `groups`/`entries`/`links`, non-string probes and icon-cache
  values, and coerces non-string entry icons, so a corrupt or hostile payload -
  from localStorage, a synced gist, or an imported backup file - can't crash
  rendering and persist itself as a bricked config.
- **Relicensed from PolyForm Noncommercial 1.0.0 to MIT + Commons Clause.**
  PolyForm NC barred all commercial use, including a company running CRTL on its
  own internal homelab. The new terms allow use (companies included),
  modification, and free redistribution, and forbid only selling the software
  (per the Commons Clause). Updated `LICENSE`, `package.json`, the README badge
  and license note, and CONTRIBUTING.

## [1.0.1] - 2026-07-14

### Changed

- **Split the periodic-check timers.** Home/Away detection and the per-service
  health probes used to share one 60-second loop and fire together. They now run
  on separate timers: Home/Away re-detects every 30 seconds, and the service
  probes run on their own 30-second timer staggered 5 seconds later so the two
  bursts of network calls don't overlap. The gist re-pull keeps its own
  60-second clock.

## [1.0.0] - 2026-07-13

Initial public release. Everything below describes the app as it ships at 1.0.0.

### Added

- **Card dashboard** - groups of services in a phosphor / CRT-styled card
  layout, each entry with an icon, a name, and one or more links. Click an entry
  to open its primary URL; long-press (or tap the dots) on a multi-link entry to
  slide out a labeled button strip with all of them.
- **Home / Away detection** - on load and every 60 seconds the page probes a
  configurable list of internal endpoints (`fetch` with `mode: 'no-cors'`). If
  any responds you're Home, otherwise Away. A top-right pill shows the current
  state and lets you flip it manually (auto -> lock -> switch -> auto).
- **Away-mode link reordering** - when Away, each entry's links reorder so
  non-internal URLs come first, and home-only entries dim. A URL is "internal"
  if its host ends in `.home` / `.local` or sits in an RFC1918 range.
- **Per-service health dots** - opt in per entry for a green (up) / amber (down)
  reachability dot beside the name.
- **Two builds from one source** - a downloadable single-file `CRTL.html` (full
  features, runs offline from `file://`) and a hosted web build for devices that
  can't open local files (iPhone / iPad). The active build and version number
  are shown in Help, and the hosted build offers a one-click download of the
  offline single-file version (gear -> Download offline version).
- **Web-build Home / Away** - a hosted `https` page can't probe an `http` LAN
  (mixed content), so the web build uses a manual Home/Away toggle and shows
  health dots only for `https` targets. Adding one `https`-reachable "beacon" to
  the Home probes restores automatic detection.
- **Edit mode** - add, edit, reorder (drag-and-drop within and across groups),
  and delete groups and entries from the gear menu, with a Global options panel
  for Home-detection probes and sync.
- **Icons** - a curated Bootstrap Icons set is baked into the build and renders
  offline; brand icons (`svg:name`, Simple Icons) and non-curated Bootstrap
  icons (`bi:name`) are fetched once from a public CDN when you save an entry,
  then embedded into your config so they keep working offline afterward.
- **Dark / light theme** - CRT phosphor palette exposed as CSS variables, with a
  persisted theme toggle applied before first paint (no flash).
- **Encrypted gist sync** - optional, opt-in config sync across machines via a
  GitHub gist. The payload is AES-encrypted client-side, so GitHub only ever
  stores ciphertext; the token and key are stored locally in plaintext,
  last-write-wins on wall-clock timestamps. An import gate and a base-version
  check keep a fresh machine from clobbering the gist.
- **Local-first storage** - config lives in the browser's `localStorage`; the
  built-in defaults in `src/config.ts` are only a first-run seed. No accounts,
  no telemetry.

### Security

- Config-supplied URLs are scheme-validated (`safeUrl`) before they reach an
  `href` or `window.open` - only `http` / `https` / `mailto` navigate, so a
  `javascript:` or `data:` URL smuggled in through a synced gist or a hand-edited
  `localStorage` is neutralized to `#` rather than run as script.
- Icon strings are escaped before interpolation into the `url("...")` CSS mask,
  so a crafted `data:` icon can't break out of the `--icon` custom property.

[Unreleased]: https://github.com/BrainInBlack/CRTL/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/BrainInBlack/CRTL/releases/tag/v1.0.0
