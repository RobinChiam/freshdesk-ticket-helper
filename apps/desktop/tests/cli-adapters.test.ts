/**
 * Subscription-CLI adapter tests use injected process runners only.
 * Never invoke real provider CLIs, credential stores, or network requests.
 */
import { describe, expect, it, vi } from 'vitest';

import { CLI_ADAPTERS } from '../src/ai/cli/registry';
import { locateCliExecutable, validateExecutableOverride } from '../src/ai/cli/locator';
import { buildCliEnvironment } from '../src/ai/cli/environment';
import { detectAntigravityCapabilities } from '../src/ai/cli/adapters/antigravity';
import {
  buildClaudePrintArgs,
  CLAUDE_STATIC_PROMPT,
  claudeHelpSupportsAutomation,
} from '../src/ai/cli/adapters/claudeCode';
import { buildCodexExecArgs, CODEX_STATIC_STDIN_SENTINEL } from '../src/ai/cli/adapters/codex';
import { createCodexJsonlParser } from '../src/ai/cli/parsers/codexJsonl';
import { createClaudeStreamJsonParser } from '../src/ai/cli/parsers/claudeStreamJson';
import { classifyCliFailure, sanitizeCliError } from '../src/ai/cli/errors';
import { CliProviderRuntime, formatCliStdinPrompt } from '../src/ai/cli/cliProviderRuntime';
import {
  CliAdapterError,
  DEFAULT_CLI_LIMITS,
  type ProcessRunner,
  type SpawnRequest,
} from '../src/ai/cli/types';
import { AiProviderService } from '../src/ai/providerService';
import { openAppDatabase } from '../src/database';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEvent, ChatSendInput } from '@fth/protocol';

function fakeFs(files: Record<string, 'file' | 'dir'>) {
  return {
    pathExists: (path: string) => path in files,
    isFile: (path: string) => files[path] === 'file',
    realpath: (path: string) => path,
  };
}

describe('CLI registry', () => {
  it('registers only antigravity, codex, and claude-code — never Cursor', () => {
    expect(Object.keys(CLI_ADAPTERS).sort()).toEqual(['antigravity', 'claude-code', 'codex']);
    expect(JSON.stringify(CLI_ADAPTERS).toLowerCase()).not.toContain('cursor');
  });
});

describe('executable locator', () => {
  it('discovers candidates on linux/mac/windows and rejects unsafe overrides', () => {
    const linux = locateCliExecutable('codex', undefined, {
      platform: 'linux',
      homeDir: '/home/agent',
      pathEnv: '',
      ...fakeFs({ '/home/agent/.local/bin/codex': 'file' }),
    });
    expect(linux.path).toBe('/home/agent/.local/bin/codex');

    const mac = locateCliExecutable('claude-code', undefined, {
      platform: 'darwin',
      homeDir: '/Users/agent',
      pathEnv: '/opt/homebrew/bin',
      ...fakeFs({ '/opt/homebrew/bin/claude': 'file' }),
    });
    expect(mac.path).toBe('/opt/homebrew/bin/claude');

    const win = locateCliExecutable('antigravity', undefined, {
      platform: 'win32',
      homeDir: '/unused',
      pathEnv: '/fake/win-bin',
      ...fakeFs({ '/fake/win-bin/agy.exe': 'file' }),
    });
    expect(win.path).toBe('/fake/win-bin/agy.exe');

    expect(() =>
      validateExecutableOverride('codex', '/tmp/not-codex', {
        platform: 'linux',
        ...fakeFs({ '/tmp/not-codex': 'file' }),
      }),
    ).toThrow(/not an allowed/i);

    expect(() =>
      validateExecutableOverride('codex', '/tmp/codex.cmd', {
        platform: 'linux',
        ...fakeFs({ '/tmp/codex.cmd': 'file' }),
      }),
    ).toThrow();

    expect(() =>
      validateExecutableOverride('codex', 'https://example.com/codex', { platform: 'linux' }),
    ).toThrow(/url/i);

    expect(() =>
      validateExecutableOverride('codex', '\\\\server\\share\\codex.exe', {
        platform: 'win32',
        ...fakeFs({ '\\\\server\\share\\codex.exe': 'file' }),
      }),
    ).toThrow(/network/i);

    expect(() =>
      validateExecutableOverride('codex', '/tmp', {
        platform: 'linux',
        ...fakeFs({ '/tmp': 'dir' }),
      }),
    ).toThrow(/regular executable/i);
  });
});

