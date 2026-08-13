import { parseAst } from "@tanstack/router-utils";
import fs from "node:fs";
import path from "node:path";
import { SharedRoutesError } from "./errors";

export const MOUNT_FILE_RE = /\.mount\.(t|j)s$/;

/** The package name mount() must be imported from. */
const PACKAGE_NAME = "tanstack-shared-routes";

export interface DiscoveredMount {
  /** Absolute path of the `*.mount.ts` file. */
  mountFilePath: string;
  /** The string literal passed to mount(): shared dir, relative to the mount file. */
  sharedDirRelative: string;
}

export function isMountFile(filePath: string): boolean {
  return MOUNT_FILE_RE.test(filePath);
}

const ACCEPTED_FORM = [
  "A mount file must contain exactly:",
  `  import { mount } from '${PACKAGE_NAME}'`,
  "  export default mount('<relative-path-to-shared-dir>')",
  "The argument must be a plain string literal (no template literals, variables, or expressions).",
].join("\n");

function parseError(mountFilePath: string, reason: string): SharedRoutesError {
  return new SharedRoutesError(
    "MOUNT_PARSE_ERROR",
    `invalid mount file ${mountFilePath}: ${reason}.\n${ACCEPTED_FORM}`,
  );
}

/**
 * Statically extracts the shared-dir path from a mount file. Mount files are
 * never executed — we accept exactly `export default mount('<literal>')` with
 * `mount` imported (possibly renamed) from '${PACKAGE_NAME}'.
 */
export function parseMountFile(code: string, mountFilePath: string): string {
  let ast: ReturnType<typeof parseAst>;
  try {
    ast = parseAst({ code, filename: path.basename(mountFilePath) });
  } catch (error) {
    throw parseError(mountFilePath, `could not parse file (${(error as Error).message})`);
  }

  // 1. Find the local name `mount` was imported as.
  let localMountName: string | undefined;
  for (const statement of ast.program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    if (statement.source.value !== PACKAGE_NAME) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ImportSpecifier") continue;
      const importedName =
        specifier.imported.type === "Identifier"
          ? specifier.imported.name
          : specifier.imported.value;
      if (importedName === "mount") {
        localMountName = specifier.local.name;
        break;
      }
    }
  }
  if (localMountName === undefined) {
    throw parseError(mountFilePath, `missing \`import { mount } from '${PACKAGE_NAME}'\``);
  }

  // 2. Find `export default <localMountName>('<literal>')`.
  const defaultExport = ast.program.body.find(
    (statement) => statement.type === "ExportDefaultDeclaration",
  );
  if (defaultExport === undefined) {
    throw parseError(mountFilePath, "missing `export default mount(...)`");
  }
  const declaration = defaultExport.declaration;
  if (declaration.type !== "CallExpression") {
    throw parseError(mountFilePath, "the default export must be a call to mount(...)");
  }
  if (declaration.callee.type !== "Identifier" || declaration.callee.name !== localMountName) {
    throw parseError(
      mountFilePath,
      `the default export must call \`${localMountName}\` (the mount import)`,
    );
  }
  if (declaration.arguments.length !== 1) {
    throw parseError(mountFilePath, "mount() takes exactly one argument");
  }
  const argument = declaration.arguments[0]!;
  if (argument.type === "TemplateLiteral") {
    if (argument.expressions.length === 0 && argument.quasis.length === 1) {
      // A plain template literal with no expressions is still a static string,
      // but we keep the accepted form strict: reject with a precise hint.
      throw parseError(mountFilePath, "use a plain string literal, not a template literal");
    }
    throw parseError(mountFilePath, "the mount() argument must be a static string literal");
  }
  if (argument.type !== "StringLiteral") {
    throw parseError(mountFilePath, "the mount() argument must be a static string literal");
  }
  if (argument.value === "") {
    throw parseError(mountFilePath, "the mount() argument must not be empty");
  }
  return argument.value;
}

/** Recursively finds `*.mount.(t|j)s` files under `routesDirectory` (absolute). */
export function discoverMountFiles(routesDirectory: string): Array<string> {
  const found: Array<string> = [];
  const walk = (dir: string): void => {
    let entries: Array<fs.Dirent>;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && isMountFile(entry.name)) found.push(fullPath);
    }
  };
  walk(routesDirectory);
  return found.sort();
}

/** Discovers and statically parses every mount file under `routesDirectory` (absolute). */
export function discoverMounts(routesDirectory: string): Array<DiscoveredMount> {
  return discoverMountFiles(routesDirectory).map((mountFilePath) => ({
    mountFilePath,
    sharedDirRelative: parseMountFile(fs.readFileSync(mountFilePath, "utf8"), mountFilePath),
  }));
}
