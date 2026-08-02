/**
 * Preload-safe entry: channel constants only (no Zod, no Node deps).
 * Sandboxed Electron preload must load this without unresolved require() calls.
 */
export { IpcChannels, type IpcChannel } from './channels.js';
