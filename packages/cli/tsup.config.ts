import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/daemon.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  splitting: false,
  shims: false,
  banner: {
    js: '#!/usr/bin/env node\nconst{createRequire:__cr}=await import("module");const require=__cr(import.meta.url);const __dirname=require("path").dirname(require("url").fileURLToPath(import.meta.url));const __filename=require("url").fileURLToPath(import.meta.url);',
  },
  clean: true,
  noExternal: [/^(?!better-sqlite3).*/],
  external: ['better-sqlite3'],
  esbuildPlugins: [
    {
      name: 'stub-optional',
      setup(build) {
        // Stub react-devtools-core (optional dep of ink, not needed at runtime)
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: 'react-devtools-core',
          namespace: 'stub',
        }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export default undefined;',
          loader: 'js',
        }));
      },
    },
  ],
});
