import { defineConfig } from 'vite';
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

// Inline the bundled JS and CSS into index.html: each `<script src>` becomes an
// inline `<script>`, each stylesheet `<link>` a `<style>`, and the inlined files
// are dropped from the bundle. Replaces vite-plugin-singlefile (whose
// micromatch -> braces chain carries an unpatched advisory) - the build config
// below does the rest (one JS chunk, one CSS file, assets inlined). `</script`
// and `<!--` in the code are escaped so the inline script can't end early.
function inlineAssets(): Plugin {
  const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    name: 'inline-assets',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset' || typeof html.source !== 'string') return;
      let out = html.source;
      for (const file of Object.values(bundle)) {
        const name = escape(file.fileName);
        if (file.type === 'chunk') {
          const code = file.code.replace(/<(\/script>|!--)/g, '\\x3C$1').trim();
          out = out.replace(new RegExp(`<script([^>]*?) src="(?:[^"]*?/)?${name}"([^>]*)></script>`),
            (_, before: string, after: string) => `<script${before}${after}>${code}</script>`);
        } else if (file.fileName.endsWith('.css') && typeof file.source === 'string') {
          const css = file.source.replace('@charset "UTF-8";', '').trim();
          out = out.replace(new RegExp(`<link([^>]*?) href="(?:[^"]*?/)?${name}"([^>]*)>`),
            (_, before: string, after: string) => `<style${before}${after}>${css}</style>`);
        } else continue;
        delete bundle[file.fileName];
      }
      html.source = out;
    }
  };
}

// Local build ships as CRTL.html; the hosted build keeps index.html (what a
// static host serves by default). Runs post so it's after inlineAssets.
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
  base: './',
  plugins: [inlineAssets(), nameOutput()],
  build: {
    outDir,                   // build output (git-ignored)
    emptyOutDir: true,        // wipe the target dir each build
    assetsDir: '',            // emit at the outDir root so inlineAssets() finds every file
    assetsInlineLimit: () => true, // force fonts/assets to inline as base64
    cssCodeSplit: false,      // one CSS file to inline
    chunkSizeWarningLimit: Infinity,
    rolldownOptions: { output: { codeSplitting: false } } // one JS chunk to inline
  },
  server: {
    port: 5173,
    strictPort: true,
    open: '/index.html'
  }
});
