/**
 * Adapter registry — Cursor is intentionally absent and must never be registered.
 */
import type { CliAdapterId } from '@fth/protocol';

import type { CliAdapterDefinition } from './types.js';

export const CLI_ADAPTERS: Record<CliAdapterId, CliAdapterDefinition> = {
  antigravity: {
    id: 'antigravity',
    displayName: 'Google Antigravity CLI',
    executableNames: { unix: ['agy'], windows: ['agy.exe', 'agy'] },
    candidateDirectories: (home, platform) => {
      if (platform === 'win32') {
        return [
          `${home}\\AppData\\Local\\Programs\\agy`,
          `${home}\\AppData\\Local\\agy`,
          `${home}\\.local\\bin`,
        ];
      }
      return [`${home}/.local/bin`, `${home}/bin`, '/usr/local/bin', '/opt/homebrew/bin'];
    },
  },
  codex: {
    id: 'codex',
    displayName: 'OpenAI Codex CLI',
    executableNames: { unix: ['codex'], windows: ['codex.exe', 'codex'] },
    candidateDirectories: (home, platform) => {
      if (platform === 'win32') {
        return [
          `${home}\\AppData\\Local\\Programs\\codex`,
          `${home}\\.local\\bin`,
          `${home}\\AppData\\Roaming\\npm`,
        ];
      }
      return [
        `${home}/.local/bin`,
        `${home}/bin`,
        '/usr/local/bin',
        '/opt/homebrew/bin',
        `${home}/.npm-global/bin`,
      ];
    },
  },
  'claude-code': {
    id: 'claude-code',
    displayName: 'Anthropic Claude Code CLI',
    executableNames: { unix: ['claude'], windows: ['claude.exe', 'claude'] },
    candidateDirectories: (home, platform) => {
      if (platform === 'win32') {
        return [
          `${home}\\AppData\\Local\\Programs\\claude`,
          `${home}\\.local\\bin`,
          `${home}\\AppData\\Roaming\\npm`,
        ];
      }
      return [
        `${home}/.local/bin`,
        `${home}/bin`,
        '/usr/local/bin',
        '/opt/homebrew/bin',
        `${home}/.npm-global/bin`,
      ];
    },
  },
};

export function getAdapterDefinition(adapter: CliAdapterId): CliAdapterDefinition {
  const definition = CLI_ADAPTERS[adapter];
  if (!definition) {
    throw new Error('Unknown CLI adapter.');
  }
  return definition;
}

export function allowedExecutableBasenames(adapter: CliAdapterId): Set<string> {
  const def = getAdapterDefinition(adapter);
  return new Set(
    [...def.executableNames.unix, ...def.executableNames.windows].map((n) => n.toLowerCase()),
  );
}