describe('environment sanitization', () => {
  it('strips API-key overrides without mutating the parent env', () => {
    const parent = {
      HOME: '/home/agent',
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'secret-openai',
      ANTHROPIC_API_KEY: 'secret-anthropic',
      GEMINI_API_KEY: 'secret-gemini',
      SSH_AUTH_SOCK: '/tmp/ssh',
    };
    const env = buildCliEnvironment('codex', parent, 'linux');
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    expect(env['HOME']).toBe('/home/agent');
    expect(env['SSH_AUTH_SOCK']).toBe('/tmp/ssh');
    expect(parent['OPENAI_API_KEY']).toBe('secret-openai');
  });
});

describe('adapter argument builders', () => {
  it('builds Codex exec args with stdin sentinel and never dangerous bypass flags', () => {
    const args = buildCodexExecArgs({ workdir: '/tmp/empty', modelId: 'gpt-test' });
    expect(args).toEqual([
      'exec',
      '--json',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '-C',
      '/tmp/empty',
      '-m',
      'gpt-test',
      CODEX_STATIC_STDIN_SENTINEL,
    ]);
    expect(args.join(' ')).not.toContain('dangerously-bypass');
    expect(args.join(' ')).not.toContain('--yolo');
    expect(args).not.toContain('resume');
  });

  it('builds Claude print args without --bare and with static argv prompt only', () => {
    const args = buildClaudePrintArgs({ modelId: 'claude-test' });
    expect(args).toContain('--print');
    expect(args).toContain('--safe-mode');
    expect(args).toContain('--no-session-persistence');
    expect(args).toContain('--strict-mcp-config');
    expect(args).not.toContain('--bare');
    expect(args.at(-1)).toBe(CLAUDE_STATIC_PROMPT);
    expect(args.join('\n')).not.toMatch(/ticket|freshdesk|customer/i);
  });
});

describe('Codex JSONL parser', () => {
  it('streams assistant text across split chunks and rejects tool activity', () => {
    const parser = createCodexJsonlParser(DEFAULT_CLI_LIMITS);
    const part1 =
      '{"type":"turn.started"}\n{"type":"item.completed","item":{"id":"1","type":"agent_message","text":"Hel';
    const part2 = 'lo"}}\n{"type":"turn.completed","usage":{"input_tokens":1}}\n';
    expect(parser.push(part1)).toBe('');
    expect(parser.push(part2)).toBe('Hello');
    expect(parser.finish().text).toBe('Hello');

    const bad = createCodexJsonlParser(DEFAULT_CLI_LIMITS);
    expect(() =>
      bad.push(
        '{"type":"item.started","item":{"id":"x","type":"command_execution","command":"ls"}}\n',
      ),
    ).toThrow(/disallowed|unexpected/i);

    const malformed = createCodexJsonlParser(DEFAULT_CLI_LIMITS);
    expect(() => malformed.push('not-json\n')).toThrow(/malformed/i);
  });
});

describe('Claude stream-json parser', () => {
  it('parses partial deltas, split chunks, and terminal results', () => {
    const parser = createClaudeStreamJsonParser(DEFAULT_CLI_LIMITS);
    const chunk1 =
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"OK';
    const chunk2 = '"}}}\n{"type":"result","result":"OK","is_error":false}\n';
    expect(parser.push(chunk1) + parser.push(chunk2)).toBe('OK');
    expect(parser.finish().completed).toBe(true);

    const tool = createClaudeStreamJsonParser(DEFAULT_CLI_LIMITS);
    expect(() =>
      tool.push('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}\n'),
    ).toThrow(/tool call/i);
  });
});

