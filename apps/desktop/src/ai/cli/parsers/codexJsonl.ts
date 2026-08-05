/**
 * Codex JSONL event parser.
 * Accepts assistant text and expected lifecycle/error events only.
 * Unexpected command/file/MCP/web-search activity is a security failure.
 */
import { CliAdapterError, type CliLimits } from '../types.js';

const ALLOWED_TOP_LEVEL = new Set([
  'thread.started',
  'turn.started',
  'turn.completed',
  'turn.failed',
  'error',
  'item.started',
  'item.updated',
  'item.completed',
]);

const ALLOWED_ITEM_TYPES = new Set(['agent_message', 'reasoning', 'message', 'plan_update']);

const FORBIDDEN_ITEM_TYPES = new Set([
  'command_execution',
  'file_change',
  'mcp_tool_call',
  'web_search',
  'collab_agent_tool_call',
]);

export type CodexParseState = {
  text: string;
  completed: boolean;
  failedMessage: string | null;
};

export function createCodexJsonlParser(
  limits: Pick<CliLimits, 'maxJsonlLineBytes' | 'maxResponseChars'>,
): {
  push: (chunk: string) => string;
  finish: () => CodexParseState;
  getState: () => CodexParseState;
} {
  let buffer = '';
  const state: CodexParseState = { text: '', completed: false, failedMessage: null };

  const pushLine = (line: string): string => {
    if (!line.trim()) return '';
    if (Buffer.byteLength(line, 'utf8') > limits.maxJsonlLineBytes) {
      throw new CliAdapterError(
        'output_limit_exceeded',
        'A provider output line exceeded the size limit.',
      );
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new CliAdapterError('malformed_output', 'The provider CLI returned malformed output.');
    }
    const type = typeof event['type'] === 'string' ? event['type'] : '';
    if (!ALLOWED_TOP_LEVEL.has(type)) {
      throw new CliAdapterError(
        'security_violation',
        'The provider CLI emitted an unexpected event and the request was stopped.',
      );
    }

    if (type === 'turn.failed' || type === 'error') {
      state.failedMessage = 'The provider CLI reported a request failure.';
      return '';
    }
    if (type === 'turn.completed') {
      state.completed = true;
      return '';
    }

    if (type.startsWith('item.')) {
      const item = event['item'];
      if (!item || typeof item !== 'object') return '';
      const itemType =
        typeof (item as { type?: unknown }).type === 'string'
          ? (item as { type: string }).type
          : '';
      if (FORBIDDEN_ITEM_TYPES.has(itemType)) {
        throw new CliAdapterError(
          'security_violation',
          'The provider CLI attempted a disallowed tool or network action and the request was stopped.',
        );
      }
      if (!ALLOWED_ITEM_TYPES.has(itemType)) {
        throw new CliAdapterError(
          'security_violation',
          'The provider CLI emitted an unexpected item type and the request was stopped.',
        );
      }
      if (itemType === 'agent_message' || itemType === 'message') {
        const text =
          typeof (item as { text?: unknown }).text === 'string'
            ? (item as { text: string }).text
            : '';
        if (!text) return '';
        // item.completed carries the full message; avoid double-counting updates.
        if (type === 'item.completed') {
          if (text.startsWith(state.text)) {
            const delta = text.slice(state.text.length);
            state.text = text;
            if (state.text.length > limits.maxResponseChars) {
              throw new CliAdapterError(
                'output_limit_exceeded',
                'The provider response exceeded the size limit.',
              );
            }
            return delta;
          }
          state.text += text;
          if (state.text.length > limits.maxResponseChars) {
            throw new CliAdapterError(
              'output_limit_exceeded',
              'The provider response exceeded the size limit.',
            );
          }
          return text;
        }
      }
    }
    return '';
  };

  return {
    push(chunk: string): string {
      buffer += chunk;
      let deltaOut = '';
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        deltaOut += pushLine(line);
        newline = buffer.indexOf('\n');
      }
      return deltaOut;
    },
    finish(): CodexParseState {
      if (buffer.trim()) {
        this.push('\n');
      }
      if (state.failedMessage) {
        throw new CliAdapterError('provider_error', state.failedMessage);
      }
      return state;
    },
    getState: () => state,
  };
}
