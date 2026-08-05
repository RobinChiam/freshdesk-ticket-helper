/**
 * Renderer CSP policy strings shared by main-process headers and the Vite HTML transform.
 * Kept free of Electron imports so electron.vite.config.ts can reuse them at build time.
 *
 * Development allows Vite React Fast Refresh (inline preamble + eval) and HMR websockets.
 * Packaged production keeps script-src 'self' with no unsafe-eval.
 */
export const PRODUCTION_RENDERER_CSP = [
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

export const DEVELOPMENT_RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws: http:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function selectRendererCsp(isPackaged: boolean): string {
  return isPackaged ? PRODUCTION_RENDERER_CSP : DEVELOPMENT_RENDERER_CSP;
}
