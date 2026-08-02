/**
 * Typed authenticated WSS client for the VPS AI broker.
 * Lives exclusively in the Electron main process.
 *
 * Readiness means authenticated (or mock), not merely socket-open.
 * context.sync must be acknowledged before chat.request is sent.
 * Never log device tokens or ticket content.
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
  /** Test-only overrides for timeouts (milliseconds). */
  authTimeoutMs?: number;
  contextAckTimeoutMs?: number;
};

type PendingChat = {
  requestId: string;
  clientRequestKey: string;
  ticketKey: string;
};

type PendingContextAck = {
  requestId: string;
  ticketKey: string;
  contextRevision: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;
const HEARTBEAT_MS = 20_000;
const DEFAULT_AUTH_TIMEOUT_MS = 10_000;
const DEFAULT_CONTEXT_ACK_TIMEOUT_MS = 10_000;

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
  private readonly pendingContextAcks = new Map<string, PendingContextAck>();
  private authenticated = false;
  private authWaiters: Array<{
    resolve: (status: ConnectionStatus) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  private connectGeneration = 0;

  constructor(options: WssClientOptions) {
    this.options = options;
  }

  getStatus(): ConnectionStatus {
    return { ...this.status };
  }

  isReady(): boolean {
    return (
      this.authenticated && (this.status.state === 'connected' || this.status.state === 'mock')
    );
  }

  /**
   * Update options. When connection-affecting settings change, disconnect the previous
   * socket/mock and reconnect so stale endpoints/tokens cannot remain active.
   */
  async configure(options: Partial<WssClientOptions>): Promise<void> {
    const previous = this.options;
    this.options = { ...previous, ...options };

    const connectionAffecting =
      (options.url !== undefined && options.url !== previous.url) ||
      (options.deviceToken !== undefined && options.deviceToken !== previous.deviceToken) ||
      (options.useMockBroker !== undefined && options.useMockBroker !== previous.useMockBroker) ||
      (options.allowInsecureWs !== undefined &&
        options.allowInsecureWs !== previous.allowInsecureWs);

    if (!connectionAffecting) {
      return;
    }

    this.rejectPendingOperations('Connection settings changed.');
    this.disconnect({ silent: true });
    await this.connect();
  }

  /** Connect and resolve only after authentication succeeds, fails, or times out. */
  async connect(): Promise<ConnectionStatus> {
    this.intentionalClose = false;
    const generation = ++this.connectGeneration;

    if (this.options.useMockBroker) {
      return this.connectMock();
    }

    // Switching to real WSS must not leave a mock adapter active.
    this.mock?.dispose();
    this.mock = null;

    const url = this.options.url.trim();
    if (!url) {
      this.authenticated = false;
      this.setStatus({
        state: 'error',
        mockMode: false,
        lastError: 'WSS URL is not configured.',
        queueDepth: this.pending.size,
      });
      return this.getStatus();
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      this.authenticated = false;
      this.setStatus({
        state: 'error',
        mockMode: false,
        lastError: 'WSS URL is malformed.',
        queueDepth: this.pending.size,
      });
      return this.getStatus();
    }

    // Production builds must never silently fall back from WSS to insecure WS.
    if (parsed.protocol === 'ws:' && !this.options.allowInsecureWs) {
      this.authenticated = false;
      this.setStatus({
        state: 'error',
        mockMode: false,
        lastError:
          'Insecure ws:// URLs are blocked in this build. Use wss:// or enable mock broker mode.',
        queueDepth: this.pending.size,
      });
      return this.getStatus();
    }

    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') {
      this.authenticated = false;
      this.setStatus({
        state: 'error',
        mockMode: false,
        lastError: 'AI broker URL must use the wss: scheme.',
        queueDepth: this.pending.size,
      });
      return this.getStatus();
    }

    // Replace any prior live socket before opening a new one.
    if (this.socket) {
      this.intentionalClose = true;
      this.closeSocket();
      this.intentionalClose = false;
    }

    this.authenticated = false;
    this.setStatus({
      state: this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
      mockMode: false,
      lastError: null,
      queueDepth: this.pending.size,
    });

    const authTimeoutMs = this.options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;

    await new Promise<void>((resolve) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      let settled = false;

      const settleOpen = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };

      socket.on('open', () => {
        if (generation !== this.connectGeneration) {
          settleOpen();
          return;
        }
        this.setStatus({
          state: 'authenticating',
          mockMode: false,
          lastError: null,
          queueDepth: this.pending.size,
        });
        this.sendAuth();
        this.startHeartbeat();
        settleOpen();
      });

      socket.on('message', (data) => {
        if (generation !== this.connectGeneration) return;
        this.handleIncoming(data);
      });

      socket.on('close', () => {
        if (generation !== this.connectGeneration) return;
        this.stopHeartbeat();
        this.authenticated = false;
        this.failAuthWaiters(new Error('WebSocket closed before authentication completed.'));
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
        settleOpen();
      });

      socket.on('error', () => {
        // Details intentionally generic — avoid leaking URL query tokens in UI/logs.
        if (generation !== this.connectGeneration) {
          settleOpen();
          return;
        }
        this.setStatus({
          state: 'error',
          mockMode: false,
          lastError: 'WebSocket connection error.',
          queueDepth: this.pending.size,
        });
        this.failAuthWaiters(new Error('WebSocket connection error.'));
        settleOpen();
      });
    });

    if (generation !== this.connectGeneration) {
      return this.getStatus();
    }

    if (this.authenticated) {
      return this.getStatus();
    }

    if (this.status.state === 'error' || this.status.state === 'disconnected') {
      return this.getStatus();
    }

    // Socket may be open while auth is still in flight — wait for auth.result.
    try {
      await this.waitForAuthentication(authTimeoutMs);
    } catch {
      if (!this.authenticated) {
        this.setStatus({
          state: 'error',
          mockMode: false,
          lastError: this.status.lastError ?? 'WSS authentication timed out.',
          queueDepth: this.pending.size,
        });
        this.intentionalClose = true;
        this.closeSocket();
      }
    }

    return this.getStatus();
  }

  disconnect(options?: { silent?: boolean }): void {
    this.intentionalClose = true;
    this.connectGeneration += 1;
    this.clearReconnect();
    this.stopHeartbeat();
    this.mock?.dispose();
    this.mock = null;
    this.closeSocket();
    this.authenticated = false;
    this.failAuthWaiters(new Error('Disconnected.'));
    if (!options?.silent) {
      this.setStatus({
        state: 'disconnected',
        mockMode: false,
        lastError: null,
        queueDepth: this.pending.size,
      });
    }
  }

  async testConnection(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
    if (this.options.useMockBroker) {
      await this.connect();
      return { ok: true, message: 'Mock AI broker is active (no remote WSS).' };
    }

    if (!this.options.deviceToken.trim()) {
      return { ok: false, error: 'WSS device/pairing token is not configured.' };
    }

    const status = await this.connect();
    if (status.state === 'connected' || status.state === 'mock') {
      return { ok: true, message: 'AI broker connection and authentication succeeded.' };
    }
    return {
      ok: false,
      error: status.lastError ?? 'AI broker connection failed.',
    };
  }

  /**
   * Ensure authenticated readiness, sync sanitized context, wait for matching context.ack,
   * then send chat.request. Rejects duplicate clientRequestKey values.
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

    if (args.ticketKey !== args.context.ticketKey) {
      return { ok: false, error: 'ticketKey does not match sanitized context.' };
    }

    if (!this.isReady()) {
      await this.connect();
      if (!this.isReady()) {
        return { ok: false, error: this.status.lastError ?? 'Not authenticated to AI broker.' };
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

    const contextRequestId = randomUUID();
    const contextMsg = createWssEnvelope('context.sync', {
      requestId: contextRequestId,
      ticketKey: args.ticketKey,
      payload: {
        contextRevision: args.context.contextRevision,
        context: args.context,
      },
    });

    try {
      // Register the ack waiter before sending — mock (and fast servers) may ack synchronously.
      const ackPromise = this.waitForContextAck({
        requestId: contextRequestId,
        ticketKey: args.ticketKey,
        contextRevision: args.context.contextRevision,
      });

      if (this.mock) {
        this.mock.handle(contextMsg);
      } else if (!this.send(contextMsg)) {
        throw new Error('Failed to send context.sync over WSS.');
      }

      await ackPromise;

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
        this.mock.handle(chatMsg);
      } else if (!this.send(chatMsg)) {
        throw new Error('Failed to send chat.request over WSS.');
      }

      return { ok: true, requestId };
    } catch (error) {
      this.pendingContextAcks.delete(contextRequestId);
      this.pending.delete(requestId);
      this.setStatus({ ...this.status, queueDepth: this.pending.size });
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to send chat request.',
      };
    }
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
    // Switching to mock must tear down any real socket.
    if (this.socket) {
      this.intentionalClose = true;
      this.closeSocket();
      this.intentionalClose = false;
    }
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
    this.resolveAuthWaiters();
    return this.getStatus();
  }

  private closeSocket(): void {
    const socket = this.socket as WebSocket | null;
    if (socket) {
      socket.close();
    }
    this.socket = null;
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
          this.resolveAuthWaiters();
        } else {
          this.authenticated = false;
          // Do not echo token material — broker errors are treated as generic auth failure text.
          this.setStatus({
            state: 'error',
            mockMode: false,
            lastError: message.payload.error ?? 'WSS authentication failed.',
            queueDepth: this.pending.size,
          });
          this.failAuthWaiters(new Error(message.payload.error ?? 'WSS authentication failed.'));
          this.intentionalClose = true;
          this.closeSocket();
        }
        break;
      }
      case 'context.ack': {
        this.resolveContextAck(message);
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
        if (!this.mock) {
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

  private waitForAuthentication(timeoutMs: number): Promise<ConnectionStatus> {
    if (this.isReady()) {
      return Promise.resolve(this.getStatus());
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.authWaiters = this.authWaiters.filter((waiter) => waiter.timer !== timer);
        reject(new Error('WSS authentication timed out.'));
      }, timeoutMs);
      this.authWaiters.push({ resolve, reject, timer });
    });
  }

  private resolveAuthWaiters(): void {
    const waiters = this.authWaiters;
    this.authWaiters = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(this.getStatus());
    }
  }

  private failAuthWaiters(error: Error): void {
    const waiters = this.authWaiters;
    this.authWaiters = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private waitForContextAck(args: {
    requestId: string;
    ticketKey: string;
    contextRevision: number;
  }): Promise<void> {
    const timeoutMs = this.options.contextAckTimeoutMs ?? DEFAULT_CONTEXT_ACK_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingContextAcks.delete(args.requestId);
        reject(new Error('context.ack timed out.'));
      }, timeoutMs);
      this.pendingContextAcks.set(args.requestId, {
        ...args,
        resolve,
        reject,
        timer,
      });
    });
  }

  private resolveContextAck(message: Extract<WssMessage, { type: 'context.ack' }>): void {
    const pending = this.pendingContextAcks.get(message.requestId);
    if (!pending) {
      return;
    }
    if (
      pending.ticketKey !== message.ticketKey ||
      pending.contextRevision !== message.payload.contextRevision
    ) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingContextAcks.delete(message.requestId);
    pending.resolve();
  }

  private rejectPendingOperations(reason: string): void {
    for (const [requestId, pending] of this.pendingContextAcks) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingContextAcks.delete(requestId);
    }
    for (const requestId of this.pending.keys()) {
      this.pending.delete(requestId);
      this.options.onChatEvent?.({
        type: 'failed',
        requestId,
        error: reason,
        code: 'connection_replaced',
      });
    }
    this.setStatus({ ...this.status, queueDepth: 0 });
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
