/**
 * Claude Code stream-json parser.
 * Extracts assistant text deltas and the terminal result; ignores cost/session metadata.
 */
import { CliAdapterError, type CliLimits } from '../types.js';

export type ClaudeParseState = {
  text: string;
  completed: boolean;
  resultText: string | null;
  errorMessage: string | null;
};

export function createClaudeStreamJsonParser(
  limits: Pick<CliLimits, 'maxJsonlLineBytes' | 'maxResponseChars'>,
): {
  push: (chunk: string) => string;
  finish: () => ClaudeParseState;
  getState: () => ClaudeParseState;
} {
  let buffer = '';
  const state: ClaudeParseState = {
    text: '',
    completed: false,
    resultText: null,
    errorMessage: null,
  };

  const appendText = (piece: string): string => {
    if (!piece) return '';
    state.text += piece;
    if (state.text.length > limits.maxResponseChars) {
      throw new CliAdapterError(
        'output_limit_exceeded',
        'The provider response exceeded the size limit.',
      );
    }
    return piece;
  };

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

    if (type === 'result') {
      state.completed = true;
      const isError = event['is_error'] === true;
      const result = typeof event['result'] === 'string' ? event['result'] : '';
      if (isError) {
        state.errorMessage = 'The provider CLI reported a request failure.';
        return '';
      }
      state.resultText = result;
      // Prefer streamed deltas when present; otherwise use final result text.
      if (!state.text && result) {
        return appendText(result);
      }
      return '';
    }

    if (type === 'error') {
      state.errorMessage = 'The provider CLI reported a request failure.';
      return '';
    }

    // stream_event with partial message deltas
    if (type === 'stream_event') {
      const streamEvent = event['event'];
      if (!streamEvent || typeof streamEvent !== 'object') return '';
      const se = streamEvent as Record<string, unknown>;
      if (se['type'] === 'content_block_delta') {
        const delta = se['delta'];
        if (delta && typeof delta === 'object') {
          const text =
            typeof (delta as { text?: unknown }).text === 'string'
              ? (delta as { text: string }).text
              : '';
          return appendText(text);
        }
      }
      return '';
    }

    // assistant message content blocks (non-partial)
    if (type === 'assistant') {
      const message = event['message'];
      if (!message || typeof message !== 'object') return '';
      const content = (message as { content?: unknown }).content;
      if (!Array.isArray(content)) return '';
      let delta = '';
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as { type?: unknown; text?: unknown };
        if (b.type === 'text' && typeof b.text === 'string') {
          // Full assistant snapshots can repeat prior text; only append new suffix.
          if (b.text.startsWith(state.text)) {
            delta += appendText(b.text.slice(state.text.length));
          } else if (!state.text.includes(b.text)) {
            delta += appendText(b.text);
          }
        }
        if (b.type === 'tool_use') {
          throw new CliAdapterError(
            'security_violation',
            'The provider CLI attempted a tool call and the request was stopped.',
          );
        }
      }
      return delta;
    }

    // Content-block style events from --include-partial-messages
    if (type === 'content_block_delta') {
      const delta = event['delta'];
      if (delta && typeof delta === 'object') {
        const text =
          typeof (delta as { text?: unknown }).text === 'string'
            ? (delta as { text: string }).text
            : '';
        return appendText(text);
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
    finish(): ClaudeParseState {
      if (buffer.trim()) {
        this.push('\n');
      }
      if (state.errorMessage) {
        throw new CliAdapterError('provider_error', state.errorMessage);
      }
      return state;
    },
    getState: () => state,
  };
}
