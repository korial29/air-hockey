import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

const isBuildingDemo = process.env.BUILD_DEMO === 'true';
const isBuildingServer = process.env.BUILD_SERVER === 'true';

// Three builds share this file:
// - default: the browser library (client + local), size-gated by scripts/size.mjs
// - BUILD_SERVER: the Node WebSocket adapter and its CLI
// - BUILD_DEMO: the static demo deployed to gh-pages
const libBuild = {
  lib: {
    entry: {
      index: resolve(root, 'src/client/index.ts'),
      local: resolve(root, 'src/local/index.ts'),
    },
    formats: ['es' as const],
  },
  target: 'es2022',
  minify: true,
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
