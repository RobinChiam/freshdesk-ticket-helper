/**
 * IPC schema validation tests — ensures renderer/main contracts stay strict.
 */
import { describe, expect, it } from 'vitest';

import {
  chatSendInputSchema,
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
      wssUrl: 'wss://ai-helper.example.com/ws',
      useMockBroker: true,
      includePrivateNotesInAi: false,
      onboardingComplete: false,
    });
    expect(parsed.useMockBroker).toBe(true);
  });

  it('rejects http Freshdesk URLs in settings schema', () => {
    expect(() =>
      nonSecretSettingsSchema.parse({
        freshdeskUrl: 'http://company.freshdesk.com',
        freshdeskUiHosts: [],
        wssUrl: '',
        useMockBroker: true,
        includePrivateNotesInAi: false,
        onboardingComplete: false,
      }),
    ).toThrow();
  });

  it('keeps secrets optional on save input', () => {
    const parsed = settingsSaveInputSchema.parse({
      freshdeskUrl: 'https://company.freshdesk.com',
      freshdeskUiHosts: [],
      wssUrl: '',
      useMockBroker: true,
      includePrivateNotesInAi: false,
      onboardingComplete: true,
      freshdeskApiKey: 'temporary-key',
    });
    expect(parsed.freshdeskApiKey).toBe('temporary-key');
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
