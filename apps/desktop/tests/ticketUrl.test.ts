/**
 * Ticket URL / ID parser tests covering allowlist, credentials, and path rules.
 */
import { describe, expect, it } from 'vitest';

import {
  buildTicketKey,
  extractFreshdeskHostname,
  parseTicketInput,
  supportedTicketPathPatterns,
} from '../src/freshdesk/ticketUrl';

const opts = {
  apiHostname: 'company.freshdesk.com',
  allowedUiHosts: ['support.company.com'],
};

describe('parseTicketInput', () => {
  it('accepts a plain positive ticket ID', () => {
    expect(parseTicketInput('8812', opts)).toEqual({
      ok: true,
      ticketId: 8812,
      source: 'id',
    });
  });

  it('accepts a supported Freshdesk ticket URL', () => {
    expect(
      parseTicketInput('https://company.freshdesk.com/a/tickets/8812', opts),
    ).toEqual({ ok: true, ticketId: 8812, source: 'url' });
  });

  it('accepts an allowlisted custom UI host', () => {
    expect(
      parseTicketInput('https://support.company.com/helpdesk/tickets/42', opts),
    ).toEqual({ ok: true, ticketId: 42, source: 'url' });
  });

  it('rejects the wrong hostname', () => {
    const result = parseTicketInput('https://evil.example/a/tickets/8812', opts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/allowlist/i);
    }
  });

  it('rejects malformed URLs', () => {
    const result = parseTicketInput('not a url or id', opts);
    expect(result.ok).toBe(false);
  });

  it('rejects URL credentials', () => {
    const result = parseTicketInput(
      'https://user:pass@company.freshdesk.com/a/tickets/8812',
      opts,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/username or password/i);
    }
  });

  it('rejects unexpected schemes', () => {
    const result = parseTicketInput('ftp://company.freshdesk.com/a/tickets/8812', opts);
    expect(result.ok).toBe(false);
  });

  it('rejects unknown ticket paths', () => {
    const result = parseTicketInput(
      'https://company.freshdesk.com/dashboard/8812',
      opts,
    );
    expect(result.ok).toBe(false);
  });

  it('documents supported path patterns', () => {
    expect(supportedTicketPathPatterns().length).toBeGreaterThanOrEqual(3);
  });
});

describe('extractFreshdeskHostname / buildTicketKey', () => {
  it('extracts hostname from account URL', () => {
    expect(extractFreshdeskHostname('https://company.freshdesk.com')).toBe(
      'company.freshdesk.com',
    );
  });

  it('builds stable ticket keys', () => {
    expect(buildTicketKey('Company.Freshdesk.com', 8812)).toBe('company.freshdesk.com:8812');
  });
});
