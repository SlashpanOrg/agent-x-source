import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/servers/*.ts'],
  format: 'esm',
  clean: true,
  external: ['better-sqlite3', 'glob', 'puppeteer'],
});
