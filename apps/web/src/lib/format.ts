import type {
  AlertCode,
  DocumentType,
  ErrorCode,
  ExpirationSource,
  ExtractedFieldName,
  RiskCategory,
} from "@nexus/shared";

// Shown where a value is missing. A hyphen so an empty cell is not mistaken for a loading one.
export const EMPTY = "-";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMoney(money: { amount: number; currency: string }): string {
  try {
    // A whole amount gets no ".00". With cents the currency's own number of decimals applies.
    const whole = Number.isInteger(money.amount) ? { maximumFractionDigits: 0 } : {};
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: money.currency,
      ...whole,
    }).format(money.amount);
  } catch {
    // Intl throws on a currency code it cannot parse. The amount is still worth showing.
    return `${money.amount} ${money.currency}`;
  }
}

// Takes the calendar date apart as text. Going through Date would shift it by a day in timezones west of UTC.
export function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || month === undefined) return isoDate;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

// The number always comes from the api (days_until_notice_deadline). Nothing here reads the browser clock,
// so the table and the csv export agree on what "today" is.
export function formatDaysLeft(days: number): string {
  if (days < 0) return "passed";
  if (days === 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

export type NoticeTone = "passed" | "critical" | "warning" | "normal";

export function noticeTone(days: number): NoticeTone {
  if (days < 0) return "passed";
  if (days <= 30) return "critical";
  if (days <= 90) return "warning";
  return "normal";
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

// A Record and not a switch: a code added to shared fails the build here until it has a label.
const ERROR_LABELS: Record<ErrorCode, string> = {
  UNSUPPORTED_TYPE: "Unsupported file type",
  FILE_TOO_LARGE: "File too large",
  NO_TEXT_LAYER: "Scanned PDF, no text layer",
  EMPTY_DOCUMENT: "No text in document",
  TEXT_TOO_LONG: "Document too long",
  PARSE_ERROR: "Could not read file",
  EXTRACTION_INVALID: "Model output invalid",
  LLM_UNAVAILABLE: "Model unavailable",
  LLM_AUTH: "Model credentials rejected",
  WORKER_STOPPED: "Processing interrupted twice",
  INTERNAL: "Internal error",
};

export function errorLabel(code: ErrorCode): string {
  return ERROR_LABELS[code];
}

// Local time, for the event timeline. Only display: no day math is done with it.
export function formatDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const month = MONTHS[date.getMonth()];
  if (month === undefined) return isoTimestamp;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getDate()} ${month} ${date.getFullYear()}, ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  // 59.95s and up would print as "60.0 s".
  if (ms < 59_950) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

export function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

// The label maps below are Records for the same reason as ERROR_LABELS: a new value in shared has to get
// a label before the build passes.

const ALERT_LABELS: Record<AlertCode, string> = {
  notice_deadline_passed: "Notice deadline passed",
  notice_deadline_soon: "Notice deadline soon",
  notice_deadline_upcoming: "Notice deadline upcoming",
  expired: "Expired",
  high_risk: "High risk",
  low_grounding: "Low grounding",
  no_notice_period: "No notice period",
  expiration_mismatch: "Expiration mismatch",
  renewal_term_unknown: "Renewal term unknown",
  prompt_injection_suspected: "Possible prompt injection",
};

export function alertLabel(code: AlertCode): string {
  return ALERT_LABELS[code];
}

// The tag next to the expiration date. "model" has to read as a caution: that date is in no clause
// and we could not recompute it.
const EXPIRATION_SOURCE_LABELS: Record<ExpirationSource, string> = {
  stated: "stated",
  computed: "computed",
  model: "model's estimate, unchecked",
};

export function expirationSourceLabel(source: ExpirationSource): string {
  return EXPIRATION_SOURCE_LABELS[source];
}

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  contract: "Contract",
  proposal: "Proposal",
  amendment: "Amendment",
  nda: "NDA",
  sow: "Statement of work",
  order_form: "Order form",
  other: "Other",
};

export function documentTypeLabel(type: DocumentType): string {
  return DOCUMENT_TYPE_LABELS[type];
}

const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = {
  auto_renewal: "Auto renewal",
  uncapped_liability: "Uncapped liability",
  broad_indemnification: "Broad indemnification",
  unilateral_price_increase: "Unilateral price increase",
  termination_for_convenience_vendor_only: "Termination for convenience, vendor only",
  exclusivity: "Exclusivity",
  ip_assignment: "IP assignment",
  data_protection_gap: "Data protection gap",
  penalties_liquidated_damages: "Penalties / liquidated damages",
  unfavorable_payment_terms: "Unfavorable payment terms",
  foreign_governing_law: "Foreign governing law",
  other: "Other",
};

export function riskCategoryLabel(category: RiskCategory): string {
  return RISK_CATEGORY_LABELS[category];
}

const FIELD_LABELS: Record<ExtractedFieldName, string> = {
  document_type: "Type",
  vendor_name: "Vendor",
  customer_name: "Customer",
  payment_terms: "Payment terms",
  governing_law: "Governing law",
  liability_cap: "Liability cap",
  effective_date: "Effective",
  expiration_date: "Expiration",
  initial_term_months: "Initial term",
  renewal_term_months: "Renewal term",
  termination_notice_days: "Notice days",
  auto_renewal: "Auto renewal",
  total_contract_value: "Total value",
};

export function fieldLabel(name: ExtractedFieldName): string {
  return FIELD_LABELS[name];
}

// "in 34 days", "today", "12 days ago". The number comes from the api, like formatDaysLeft.
export function formatRelativeDays(days: number): string {
  if (days === 0) return "today";
  const count = plural(Math.abs(days), "day");
  return days > 0 ? `in ${count}` : `${count} ago`;
}

// A date and how far away it is, as the table shows it: "15 Nov 2026 · in 34 days".
export function formatDateWithDays(isoDate: string, days: number | null): string {
  const date = formatDate(isoDate);
  return days === null ? date : `${date} · ${formatRelativeDays(days)}`;
}

// A notice deadline closer than this is highlighted in the table: there is still time to act,
// and not much of it.
export const NOTICE_SOON_DAYS = 60;

export function isNoticeSoon(days: number): boolean {
  return days >= 0 && days < NOTICE_SOON_DAYS;
}

// How long something has been going on, for the processing chip: "42s", "1m 12s", "1h 03m".
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

// The error code in words, lower case, for use inside a sentence or a chip:
// "run 2 with gpt-5-mini failed (api key rejected)".
const ERROR_PHRASES: Record<ErrorCode, string> = {
  UNSUPPORTED_TYPE: "unsupported file type",
  FILE_TOO_LARGE: "file too large",
  NO_TEXT_LAYER: "scanned pdf, no text to read",
  EMPTY_DOCUMENT: "no text in the document",
  TEXT_TOO_LONG: "document too long",
  PARSE_ERROR: "file could not be read",
  EXTRACTION_INVALID: "model output was not usable",
  LLM_UNAVAILABLE: "model not reachable",
  LLM_AUTH: "api key rejected",
  WORKER_STOPPED: "processing was interrupted",
  INTERNAL: "internal error",
};

export function errorPhrase(code: ErrorCode): string {
  return ERROR_PHRASES[code];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
