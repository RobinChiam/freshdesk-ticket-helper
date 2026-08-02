/**
 * Central Electron security helpers: CSP, navigation allowlists, and session hardening.
 */
import { session } from 'electron';

/** HTTPS hosts the UI may open externally (documentation / Freshdesk help). */
export const ALLOWED_EXTERNAL_HTTPS_HOST_SUFFIXES = [
  'freshdesk.com',
  'freshworks.com',
  'github.com',
] as const;

/**
 * Restrictive Content Security Policy for the renderer.
 * No unsafe-eval; styles allow 'unsafe-inline' for the prototype CSS.
 */
export const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Apply CSP headers to all renderer responses for the default session. */
export function applyContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    headers['Content-Security-Policy'] = [RENDERER_CSP];
    callback({ responseHeaders: headers });
  });
}

/** Block permission requests that the prototype does not need. */
export function hardenSessionPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}
