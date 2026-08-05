import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/** Unit tests for pure modules and main-process orchestration without real provider calls. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@fth/protocol': resolve(__dirname, '../../packages/protocol/src/index.ts'),
    },
  },
});
