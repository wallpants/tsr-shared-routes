#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type { SharedRoutesUserConfig } from "./config";
import { resolveConfig } from "./config";
import { runPipeline } from "./core/pipeline";

/** Optional config file read from the project root. */
export const CONFIG_FILE_NAME = "shared-routes.config.json";

const USAGE = [
   "Usage: tsr-shared-routes generate [--check] [--root <dir>]",
   "",
   "  generate        run the shared-routes codegen pipeline once",
   "  --check         report would-be changes without writing; exit 1 if any",
   "  --root <dir>    project root (default: current working directory)",
   "",
   `Config: optional ${CONFIG_FILE_NAME} at the project root (zero config works).`,
].join("\n");

export interface CliIO {
   log(message: string): void;
   error(message: string): void;
}

/** Parsed and validated argv, or an error already reported through `io`. */
function parseArgs(
   argv: Array<string>,
   io: CliIO,
): { check: boolean; root: string } | { exitCode: number } {
   const [command, ...rest] = argv;
   if (command === undefined || command === "--help" || command === "-h" || command === "help") {
      io.log(USAGE);
      return { exitCode: command === undefined ? 1 : 0 };
   }
   if (command !== "generate") {
      io.error(`tsr-shared-routes: unknown command ${JSON.stringify(command)}\n${USAGE}`);
      return { exitCode: 1 };
   }

   let check = false;
   let root = process.cwd();
   for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!;
      if (arg === "--check") {
         check = true;
      } else if (arg === "--root") {
         const value = rest[++i];
         if (value === undefined) {
            io.error(`tsr-shared-routes: --root requires a value\n${USAGE}`);
            return { exitCode: 1 };
         }
         root = path.resolve(value);
      } else {
         io.error(`tsr-shared-routes: unknown option ${JSON.stringify(arg)}\n${USAGE}`);
         return { exitCode: 1 };
      }
   }
   return { check, root };
}

function readConfigFile(root: string, io: CliIO): SharedRoutesUserConfig | { exitCode: number } {
   const configPath = path.join(root, CONFIG_FILE_NAME);
   if (!fs.existsSync(configPath)) return {};
   try {
      return JSON.parse(fs.readFileSync(configPath, "utf8")) as SharedRoutesUserConfig;
   } catch (error) {
      io.error(`tsr-shared-routes: could not parse ${configPath}: ${(error as Error).message}`);
      return { exitCode: 1 };
   }
}

const defaultIO: CliIO = {
   log: (message) => console.log(message),
   error: (message) => console.error(message),
};

/** CLI entry point; returns the process exit code. */
export function main(argv: Array<string>, io: CliIO = defaultIO): number {
   const parsed = parseArgs(argv, io);
   if ("exitCode" in parsed) return parsed.exitCode;
   const { check, root } = parsed;

   const userConfig = readConfigFile(root, io);
   if ("exitCode" in userConfig) return userConfig.exitCode;

   try {
      const summary = runPipeline(resolveConfig(userConfig, root), { check });
      for (const warning of summary.errors) io.error(`warning: ${warning}`);
      for (const note of summary.incomplete) io.log(`incomplete: ${note}`);
      for (const file of summary.scaffolded) io.log(`scaffolded ${file}`);
      for (const file of summary.rewritten) io.log(`retargeted import in ${file}`);

      if (check) {
         for (const file of summary.written) io.log(`would write ${file}`);
         for (const file of summary.deleted) io.log(`would delete ${file}`);
         const pending = summary.written.length + summary.deleted.length;
         if (pending > 0) {
            io.error(
               `tsr-shared-routes: ${pending} pending change(s) — run \`tsr-shared-routes generate\``,
            );
            return 1;
         }
         io.log(`clean: ${summary.unchanged} generated file(s) up to date`);
         return 0;
      }

      for (const file of summary.written) io.log(`wrote ${file}`);
      for (const file of summary.deleted) io.log(`deleted ${file}`);
      io.log(
         `done: ${summary.written.length} written, ${summary.deleted.length} deleted, ${summary.unchanged} unchanged`,
      );
      return 0;
   } catch (error) {
      io.error(error instanceof Error ? error.message : String(error));
      return 1;
   }
}

// Run when executed directly (the published `bin` entry). argv[1] is
// realpathed because bin entries are symlinks, while node resolves the
// main module to its real path.
function isDirectRun(): boolean {
   const argPath = process.argv[1];
   if (argPath === undefined) return false;
   try {
      return import.meta.url === pathToFileURL(fs.realpathSync(path.resolve(argPath))).href;
   } catch {
      return false;
   }
}
if (isDirectRun()) {
   process.exitCode = main(process.argv.slice(2));
}
