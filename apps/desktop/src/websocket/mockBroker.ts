/**
 * In-process mock AI broker used when the real VPS endpoint is unavailable.
 * Emits visibly distinct mock responses so agents never confuse it with production AI.
 */
import { createWssEnvelope, type WssMessage } from '@fth/protocol';

export type MockBrokerAdapterOptions = {
  onMessage: (message: WssMessage) => void;
};

export class MockBrokerAdapter {
  private readonly onMessage: (message: WssMessage) => void;
  private readonly timers = new Set<NodeJS.Timeout>();
  private cancelled = new Set<string>();

  constructor(options: MockBrokerAdapterOptions) {
    this.onMessage = options.onMessage;
  }

  handle(message: WssMessage): void {
    switch (message.type) {
      case 'auth': {
        // Mock always accepts auth so onboarding can be tested offline.
        this.emit(
          createWssEnvelope('auth.result', {
            requestId: message.requestId,
            ticketKey: null,
            payload: { ok: true, sessionId: 'mock-session' },
          }),
        );
        break;
      }
      case 'context.sync': {
        this.emit(
          createWssEnvelope('context.ack', {
            requestId: message.requestId,
            ticketKey: message.ticketKey,
            payload: { contextRevision: message.payload.contextRevision },
          }),
        );
        break;
      }
      case 'chat.request': {
        this.simulateChat(message);
        break;
      }
      case 'chat.cancel': {
        this.cancelled.add(message.requestId);
        break;
      }
      case 'ping': {
        this.emit(
          createWssEnvelope('pong', {
            requestId: message.requestId,
            ticketKey: message.ticketKey,
            payload: { nonce: message.payload.nonce },
          }),
        );
        break;
      }
      default:
        break;
    }
  }

  dispose(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private simulateChat(message: Extract<WssMessage, { type: 'chat.request' }>): void {
    const requestId = message.requestId;
    const ticketKey = message.ticketKey;

    this.emit(
      createWssEnvelope('chat.queued', {
        requestId,
        ticketKey,
        payload: { position: 0 },
      }),
    );

    const chunks = [
      '[MOCK BROKER] ',
      'This is a simulated streaming reply. ',
      'Connect a real wss:// endpoint and disable mock mode to use the VPS broker. ',
      `You asked: "${truncate(message.payload.userMessage, 120)}"`,
    ];

    let sequence = 0;
    let accumulated = '';

    chunks.forEach((chunk, index) => {
      const timer = setTimeout(() => {
        if (this.cancelled.has(requestId)) {
          return;
        }
        accumulated += chunk;
        this.emit(
          createWssEnvelope('chat.delta', {
            requestId,
            ticketKey,
            payload: { sequence, text: chunk },
          }),
        );
        sequence += 1;

        if (index === chunks.length - 1) {
          this.emit(
            createWssEnvelope('chat.completed', {
              requestId,
              ticketKey,
              payload: { text: accumulated, sequenceEnd: sequence - 1 },
            }),
          );
        }
      }, 200 + index * 250);
      this.timers.add(timer);
    });
  }

  private emit(message: WssMessage): void {
    this.onMessage(message);
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
