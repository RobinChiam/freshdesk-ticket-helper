/**
 * CLI discovery, version, and authentication preflight.
 * Never runs login/logout, install, or update commands.
 */
import type { CliAdapterId, CliCheckResult, CliInstallStatus } from '@fth/protocol';

import {
  assertAntigravityAutomationAllowed,
  buildAntigravityHelpArgs,
  buildAntigravityVersionArgs,
  detectAntigravityCapabilities,
} from './adapters/antigravity.js';
import {
  buildClaudeAuthStatusArgs,
  buildClaudeVersionArgs,
  claudeHelpSupportsAutomation,
  interpretClaudeAuthStatus,
} from './adapters/claudeCode.js';
import {
  buildCodexLoginStatusArgs,
  buildCodexVersionArgs,
  interpretCodexAuthStatus,
} from './adapters/codex.js';
import { buildCliEnvironment } from './environment.js';
import { locateCliExecutable } from './locator.js';
import { getAdapterDefinition } from './registry.js';
import { CliAdapterError, DEFAULT_CLI_LIMITS, type ProcessRunner } from './types.js';
import { createIsolatedWorkdir } from './workdir.js';

const PREFLIGHT_LIMITS = {
  ...DEFAULT_CLI_LIMITS,
  startupTimeoutMs: 15_000,
  totalTimeoutMs: 20_000,
  maxStdoutBytes: 64_000,
  maxStderrBytes: 64_000,
};

export type PreflightDeps = {
  runner: ProcessRunner;
  platform?: NodeJS.Platform;
  homeDir?: string;
  pathEnv?: string;
};

export async function checkCliInstallation(
  adapter: CliAdapterId,
  executableOverride: string | undefined,
  deps: PreflightDeps,
): Promise<CliCheckResult> {
  const def = getAdapterDefinition(adapter);
  let executablePath: string;
  try {
    executablePath = locateCliExecutable(adapter, executableOverride, {
      platform: deps.platform,
      homeDir: deps.homeDir,
      pathEnv: deps.pathEnv,
    }).path;
  } catch (error) {
    return statusResult(
      adapter,
      'missing',
      null,
      null,
      safeMessage(error, `${def.displayName} was not found.`),
    );
  }

  const work = createIsolatedWorkdir('fth-cli-preflight-');
  try {
    const env = buildCliEnvironment(adapter, process.env, deps.platform ?? process.platform);
    const version = await readVersion(adapter, executablePath, work.path, env, deps.runner);

    if (adapter === 'antigravity') {
      return await checkAntigravity(executablePath, version, work.path, env, deps.runner);
    }
    if (adapter === 'codex') {
      return await checkCodex(executablePath, version, work.path, env, deps.runner);
    }
    return await checkClaude(executablePath, version, work.path, env, deps.runner);
  } finally {
    work.cleanup();
  }
}

async function checkCodex(
  executablePath: string,
  version: string | null,
  cwd: string,
  env: NodeJS.ProcessEnv,
  runner: ProcessRunner,
): Promise<CliCheckResult> {
  const controller = new AbortController();
  try {
    const result = await runner({
      executable: executablePath,
      args: buildCodexLoginStatusArgs(),
      cwd,
      env,
      stdin: '',
      signal: controller.signal,
      limits: PREFLIGHT_LIMITS,
    });
    const auth = await interpretCodexAuthStatus(result.stdout + result.stderr, result.exitCode);
    if (auth === 'login_required') {
      return statusResult(
        'codex',
        'login_required',
        executablePath,
        version,
        'Codex CLI is installed but not authenticated. Run `codex login` in a terminal, then check again.',
      );
    }
    return statusResult(
      'codex',
      'ready',
      executablePath,
      version,
      'Codex CLI is installed and authenticated.',
    );
  } catch {
    return statusResult(
      'codex',
      'installed_auth_unverified',
      executablePath,
      version,
      'Codex CLI is installed; authentication status could not be verified.',
    );
  }
}

