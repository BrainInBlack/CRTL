import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Two builds off one source tree: `local` (the downloadable single-file
// CRTL.html) and `web` (the hosted build). Set with BUILD_TARGET=web; anything
// else is `local`. Dev previews `local` unless the env var is set.
const BUILD_TARGET = process.env.BUILD_TARGET === 'web' ? 'web' : 'local';
const isWeb = BUILD_TARGET === 'web';

// The web build also ships the offline single-file for download. A second pass
// (BUILD_TARGET=local DOWNLOAD_COPY=1) emits the local build into
// dist-web/download/CRTL.html, next to the hosted dist-web/index.html, so the
// deployed site can offer it. See package.json `build:web`.
const DOWNLOAD_COPY = process.env.DOWNLOAD_COPY === '1';
const outDir = DOWNLOAD_COPY ? 'dist-web/download' : (isWeb ? 'dist-web' : 'dist');

// Local build ships as CRTL.html; the hosted build keeps index.html (what a
// static host serves by default). Runs post so it's after singleFile.
function nameOutput(): Plugin {
  return {
    name: 'name-output',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      if (isWeb) return; // hosted build stays index.html
      const html = bundle['index.html'];
      if (html) { html.fileName = 'CRTL.html'; }
    }
  };
}

// CRTL ships as one self-contained HTML file. Source is modular under src/;
// `vite build` inlines all JS/CSS/fonts. Local -> dist/CRTL.html, web ->
// dist-web/index.html. Dev runs a live-reloading preview off index.html.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TARGET__: JSON.stringify(BUILD_TARGET)
  },
  plugins: [viteSingleFile(), nameOutput()],
  build: {
    outDir,                   // build output (git-ignored)
    emptyOutDir: true,        // wipe the target dir each build
    assetsInlineLimit: 100_000_000, // force fonts/assets to inline as base64
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4096
  },
  server: {
    port: 5173,
    strictPort: true,
    open: '/index.html'
  }
});
