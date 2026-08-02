/**
 * CSP policy selection tests — development vs packaged must not conflict.
 */
import { describe, expect, it } from 'vitest';

import {
  DEVELOPMENT_RENDERER_CSP,
  PRODUCTION_RENDERER_CSP,
  selectRendererCsp,
} from '../src/main/cspPolicies';

describe('renderer CSP policies', () => {
  it('uses strict script-src in packaged builds', () => {
    const csp = selectRendererCsp(true);
    expect(csp).toBe(PRODUCTION_RENDERER_CSP);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('allows Vite Fast Refresh allowances only in development', () => {
    const csp = selectRendererCsp(false);
    expect(csp).toBe(DEVELOPMENT_RENDERER_CSP);
    expect(csp).toContain('unsafe-eval');
    expect(csp).toContain('ws:');
  });
});
