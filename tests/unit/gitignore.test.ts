import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GITIGNORE_BLOCK_END,
  GITIGNORE_BLOCK_START,
  renderGitignoreBlock,
  updateGitignore,
} from "../../src/core/gitignore";
import { exists, makeTmpDir, readFile } from "../helpers";

const ENTRIES = ["src/routes/inventory/providers/", "src/shared/providers/**/*.gen.*"];

function gitignorePath(root: string): string {
  return path.join(root, ".gitignore");
}

describe("renderGitignoreBlock", () => {
  it("sorts and dedupes entries between the markers", () => {
    expect(renderGitignoreBlock(["b/", "a/", "b/"])).toBe(
      `${GITIGNORE_BLOCK_START}\na/\nb/\n${GITIGNORE_BLOCK_END}`,
    );
  });
});

describe("updateGitignore", () => {
  it("creates the file with the block when enabled and absent", () => {
    const root = makeTmpDir();
    const result = updateGitignore({
      gitignorePath: gitignorePath(root),
      enabled: true,
      entries: ENTRIES,
    });
    expect(result.changed).toBe(true);
    expect(readFile(gitignorePath(root))).toBe(
      `${GITIGNORE_BLOCK_START}\n${ENTRIES[0]}\n${ENTRIES[1]}\n${GITIGNORE_BLOCK_END}\n`,
    );
  });

  it("appends the block after existing content", () => {
    const root = makeTmpDir();
    fs.writeFileSync(gitignorePath(root), "node_modules\ndist\n");
    updateGitignore({ gitignorePath: gitignorePath(root), enabled: true, entries: ENTRIES });
    const content = readFile(gitignorePath(root));
    expect(content.startsWith("node_modules\ndist\n\n")).toBe(true);
    expect(content).toContain(GITIGNORE_BLOCK_START);
    expect(content.endsWith(`${GITIGNORE_BLOCK_END}\n`)).toBe(true);
  });

  it("is idempotent", () => {
    const root = makeTmpDir();
    updateGitignore({ gitignorePath: gitignorePath(root), enabled: true, entries: ENTRIES });
    const before = readFile(gitignorePath(root));
    const result = updateGitignore({
      gitignorePath: gitignorePath(root),
      enabled: true,
      entries: ENTRIES,
    });
    expect(result.changed).toBe(false);
    expect(readFile(gitignorePath(root))).toBe(before);
  });

  it("updates the block in place when entries change", () => {
    const root = makeTmpDir();
    fs.writeFileSync(gitignorePath(root), `dist\n\n${renderGitignoreBlock(["old/"])}\n\n# tail\n`);
    const result = updateGitignore({
      gitignorePath: gitignorePath(root),
      enabled: true,
      entries: ENTRIES,
    });
    expect(result.changed).toBe(true);
    const content = readFile(gitignorePath(root));
    expect(content).not.toContain("old/");
    expect(content).toContain(ENTRIES[0]!);
    expect(content.startsWith("dist\n")).toBe(true);
    expect(content).toContain("# tail");
  });

  it("removes the block when disabled", () => {
    const root = makeTmpDir();
    fs.writeFileSync(gitignorePath(root), `dist\n\n${renderGitignoreBlock(ENTRIES)}\n`);
    const result = updateGitignore({
      gitignorePath: gitignorePath(root),
      enabled: false,
      entries: ENTRIES,
    });
    expect(result.changed).toBe(true);
    const content = readFile(gitignorePath(root));
    expect(content).not.toContain(GITIGNORE_BLOCK_START);
    expect(content).toContain("dist");
  });

  it("does nothing when disabled and no block exists", () => {
    const root = makeTmpDir();
    expect(
      updateGitignore({ gitignorePath: gitignorePath(root), enabled: false, entries: ENTRIES })
        .changed,
    ).toBe(false);
    expect(exists(gitignorePath(root))).toBe(false);

    fs.writeFileSync(gitignorePath(root), "dist\n");
    expect(
      updateGitignore({ gitignorePath: gitignorePath(root), enabled: false, entries: ENTRIES })
        .changed,
    ).toBe(false);
    expect(readFile(gitignorePath(root))).toBe("dist\n");
  });

  it("dryRun reports a pending change without writing", () => {
    const root = makeTmpDir();
    const result = updateGitignore({
      gitignorePath: gitignorePath(root),
      enabled: true,
      entries: ENTRIES,
      dryRun: true,
    });
    expect(result.changed).toBe(true);
    expect(exists(gitignorePath(root))).toBe(false);
  });
});
