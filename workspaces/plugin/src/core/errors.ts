export type SharedRoutesErrorCode =
   | "MOUNT_PARSE_ERROR"
   | "INVALID_MOUNT_NAME"
   | "SOURCE_DIR_NOT_FOUND"
   | "SOURCE_DIR_OUTSIDE_ROUTES"
   | "SOURCE_DIR_IS_ROUTES_ROOT"
   | "SOURCE_INSIDE_TARGET"
   | "TARGET_INSIDE_SOURCE"
   | "NESTED_MOUNT_UNSUPPORTED"
   | "ROOT_IN_SHARED_DIR"
   | "LEGACY_SUFFIX"
   | "UNSUPPORTED_FILE_TYPE"
   | "TARGET_OVERLAP"
   | "TARGET_COLLISION"
   | "UNOWNED_TARGET_FILE";

/**
 * Every failure this tool raises on purpose. `code` is stable and
 * machine-checkable; the message is written for humans and includes fix
 * instructions where possible.
 */
export class SharedRoutesError extends Error {
   readonly code: SharedRoutesErrorCode;

   constructor(code: SharedRoutesErrorCode, message: string) {
      super(`tsr-shared-routes: ${message}`);
      this.name = "SharedRoutesError";
      this.code = code;
   }
}
