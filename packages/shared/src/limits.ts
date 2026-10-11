// Defaults for MAX_UPLOAD_MB and MAX_FILES_PER_REQUEST. They live here and not in config.ts so the web
// client can check files against the same numbers before uploading. The api enforces whatever env says.
export const DEFAULT_MAX_UPLOAD_MB = 20;
export const DEFAULT_MAX_FILES_PER_REQUEST = 10;
