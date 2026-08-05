/** IPC schema validation tests — ensures renderer/main contracts stay strict. */
import { describe, expect, it } from 'vitest';

import {
  aiConnectionSchema,
  chatSendInputSchema,
  cliAdapterIdSchema,
  nonSecretSettingsSchema,
  settingsSaveInputSchema,
  ticketParseInputSchema,
  ticketOpenResultSchema,
} from '@fth/protocol';

describe('IPC schemas', () => {
  it('accepts valid non-secret settings with https Freshdesk URL', () => {
    const parsed = nonSecretSettingsSchema.parse({
      freshdeskUrl: 'https://company.freshdesk.com',
      freshdeskUiHosts: [],
      includePrivateNotesInAi: false,
      onboardingComplete: false,
      aiConnection: {
        kind: 'api-key',
        provider: 'google',
        modelId: 'gemini-model',
        customBaseUrl: '',
      },
    });
    expect(parsed.aiConnection.kind).toBe('api-key');
    if (parsed.aiConnection.kind === 'api-key') {
      expect(parsed.aiConnection.provider).toBe('google');
    }
  });

  it('rejects http Freshdesk URLs in settings schema', () => {
    expect(() =>
      nonSecretSettingsSchema.parse({
        freshdeskUrl: 'http://company.freshdesk.com',
        freshdeskUiHosts: [],
        includePrivateNotesInAi: false,
        onboardingComplete: false,
        aiConnection: {
          kind: 'api-key',
          provider: 'google',
          modelId: '',
          customBaseUrl: '',
        },
      }),
    ).toThrow();
  });

  it('keeps secrets optional on save input', () => {
    const parsed = settingsSaveInputSchema.parse({
      freshdeskUrl: 'https://company.freshdesk.com',
      freshdeskUiHosts: [],
      includePrivateNotesInAi: false,
      onboardingComplete: true,
      aiConnection: {
        kind: 'api-key',
        provider: 'anthropic',
        modelId: 'claude-model',
        customBaseUrl: '',
      },
      freshdeskApiKey: 'temporary-key',
    });
    expect(parsed.freshdeskApiKey).toBe('temporary-key');
    expect(() =>
      settingsSaveInputSchema.parse({
        ...parsed,
        aiApiKey: 'x'.repeat(4_097),
      }),
    ).toThrow();
  });

  it('requires custom provider URLs to use HTTPS without embedded credentials', () => {
    const base = {
      freshdeskUrl: '',
      freshdeskUiHosts: [],
      includePrivateNotesInAi: false,
      onboardingComplete: true,
      aiConnection: {
        kind: 'api-key' as const,
        provider: 'openai-compatible' as const,
        modelId: 'model',
        customBaseUrl: '',
      },
    };
    expect(() =>
      nonSecretSettingsSchema.parse({
        ...base,
        aiConnection: { ...base.aiConnection, customBaseUrl: 'http://localhost/v1' },
      }),
    ).toThrow();
    expect(() =>
      nonSecretSettingsSchema.parse({
        ...base,
        aiConnection: {
          ...base.aiConnection,
          customBaseUrl: 'https://user:pass@example.com/v1',
        },
      }),
    ).toThrow();
    expect(
      (
        nonSecretSettingsSchema.parse({
          ...base,
          aiConnection: { ...base.aiConnection, customBaseUrl: 'https://example.com/v1' },
        }).aiConnection as { customBaseUrl: string }
      ).customBaseUrl,
    ).toBe('https://example.com/v1');
  });

  it('rejects invalid connection combinations and keeps Cursor absent', () => {
    expect(() =>
      aiConnectionSchema.parse({
        kind: 'api-key',
        provider: 'cursor',
        modelId: 'x',
        customBaseUrl: '',
      }),
    ).toThrow();
    expect(() =>
      aiConnectionSchema.parse({
        kind: 'subscription-cli',
        adapter: 'cursor',
        modelId: '',
        executablePath: '',
      }),
    ).toThrow();
    expect(() => cliAdapterIdSchema.parse('cursor')).toThrow();
    expect(cliAdapterIdSchema.options).not.toContain('cursor');

    expect(
      aiConnectionSchema.parse({
        kind: 'subscription-cli',
        adapter: 'codex',
        modelId: 'gpt-5',
        executablePath: '',
      }).kind,
    ).toBe('subscription-cli');

    // API-key fields are invalid on subscription-cli; adapter fields invalid on api-key.
    expect(() =>
      aiConnectionSchema.parse({
        kind: 'subscription-cli',
        provider: 'openai',
        modelId: 'x',
        customBaseUrl: '',
      }),
    ).toThrow();
  });

  it('allows subscription-cli settings without an API key field', () => {
    const parsed = settingsSaveInputSchema.parse({
      freshdeskUrl: 'https://company.freshdesk.com',
      freshdeskUiHosts: [],
      includePrivateNotesInAi: false,
      onboardingComplete: true,
      aiConnection: {
        kind: 'subscription-cli',
        adapter: 'claude-code',
        modelId: '',
        executablePath: '',
      },
    });
    expect(parsed.aiApiKey).toBeUndefined();
    expect(parsed.aiConnection.kind).toBe('subscription-cli');
  });

  it('validates ticket parse input bounds', () => {
    expect(() => ticketParseInputSchema.parse({ input: '' })).toThrow();
    expect(ticketParseInputSchema.parse({ input: '8812' }).input).toBe('8812');
  });

  it('requires UUID clientRequestKey for chat send', () => {
    expect(() =>
      chatSendInputSchema.parse({
        ticketKey: 'company.freshdesk.com:1',
        contextRevision: 1,
        sanitizedContext: {
          ticketKey: 'company.freshdesk.com:1',
          contextRevision: 1,
          subject: 'x',
          includePrivateNotes: false,
          redactionMap: {},
          messages: [],
          warnings: [],
          previewText: 'x',
        },
        userMessage: 'hello',
        clientRequestKey: 'not-a-uuid',
      }),
    ).toThrow();
  });

  it('discriminates ticket open success/failure', () => {
    const failure = ticketOpenResultSchema.parse({
      ok: false,
      code: 'permission_denied',
      error: 'Freshdesk denied access.',
    });
    expect(failure.ok).toBe(false);
  });
});
