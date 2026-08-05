/** Prompt tests keep ticket data out of system instructions and bound stored history. */
import { describe, expect, it } from 'vitest';

import type { ChatHistoryMessage, SanitizedContext } from '@fth/protocol';

import { buildPromptMessages, selectRecentHistory, SYSTEM_INSTRUCTIONS } from '../src/ai/prompt';

function historyMessage(index: number, text = `message-${index}`): ChatHistoryMessage {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    ticketKey: 'company.freshdesk.com:8812',
    role: index % 2 === 0 ? 'user' : 'assistant',
    text,
    providerId: 'google',
    modelId: 'test-model',
    connectionKind: 'api-key',
    contextRevision: 1,
    createdAt: '2026-08-03T00:00:00.000Z',
  };
}

describe('AI prompt construction', () => {
  it('keeps sanitized ticket content in a user message', () => {
    const context = {
      ticketKey: 'company.freshdesk.com:8812',
      contextRevision: 1,
      subject: 'Sanitized subject',
      includePrivateNotes: false,
      redactionMap: {},
      messages: [],
      warnings: [],
      previewText: 'SANITIZED TICKET VALUE',
    } satisfies SanitizedContext;

    const messages = buildPromptMessages(context, [], 'What happened?');
    expect(SYSTEM_INSTRUCTIONS).not.toContain(context.previewText);
    expect(messages[0]).toMatchObject({ role: 'user' });
    expect(messages[0]?.content).toContain(context.previewText);
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'What happened?' });
  });

  it('selects only the newest history within count and character limits', () => {
    const history = Array.from({ length: 25 }, (_, index) => historyMessage(index));
    const selected = selectRecentHistory(history);
    expect(selected).toHaveLength(20);
    expect(selected[0]?.content).toBe('message-5');
    expect(selected.at(-1)?.content).toBe('message-24');

    expect(
      selectRecentHistory([historyMessage(1, '1234'), historyMessage(2, '5678')], 20, 5),
    ).toEqual([{ role: 'user', content: '5678' }]);
  });
});
