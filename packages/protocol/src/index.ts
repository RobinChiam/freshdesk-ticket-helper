/**
 * Shared protocol package: Zod schemas for IPC and authenticated WSS messages.
 * Both Electron main and future VPS broker must agree on these shapes.
 */
export * from './common.js';
export * from './ipc.js';
export * from './wss.js';
