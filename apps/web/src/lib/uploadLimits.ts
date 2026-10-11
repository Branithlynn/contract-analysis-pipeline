import { DEFAULT_MAX_FILES_PER_REQUEST, DEFAULT_MAX_UPLOAD_MB, MIME_FORMATS } from "@nexus/shared";

const MB = 1024 * 1024;

// The api is what enforces these. Checking here only saves the user a pointless upload. The numbers are
// the api defaults from shared, so a deployment that overrides MAX_UPLOAD_MB or MAX_FILES_PER_REQUEST
// gets a client check that is off, and the api answer is still the one that counts.
export const UPLOAD_LIMITS = {
  maxFileMb: DEFAULT_MAX_UPLOAD_MB,
  maxFiles: DEFAULT_MAX_FILES_PER_REQUEST,
  extensions: [...new Set(MIME_FORMATS.values())],
} as const;

export const ACCEPT_ATTRIBUTE = UPLOAD_LIMITS.extensions.map((ext) => `.${ext}`).join(",");

export interface LocalReject {
  name: string;
  message: string;
}

function hasAllowedExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return UPLOAD_LIMITS.extensions.some((allowed) => allowed === ext);
}

// Generic over name and size so tests don't have to allocate 20 MB files.
export function checkFiles<T extends { name: string; size: number }>(
  files: readonly T[],
): { accepted: T[]; rejected: LocalReject[] } {
  const accepted: T[] = [];
  const rejected: LocalReject[] = [];
  for (const file of files) {
    if (!hasAllowedExtension(file.name)) {
      const allowed = UPLOAD_LIMITS.extensions.map((ext) => `.${ext}`).join(" and ");
      rejected.push({ name: file.name, message: `Only ${allowed} files are accepted` });
    } else if (file.size > UPLOAD_LIMITS.maxFileMb * MB) {
      rejected.push({ name: file.name, message: `Larger than ${UPLOAD_LIMITS.maxFileMb} MB` });
    } else if (accepted.length >= UPLOAD_LIMITS.maxFiles) {
      rejected.push({
        name: file.name,
        message: `Only ${UPLOAD_LIMITS.maxFiles} files per upload`,
      });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}
