import * as fs from 'fs';
import * as path from 'path';

/**
 * File-reference handling for agy prompts.
 *
 * Why this exists: `agy --print` resolves an `@file` reference ONLY when the
 * file's directory is part of the workspace (`--add-dir`). cwd is never
 * auto-registered. An `@file` outside any added dir makes agy hang until
 * `--print-timeout`. So for every reference in a prompt that actually resolves
 * to a real file under a trusted root (the working directory or an explicitly
 * supplied includeDirectories entry), we register that root with `--add-dir`.
 *
 * We never inline file contents: agy reads the file itself, keeping the
 * `--print` argv small and preserving the large-file use case (inlining would
 * risk E2BIG). References that don't resolve under a trusted root are left
 * untouched — the prompt still runs.
 */

/** Normalize a comma-separated string or array into a trimmed, non-empty list. */
export function normalizeList(value?: string | string[]): string[] {
  if (!value) return [];
  const items = Array.isArray(value) ? value : value.split(',');
  return items.map(item => item.trim()).filter(Boolean);
}

// `@` reference: an `@` that is NOT part of an email/scoped continuation
// (preceded by a word char, another `@`, `/`, or `.`), then a run of non-space,
// non-`@` characters. Existence under a trust root — not shape — gates whether
// it is treated as a file, so extensionless names (Makefile, LICENSE) work.
const AT_REF = /(?<![\w@/.])@([^\s@]+)/g;
// `file:` reference: `file:` at a word boundary, not a `file://` URL.
const FILE_REF = /(?<![\w])file:(?!\/\/)(\S+)/g;

const TRAILING_PUNCT = /[),.;:!?\]}'"`]+$/;

function stripTrailingPunct(token: string): string {
  return token.replace(TRAILING_PUNCT, '');
}

/** True when `p` resolves to a filesystem root (e.g. `/` or `C:\`). */
export function isFilesystemRoot(p: string): boolean {
  try {
    const resolved = path.resolve(p);
    return resolved === path.parse(resolved).root;
  } catch {
    return false;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Realpath'd, existing directories that references may resolve under: the
 * working directory plus each includeDirectories entry.
 */
function resolveTrustRoots(cwd: string | undefined, includeDirectories?: string | string[]): string[] {
  const baseCwd = cwd || process.cwd();
  const candidates = [baseCwd, ...normalizeList(includeDirectories).map(d => path.resolve(baseCwd, d))];
  const roots: string[] = [];
  for (const candidate of candidates) {
    try {
      const real = fs.realpathSync(candidate);
      if (fs.statSync(real).isDirectory()) roots.push(real);
    } catch {
      // Non-existent / unreadable root — skip.
    }
  }
  return [...new Set(roots)];
}

/**
 * Resolve a token to the trust root it lives under. agy joins the reference
 * path to an added dir, so the root that resolves the token is exactly what
 * must be added. Returns null for tokens that don't resolve to a real file, or
 * that escape every root via absolute/`..`/symlink.
 */
function rootForToken(rawToken: string, roots: string[]): string | null {
  const token = stripTrailingPunct(rawToken);
  if (!token) return null;
  for (const root of roots) {
    try {
      const real = fs.realpathSync(path.resolve(root, token));
      if (isWithin(root, real) && fs.statSync(real).isFile()) return root;
    } catch {
      // Does not resolve under this root — try the next one.
    }
  }
  return null;
}

/**
 * Normalize file references in a prompt and collect the `--add-dir` roots agy
 * needs to read them. Returns the (possibly rewritten) prompt and the deduped
 * list of trust roots that contain a resolved reference. Never throws.
 */
export function resolveFileReferences(
  prompt: string,
  opts: { cwd?: string; includeDirectories?: string | string[] },
): { prompt: string; addDirs: string[] } {
  const roots = resolveTrustRoots(opts.cwd, opts.includeDirectories);
  if (roots.length === 0) return { prompt, addDirs: [] };

  const addDirs = new Set<string>();

  // Rewrite a `file:` reference to `@` ONLY when it resolves to a real file
  // under a trusted root — otherwise we'd hand agy a dangling @ref that hangs.
  // The converted token drops trailing punctuation so agy sees the exact path.
  const rewritten = prompt.replace(FILE_REF, (match, rawToken: string) => {
    const root = rootForToken(rawToken, roots);
    if (!root) return match;
    addDirs.add(root);
    return `@${stripTrailingPunct(rawToken)}`;
  });

  // Collect the trust root for every `@` reference that resolves.
  AT_REF.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AT_REF.exec(rewritten)) !== null) {
    if (addDirs.size >= roots.length) break; // every root already registered
    const root = rootForToken(m[1], roots);
    if (root) addDirs.add(root);
  }

  return { prompt: rewritten, addDirs: [...addDirs] };
}