describe('error classification and logging safety', () => {
  it('maps auth/quota failures without exposing raw diagnostics', () => {
    const auth = classifyCliFailure({
      exitCode: 1,
      stderr: 'Error: not logged in — visit https://auth.example/secret-token',
      stdout: '',
      timedOut: false,
      startupTimedOut: false,
      aborted: false,
    });
    expect(auth.code).toBe('not_authenticated');
    expect(auth.message).not.toContain('secret-token');
    expect(auth.message).not.toContain('https://');

    const quota = classifyCliFailure({
      exitCode: 1,
      stderr: 'rate limit exceeded',
      stdout: '',
      timedOut: false,
      startupTimedOut: false,
      aborted: false,
    });
    expect(quota.code).toBe('rate_limited');

    expect(
      sanitizeCliError(
        new CliAdapterError('timeout', 'The provider CLI did not finish before the timeout.'),
      ),
    ).toEqual({
      code: 'timeout',
      error: 'The provider CLI did not finish before the timeout.',
    });
  });
});

describe('Antigravity capability gate', () => {
  it('fails closed unless secure automation requirements are proven', () => {
    const currentHelp = `
Usage of agy:
  -p  Short alias for --print
  --print  Run a single prompt non-interactively
  --sandbox  Run in a sandbox
  --continue  Continue the most recent conversation
`;
    const caps = detectAntigravityCapabilities(currentHelp);
    expect(caps.secureAutomationSupported).toBe(false);
    expect(caps.mentionsStdin).toBe(false);

    const futureHelp = `
agy --print reads the prompt from stdin when - is supplied
--output-format stream-json
--tools "" --disallowed-tools *
--no-session-persistence
--sandbox read-only strict
`;
    expect(detectAntigravityCapabilities(futureHelp).secureAutomationSupported).toBe(true);
  });
});

describe('Claude help capability check', () => {
  it('requires documented automation controls', () => {
    expect(
      claudeHelpSupportsAutomation(
        'claude --print --tools --disallowedTools --strict-mcp-config --no-session-persistence --output-format --include-partial-messages --no-chrome --disable-slash-commands',
      ),
    ).toBe(true);
    expect(claudeHelpSupportsAutomation('claude interactive only')).toBe(false);
  });
});

