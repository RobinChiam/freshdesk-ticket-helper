/**
 * Typed authenticated WSS client for the VPS AI broker.
 * Lives exclusively in the Electron main process.
 */
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

import {
  MAX_WSS_MESSAGE_BYTES,
  createWssEnvelope,
  wssMessageSchema,
  type ChatEvent,
  type ConnectionStatus,
  type SanitizedContext,
  type WssMessage,
} from '@fth/protocol';

import { MockBrokerAdapter } from './mockBroker.js';

export type WssClientOptions = {
  /** Public wss:// URL only — never an internal broker port like :8787. */
  url: string;
  deviceToken: string;
  clientVersion: string;
  /** Force mock mode (also used when URL is empty in development). */
  useMockBroker: boolean;
  /** Refuse insecure ws:// in packaged/production builds. */
  allowInsecureWs: boolean;
  onStatus?: (status: ConnectionStatus) => void;
  onChatEvent?: (event: ChatEvent) => void;
};

type PendingChat = {
  requestId: string;
  clientRequestKey: string;
  ticketKey: string;
};

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;
const HEARTBEAT_MS = 20_000;

/**
 * Manages connection lifecycle, auth, heartbeat, reconnect, and chat requests.
 * Duplicate clientRequestKey submissions are rejected locally.
 */
export class AiBrokerClient {
  private options: WssClientOptions;
  private socket: WebSocket | null = null;
  private mock: MockBrokerAdapter | null = null;
  private status: ConnectionStatus = {
    state: 'disconnected',
    mockMode: false,
    lastError: null,
    lastConnectedAt: null,
    queueDepth: 0,
  };
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private intentionalClose = false;
  private readonly seenRequestKeys = new Set<string>();
  private readonly pending = new Map<string, PendingChat>();
  private authenticated = false;

  constructor(options: WssClientOptions) {
    this.options = options;
  }

  getStatus(): ConnectionStatus {
    return { ...this.status };
  }

  /** Update connection settings; reconnects if already active. */
  configure(options: Partial<WssClientOptions>): void {
    this.options = { ...this.options, ...options };
  }

  async connect(): Promise<ConnectionStatus> {
    this.intentionalClose = false;

    if (this.options.useMockBroker) {
      return this.connectMock();
    }

    const url = this.options.url.trim();
    if (!url) {
      this.setStatus({
        state: 'error',
        mockMode: false,
        lastError: 'WSS URL is not configured.',
        queueDepth: 0,
      });
      return this.getStatus();
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      this.setStatus({
        state: 'error',
        mockMode: false,
        lastError: 'WSS URL is malformed.',
        queueDepth: 0,
      });
      return this.getStatus();
    }

    // Production builds must never silently fall back from WSS to insecure WS.
    if (parsed.protocol === 'ws:' && !this.options.allowInsecureWs) {
      this.setStatus({
        state: 'error',
        mockMode: false,
        lastError:
          'Insecure ws:// URLs are blocked in this build. Use wss:// or enable mock broker mode.',
        queueDepth: 0,
      });
      return this.getStatus();
    }

    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') {
      this.setStatus({
        state: 'error',
        mockMode: false,
        lastError: 'AI broker URL must use the wss: scheme.',
        queueDepth: 0,
      });
      return this.getStatus();
    }

    this.setStatus({
      state: this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
      mockMode: false,
      lastError: null,
      queueDepth: this.pending.size,
    });

    await new Promise<void>((resolve) => {
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.on('open', () => {
        this.setStatus({
          state: 'authenticating',
          mockMode: false,
          lastError: null,
          queueDepth: this.pending.size,
        });
        this.sendAuth();
        this.startHeartbeat();
        resolve();
      });

      socket.on('message', (data) => {
        this.handleIncoming(data);
      });

      socket.on('close', () => {
        this.stopHeartbeat();
        this.authenticated = false;
        if (!this.intentionalClose) {
          this.scheduleReconnect();
        } else {
          this.setStatus({
            state: 'disconnected',
            mockMode: false,
            lastError: null,
            queueDepth: this.pending.size,
          });
        }
      });

      socket.on('error', () => {
        // Details intentionally generic — avoid leaking URL query tokens in UI/logs.
        this.setStatus({
          state: 'error',
          mockMode: false,
          lastError: 'WebSocket connection error.',
          queueDepth: this.pending.size,
        });
        resolve();
      });
    });

