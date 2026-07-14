import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // Mirror the build-time constants Vite injects (see vite.config.ts) so
  // modules importing them (build.ts) resolve under the test runner too.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TARGET__: JSON.stringify('local'),
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
