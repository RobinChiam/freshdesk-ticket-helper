/**
 * Shared protocol package: Zod schemas for Electron IPC messages.
 *
 * Sandboxed preload must import `@fth/protocol/preload` (channels only), not this
 * entry — the full package pulls in Zod and cannot be required() under sandbox.
 */
export * from './channels.js';
export * from './common.js';
export * from './ipc.js';