async function checkClaude(
  executablePath: string,
  version: string | null,
  cwd: string,
  env: NodeJS.ProcessEnv,
  runner: ProcessRunner,
): Promise<CliCheckResult> {
  const controller = new AbortController();
  try {
    const help = await runner({
      executable: executablePath,
      args: ['--help'],
      cwd,
      env,
      stdin: '',
      signal: controller.signal,
      limits: PREFLIGHT_LIMITS,
    });
    if (!claudeHelpSupportsAutomation(`${help.stdout}\n${help.stderr}`)) {
      return statusResult(
        'claude-code',
        'unsupported_version',
        executablePath,
        version,
        'The installed Claude Code CLI version lacks required automation controls.',
      );
    }
  } catch {
    return statusResult(
      'claude-code',
      'installed_auth_unverified',
      executablePath,
      version,
      'Claude Code CLI is installed; capability checks could not be completed.',
    );
  }

  try {
    const authRun = await runner({
      executable: executablePath,
      args: buildClaudeAuthStatusArgs(),
      cwd,
      env,
      stdin: '',
      signal: new AbortController().signal,
      limits: PREFLIGHT_LIMITS,
    });
    const auth = interpretClaudeAuthStatus(authRun.stdout || authRun.stderr, authRun.exitCode);
    if (auth === 'login_required') {
      return statusResult(
        'claude-code',
        'login_required',
        executablePath,
        version,
        'Claude Code CLI is installed but not authenticated. Run `claude auth login` in a terminal, then check again.',
      );
    }
    return statusResult(
      'claude-code',
      'ready',
      executablePath,
      version,
      'Claude Code CLI is installed and authenticated.',
    );
  } catch {
    return statusResult(
      'claude-code',
      'installed_auth_unverified',
      executablePath,
      version,
      'Claude Code CLI is installed; authentication status could not be verified.',
    );
  }
}

async function checkAntigravity(
  executablePath: string,
  version: string | null,
  cwd: string,
  env: NodeJS.ProcessEnv,
  runner: ProcessRunner,
): Promise<CliCheckResult> {
  try {
    const help = await runner({
      executable: executablePath,
      args: buildAntigravityHelpArgs(),
      cwd,
      env,
      stdin: '',
      signal: new AbortController().signal,
      limits: PREFLIGHT_LIMITS,
    });
    const helpText = `${help.stdout}\n${help.stderr}`;
    const caps = detectAntigravityCapabilities(helpText);
    try {
      assertAntigravityAutomationAllowed(helpText);
    } catch {
      return statusResult(
        'antigravity',
        'secure_automation_unsupported',
        executablePath,
        version,
        'Installed, but secure automation is unsupported by this CLI version.',
      );
    }
    if (!caps.secureAutomationSupported) {
      return statusResult(
        'antigravity',
        'secure_automation_unsupported',
        executablePath,
        version,
        'Installed, but secure automation is unsupported by this CLI version.',
      );
    }
    return statusResult(
      'antigravity',
      'installed_auth_unverified',
      executablePath,
      version,
      'Antigravity CLI reports automation capabilities; authenticate in a terminal if prompted by the OS credential store.',
    );
  } catch (error) {
    if (error instanceof CliAdapterError && error.code === 'secure_automation_unsupported') {
      return statusResult(
        'antigravity',
        'secure_automation_unsupported',
        executablePath,
        version,
        error.message,
      );
    }
    return statusResult(
      'antigravity',
      'installed',
      executablePath,
      version,
      'Antigravity CLI is installed; secure automation support could not be verified.',
    );
  }
}

async function readVersion(
  adapter: CliAdapterId,
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  runner: ProcessRunner,
): Promise<string | null> {
  const args =
    adapter === 'antigravity'
      ? buildAntigravityVersionArgs()
      : adapter === 'codex'
        ? buildCodexVersionArgs()
        : buildClaudeVersionArgs();
  try {
    const result = await runner({
      executable,
      args,
      cwd,
      env,
      stdin: '',
      signal: new AbortController().signal,
      limits: PREFLIGHT_LIMITS,
    });
    const text = (result.stdout || result.stderr).trim().split('\n')[0] ?? '';
    return text.slice(0, 120) || null;
  } catch {
    return null;
  }
}

function statusResult(
  adapter: CliAdapterId,
  status: CliInstallStatus,
  executablePath: string | null,
  version: string | null,
  message: string,
): CliCheckResult {
  return { adapter, status, executablePath, version, message };
}

function safeMessage(error: unknown, fallback: string): string {
  if (error instanceof CliAdapterError) return error.message;
  return fallback;
}
