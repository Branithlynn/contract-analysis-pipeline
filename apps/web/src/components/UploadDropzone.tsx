import { useRef, useState, type DragEvent } from "react";
import { useUpload } from "../api/hooks.js";
import {
  ACCEPT_ATTRIBUTE,
  checkFiles,
  UPLOAD_LIMITS,
  type LocalReject,
} from "../lib/uploadLimits.js";

type Tone = "ok" | "muted" | "error";

interface ResultLine {
  name: string;
  tone: Tone;
  text: string;
}

export function UploadDropzone() {
  const upload = useUpload();
  const [localRejects, setLocalRejects] = useState<LocalReject[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(list: FileList | null) {
    if (!list || list.length === 0 || upload.isPending) return;
    const { accepted, rejected } = checkFiles(Array.from(list));
    // Both of these drop what the previous upload left on screen.
    setLocalRejects(rejected);
    upload.reset();
    if (accepted.length > 0) upload.mutate(accepted);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    submit(event.dataTransfer.files);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    // Without this the browser opens the dropped file instead of firing drop.
    event.preventDefault();
    setDragging(true);
  }

  const sending = upload.variables?.length ?? 0;
  const requestError = upload.error?.message ?? upload.data?.error?.message;

  const lines: ResultLine[] = [
    ...(upload.data?.accepted ?? []).map((doc): ResultLine =>
      doc.duplicate_of === null
        ? { name: doc.original_name, tone: "ok", text: "Queued" }
        : { name: doc.original_name, tone: "muted", text: "Duplicate of earlier upload" },
    ),
    ...(upload.data?.rejected ?? []).map((file): ResultLine => ({
      name: file.original_name,
      tone: "error",
      text: `Rejected: ${file.message}`,
    })),
    ...localRejects.map((file): ResultLine => ({
      name: file.name,
      tone: "error",
      text: `Rejected: ${file.message}`,
    })),
  ];

  return (
    <section className="upload">
      <div
        className={dragging ? "dropzone dropzone-active" : "dropzone"}
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p>
          Drop contracts here ({UPLOAD_LIMITS.extensions.map((ext) => `.${ext}`).join(", ")}, up to{" "}
          {UPLOAD_LIMITS.maxFileMb} MB each, {UPLOAD_LIMITS.maxFiles} per upload)
        </p>
        <button type="button" disabled={upload.isPending} onClick={() => inputRef.current?.click()}>
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={ACCEPT_ATTRIBUTE}
          onChange={(event) => {
            submit(event.target.files);
            // Otherwise choosing the same file again fires no change event.
            event.target.value = "";
          }}
        />
      </div>

      {/* Always mounted: screen readers only announce changes inside a live region that already exists. */}
      <div className="upload-status" aria-live="polite">
        {upload.isPending && (
          <p>
            Uploading {sending} {sending === 1 ? "file" : "files"}...
          </p>
        )}
        {requestError !== undefined && <p className="tone-error">{requestError}</p>}
        {lines.length > 0 && (
          <ul className="upload-results">
            {lines.map((line, index) => (
              <li key={index}>
                <span className="upload-name">{line.name}</span>{" "}
                <span className={`tone-${line.tone}`}>{line.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
