import { CircleCheck, CircleX, Copy, LoaderCircle, Upload, X } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { uploadFile } from "../api/client.js";
import { useDocuments, useInvalidateDocuments } from "../api/hooks.js";
import { formatBytes } from "../lib/format.js";
import { useModelChoice } from "../lib/modelChoice.js";
import { shortModelName } from "../lib/modelPicker.js";
import { ACCEPT_ATTRIBUTE, checkFiles, UPLOAD_LIMITS } from "../lib/uploadLimits.js";

type ItemState = "waiting" | "uploading" | "queued" | "duplicate" | "rejected";

interface Item {
  key: number;
  name: string;
  size: number;
  state: ItemState;
  // 0 to 1 while uploading.
  progress: number;
  // Why it was rejected, or what happened to it.
  message: string | null;
}

const STATE_ICONS = {
  waiting: LoaderCircle,
  uploading: LoaderCircle,
  queued: CircleCheck,
  duplicate: Copy,
  rejected: CircleX,
} as const;

const STATE_TEXT: Record<ItemState, string> = {
  waiting: "Waiting",
  uploading: "Uploading",
  queued: "Queued for analysis",
  duplicate: "Already analyzed, result reused",
  rejected: "Not uploaded",
};

const EXTENSIONS = UPLOAD_LIMITS.extensions.map((ext) => `.${ext}`).join(" or ");

export function UploadDropzone() {
  const documents = useDocuments();
  const invalidate = useInvalidateDocuments();
  const { selected } = useModelChoice();
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(1);
  const busy = items.some((item) => item.state === "waiting" || item.state === "uploading");

  const patch = (key: number, change: Partial<Item>) =>
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...change } : item)),
    );

  async function submit(list: FileList | null) {
    if (!list || list.length === 0 || busy) return;
    const { accepted, rejected } = checkFiles(Array.from(list));
    const queue = accepted.map((file) => ({ file, key: nextKey.current++ }));
    // A new drop replaces what the last one left on screen.
    setItems([
      ...queue.map(({ file, key }): Item => ({
        key,
        name: file.name,
        size: file.size,
        state: "waiting",
        progress: 0,
        message: null,
      })),
      ...rejected.map((file): Item => ({
        key: nextKey.current++,
        name: file.name,
        size: 0,
        state: "rejected",
        progress: 0,
        message: file.message,
      })),
    ]);

    // One after the other: each file gets its own progress and its own answer, and a file the
    // api refuses does not take the others down with it.
    for (const { file, key } of queue) {
      patch(key, { state: "uploading" });
      try {
        const res = await uploadFile(file, selected, (progress) => patch(key, { progress }));
        const [accepted] = res.accepted;
        const [refused] = res.rejected;
        if (accepted) {
          patch(key, {
            state: accepted.duplicate_of === null ? "queued" : "duplicate",
            progress: 1,
          });
        } else {
          patch(key, {
            state: "rejected",
            message: refused?.message ?? res.error?.message ?? "The server did not accept the file",
          });
        }
      } catch (err) {
        patch(key, {
          state: "rejected",
          message: err instanceof Error ? err.message : "Upload failed",
        });
      }
      // After every file, so each one shows up in the table as soon as it is stored.
      void invalidate();
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void submit(event.dataTransfer.files);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    // Without this the browser opens the dropped file instead of firing drop.
    event.preventDefault();
    setDragging(true);
  }

  // Big while there is nothing to look at, a slim bar once the table has rows.
  const compact = (documents.data?.length ?? 0) > 0;
  const model = selected === null ? null : shortModelName(selected.model);
  const className = [
    "dropzone",
    compact ? "dropzone-compact" : "",
    dragging ? "dropzone-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="upload" aria-label="Upload contracts">
      <div
        className={className}
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <Upload size={compact ? 16 : 28} aria-hidden="true" className="dropzone-icon" />
        <div className="dropzone-text">
          <p className="dropzone-title">
            {compact ? "Drop more contracts here" : "Drop a contract here to analyze it"}
          </p>
          <p className="dropzone-hint">
            {EXTENSIONS}, up to {UPLOAD_LIMITS.maxFileMb} MB each
            {model !== null && <>, analyzed with {model}</>}
          </p>
        </div>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={ACCEPT_ATTRIBUTE}
          onChange={(event) => {
            void submit(event.target.files);
            // Otherwise choosing the same file again fires no change event.
            event.target.value = "";
          }}
        />
      </div>

      {/* Always mounted: screen readers only announce changes inside a live region that exists. */}
      <div aria-live="polite">
        {items.length > 0 && (
          <div className="upload-list">
            <ul className="plain-list">
              {items.map((item) => {
                const Icon = STATE_ICONS[item.state];
                const active = item.state === "waiting" || item.state === "uploading";
                return (
                  <li key={item.key} className={`upload-item upload-${item.state}`}>
                    <Icon size={14} aria-hidden="true" className={active ? "spin" : ""} />
                    <span className="upload-name" title={item.name}>
                      {item.name}
                    </span>
                    {item.size > 0 && <span className="upload-size">{formatBytes(item.size)}</span>}
                    {item.state === "uploading" ? (
                      <progress
                        className="upload-progress"
                        max={1}
                        value={item.progress}
                        aria-label={`Uploading ${item.name}`}
                      />
                    ) : (
                      <span className="upload-state">
                        {STATE_TEXT[item.state]}
                        {item.message !== null && `: ${item.message}`}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {!busy && (
              <button
                type="button"
                className="icon-button"
                aria-label="Clear the upload list"
                onClick={() => setItems([])}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
