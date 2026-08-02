/**
 * Sanitizer tests: HTML stripping, redaction, private-note visibility, quoted history.
 */
import { describe, expect, it } from 'vitest';

import type { TicketDetail } from '@fth/protocol';

import { buildSanitizedContext } from '../src/sanitizer/index';
import { htmlToPlainText } from '../src/sanitizer/htmlToText';
import { redactSensitiveValues } from '../src/sanitizer/redact';
import { stripQuotedEmailHistory } from '../src/sanitizer/quotedHistory';

function sampleTicket(): TicketDetail {
  return {
    ticketKey: 'company.freshdesk.com:8812',
    id: 8812,
    subject: 'Help <b>please</b>',
    descriptionText:
      'Email me at person@example.com or call +1 555-010-9988. Token Bearer abcdefghijklmnopqrstuvwxyz012345',
    status: 2,
    priority: 1,
    requesterId: 1,
    responderId: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    conversations: [
      {
        id: 10,
        bodyText:
          'Public reply.\n\nOn Mon, someone wrote:\n> old quoted history that should be removed',
        createdAt: '2026-01-01T01:00:00.000Z',
        private: false,
        incoming: false,
        role: 'agent',
        fromEmail: 'agent@example.com',
        supportEmail: null,
      },
      {
        id: 11,
        bodyText: 'Secret internal plan. Card 4111111111111111',
        createdAt: '2026-01-01T02:00:00.000Z',
        private: true,
        incoming: false,
        role: 'agent',
        fromEmail: 'agent@example.com',
        supportEmail: null,
      },
    ],
    fetchedAt: '2026-01-01T03:00:00.000Z',
  };
}

describe('htmlToPlainText', () => {
  it('strips scripts and styles', () => {
    const text = htmlToPlainText(
      '<p>Hello</p><script>alert(1)</script><style>.x{}</style><img src="https://x/track.gif">',
    );
    expect(text).toContain('Hello');
    expect(text.toLowerCase()).not.toContain('alert');
    expect(text.toLowerCase()).not.toContain('track.gif');
  });

  it('drops javascript URLs', () => {
    const text = htmlToPlainText('<a href="javascript:alert(1)">click</a>');
    expect(text.toLowerCase()).not.toContain('javascript:');
  });
});

describe('redactSensitiveValues', () => {
  it('redacts emails, phones, tokens, and card-like numbers', () => {
    const state = { map: {}, counters: {} };
    const { text } = redactSensitiveValues(
      'mail user@example.com phone +1 555-010-9988 card 4111111111111111 token Bearer abcdefghijklmnopqrstuvwxyz012345',
      state,
    );
    expect(text).toContain('[CUSTOMER_EMAIL_1]');
    expect(text).toContain('[PHONE_NUMBER_1]');
    expect(text).toContain('[PAYMENT_CARD_1]');
    expect(text).toContain('[AUTH_TOKEN_1]');
    expect(text).not.toContain('user@example.com');
    expect(Object.values(state.map)).not.toContain('user@example.com');
  });
});

describe('stripQuotedEmailHistory', () => {
  it('cuts at original message markers', () => {
    const result = stripQuotedEmailHistory('New text\n\nOn Mon, Alex wrote:\n> old');
    expect(result).toBe('New text');
  });
});

describe('buildSanitizedContext', () => {
  it('excludes private notes by default labeling', () => {
    const context = buildSanitizedContext({
      ticket: sampleTicket(),
      includePrivateNotes: false,
      contextRevision: 1,
    });
    const internal = context.messages.find((m) => m.id === 11);
    expect(internal?.visibility).toBe('EXCLUDED_INTERNAL_NOTE');
    expect(context.previewText).toContain('INCLUDE_PRIVATE_NOTES: no');
  });

  it('labels included private notes as INTERNAL_NOTE and warns', () => {
    const context = buildSanitizedContext({
      ticket: sampleTicket(),
      includePrivateNotes: true,
      contextRevision: 2,
    });
    const internal = context.messages.find((m) => m.id === 11);
    expect(internal?.visibility).toBe('INTERNAL_NOTE');
    expect(internal?.text).toContain('[PAYMENT_CARD_');
    expect(context.warnings[0]).toMatch(/Private\/internal notes/i);
  });

  it('preserves message order and roles', () => {
    const context = buildSanitizedContext({
      ticket: sampleTicket(),
      includePrivateNotes: true,
      contextRevision: 3,
    });
    expect(context.messages.map((m) => m.id)).toEqual([0, 10, 11]);
    expect(context.messages[1]?.role).toBe('agent');
  });
});
