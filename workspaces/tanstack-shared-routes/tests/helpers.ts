import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import type { SharedRoutesConfig, SharedRoutesUserConfig } from "../src/config";
import { resolveConfig } from "../src/config";

const created: Array<string> = [];

afterEach(() => {
  while (created.length > 0) {
    fs.rmSync(created.pop()!, { recursive: true, force: true });
  }
});

/** Creates a temp dir (auto-removed after each test). Returns its realpath. */
export function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsr-shared-"));
  created.push(dir);
  // macOS: /var/folders → /private/var/folders; realpath keeps comparisons stable.
  return fs.realpathSync(dir);
}

/** Writes a file tree: keys are posix-relative paths, values are contents. */
export function writeTree(root: string, tree: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(tree)) {
    const filePath = path.join(root, ...relPath.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
}

export function mountFileSource(sharedDirRelative: string): string {
  return `import { mount } from 'tanstack-shared-routes'\nexport default mount('${sharedDirRelative}')\n`;
}

export function makeConfig(
  root: string,
  overrides: SharedRoutesUserConfig = {},
): SharedRoutesConfig {
  return resolveConfig(overrides, root);
}

/** Reads a file as utf8 (throws when missing). */
export function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

export function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
