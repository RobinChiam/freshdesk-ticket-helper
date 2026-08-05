/**
 * Child environment for subscription CLIs.
 * Preserves profile/keychain variables for OAuth while stripping API-key overrides.
 * Never mutates the parent process environment.
 */
import type { CliAdapterId } from '@fth/protocol';

/** API-key variables that must not override subscription authentication. */
const API_KEY_ENV_VARS = [
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'OPENAI_API_KEY_PATH',
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
] as const;

const PRESERVE_PREFIXES = ['XDG_', 'LC_', 'LANG', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM'];

export function buildCliEnvironment(
  adapter: CliAdapterId,
  parentEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;
    if ((API_KEY_ENV_VARS as readonly string[]).includes(key)) continue;
    // Drop adapter-irrelevant provider keys that could still override auth.
    if (adapter === 'codex' && /^ANTHROPIC_|^GOOGLE_|^GEMINI_/.test(key)) continue;
    if (adapter === 'claude-code' && /^OPENAI_|^CODEX_|^GOOGLE_|^GEMINI_/.test(key)) continue;
    if (adapter === 'antigravity' && /^OPENAI_|^CODEX_|^ANTHROPIC_|^CLAUDE_/.test(key)) continue;

    if (
      PRESERVE_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix)) ||
      key === 'PATH' ||
      key === 'Path' ||
      (platform === 'win32' &&
        /^(USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT)$/i.test(
          key,
        )) ||
      (platform === 'darwin' && /^(TMPDIR|__CF|SSH_AUTH_SOCK)$/.test(key)) ||
      key === 'SSH_AUTH_SOCK' ||
      key === 'DBUS_SESSION_BUS_ADDRESS'
    ) {
      env[key] = value;
    }
  }

  // Ensure PATH exists for discovery of helper binaries the CLI may need.
  if (!env['PATH'] && !env['Path'] && parentEnv['PATH']) {
    env['PATH'] = parentEnv['PATH'];
  }

  // Avoid inheriting Electron/Node debugger hooks into the child.
  delete env['NODE_OPTIONS'];
  delete env['ELECTRON_RUN_AS_NODE'];

  return env;
}
