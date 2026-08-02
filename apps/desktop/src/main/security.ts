/**
 * Central Electron security helpers: CSP headers, navigation allowlists, session hardening.
 * Header CSP must match the HTML meta CSP (dev source vs production transform).
 */
import { app, session } from 'electron';

import { selectRendererCsp } from './cspPolicies.js';

/** HTTPS hosts the UI may open externally (documentation / Freshdesk help). */
export const ALLOWED_EXTERNAL_HTTPS_HOST_SUFFIXES = [
  'freshdesk.com',
  'freshworks.com',
  'github.com',
] as const;

export {
  DEVELOPMENT_RENDERER_CSP,
  PRODUCTION_RENDERER_CSP,
  selectRendererCsp,
} from './cspPolicies.js';

/** Choose CSP based on whether this is a packaged app or electron-vite development. */
export function getRendererCsp(isPackaged: boolean = app.isPackaged): string {
  return selectRendererCsp(isPackaged);
}

/** Apply CSP response headers aligned with the HTML meta policy for the current mode. */
export function applyContentSecurityPolicy(): void {
  const csp = getRendererCsp();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    headers['Content-Security-Policy'] = [csp];
    callback({ responseHeaders: headers });
  });
}

/** Block permission requests that the prototype does not need. */
export function hardenSessionPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}
