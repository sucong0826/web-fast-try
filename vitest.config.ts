import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    exclude: ['node_modules', 'dist'],
  },
});
