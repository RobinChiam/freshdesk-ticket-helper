/**
 * Shared protocol package: Zod schemas for IPC and authenticated WSS messages.
 * Both Electron main and future VPS broker must agree on these shapes.
 *
 * Sandboxed preload must import `@fth/protocol/preload` (channels only), not this
 * entry — the full package pulls in Zod and cannot be required() under sandbox.
 */
export * from './channels.js';
export * from './common.js';
export * from './ipc.js';
export * from './wss.js';
