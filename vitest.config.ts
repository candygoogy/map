import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // vite.config.ts's plugin builds virtual:models for the page; the tests get a stand-in.
  resolve: { alias: { 'virtual:models': fileURLToPath(new URL('tests/unit/helpers/virtual-models.ts', import.meta.url)) } },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
