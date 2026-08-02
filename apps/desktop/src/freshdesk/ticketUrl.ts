/**
 * Freshdesk ticket URL / ID parsing.
 * Uses the URL API only — never scrapes or embeds the Freshdesk website.
 */
export type TicketParseSuccess = {
  ok: true;
  ticketId: number;
  source: 'id' | 'url';
};

export type TicketParseFailure = {
  ok: false;
  error: string;
};

export type TicketParseOutcome = TicketParseSuccess | TicketParseFailure;

export type ParseTicketInputOptions = {
  /** Canonical API/account hostname, e.g. company.freshdesk.com */
  apiHostname: string;
  /** Extra allowed UI hostnames (custom domains, regional portals). */
  allowedUiHosts?: string[];
};

/** Documented Freshdesk ticket path patterns we accept. */
const TICKET_PATH_PATTERNS: RegExp[] = [
  /^\/a\/tickets\/(\d+)(?:\/|$)/i,
  /^\/helpdesk\/tickets\/(\d+)(?:\/|$)/i,
  /^\/tickets\/(\d+)(?:\/|$)/i,
];

const PLAIN_ID = /^\d{1,12}$/;

/**
 * Extract a positive ticket ID from a plain ID or a Freshdesk ticket URL.
 * Rejects unexpected schemes, URL credentials, unknown hosts, and unknown paths.
 */
export function parseTicketInput(
  raw: string,
  options: ParseTicketInputOptions,
): TicketParseOutcome {
  const input = raw.trim();
  if (!input) {
    return { ok: false, error: 'Ticket input is empty.' };
  }

  if (PLAIN_ID.test(input)) {
    const ticketId = Number(input);
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      return { ok: false, error: 'Ticket ID must be a positive integer.' };
    }
    return { ok: true, ticketId, source: 'id' };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return {
      ok: false,
      error: 'Unrecognized ticket input. Use a numeric ID or a Freshdesk ticket URL.',
    };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'Ticket URL must use http or https.' };
  }

  // URL credentials (user:pass@host) must never be accepted — they can leak into logs.
  if (url.username || url.password) {
    return { ok: false, error: 'Ticket URL must not include username or password credentials.' };
  }

  const hostname = url.hostname.toLowerCase();
  const allowed = buildAllowedHosts(options.apiHostname, options.allowedUiHosts);
  if (!allowed.has(hostname)) {
    return {
      ok: false,
      error: `Ticket URL host "${hostname}" is not in the configured Freshdesk host allowlist.`,
    };
  }

  for (const pattern of TICKET_PATH_PATTERNS) {
    const match = pattern.exec(url.pathname);
    if (match?.[1]) {
      const ticketId = Number(match[1]);
      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return { ok: false, error: 'Ticket ID in URL must be a positive integer.' };
      }
      return { ok: true, ticketId, source: 'url' };
    }
  }

  return {
    ok: false,
    error:
      'Ticket URL path is not a supported Freshdesk ticket path. Expected /a/tickets/{id}, /helpdesk/tickets/{id}, or /tickets/{id}.',
  };
}

/** Normalize account URL into hostname for API calls and allowlisting. */
export function extractFreshdeskHostname(accountUrl: string): string | null {
  try {
    const url = new URL(accountUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Build ticketKey as host:id for stable cross-layer identity. */
export function buildTicketKey(hostname: string, ticketId: number): string {
  return `${hostname.toLowerCase()}:${ticketId}`;
}

function buildAllowedHosts(apiHostname: string, extra: string[] = []): Set<string> {
  const set = new Set<string>();
  const api = apiHostname.trim().toLowerCase();
  if (api) {
    set.add(api);
  }
  for (const host of extra) {
    const normalized = host.trim().toLowerCase();
    if (normalized) {
      set.add(normalized);
    }
  }
  return set;
}

/** Exported for documentation/tests — the supported path patterns. */
export function supportedTicketPathPatterns(): string[] {
  return [
    '/a/tickets/{id}',
    '/helpdesk/tickets/{id}',
    '/tickets/{id}',
  ];
}
