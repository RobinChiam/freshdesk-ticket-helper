/**
 * Cross-platform CLI executable discovery and override validation.
 * Rejects shell wrappers (.cmd/.bat), directories, URLs, and unrelated filenames.
 */
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { basename, delimiter, isAbsolute, join, resolve } from 'node:path';

import type { CliAdapterId } from '@fth/protocol';

import { allowedExecutableBasenames, getAdapterDefinition } from './registry.js';
import { CliAdapterError } from './types.js';

const UNSAFE_EXTENSIONS = new Set([
  '.cmd',
  '.bat',
  '.ps1',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.vbs',
]);

export type LocatorOptions = {
  platform?: NodeJS.Platform;
  homeDir?: string;
  pathEnv?: string;
  pathExists?: (path: string) => boolean;
  realpath?: (path: string) => string;
  isFile?: (path: string) => boolean;
};

export type LocatedExecutable = {
  path: string;
  source: 'override' | 'candidate' | 'path';
};

export function locateCliExecutable(
  adapter: CliAdapterId,
  overridePath: string | undefined,
  options: LocatorOptions = {},
): LocatedExecutable {
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  const pathExists = options.pathExists ?? existsSync;
  const realpath = options.realpath ?? ((p: string) => realpathSync(p));
  const isFile =
    options.isFile ??
    ((p: string) => {
      try {
        return lstatSync(p).isFile();
      } catch {
        return false;
      }
    });

  if (overridePath?.trim()) {
    return {
      path: validateExecutableOverride(adapter, overridePath.trim(), {
        platform,
        pathExists,
        realpath,
        isFile,
      }),
      source: 'override',
    };
  }

  const def = getAdapterDefinition(adapter);
  const names = platform === 'win32' ? def.executableNames.windows : def.executableNames.unix;

  for (const dir of def.candidateDirectories(home, platform)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (!pathExists(candidate) || !isFile(candidate)) continue;
      if (!isSafeExecutablePath(adapter, candidate, { platform, realpath, isFile, pathExists })) {
        continue;
      }
      return { path: canonicalize(candidate, realpath), source: 'candidate' };
    }
  }

  const pathEnv = options.pathEnv ?? process.env['PATH'] ?? '';
  for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (!pathExists(candidate) || !isFile(candidate)) continue;
      if (!isSafeExecutablePath(adapter, candidate, { platform, realpath, isFile, pathExists })) {
        continue;
      }
      return { path: canonicalize(candidate, realpath), source: 'path' };
    }
  }

  throw new CliAdapterError(
    'cli_missing',
    `${def.displayName} was not found. Install it with the provider's native installer, authenticate in a terminal, then try again.`,
  );
}

export function validateExecutableOverride(
  adapter: CliAdapterId,
  rawPath: string,
  options: LocatorOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const pathExists = options.pathExists ?? existsSync;
  const realpath = options.realpath ?? ((p: string) => realpathSync(p));
  const isFile =
    options.isFile ??
    ((p: string) => {
      try {
        return lstatSync(p).isFile();
      } catch {
        return false;
      }
    });

  if (!rawPath || lookLikeUrl(rawPath)) {
    throw new CliAdapterError(
      'cli_missing',
      'Choose a local executable file, not a URL or empty path.',
    );
  }
  // Reject UNC / network paths on Windows before other path checks.
  if (platform === 'win32' && (rawPath.startsWith('\\\\') || rawPath.startsWith('//'))) {
    throw new CliAdapterError('cli_missing', 'Network paths are not allowed for CLI executables.');
  }
  if (!isAbsolute(rawPath)) {
    throw new CliAdapterError('cli_missing', 'CLI executable override must be an absolute path.');
  }
  if (!pathExists(rawPath)) {
    throw new CliAdapterError('cli_missing', 'The selected CLI executable does not exist.');
  }
  if (!isFile(rawPath)) {
    throw new CliAdapterError(
      'cli_missing',
      'The selected path must be a regular executable file.',
    );
  }
  if (!isSafeExecutablePath(adapter, rawPath, { platform, realpath, isFile, pathExists })) {
    throw new CliAdapterError(
      'cli_missing',
      `The selected file is not an allowed ${getAdapterDefinition(adapter).displayName} executable.`,
    );
  }
  return canonicalize(rawPath, realpath);
}

function isSafeExecutablePath(
  adapter: CliAdapterId,
  path: string,
  options: Required<Pick<LocatorOptions, 'platform' | 'realpath' | 'isFile' | 'pathExists'>>,
): boolean {
  const base = basename(path).toLowerCase();
  const allow = allowedExecutableBasenames(adapter);
  if (!allow.has(base)) return false;

  const ext = extensionOf(base);
  if (UNSAFE_EXTENSIONS.has(ext)) return false;
  // Prefer native binaries; reject cmd/bat wrappers even if basename matched somehow.
  if (options.platform === 'win32' && (base.endsWith('.cmd') || base.endsWith('.bat'))) {
    return false;
  }

  try {
    const resolved = canonicalize(path, options.realpath);
    if (!options.pathExists(resolved) || !options.isFile(resolved)) return false;
    const resolvedBase = basename(resolved).toLowerCase();
    if (!allow.has(resolvedBase)) return false;
    if (UNSAFE_EXTENSIONS.has(extensionOf(resolvedBase))) return false;
    return true;
  } catch {
    return false;
  }
}

function canonicalize(path: string, realpath: (p: string) => string): string {
  return resolve(realpath(path));
}

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx) : '';
}

function lookLikeUrl(value: string): boolean {
  // Avoid treating Windows drive letters (C:\...) as URLs.
  if (/^[a-zA-Z]:[\\/]/.test(value)) return false;
  return /^(https?|file|ftp):/i.test(value);
}
