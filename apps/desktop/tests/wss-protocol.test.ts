/**
 * WSS protocol envelope and AiBrokerClient lifecycle tests.
 */
import { describe, expect, it, vi } from 'vitest';

import { PROTOCOL_VERSION, createWssEnvelope, wssMessageSchema } from '@fth/protocol';

import { MockBrokerAdapter } from '../src/websocket/mockBroker';
import { AiBrokerClient } from '../src/websocket/client';

function sampleContext(ticketKey = 'company.freshdesk.com:1') {
  return {
    ticketKey,
    contextRevision: 1,
    subject: 'x',
    includePrivateNotes: false,
    redactionMap: {},
    messages: [],
    warnings: [],
    previewText: 'x',
  };
}

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

  it('parses authentication failure results', () => {
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

  it('activates visibly mock mode on first connection', async () => {
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
    expect(client.isReady()).toBe(true);
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
    const context = sampleContext();
    const first = await client.sendChat({
      ticketKey: context.ticketKey,
      context,
      userMessage: 'one',
      clientRequestKey: key,
    });
    const second = await client.sendChat({
      ticketKey: context.ticketKey,
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

  it('waits for context.ack before completing a mock chat send', async () => {
    const client = new AiBrokerClient({
      url: '',
      deviceToken: '',
      clientVersion: '0.1.0',
      useMockBroker: true,
      allowInsecureWs: false,
    });
    await client.connect();
    const context = sampleContext();
    const result = await client.sendChat({
      ticketKey: context.ticketKey,
      context,
      userMessage: 'hello',
      clientRequestKey: '44444444-4444-4444-8444-444444444444',
    });
    expect(result.ok).toBe(true);
  });

  it('reconnects atomically when switching from real URL config into mock mode', async () => {
    const client = new AiBrokerClient({
      url: 'wss://example.invalid/ws',
      deviceToken: 'token',
      clientVersion: '0.1.0',
      useMockBroker: false,
      allowInsecureWs: false,
      authTimeoutMs: 200,
    });
    await client.connect();
    await client.configure({ useMockBroker: true });
    expect(client.getStatus().mockMode).toBe(true);
    expect(client.isReady()).toBe(true);
  });

  it('does not leave a mock adapter active when switching to a real endpoint config', async () => {
    const client = new AiBrokerClient({
      url: '',
      deviceToken: 'token',
      clientVersion: '0.1.0',
      useMockBroker: true,
      allowInsecureWs: false,
      authTimeoutMs: 200,
    });
    await client.connect();
    expect(client.getStatus().mockMode).toBe(true);

    await client.configure({
      useMockBroker: false,
      url: 'wss://127.0.0.1:1/ws',
    });
    expect(client.getStatus().mockMode).toBe(false);
    client.disconnect();
  });

  it('times out context acknowledgement when ack never arrives', async () => {
    const client = new AiBrokerClient({
      url: '',
      deviceToken: '',
      clientVersion: '0.1.0',
      useMockBroker: true,
      allowInsecureWs: false,
      contextAckTimeoutMs: 50,
    });
    await client.connect();

    // Replace mock with a stub that never emits context.ack.
    (client as unknown as { mock: { handle: () => void; dispose: () => void } }).mock = {
      handle: () => undefined,
      dispose: () => undefined,
    };

    const context = sampleContext();
    const result = await client.sendChat({
      ticketKey: context.ticketKey,
      context,
      userMessage: 'hello',
      clientRequestKey: '55555555-5555-4555-8555-555555555555',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/context\.ack timed out/i);
    }
  });

  it('rejects sendChat when ticketKey does not match sanitized context', async () => {
    const client = new AiBrokerClient({
      url: '',
      deviceToken: '',
      clientVersion: '0.1.0',
      useMockBroker: true,
      allowInsecureWs: false,
    });
    await client.connect();
    const context = sampleContext('company.freshdesk.com:1');
    const result = await client.sendChat({
      ticketKey: 'company.freshdesk.com:2',
      context,
      userMessage: 'hello',
      clientRequestKey: '66666666-6666-4666-8666-666666666666',
    });
    expect(result.ok).toBe(false);
  });

  it('never silently falls back to mock on a failed real connection', async () => {
    const client = new AiBrokerClient({
      url: 'wss://127.0.0.1:1/ws',
      deviceToken: 'token',
      clientVersion: '0.1.0',
      useMockBroker: false,
      allowInsecureWs: false,
      authTimeoutMs: 300,
    });
    const status = await client.connect();
    expect(status.mockMode).toBe(false);
    expect(['error', 'connecting', 'reconnecting', 'authenticating', 'disconnected']).toContain(
      status.state,
    );
    client.disconnect();
  });
});
