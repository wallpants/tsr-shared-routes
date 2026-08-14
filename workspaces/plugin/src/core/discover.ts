import fs from "node:fs";
import path from "node:path";
import { parseAst } from "@tanstack/router-utils";
import { SharedRoutesError } from "./errors";

export const MOUNT_FILE_RE = /\.mount\.(t|j)s$/;

/** The package name mount() must be imported from. */
const PACKAGE_NAME = "tsr-shared-routes";

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

/** Boilerplate written into byte-empty mount files (see scaffoldEmptyMountFile). */
export const MOUNT_SCAFFOLD = `import { mount } from '${PACKAGE_NAME}'\n\nexport default mount('')\n`;

export type MountClassification =
   /** Well-formed with a non-empty shared-dir path. */
   | { kind: "valid"; sharedDirRelative: string }
   /** Blank file or `mount('')`: being authored right now — never an error. */
   | { kind: "incomplete" }
   /** Anything else; `error` carries the full accepted-form message. */
   | { kind: "invalid"; error: SharedRoutesError };

/**
 * Statically classifies a mount file. Mount files are never executed — the
 * only accepted form is `export default mount('<literal>')` with `mount`
 * imported (possibly renamed) from '${PACKAGE_NAME}'. A blank file or an
 * empty-string argument is `incomplete`, not `invalid`: that is the mid-edit
 * state every mount file passes through (the scaffold writes `mount('')`).
 */
export function classifyMountFile(code: string, mountFilePath: string): MountClassification {
   if (code.trim() === "") return { kind: "incomplete" };
   try {
      const sharedDirRelative = parseMountFileStrict(code, mountFilePath);
      return sharedDirRelative === ""
         ? { kind: "incomplete" }
         : { kind: "valid", sharedDirRelative };
   } catch (error) {
      if (error instanceof SharedRoutesError) return { kind: "invalid", error };
      throw error;
   }
}

/**
 * Strict variant: throws on invalid content, and returns "" for the
 * incomplete `mount('')` form (blank files never reach it via classify).
 */
export function parseMountFile(code: string, mountFilePath: string): string {
   return parseMountFileStrict(code, mountFilePath);
}

function parseMountFileStrict(code: string, mountFilePath: string): string {
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

/**
 * Writes the mount boilerplate into a byte-empty (or whitespace-only) mount
 * file so creating one in an editor immediately yields the accepted form with
 * only the shared-dir path left to fill in. Returns true when scaffolded.
 */
export function scaffoldEmptyMountFile(mountFilePath: string, code: string): boolean {
   if (code.trim() !== "") return false;
   fs.writeFileSync(mountFilePath, MOUNT_SCAFFOLD, "utf8");
   return true;
}

export interface DiscoverOptions {
   /**
    * Lenient (dev-server) mode: invalid mount files become warnings and are
    * skipped instead of aborting discovery. Strict (CLI) mode throws.
    */
   lenient?: boolean;
   /** Populate byte-empty mount files with the boilerplate scaffold. */
   scaffold?: boolean;
}

export interface DiscoverResult {
   mounts: Array<DiscoveredMount>;
   /** Mount files skipped this pass (incomplete or, in lenient mode, invalid). */
   skipped: Array<string>;
   /** One line per skipped-invalid mount file (lenient mode only). */
   warnings: Array<string>;
   /** Root-relative-agnostic notes about incomplete files (CLI display only). */
   incomplete: Array<string>;
   /** Absolute paths of mount files that received the scaffold this pass. */
   scaffolded: Array<string>;
}

/** Discovers and statically classifies every mount file under `routesDirectory` (absolute). */
export function discoverMounts(
   routesDirectory: string,
   options: DiscoverOptions = {},
): DiscoverResult {
   const { lenient = false, scaffold = false } = options;
   const mounts: Array<DiscoveredMount> = [];
   const skipped: Array<string> = [];
   const warnings: Array<string> = [];
   const incomplete: Array<string> = [];
   const scaffolded: Array<string> = [];

   for (const mountFilePath of discoverMountFiles(routesDirectory)) {
      const code = fs.readFileSync(mountFilePath, "utf8");
      if (scaffold && scaffoldEmptyMountFile(mountFilePath, code)) {
         scaffolded.push(mountFilePath);
         skipped.push(mountFilePath);
         incomplete.push(`mount file ${mountFilePath} is waiting for its shared-dir path`);
         continue;
      }
      const classified = classifyMountFile(code, mountFilePath);
      if (classified.kind === "valid") {
         mounts.push({ mountFilePath, sharedDirRelative: classified.sharedDirRelative });
      } else if (classified.kind === "incomplete") {
         skipped.push(mountFilePath);
         incomplete.push(`mount file ${mountFilePath} is waiting for its shared-dir path`);
      } else if (lenient) {
         skipped.push(mountFilePath);
         warnings.push(
            `skipping invalid mount file ${mountFilePath} (run \`tsr-shared-routes generate\` for details)`,
         );
      } else {
         throw classified.error;
      }
   }
   return { mounts, skipped, warnings, incomplete, scaffolded };
}
