import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/** Unit tests for pure modules (URL parser, sanitizer, schemas, WSS helpers). */
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