    return this.getStatus();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnect();
    this.stopHeartbeat();
    this.mock?.dispose();
    this.mock = null;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.authenticated = false;
    this.setStatus({
      state: 'disconnected',
      mockMode: false,
      lastError: null,
      queueDepth: this.pending.size,
    });
  }

  async testConnection(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
    if (this.options.useMockBroker) {
      await this.connectMock();
      return { ok: true, message: 'Mock AI broker is active (no remote WSS).' };
    }

    if (!this.options.deviceToken.trim()) {
      return { ok: false, error: 'WSS device/pairing token is not configured.' };
    }

    await this.connect();
    if (this.status.state === 'authenticating' || this.status.state === 'connecting') {
      // Wait briefly for auth.result during the test.
      await sleep(1500);
    }
    if (this.status.state === 'connected' || this.status.state === 'mock') {
      return { ok: true, message: 'AI broker connection and authentication succeeded.' };
    }
    return {
      ok: false,
      error: this.status.lastError ?? 'AI broker connection failed.',
    };
  }

  /**
   * Sync sanitized context then send a chat request.
   * Rejects duplicate clientRequestKey values to protect against double-submit.
   */
  async sendChat(args: {
    ticketKey: string;
    context: SanitizedContext;
    userMessage: string;
    clientRequestKey: string;
  }): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> {
    if (this.seenRequestKeys.has(args.clientRequestKey)) {
      return {
        ok: false,
        error: 'Duplicate chat request blocked. Refresh or send a new message.',
      };
    }

    if (!this.options.useMockBroker && !this.authenticated) {
      await this.connect();
      if (!this.authenticated && this.status.state !== 'mock') {
        return { ok: false, error: this.status.lastError ?? 'Not connected to AI broker.' };
      }
    }

    this.seenRequestKeys.add(args.clientRequestKey);
    const requestId = randomUUID();
    this.pending.set(requestId, {
      requestId,
      clientRequestKey: args.clientRequestKey,
      ticketKey: args.ticketKey,
    });
    this.setStatus({ ...this.status, queueDepth: this.pending.size });

    const contextMsg = createWssEnvelope('context.sync', {
      requestId: randomUUID(),
      ticketKey: args.ticketKey,
      payload: {
        contextRevision: args.context.contextRevision,
        context: args.context,
      },
    });

    const chatMsg = createWssEnvelope('chat.request', {
      requestId,
      ticketKey: args.ticketKey,
      payload: {
        contextRevision: args.context.contextRevision,
        userMessage: args.userMessage,
        clientRequestKey: args.clientRequestKey,
      },
    });

    if (this.mock) {
      this.mock.handle(contextMsg);
      this.mock.handle(chatMsg);
      return { ok: true, requestId };
    }

    if (!this.send(contextMsg) || !this.send(chatMsg)) {
      this.pending.delete(requestId);
      this.setStatus({ ...this.status, queueDepth: this.pending.size });
      return { ok: false, error: 'Failed to send chat request over WSS.' };
    }

    return { ok: true, requestId };
  }

  cancel(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    const msg = createWssEnvelope('chat.cancel', {
      requestId,
      ticketKey: pending.ticketKey,
      payload: {},
    });
    if (this.mock) {
      this.mock.handle(msg);
    } else {
      this.send(msg);
    }
    this.pending.delete(requestId);
    this.setStatus({ ...this.status, queueDepth: this.pending.size });
  }

  private connectMock(): ConnectionStatus {
    this.mock?.dispose();
    this.mock = new MockBrokerAdapter({
      onMessage: (message) => this.dispatchMessage(message),
    });
    this.authenticated = true;
    this.reconnectAttempt = 0;
    this.setStatus({
      state: 'mock',
      mockMode: true,
      lastError: null,
      lastConnectedAt: new Date().toISOString(),
      queueDepth: this.pending.size,
    });
    return this.getStatus();
  }

  private sendAuth(): void {
    const msg = createWssEnvelope('auth', {
      requestId: randomUUID(),
      ticketKey: null,
      payload: {
        deviceToken: this.options.deviceToken,
        clientName: 'freshdesk-ticket-helper',
        clientVersion: this.options.clientVersion,
      },
    });
    this.send(msg);
  }

  private send(message: WssMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    const raw = JSON.stringify(message);
    if (Buffer.byteLength(raw, 'utf8') > MAX_WSS_MESSAGE_BYTES) {
      this.setStatus({
        ...this.status,
        state: 'error',
        lastError: 'Outbound WSS message exceeded maximum size.',
      });
      return false;
    }
    this.socket.send(raw);
    return true;
  }

  private handleIncoming(data: WebSocket.RawData): void {
    const raw = typeof data === 'string' ? data : data.toString('utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_WSS_MESSAGE_BYTES) {
      this.setStatus({
        ...this.status,
        state: 'error',
        lastError: 'Inbound WSS message exceeded maximum size and was dropped.',
      });
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      this.setStatus({
        ...this.status,
        lastError: 'Received malformed JSON from AI broker.',
      });
      return;
    }

    const parsed = wssMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.setStatus({
        ...this.status,
        lastError: 'Received invalid WSS protocol message.',
      });
      return;
    }

    this.dispatchMessage(parsed.data);
  }

  private dispatchMessage(message: WssMessage): void {
    switch (message.type) {
      case 'auth.result': {
        if (message.payload.ok) {
          this.authenticated = true;
          this.reconnectAttempt = 0;
          this.setStatus({
            state: 'connected',
            mockMode: false,
            lastError: null,
            lastConnectedAt: new Date().toISOString(),
            queueDepth: this.pending.size,
          });
        } else {
          this.authenticated = false;
          this.setStatus({
            state: 'error',
            mockMode: false,
            lastError: message.payload.error ?? 'WSS authentication failed.',
            queueDepth: this.pending.size,
          });
          this.intentionalClose = true;
          this.socket?.close();
        }
        break;
      }
      case 'pong':
        break;
      case 'ping': {
        const pong = createWssEnvelope('pong', {
          requestId: message.requestId,
          ticketKey: message.ticketKey,
          payload: { nonce: message.payload.nonce },
        });
        if (this.mock) {
          // Mock answers its own pings.
        } else {
          this.send(pong);
        }
        break;
      }
      case 'chat.queued':
        this.options.onChatEvent?.({
          type: 'queued',
          requestId: message.requestId,
          position: message.payload.position,
        });
        break;
      case 'chat.delta':
        this.options.onChatEvent?.({
          type: 'delta',
          requestId: message.requestId,
          sequence: message.payload.sequence,
          text: message.payload.text,
        });
        break;
      case 'chat.completed':
        this.pending.delete(message.requestId);
        this.setStatus({ ...this.status, queueDepth: this.pending.size });
        this.options.onChatEvent?.({
          type: 'completed',
          requestId: message.requestId,
          text: message.payload.text,
        });
        break;
      case 'chat.failed':
        this.pending.delete(message.requestId);
        this.setStatus({ ...this.status, queueDepth: this.pending.size });
        this.options.onChatEvent?.({
          type: 'failed',
          requestId: message.requestId,
          error: message.payload.error,
          code: message.payload.code,
        });
        break;
      case 'error':
        this.setStatus({
          ...this.status,
          lastError: message.payload.error,
        });
        break;
      default:
        break;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const ping = createWssEnvelope('ping', {
        requestId: randomUUID(),
        ticketKey: null,
        payload: { nonce: randomUUID() },
      });
      this.send(ping);
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    this.reconnectAttempt += 1;
    const delay = Math.min(
      MAX_BACKOFF_MS,
      BASE_BACKOFF_MS * 2 ** Math.min(this.reconnectAttempt, 6),
    );
    this.setStatus({
      state: 'reconnecting',
      mockMode: false,
      lastError: this.status.lastError,
      lastConnectedAt: this.status.lastConnectedAt,
      queueDepth: this.pending.size,
    });
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(partial: Partial<ConnectionStatus> & Pick<ConnectionStatus, 'state'>): void {
    this.status = {
      ...this.status,
      ...partial,
    };
    this.options.onStatus?.(this.getStatus());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
