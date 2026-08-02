/**
 * Cross-ticket context leakage prevention tests.
 */
import { describe, expect, it } from 'vitest';

import { chatSendInputSchema } from '@fth/protocol';

import { canSendWithContext, selectSanitizedForTicket } from '../src/renderer/ticketContextGuard';

const contextA = {
  ticketKey: 'company.freshdesk.com:100',
  contextRevision: 1,
  subject: 'Ticket A',
  includePrivateNotes: false,
  redactionMap: {},
  messages: [],
  warnings: [],
  previewText: 'A',
};

const contextB = {
  ...contextA,
  ticketKey: 'company.freshdesk.com:200',
  contextRevision: 2,
  subject: 'Ticket B',
  previewText: 'B',
};

describe('ticket context identity', () => {
  it('clears previous sanitized context when the selected ticket changes', () => {
    expect(selectSanitizedForTicket('company.freshdesk.com:200', contextA)).toBeNull();
    expect(selectSanitizedForTicket('company.freshdesk.com:200', contextB)?.previewText).toBe('B');
  });

  it('disables send until sanitized context matches the current ticket', () => {
    expect(canSendWithContext('company.freshdesk.com:200', contextA)).toBe(false);
    expect(canSendWithContext('company.freshdesk.com:200', contextB)).toBe(true);
    expect(canSendWithContext('company.freshdesk.com:200', null)).toBe(false);
  });

  it('rejects chat payloads that mix ticket B identity with ticket A context', () => {
    const result = chatSendInputSchema.safeParse({
      ticketKey: 'company.freshdesk.com:200',
      contextRevision: 2,
      sanitizedContext: contextA,
      userMessage: 'summarize',
      clientRequestKey: '33333333-3333-4333-8333-333333333333',
    });
    expect(result.success).toBe(false);
  });

  it('rejects mismatched contextRevision even when ticketKey matches', () => {
    const result = chatSendInputSchema.safeParse({
      ticketKey: 'company.freshdesk.com:200',
      contextRevision: 99,
      sanitizedContext: contextB,
      userMessage: 'summarize',
      clientRequestKey: '33333333-3333-4333-8333-333333333333',
    });
    expect(result.success).toBe(false);
  });

  it('accepts aligned ticketKey and contextRevision', () => {
    const result = chatSendInputSchema.safeParse({
      ticketKey: 'company.freshdesk.com:200',
      contextRevision: 2,
      sanitizedContext: contextB,
      userMessage: 'summarize',
      clientRequestKey: '33333333-3333-4333-8333-333333333333',
    });
    expect(result.success).toBe(true);
  });
});
