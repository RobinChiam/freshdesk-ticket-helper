/**
 * Freshdesk client mapping tests with a fake fetch implementation.
 */
import { describe, expect, it } from 'vitest';

import { FreshdeskClient } from '../src/freshdesk/client';
import type { FreshdeskApiError } from '../src/freshdesk/client';

describe('FreshdeskClient', () => {
  it('maps private and public conversations', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/tickets/10') && !url.includes('conversations')) {
        return new Response(
          JSON.stringify({
            id: 10,
            subject: 'Subject',
            description_text: 'Desc',
            status: 2,
            priority: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify([
          {
            id: 1,
            body_text: 'public',
            incoming: true,
            private: false,
            created_at: '2026-01-01T01:00:00Z',
          },
          {
            id: 2,
            body_text: 'private',
            incoming: false,
            private: true,
            created_at: '2026-01-01T02:00:00Z',
            user_id: 9,
          },
        ]),
        { status: 200 },
      );
    };

    const client = new FreshdeskClient({
      accountUrl: 'https://company.freshdesk.com',
      apiKey: 'test-key',
      fetchImpl,
    });
    const ticket = await client.fetchTicket(10);
    expect(ticket.conversations).toHaveLength(2);
    expect(ticket.conversations[0]?.private).toBe(false);
    expect(ticket.conversations[1]?.private).toBe(true);
    expect(ticket.conversations[1]?.role).toBe('agent');
  });

  it('maps missing permission to permission_denied', async () => {
    const fetchImpl: typeof fetch = async () => new Response('denied', { status: 403 });
    const client = new FreshdeskClient({
      accountUrl: 'https://company.freshdesk.com',
      apiKey: 'test-key',
      fetchImpl,
    });
    await expect(client.fetchTicket(1)).rejects.toMatchObject({
      code: 'permission_denied',
    } satisfies Partial<FreshdeskApiError>);
  });

  it('rejects http Freshdesk account URLs before Authorization is used', async () => {
    expect(
      () =>
        new FreshdeskClient({
          accountUrl: 'http://company.freshdesk.com',
          apiKey: 'test-key',
        }),
    ).toThrow(/https/i);
  });

  it('allows explicit test-only http injection for local mock servers', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ id: 1 }), { status: 200 });
    const client = new FreshdeskClient({
      accountUrl: 'http://127.0.0.1:9',
      apiKey: 'test-key',
      fetchImpl,
      allowInsecureHttpForTests: true,
    });
    await expect(client.testConnection()).resolves.toMatchObject({ ok: true });
  });

  it('maps network failures without echoing credentials', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    const client = new FreshdeskClient({
      accountUrl: 'https://company.freshdesk.com',
      apiKey: 'super-secret-key',
      fetchImpl,
    });
    await expect(client.testConnection()).resolves.toMatchObject({ ok: false });
    const result = await client.testConnection();
    if (!result.ok) {
      expect(result.error).not.toContain('super-secret-key');
    }
  });
});
