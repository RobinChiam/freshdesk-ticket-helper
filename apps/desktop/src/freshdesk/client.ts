/**
 * Freshdesk REST API v2 client (read-only for this prototype).
 * Runs only in the Electron main process — never from the renderer.
 */
import type { ConversationMessage, TicketDetail } from '@fth/protocol';

import { buildTicketKey } from './ticketUrl.js';

export type FreshdeskClientOptions = {
  /** Account base URL such as https://company.freshdesk.com */
  accountUrl: string;
  apiKey: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Test-only: allow http:// for a local mock server.
   * Production callers must never set this — HTTPS is required before Authorization is sent.
   */
  allowInsecureHttpForTests?: boolean;
};

export type FreshdeskErrorCode = 'permission_denied' | 'not_found' | 'network_error' | 'unknown';

export class FreshdeskApiError extends Error {
  readonly code: FreshdeskErrorCode;
  readonly status?: number;

  constructor(code: FreshdeskErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'FreshdeskApiError';
    this.code = code;
    this.status = status;
  }
}

type RawTicket = {
  id: number;
  subject?: string;
  description_text?: string;
  description?: string;
  status?: number | string;
  priority?: number | string;
  requester_id?: number | null;
  responder_id?: number | null;
  created_at?: string;
  updated_at?: string;
};

type RawConversation = {
  id: number;
  body_text?: string;
  body?: string;
  incoming?: boolean;
  private?: boolean;
  created_at?: string;
  from_email?: string | null;
  support_email?: string | null;
  user_id?: number | null;
};

/**
 * Minimal read-only Freshdesk v2 client.
 * Writes (replies/notes) are intentionally not implemented in the prototype.
 */
export class FreshdeskClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  readonly hostname: string;

  constructor(options: FreshdeskClientOptions) {
    const url = new URL(options.accountUrl);
    // Reject HTTP before any Authorization header is constructed or sent.
    if (url.protocol !== 'https:' && !options.allowInsecureHttpForTests) {
      throw new FreshdeskApiError(
        'unknown',
        'Freshdesk account URL must use https:// before API credentials are sent.',
      );
    }
    if (
      options.allowInsecureHttpForTests &&
      url.protocol !== 'http:' &&
      url.protocol !== 'https:'
    ) {
      throw new FreshdeskApiError('unknown', 'Unsupported Freshdesk URL scheme.');
    }
    this.baseUrl = `${url.protocol}//${url.host}`;
    this.hostname = url.hostname.toLowerCase();
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Lightweight connectivity check using the authenticated agent profile. */
  async testConnection(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
    try {
      await this.requestJson('/api/v2/agents/me');
      return { ok: true, message: 'Freshdesk connection succeeded.' };
    } catch (error) {
      return { ok: false, error: sanitizeFreshdeskError(error) };
    }
  }

  /** Fetch ticket metadata plus every conversation page. */
  async fetchTicket(ticketId: number): Promise<TicketDetail> {
    const ticket = await this.requestJson<RawTicket>(`/api/v2/tickets/${ticketId}`);
    const conversations = await this.fetchAllConversations(ticketId);

    return {
      ticketKey: buildTicketKey(this.hostname, ticketId),
      id: ticket.id,
      subject: ticket.subject ?? `(Ticket #${ticketId})`,
      descriptionText: pickPlainText(ticket.description_text, ticket.description),
      status: ticket.status ?? 'unknown',
      priority: ticket.priority ?? 'unknown',
      requesterId: ticket.requester_id ?? null,
      responderId: ticket.responder_id ?? null,
      createdAt: ticket.created_at ?? new Date(0).toISOString(),
      updatedAt: ticket.updated_at ?? new Date(0).toISOString(),
      conversations: conversations.map(mapConversation),
      fetchedAt: new Date().toISOString(),
    };
  }

  private async fetchAllConversations(ticketId: number): Promise<RawConversation[]> {
    const pageSize = 100;
    let page = 1;
    const all: RawConversation[] = [];

    // Freshdesk paginates conversations; keep requesting until a short page arrives.
    for (;;) {
      const batch = await this.requestJson<RawConversation[]>(
        `/api/v2/tickets/${ticketId}/conversations?page=${page}&per_page=${pageSize}`,
      );
      all.push(...batch);
      if (batch.length < pageSize) {
        break;
      }
      page += 1;
      if (page > 50) {
        throw new FreshdeskApiError(
          'unknown',
          'Conversation pagination exceeded safety limit (50 pages).',
        );
      }
    }

    return all;
  }

  private async requestJson<T>(path: string): Promise<T> {
    const auth = Buffer.from(`${this.apiKey}:X`).toString('base64');
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
    } catch {
      throw new FreshdeskApiError(
        'network_error',
        'Unable to reach Freshdesk. Check network connectivity and the account URL.',
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new FreshdeskApiError(
        'permission_denied',
        'Freshdesk denied access. Check the API key and ticket permissions.',
        response.status,
      );
    }
    if (response.status === 404) {
      throw new FreshdeskApiError(
        'not_found',
        'Ticket was not found in Freshdesk.',
        response.status,
      );
    }
    if (!response.ok) {
      throw new FreshdeskApiError(
        'unknown',
        `Freshdesk request failed with status ${response.status}.`,
        response.status,
      );
    }

    return (await response.json()) as T;
  }
}

function mapConversation(raw: RawConversation): ConversationMessage {
  const incoming = Boolean(raw.incoming);
  const isPrivate = Boolean(raw.private);
  let role: ConversationMessage['role'] = 'unknown';
  if (incoming) {
    role = 'requester';
  } else if (isPrivate || raw.user_id != null) {
    role = 'agent';
  }

  return {
    id: raw.id,
    bodyText: pickPlainText(raw.body_text, raw.body),
    createdAt: raw.created_at ?? new Date(0).toISOString(),
    private: isPrivate,
    incoming,
    role,
    fromEmail: raw.from_email ?? null,
    supportEmail: raw.support_email ?? null,
  };
}

/** Prefer Freshdesk plain-text fields; fall back to stripping tags from HTML. */
function pickPlainText(text: string | undefined, html: string | undefined): string {
  if (text && text.trim()) {
    return text;
  }
  if (html && html.trim()) {
    return stripTags(html);
  }
  return '';
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Never echo API keys or Authorization headers in user-facing errors. */
export function sanitizeFreshdeskError(error: unknown): string {
  if (error instanceof FreshdeskApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message.replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [REDACTED]');
  }
  return 'Unexpected Freshdesk error.';
}
