/** Main-process ticket state must not trust ticket text echoed back by the renderer. */
import { describe, expect, it } from 'vitest';

import type { TicketDetail } from '@fth/protocol';

import { TrustedTicketState } from '../src/main/trustedTicketState';

function ticket(): TicketDetail {
  return {
    ticketKey: 'company.freshdesk.com:8812',
    id: 8812,
    subject: 'Original subject',
    descriptionText: 'Original description',
    status: 2,
    priority: 2,
    requesterId: 1,
    responderId: 2,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    fetchedAt: '2026-08-03T00:00:00.000Z',
    conversations: [
      {
        id: 9,
        bodyText: 'Internal detail',
        createdAt: '2026-08-03T00:00:00.000Z',
        private: true,
        incoming: false,
        role: 'agent',
        fromEmail: null,
        supportEmail: null,
      },
    ],
  };
}

describe('TrustedTicketState', () => {
  it('builds provider context from the main-process ticket and enforces revisions', () => {
    const state = new TrustedTicketState();
    state.rememberTicket(ticket());

    const context = state.buildContext(ticket().ticketKey, false, 4);
    expect(context?.previewText).toContain('Original subject');
    expect(context?.previewText).toContain('[INTERNAL_NOTE excluded from AI context]');
    expect(context?.previewText).not.toContain('Internal detail');
    expect(state.getContext(ticket().ticketKey, 3)).toBeNull();
    expect(state.getContext(ticket().ticketKey, 4)).toEqual(context);
  });

  it('requires a ticket fetched by main before building context', () => {
    const state = new TrustedTicketState();
    expect(state.buildContext(ticket().ticketKey, false, 1)).toBeNull();
  });
});
