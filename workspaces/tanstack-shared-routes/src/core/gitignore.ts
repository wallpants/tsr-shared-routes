import fs from "node:fs";
import { readIfExists } from "./fsio";

export const GITIGNORE_BLOCK_START = "# >>> tanstack-shared-routes (auto)";
export const GITIGNORE_BLOCK_END = "# <<< tanstack-shared-routes";

export interface GitignoreUpdateOptions {
  /** Absolute path of the project-root .gitignore. */
  gitignorePath: string;
  /** false removes the managed block if present. */
  enabled: boolean;
  /** Ignore entries (root-relative posix globs), rendered sorted + deduped. */
  entries: Array<string>;
  /** When true, report whether a write would happen without writing. */
  dryRun?: boolean;
}

export function renderGitignoreBlock(entries: Array<string>): string {
  const unique = [...new Set(entries)].sort();
  return [GITIGNORE_BLOCK_START, ...unique, GITIGNORE_BLOCK_END].join("\n");
}

/**
 * Adds, updates, or removes the managed block idempotently. Compares before
 * writing; returns whether the file changed (or would change under dryRun).
 */
export function updateGitignore(options: GitignoreUpdateOptions): { changed: boolean } {
  const { gitignorePath, enabled, entries, dryRun = false } = options;
  const existing = readIfExists(gitignorePath);

  const next = computeNextContent(existing, enabled, entries);
  if (next === existing || (existing === undefined && next === undefined)) {
    return { changed: false };
  }
  if (!dryRun && next !== undefined) fs.writeFileSync(gitignorePath, next, "utf8");
  return { changed: true };
}

function computeNextContent(
  existing: string | undefined,
  enabled: boolean,
  entries: Array<string>,
): string | undefined {
  const block = renderGitignoreBlock(entries);

  if (existing === undefined) {
    // No .gitignore: only create one when we actually have a block to add.
    return enabled ? `${block}\n` : undefined;
  }

  const lines = existing.split("\n");
  const start = lines.indexOf(GITIGNORE_BLOCK_START);
  const end = lines.indexOf(GITIGNORE_BLOCK_END);
  const hasBlock = start !== -1 && end !== -1 && end >= start;

  if (!enabled) {
    if (!hasBlock) return existing;
    const before = lines.slice(0, start);
    const after = lines.slice(end + 1);
    // Drop a single separating blank line we may have added.
    if (before[before.length - 1] === "" && (after[0] === "" || after.length === 0)) {
      before.pop();
    }
    const result = [...before, ...after].join("\n");
    return result === "" ? "" : result;
  }

  if (hasBlock) {
    const next = [...lines.slice(0, start), ...block.split("\n"), ...lines.slice(end + 1)];
    return next.join("\n");
  }

  const trimmed = existing.endsWith("\n") ? existing.slice(0, -1) : existing;
  return trimmed === "" ? `${block}\n` : `${trimmed}\n\n${block}\n`;
}
