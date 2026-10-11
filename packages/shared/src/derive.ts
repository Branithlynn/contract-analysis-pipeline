import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  differenceInMonths,
  format,
  parseISO,
} from "date-fns";
import type { Alert, Derived, ExtractionResult, Severity } from "./schemas/extraction.js";

// The model extracts facts, this does the date math. Pure and browser safe: the api reruns it on
// every read with its own clock, because days left, alerts and a rolled auto renewal term go stale
// daily, and the worker runs it once when storing. One function, so the two never drift.
//
// Dates are calendar dates (YYYY-MM-DD) with no time zone. date-fns parses a date-only string as
// local midnight and formats it back the same way, so the arithmetic is the same in any server zone.
//
// Month math follows date-fns: adding months to a day the target month doesn't have clamps to its
// last day. 2024-02-29 + 12 months is 2025-02-28, so that term ends 2025-02-27.

type FactName =
  | "effective_date"
  | "expiration_date"
  | "initial_term_months"
  | "renewal_term_months"
  | "termination_notice_days"
  | "auto_renewal";

// Only the values are read, so stored results and the worker's in-between shapes both fit.
export type DeriveFields = { [K in FactName]: { value: ExtractionResult[K]["value"] } };

const URGENT_DAYS = 30;
const SOON_DAYS = 90;

function toDate(iso: string): Date {
  return parseISO(iso);
}

function toIso(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

// A term of N months starting on `start` ends the day before the same date N months later.
function termEnd(start: Date, months: number): Date {
  return addDays(addMonths(start, months), -1);
}

// Term k ends at start + offset + k * len months - 1 day, always counted from the same start.
// Stepping one term at a time from the previous end would drift at month ends: a Jan 31 monthly
// contract would go Feb 28, Mar 28, Apr 28 instead of Feb 28, Mar 30, Apr 29.
// Returns the end of the first term that ends on or after today. k is estimated from the month
// difference, which is off by at most one, so the loops below step once or twice.
function firstTermEndingFrom(start: Date, offset: number, len: number, today: Date): Date {
  const end = (k: number) => termEnd(start, offset + k * len);
  let k = Math.max(0, Math.floor((differenceInMonths(today, start) - offset) / len));
  while (end(k) < today) k++;
  while (k > 0 && end(k - 1) >= today) k--;
  return end(k);
}

export function deriveDates(
  fields: DeriveFields,
  risks: readonly { severity: Severity }[],
  groundingScore: number | null,
  threshold: number,
  today: string,
): Derived {
  const now = toDate(today);
  const effective = fields.effective_date.value;
  const stated = fields.expiration_date.value;
  const initial = fields.initial_term_months.value;
  const renewalMonths = fields.renewal_term_months.value ?? initial;
  const noticeDays = fields.termination_notice_days.value;
  const autoRenews = fields.auto_renewal.value === true;
  const later: Alert[] = [];

  const computed =
    effective !== null && initial !== null ? toIso(termEnd(toDate(effective), initial)) : null;
  const expiration = stated ?? computed;
  // Models compute the expiration themselves despite the prompt, and are sometimes right. When the
  // stated and computed dates disagree, a person should look. An alert, not a merge conflict:
  // this is recomputed on every read, conflicts are stored once.
  if (stated !== null && computed !== null && stated !== computed) {
    later.push({
      level: "warning",
      code: "expiration_mismatch",
      message: `Stated expiration ${stated} differs from effective date + term (${computed}). Check the contract.`,
    });
  }

  let end = expiration === null ? null : toDate(expiration);
  if (end !== null && autoRenews && end < now) {
    if (renewalMonths) {
      // Counted from the start of the contract when it is known, otherwise from the day after the
      // expiration. Both use the original day of month, so a Jan 31 start keeps ending on month ends.
      const base =
        effective !== null && initial !== null
          ? { start: toDate(effective), offset: initial }
          : { start: addDays(end, 1), offset: 0 };
      end = firstTermEndingFrom(base.start, base.offset, renewalMonths, now);
    } else {
      later.push({
        level: "warning",
        code: "renewal_term_unknown",
        message:
          "Contract auto-renews but no renewal term was found, so the current term could not be rolled forward.",
      });
    }
  }

  const currentTermEnd = end === null ? null : toIso(end);
  const nextRenewal = end !== null && autoRenews ? toIso(addDays(end, 1)) : null;
  // Only for a contract that renews: on one that just ends, the notice period is for terminating
  // early and "notice by" would be a deadline that does nothing.
  const deadline =
    end !== null && autoRenews && noticeDays !== null ? addDays(end, -noticeDays) : null;
  const noticeDeadline = deadline === null ? null : toIso(deadline);
  const daysLeft = deadline === null ? null : differenceInCalendarDays(deadline, now);

  const alerts: Alert[] = [];
  if (daysLeft !== null && noticeDeadline !== null) {
    const renews = renewalMonths
      ? `Contract auto-renews for ${String(renewalMonths)} months if no notice is given.`
      : "Contract auto-renews if no notice is given.";
    const soon = `Notice deadline in ${String(daysLeft)} days (${noticeDeadline}). ${renews}`;
    if (daysLeft < 0) {
      alerts.push({
        level: "critical",
        code: "notice_deadline_passed",
        message: `Notice deadline ${noticeDeadline} has passed. Contract renews on ${nextRenewal ?? "?"}.`,
      });
    } else if (daysLeft <= URGENT_DAYS) {
      alerts.push({ level: "critical", code: "notice_deadline_soon", message: soon });
    } else if (daysLeft <= SOON_DAYS) {
      alerts.push({ level: "warning", code: "notice_deadline_upcoming", message: soon });
    }
  }
  if (!autoRenews && end !== null && currentTermEnd !== null && end < now) {
    alerts.push({
      level: "info",
      code: "expired",
      message: `Contract expired on ${currentTermEnd}.`,
    });
  }
  const highRisks = risks.filter((r) => r.severity === "high").length;
  if (highRisks > 0) {
    alerts.push({
      level: "warning",
      code: "high_risk",
      message: `${String(highRisks)} high-severity risk clause(s).`,
    });
  }
  if (groundingScore !== null && groundingScore < threshold) {
    alerts.push({
      level: "warning",
      code: "low_grounding",
      message: `Only ${String(Math.round(groundingScore * 100))}% of quotes were found in the document. Verify values manually.`,
    });
  }
  // Without notice days there is no deadline, and the deadline is the point of the dashboard.
  if (autoRenews && noticeDays === null) {
    alerts.push({
      level: "warning",
      code: "no_notice_period",
      message:
        "Contract auto-renews but no notice period was found, so there is no notice deadline.",
    });
  }

  return {
    expiration_date: expiration,
    expiration_source: stated !== null ? "stated" : computed !== null ? "computed" : null,
    current_term_end: currentTermEnd,
    next_renewal_date: nextRenewal,
    notice_deadline: noticeDeadline,
    days_until_notice_deadline: daysLeft,
    alerts: [...alerts, ...later],
  };
}
