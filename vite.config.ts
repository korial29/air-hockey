import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

const isBuildingDemo = process.env.BUILD_DEMO === 'true';
const isBuildingServer = process.env.BUILD_SERVER === 'true';
const isBuildingLocal = process.env.BUILD_LOCAL === 'true';

// Four builds share this file:
// - default: the browser client (dist/index.js)
// - BUILD_LOCAL: the same-browser host (dist/local.js). Built apart from the client so
//   neither carries the other's code in a shared chunk; both are size-gated by scripts/size.mjs
// - BUILD_SERVER: the Node WebSocket adapter and its CLI
// - BUILD_DEMO: the static demo deployed to gh-pages
const libBuild = {
  lib: {
    entry: {
      [isBuildingLocal ? 'local' : 'index']: resolve(
        root,
        isBuildingLocal ? 'src/local/index.ts' : 'src/client/index.ts',
      ),
    },
    formats: ['es' as const],
  },
  emptyOutDir: false,
  target: 'es2022',
  minify: true,
  // Vite keeps whitespace in ES library output; ship it fully minified.
  rolldownOptions: { output: { minify: true } },
};

const serverBuild = {
  ssr: true,
  emptyOutDir: false,
  target: 'node20',
  rollupOptions: {
    input: {
      server: resolve(root, 'src/server/index.ts'),
      cli: resolve(root, 'src/server/cli.ts'),
    },
    external: ['ws', /^node:/],
    output: { format: 'es' as const, entryFileNames: '[name].js' },
  },
};

const demoBuild = {
  outDir: resolve(root, 'dist-demo'),
  emptyOutDir: true,
  target: 'es2022',
};

export default defineConfig({
  root: isBuildingDemo ? resolve(root, 'demo') : root,
  base: isBuildingDemo ? '/air-hockey/' : undefined,
  build: isBuildingDemo ? demoBuild : isBuildingServer ? serverBuild : libBuild,
  test: {
    root,
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json'],
    },
  },
});
