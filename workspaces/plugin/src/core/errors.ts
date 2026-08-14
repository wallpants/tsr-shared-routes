export type SharedRoutesErrorCode =
   | "MOUNT_PARSE_ERROR"
   | "INVALID_MOUNT_NAME"
   | "SHARED_DIR_NOT_FOUND"
   | "SHARED_DIR_INSIDE_ROUTES"
   | "SHARED_DIR_CONTAINS_ROUTES"
   | "ROOT_IN_SHARED_DIR"
   | "LEGACY_SUFFIX"
   | "UNSUPPORTED_FILE_TYPE"
   | "TARGET_OVERLAP"
   | "TARGET_COLLISION"
   | "MOUNT_CYCLE"
   | "MOUNT_DEPTH_EXCEEDED"
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
