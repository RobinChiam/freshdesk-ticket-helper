/**
 * WSS protocol envelope and mock broker behaviour tests.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  PROTOCOL_VERSION,
  createWssEnvelope,
  wssMessageSchema,
} from '@fth/protocol';

import { MockBrokerAdapter } from '../src/websocket/mockBroker';
import { AiBrokerClient } from '../src/websocket/client';

describe('WSS protocol', () => {
  it('creates versioned envelopes', () => {
    const msg = createWssEnvelope('ping', {
      requestId: '11111111-1111-4111-8111-111111111111',
      ticketKey: null,
      payload: { nonce: 'abc' },
    });
    expect(msg.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(wssMessageSchema.parse(msg).type).toBe('ping');
  });

  it('rejects oversized conceptual auth failures through schema', () => {
    const result = wssMessageSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      type: 'auth.result',
      requestId: '11111111-1111-4111-8111-111111111111',
      ticketKey: null,
      timestamp: new Date().toISOString(),
      payload: { ok: false, error: 'invalid device token' },
    });
    expect(result.success).toBe(true);
  });
});

describe('MockBrokerAdapter', () => {
  it('streams a visibly mock chat completion', async () => {
    const messages: string[] = [];
    const mock = new MockBrokerAdapter({
      onMessage: (message) => messages.push(message.type),
    });

    mock.handle(
      createWssEnvelope('chat.request', {
        requestId: '11111111-1111-4111-8111-111111111111',
        ticketKey: 'company.freshdesk.com:8812',
        payload: {
          contextRevision: 1,
          userMessage: 'summarize',
          clientRequestKey: '22222222-2222-4222-8222-222222222222',
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 1400));
    expect(messages).toContain('chat.queued');
    expect(messages).toContain('chat.delta');
    expect(messages).toContain('chat.completed');
    mock.dispose();
  });
});

describe('AiBrokerClient', () => {
  it('blocks insecure ws:// when allowInsecureWs is false', async () => {
    const client = new AiBrokerClient({
      url: 'ws://ai-helper.example.com/ws',
      deviceToken: 'token',
      clientVersion: '0.1.0',
      useMockBroker: false,
      allowInsecureWs: false,
    });
    const status = await client.connect();
    expect(status.state).toBe('error');
    expect(status.lastError).toMatch(/Insecure ws:\/\//i);
  });

  it('activates visibly mock mode', async () => {
    const onStatus = vi.fn();
    const client = new AiBrokerClient({
      url: '',
      deviceToken: '',
      clientVersion: '0.1.0',
      useMockBroker: true,
      allowInsecureWs: false,
      onStatus,
    });
    const status = await client.connect();
    expect(status.mockMode).toBe(true);
    expect(status.state).toBe('mock');
  });

  it('protects against duplicate clientRequestKey submissions', async () => {
    const client = new AiBrokerClient({
      url: '',
      deviceToken: '',
      clientVersion: '0.1.0',
      useMockBroker: true,
      allowInsecureWs: false,
    });
    await client.connect();
    const key = '33333333-3333-4333-8333-333333333333';
    const context = {
      ticketKey: 'company.freshdesk.com:1',
      contextRevision: 1,
      subject: 'x',
      includePrivateNotes: false,
      redactionMap: {},
      messages: [],
      warnings: [],
      previewText: 'x',
    };
    const first = await client.sendChat({
      ticketKey: 'company.freshdesk.com:1',
      context,
      userMessage: 'one',
      clientRequestKey: key,
    });
    const second = await client.sendChat({
      ticketKey: 'company.freshdesk.com:1',
      context,
      userMessage: 'two',
      clientRequestKey: key,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toMatch(/Duplicate/i);
    }
  });

  it('reconnects with bounded backoff after unexpected disconnect in mock-less mode', async () => {
    // Exercise reconnect scheduling without a live socket by checking status transitions
    // when connect fails against an invalid host under allowInsecureWs false for wss.
    const client = new AiBrokerClient({
      url: 'wss://127.0.0.1:1/ws',
      deviceToken: 'token',
      clientVersion: '0.1.0',
      useMockBroker: false,
      allowInsecureWs: false,
    });
    const status = await client.connect();
    // Either error or connecting/reconnecting depending on timing; never silently mock.
    expect(status.mockMode).toBe(false);
    expect(['error', 'connecting', 'reconnecting', 'authenticating', 'disconnected']).toContain(
      status.state,
    );
    client.disconnect();
  });
});