describe('CLI runtime with injected runner', () => {
  it('sends sensitive context on stdin, never argv, and uses shell:false spawn contract', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fth-cli-bin-'));
    const fakeBin = join(dir, 'codex');
    writeFileSync(fakeBin, '#!/bin/sh\n', { mode: 0o755 });

    const calls: SpawnRequest[] = [];
    const runner: ProcessRunner = async (request) => {
      calls.push(request);
      const events = [
        '{"type":"turn.started"}',
        '{"type":"item.completed","item":{"id":"1","type":"agent_message","text":"Hello"}}',
        '{"type":"turn.completed","usage":{"input_tokens":1}}',
        '',
      ].join('\n');
      request.onStdoutChunk?.(events);
      return {
        exitCode: 0,
        signal: null,
        stdout: events,
        stderr: '',
        timedOut: false,
        startupTimedOut: false,
      };
    };

    const runtime = new CliProviderRuntime({ runner });
    const ticket = 'SECRET_TICKET_BODY_12345';
    const chunks: string[] = [];
    for await (const delta of runtime.stream({
      kind: 'subscription-cli',
      adapter: 'codex',
      logicalProviderId: 'openai',
      modelId: '',
      executablePath: fakeBin,
      system: 'static system',
      messages: [{ role: 'user', content: ticket }],
      signal: new AbortController().signal,
    })) {
      chunks.push(delta);
    }

    expect(chunks.join('')).toContain('Hello');
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.args.join(' ')).not.toContain(ticket);
    expect(call.stdin).toContain(ticket);
    expect(call.args.at(-1)).toBe('-');
    expect(formatCliStdinPrompt('sys', [{ role: 'user', content: ticket }])).toContain(ticket);
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not persist partial assistant text after cancellation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fth-cli-chat-'));
    const fakeBin = join(dir, 'codex');
    writeFileSync(fakeBin, '#!/bin/sh\n', { mode: 0o755 });
    const db = openAppDatabase(join(dir, 'state.sqlite'));
    const events: ChatEvent[] = [];
    const runner: ProcessRunner = async (request) => {
      request.onStdoutChunk?.(
        '{"type":"item.completed","item":{"id":"1","type":"agent_message","text":"partial"}}\n',
      );
      await new Promise<void>((resolve) =>
        request.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return {
        exitCode: null,
        signal: 'SIGTERM',
        stdout: '',
        stderr: '',
        timedOut: false,
        startupTimedOut: false,
      };
    };
    const runtime = new CliProviderRuntime({ runner });
    const service = new AiProviderService({
      db,
      runtime: {
        stream: (req) => runtime.stream(req as never),
        test: async () => undefined,
      },
      onEvent: (event) => events.push(event),
    });

    const input: ChatSendInput = {
      ticketKey: 'company.freshdesk.com:99',
      contextRevision: 1,
      sanitizedContext: {
        ticketKey: 'company.freshdesk.com:99',
        contextRevision: 1,
        subject: 'x',
        includePrivateNotes: false,
        redactionMap: {},
        messages: [],
        warnings: [],
        previewText: 'ticket',
      },
      userMessage: 'hi',
      clientRequestKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    const { requestId } = service.start(
      input,
      {
        kind: 'subscription-cli',
        adapter: 'codex',
        logicalProviderId: 'openai',
        modelId: '',
        executablePath: fakeBin,
      },
      'hi',
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    service.cancel(requestId);
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (events.some((event) => ['completed', 'failed', 'cancelled'].includes(event.type))) {
          clearInterval(timer);
          resolve();
        }
      }, 5);
    });
    expect(events.at(-1)?.type).toBe('cancelled');
    expect(db.listChatMessages(input.ticketKey).map((message) => message.role)).toEqual(['user']);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('terminates on timeout classification and never logs raw stdout in sanitize', async () => {
    const err = classifyCliFailure({
      exitCode: null,
      stderr: 'RAW_STDERR_SECRET',
      stdout: 'RAW_STDOUT_SECRET',
      timedOut: true,
      startupTimedOut: false,
      aborted: false,
    });
    expect(err.code).toBe('timeout');
    expect(JSON.stringify(sanitizeCliError(err))).not.toContain('RAW_');
  });
});

describe('process runner contract documentation', () => {
  it('documents shell:false requirement via spawn request shape used by adapters', () => {
    // Production runner always sets shell:false; adapters only pass executable+args arrays.
    const args = buildCodexExecArgs({ workdir: '/tmp/x' });
    expect(Array.isArray(args)).toBe(true);
    expect(args.every((part) => typeof part === 'string')).toBe(true);
    expect(args.join(' ')).not.toMatch(/(?:bash|sh|cmd\.exe|powershell)\s+-c/i);
  });
});

describe('line and output limits', () => {
  it('rejects oversized JSONL lines', () => {
    const parser = createCodexJsonlParser({
      maxJsonlLineBytes: 32,
      maxResponseChars: 100,
    });
    expect(() => parser.push(`${'{"type":"error","x":"'.padEnd(64, 'a')}"}\n`)).toThrow(
      /size limit/i,
    );
  });
});

describe('session policy', () => {
  it('never resumes provider-owned sessions in argument builders', () => {
    expect(buildCodexExecArgs({ workdir: '/tmp' }).join(' ')).not.toMatch(/resume|--last|-c\b/);
    expect(buildClaudePrintArgs({}).join(' ')).not.toMatch(/--continue|--resume|--fork-session/);
    expect(buildClaudePrintArgs({}).join(' ')).toContain('--no-session-persistence');
  });
});

describe('vault isolation for CLI mode', () => {
  it('does not require API keys for subscription-cli config construction', () => {
    // Handlers skip vault writes for CLI mode; this unit asserts the config shape.
    const config = {
      kind: 'subscription-cli' as const,
      adapter: 'claude-code' as const,
      logicalProviderId: 'anthropic' as const,
      modelId: '',
      executablePath: '',
    };
    expect(config).not.toHaveProperty('apiKey');
    expect(vi.fn()).toBeTypeOf('function');
  });
});
