import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

import { PRODUCTION_RENDERER_CSP } from './src/main/cspPolicies';

/**
 * Replace the development CSP meta with the strict packaged policy during production builds.
 * Header CSP (main/security.ts) and meta CSP must not conflict.
 */
function productionCspMetaPlugin(): Plugin {
  return {
    name: 'fth-production-csp-meta',
    transformIndexHtml(html, ctx) {
      if (ctx.server) {
        return html;
      }
      return html.replace(
        /http-equiv="Content-Security-Policy"\s+content="[^"]*"/,
        `http-equiv="Content-Security-Policy" content="${PRODUCTION_RENDERER_CSP}"`,
      );
    },
  };
}

/**
 * electron-vite config: isolated builds for main, preload, and renderer.
 *
 * Preload bundling invariant: sandboxed preload cannot require() npm/workspace packages.
 * Channel constants are resolved from source and inlined; only `electron` stays external.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@fth/protocol'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    resolve: {
      alias: {
        // Bundle schema-free channels from source — never leave a require("@fth/protocol/...") .
        '@fth/protocol/preload': resolve('../../packages/protocol/src/preload.ts'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
        },
        // Electron is provided by the runtime; everything else must be inlined for sandbox.
        external: ['electron'],
        output: {
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
        },
      },
    },
    plugins: [react(), productionCspMetaPlugin()],
  },
});
