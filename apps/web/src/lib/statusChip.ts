import type { DocumentSummary } from "@nexus/shared";
import { errorPhrase, formatElapsed } from "./format.js";

// What the status chip says. The kind picks icon and color, the text says the same thing in
// words, so the color is never the only signal.

export type ChipKind = "queued" | "processing" | "completed" | "review" | "failed";

export interface StatusChipModel {
  kind: ChipKind;
  label: string;
  // The second half of the chip: the stage and how long it has been running, or why it failed.
  detail: string | null;
  // The long form for hover, e.g. the provider's own error message.
  title: string | null;
}

type ChipDoc = Pick<
  DocumentSummary,
  "status" | "stage" | "needs_review" | "error_code" | "error_message" | "updated_at"
>;

// nowMs is passed in: the chip ticks with a timer in the component, and tests pin the clock.
export function statusChip(doc: ChipDoc, nowMs: number): StatusChipModel {
  switch (doc.status) {
    case "queued":
      return { kind: "queued", label: "Queued", detail: null, title: null };
    case "processing": {
      // updated_at moves with every stage, so this is the time in the current stage.
      const elapsed = formatElapsed(nowMs - Date.parse(doc.updated_at));
      return {
        kind: "processing",
        label: "Processing",
        detail: `${doc.stage ?? "starting"} · ${elapsed}`,
        title: null,
      };
    }
    case "completed":
      return doc.needs_review
        ? { kind: "review", label: "Needs review", detail: null, title: null }
        : { kind: "completed", label: "Completed", detail: null, title: null };
    case "failed":
      return {
        kind: "failed",
        label: "Failed",
        detail: doc.error_code === null ? null : errorPhrase(doc.error_code),
        title: doc.error_message,
      };
  }
}
