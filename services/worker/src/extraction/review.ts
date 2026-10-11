import { REVIEW_PREFIX, type Alert, type AlertCode } from "@nexus/shared";
import type { GroundedExtraction } from "./grounding.js";
import type { Conflict } from "./merge.js";

export interface ReviewInput {
  data: GroundedExtraction;
  conflicts: readonly Conflict[];
  warnings: readonly string[];
  groundingScore: number | null;
  threshold: number;
  alerts: readonly Alert[];
}

export interface ReviewDecision {
  needsReview: boolean;
  // Already prefixed, they go straight into warnings and the ui picks them out by the prefix.
  reasons: string[];
}

// The fields the dashboard and the renewal deadline are built on. A wrong value here costs money.
const KEY_FIELDS = [
  "vendor_name",
  "effective_date",
  "expiration_date",
  "total_contract_value",
  "termination_notice_days",
] as const;

// Alerts that mean the dates themselves can't be trusted. no_notice_period matters most: the 7b
// once missed "at least 60 days before the renewal date", and without notice days there is no
// deadline, which is the point of the dashboard.
const REVIEW_ALERTS: Partial<Record<AlertCode, string>> = {
  no_notice_period: "auto-renews but no notice period was found, so there is no notice deadline",
  expiration_mismatch: "stated expiration differs from effective date + term",
  renewal_term_unknown: "auto-renews but the renewal term is unknown",
};

export function decideNeedsReview(input: ReviewInput): ReviewDecision {
  const reasons: string[] = [];

  if (input.groundingScore !== null && input.groundingScore < input.threshold) {
    const pct = (n: number) => `${String(Math.round(n * 100))}%`;
    reasons.push(
      `only ${pct(input.groundingScore)} of quotes were found, below the ${pct(input.threshold)} threshold`,
    );
  }
  for (const name of KEY_FIELDS) {
    const field = input.data[name];
    if (field.value !== null && !field.quote_verified) {
      reasons.push(`${name} has a value but its quote was not found in the document`);
    }
  }
  for (const conflict of input.conflicts) {
    reasons.push(`chunks disagree on ${conflict.field}`);
  }
  // Only when the field ended up empty. If another chunk supplied a valid value the dropped one
  // doesn't matter, and flagging it would send almost every long contract to review.
  for (const name of KEY_FIELDS) {
    if (input.data[name].value !== null) continue;
    const prefix = `${name}: `;
    const dropped = input.warnings.find((w) => w.startsWith(`${prefix}dropped `));
    if (dropped) reasons.push(`${name} was dropped: ${dropped.slice(prefix.length)}`);
  }
  for (const alert of input.alerts) {
    const reason = REVIEW_ALERTS[alert.code];
    if (reason) reasons.push(reason);
  }

  return { needsReview: reasons.length > 0, reasons: reasons.map((r) => REVIEW_PREFIX + r) };
}
