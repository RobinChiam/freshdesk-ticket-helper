/**
 * Google Antigravity CLI adapter — capability-gated.
 *
 * Public docs describe `agy -p` one-shot prompts but do not establish a stable
 * structured-output + secure-stdin + tool-containment contract comparable to Codex/Claude.
 * Ticket chat stays disabled unless feature detection proves those capabilities.
 * Never put ticket content in `agy -p "<prompt>"`.
 */
import type { CliAdapterId } from '@fth/protocol';

import { CliAdapterError } from '../types.js';

export type AntigravityCapabilities = {
  hasPrintMode: boolean;
  mentionsStdin: boolean;
  hasStructuredOutput: boolean;
  hasToolContainment: boolean;
  hasSessionDisable: boolean;
  secureAutomationSupported: boolean;
  reasons: string[];
};

/**
 * Fail closed: require explicit evidence of stdin, non-TUI print mode, parseable output,
 * tool/file/MCP containment, and no session persistence for ticket data.
 */
export function detectAntigravityCapabilities(helpText: string): AntigravityCapabilities {
  const text = helpText.toLowerCase();
  const reasons: string[] = [];

  const hasPrintMode = /\s-p\b|--print\b|--prompt\b/.test(text);
  if (!hasPrintMode) reasons.push('No non-interactive print mode documented in help.');

  // Require an explicit stdin contract — piping alone without documentation is insufficient.
  const mentionsStdin =
    /\bstdin\b/.test(text) ||
    /read (the )?prompt from stdin/.test(text) ||
    /prompt from standard input/.test(text) ||
    /\s-\s*(as|for) (the )?prompt/.test(text);
  if (!mentionsStdin) {
    reasons.push('No documented secure stdin prompt contract.');
  }

  const hasStructuredOutput = /jsonl|stream-json|output-format|--json\b|structured output/.test(
    text,
  );
  if (!hasStructuredOutput) {
    reasons.push('No deterministic structured output format documented.');
  }

  const hasToolContainment =
    (/--tools\b/.test(text) && /disallowed/.test(text)) ||
    /--allowed-tools\b/.test(text) ||
    (/sandbox/.test(text) && /strict|read-only|no-tools|disable.*tool/.test(text));
  if (!hasToolContainment) {
    reasons.push('No documented controls to disable tools, file access, MCP, or web actions.');
  }

  const hasSessionDisable =
    /no-session|ephemeral|without.*session|disable.*session|no-persist/.test(text);
  if (!hasSessionDisable) {
    reasons.push('No documented way to disable session persistence for ticket data.');
  }

  const secureAutomationSupported =
    hasPrintMode && mentionsStdin && hasStructuredOutput && hasToolContainment && hasSessionDisable;

  if (!secureAutomationSupported && reasons.length === 0) {
    reasons.push('Secure automation requirements are not met by this CLI version.');
  }

  return {
    hasPrintMode,
    mentionsStdin,
    hasStructuredOutput,
    hasToolContainment,
    hasSessionDisable,
    secureAutomationSupported,
    reasons,
  };
}

export function assertAntigravityAutomationAllowed(helpText: string): void {
  const caps = detectAntigravityCapabilities(helpText);
  if (!caps.secureAutomationSupported) {
    throw new CliAdapterError(
      'secure_automation_unsupported',
      'Installed, but secure automation is unsupported by this CLI version.',
    );
  }
}

/** Antigravity must never receive ticket text via argv print flags. */
export function buildAntigravityPrintArgsForTicket(): never {
  throw new CliAdapterError(
    'secure_automation_unsupported',
    'Installed, but secure automation is unsupported by this CLI version.',
  );
}

export function buildAntigravityVersionArgs(): string[] {
  return ['--version'];
}

export function buildAntigravityHelpArgs(): string[] {
  return ['--help'];
}

export const ANTIGRAVITY_ADAPTER_ID: CliAdapterId = 'antigravity';
