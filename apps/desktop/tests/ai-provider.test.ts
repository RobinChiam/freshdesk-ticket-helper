/** Provider service tests use a fake runtime and never make billable network requests. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatEvent, ChatSendInput } from '@fth/protocol';

import { AiProviderService } from '../src/ai/providerService';
import {
  sanitizeProviderError,
  type ProviderRuntime,
  type StreamRequest,
} from '../src/ai/providerRuntime';
import { openAppDatabase, type AppDatabase } from '../src/database';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function database(): AppDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'fth-provider-test-'));
  tempDirs.push(dir);
  return openAppDatabase(join(dir, 'state.sqlite'));
}

function input(clientRequestKey = '33333333-3333-4333-8333-333333333333'): ChatSendInput {
  return {
    ticketKey: 'company.freshdesk.com:8812',
    contextRevision: 1,
    sanitizedContext: {
      ticketKey: 'company.freshdesk.com:8812',
      contextRevision: 1,
      subject: 'Help',
      includePrivateNotes: false,
      redactionMap: {},
      messages: [],
      warnings: [],
      previewText: 'sanitized ticket',
    },
    userMessage: 'summarize',
    clientRequestKey,
  };
}

const config = {
  kind: 'api-key' as const,
  providerId: 'google' as const,
  modelId: 'test-model',
  customBaseUrl: '',
  apiKey: 'test-only-key',
};

function waitForTerminalEvent(events: ChatEvent[]): Promise<ChatEvent> {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const terminal = events.find((event) =>
        ['completed', 'failed', 'cancelled'].includes(event.type),
      );
      if (terminal) {
        clearInterval(interval);
        resolve(terminal);
      }
    }, 5);
  });
}

describe('AiProviderService', () => {
  it('streams events and persists complete user/assistant messages per ticket', async () => {
    const db = database();
    const events: ChatEvent[] = [];
    const runtime: ProviderRuntime = {
      async *stream() {
        yield 'Hello ';
        yield 'world';
      },
      test: vi.fn(async () => undefined),
    };
    const service = new AiProviderService({ db, runtime, onEvent: (event) => events.push(event) });
    service.start(input(), config, 'summarize');
    await waitForTerminalEvent(events);

    expect(events.map((event) => event.type)).toEqual(['started', 'delta', 'delta', 'completed']);
    expect(events.every((event) => event.ticketKey === input().ticketKey)).toBe(true);
    expect(
      db.listChatMessages(input().ticketKey).map((message) => [message.role, message.text]),
    ).toEqual([
      ['user', 'summarize'],
      ['assistant', 'Hello world'],
    ]);
    db.close();
  });

  it('rejects duplicate client request keys', async () => {
    const db = database();
    const events: ChatEvent[] = [];
    const runtime: ProviderRuntime = {
      async *stream() {
        yield 'ok';
      },
      test: async () => undefined,
    };
    const service = new AiProviderService({ db, runtime, onEvent: (event) => events.push(event) });
    service.start(input(), config, 'one');
    expect(() => service.start(input(), config, 'two')).toThrow(/already submitted/i);
    await waitForTerminalEvent(events);
    db.close();
  });

  it('does not persist a partial assistant response after cancellation', async () => {
    const db = database();
    const events: ChatEvent[] = [];
    const runtime: ProviderRuntime = {
      async *stream(request: StreamRequest) {
        yield 'partial';
        await new Promise<void>((resolve) =>
          request.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        throw new DOMException('Aborted', 'AbortError');
      },
      test: async () => undefined,
    };
    const service = new AiProviderService({ db, runtime, onEvent: (event) => events.push(event) });
    const { requestId } = service.start(input(), config, 'question');
    await new Promise((resolve) => setTimeout(resolve, 10));
    service.cancel(requestId);
    await waitForTerminalEvent(events);
    expect(events.at(-1)?.type).toBe('cancelled');
    expect(db.listChatMessages(input().ticketKey).map((message) => message.role)).toEqual(['user']);
    db.close();
  });
});

describe('sanitizeProviderError', () => {
  it('maps status categories without exposing provider response text', () => {
    expect(sanitizeProviderError({ statusCode: 401, message: 'secret response' })).toEqual({
      code: 'authentication_failed',
      error: 'The provider rejected the API key or account permissions.',
    });
    expect(JSON.stringify(sanitizeProviderError(new Error('api-key=do-not-echo')))).not.toContain(
      'do-not-echo',
    );
  });
});
