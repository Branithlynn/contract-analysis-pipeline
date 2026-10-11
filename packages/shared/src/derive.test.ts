import { describe, expect, it } from "vitest";
import { deriveDates, type DeriveFields } from "./derive.js";

const TODAY = "2026-10-09";
const THRESHOLD = 0.8;

function facts(values: {
  effective_date?: string | null;
  expiration_date?: string | null;
  initial_term_months?: number | null;
  renewal_term_months?: number | null;
  termination_notice_days?: number | null;
  auto_renewal?: boolean | null;
}): DeriveFields {
  return {
    effective_date: { value: values.effective_date ?? null },
    expiration_date: { value: values.expiration_date ?? null },
    initial_term_months: { value: values.initial_term_months ?? null },
    renewal_term_months: { value: values.renewal_term_months ?? null },
    termination_notice_days: { value: values.termination_notice_days ?? null },
    auto_renewal: { value: values.auto_renewal ?? null },
  };
}

function derive(fields: DeriveFields, risks: { severity: "low" | "medium" | "high" }[] = []) {
  return deriveDates(fields, risks, 1, THRESHOLD, TODAY);
}

describe("deriveDates", () => {
  it("uses the stated expiration", () => {
    const d = derive(facts({ expiration_date: "2027-06-30", effective_date: "2026-07-01" }));

    expect(d.expiration_date).toBe("2027-06-30");
    expect(d.expiration_source).toBe("stated");
  });

  it("computes effective + initial term - 1 day when no expiration is stated", () => {
    const d = derive(facts({ effective_date: "2026-03-01", initial_term_months: 12 }));

    expect(d.expiration_date).toBe("2027-02-28");
    expect(d.expiration_source).toBe("computed");
  });

  it("clamps a leap day start to Feb 28 before taking the day off", () => {
    const d = derive(facts({ effective_date: "2024-02-29", initial_term_months: 12 }));

    expect(d.expiration_date).toBe("2025-02-27");
  });

  it("rolls an auto renewing term past today and flags a deadline within 30 days", () => {
    const d = derive(
      facts({
        effective_date: "2025-01-01",
        expiration_date: "2025-12-31",
        initial_term_months: 12,
        renewal_term_months: 12,
        termination_notice_days: 60,
        auto_renewal: true,
      }),
    );

    expect(d).toEqual({
      expiration_date: "2025-12-31",
      expiration_source: "stated",
      current_term_end: "2026-12-31",
      next_renewal_date: "2027-01-01",
      notice_deadline: "2026-11-01",
      days_until_notice_deadline: 23,
      alerts: [
        {
          level: "critical",
          code: "notice_deadline_soon",
          message:
            "Notice deadline in 23 days (2026-11-01). Contract auto-renews for 12 months if no notice is given.",
        },
      ],
    });
  });

  it("uses the initial term for renewals when no renewal term is stated", () => {
    const d = derive(
      facts({ expiration_date: "2025-06-30", initial_term_months: 6, auto_renewal: true }),
    );

    expect(d.current_term_end).toBe("2026-12-31");
  });

  it("warns 31 to 90 days ahead and goes critical once the deadline has passed", () => {
    const upcoming = derive(
      facts({
        expiration_date: "2027-01-31",
        renewal_term_months: 12,
        termination_notice_days: 30,
        auto_renewal: true,
      }),
    );
    // Term ends 2026-10-20, 30 days notice -> deadline 2026-09-20, already gone.
    const passed = derive(
      facts({
        expiration_date: "2026-10-20",
        renewal_term_months: 12,
        termination_notice_days: 30,
        auto_renewal: true,
      }),
    );

    expect(upcoming.alerts).toEqual([
      {
        level: "warning",
        code: "notice_deadline_upcoming",
        message:
          "Notice deadline in 84 days (2027-01-01). Contract auto-renews for 12 months if no notice is given.",
      },
    ]);
    expect(passed.days_until_notice_deadline).toBe(-19);
    expect(passed.alerts).toEqual([
      {
        level: "critical",
        code: "notice_deadline_passed",
        message: "Notice deadline 2026-09-20 has passed. Contract renews on 2026-10-21.",
      },
    ]);
  });

  it("says a contract without auto renewal has expired", () => {
    const d = derive(
      facts({ expiration_date: "2026-03-31", termination_notice_days: 30, auto_renewal: false }),
    );

    expect(d.current_term_end).toBe("2026-03-31");
    expect(d.next_renewal_date).toBeNull();
    expect(d.alerts).toEqual([
      { level: "info", code: "expired", message: "Contract expired on 2026-03-31." },
    ]);
  });

  it("returns nulls and no alerts when the facts are missing", () => {
    expect(derive(facts({}))).toEqual({
      expiration_date: null,
      expiration_source: null,
      current_term_end: null,
      next_renewal_date: null,
      notice_deadline: null,
      days_until_notice_deadline: null,
      alerts: [],
    });
    expect(derive(facts({ effective_date: "2026-01-01" })).expiration_date).toBeNull();
    expect(derive(facts({ initial_term_months: 12 })).expiration_date).toBeNull();
  });

  it("alerts on a stated expiration that differs from effective + term, keeping the stated one", () => {
    const same = derive(
      facts({
        expiration_date: "2028-03-31",
        effective_date: "2026-04-01",
        initial_term_months: 24,
      }),
    );
    const differs = derive(
      facts({
        expiration_date: "2028-06-30",
        effective_date: "2026-04-01",
        initial_term_months: 24,
      }),
    );

    expect(same.alerts).toEqual([]);
    expect(differs.expiration_date).toBe("2028-06-30");
    expect(differs.alerts).toEqual([
      {
        level: "warning",
        code: "expiration_mismatch",
        message:
          "Stated expiration 2028-06-30 differs from effective date + term (2028-03-31). Check the contract.",
      },
    ]);
  });

  it("flags auto renewal without a notice period and leaves the deadline null", () => {
    const d = derive(
      facts({ expiration_date: "2027-03-31", renewal_term_months: 12, auto_renewal: true }),
    );

    expect(d.notice_deadline).toBeNull();
    expect(d.days_until_notice_deadline).toBeNull();
    expect(d.next_renewal_date).toBe("2027-04-01");
    expect(d.alerts).toEqual([
      {
        level: "warning",
        code: "no_notice_period",
        message:
          "Contract auto-renews but no notice period was found, so there is no notice deadline.",
      },
    ]);
  });

  it("stops rolling and alerts when no renewal length is known", () => {
    const d = derive(
      facts({ expiration_date: "2025-12-31", termination_notice_days: 30, auto_renewal: true }),
    );

    expect(d.current_term_end).toBe("2025-12-31");
    expect(d.alerts.map((a) => a.code)).toEqual(["notice_deadline_passed", "renewal_term_unknown"]);
  });

  it("counts high risks and flags grounding under the threshold", () => {
    const d = deriveDates(
      facts({}),
      [{ severity: "high" }, { severity: "medium" }, { severity: "high" }],
      0.625,
      THRESHOLD,
      TODAY,
    );

    expect(d.alerts).toEqual([
      { level: "warning", code: "high_risk", message: "2 high-severity risk clause(s)." },
      {
        level: "warning",
        code: "low_grounding",
        message: "Only 63% of quotes were found in the document. Verify values manually.",
      },
    ]);
    expect(deriveDates(facts({}), [], null, THRESHOLD, TODAY).alerts).toEqual([]);
  });

  it("keeps the alert order fixed", () => {
    const d = deriveDates(
      facts({
        expiration_date: "2026-12-31",
        effective_date: "2026-01-01",
        initial_term_months: 6,
        renewal_term_months: 12,
        termination_notice_days: 60,
        auto_renewal: true,
      }),
      [{ severity: "high" }],
      0.5,
      THRESHOLD,
      TODAY,
    );

    expect(d.alerts.map((a) => a.code)).toEqual([
      "notice_deadline_soon",
      "high_risk",
      "low_grounding",
      "expiration_mismatch",
    ]);
  });

  it("keeps a Jan 31 monthly contract on month ends instead of drifting to the 28th", () => {
    const jan31 = facts({
      effective_date: "2024-01-31",
      initial_term_months: 1,
      renewal_term_months: 1,
      auto_renewal: true,
    });
    const termEndOn = (today: string) =>
      deriveDates(jan31, [], 1, THRESHOLD, today).current_term_end;

    expect(termEndOn("2024-02-10")).toBe("2024-02-28");
    expect(termEndOn("2024-03-01")).toBe("2024-03-30");
    expect(termEndOn("2024-03-31")).toBe("2024-04-29");
    expect(termEndOn("2024-04-29")).toBe("2024-04-29");
  });

  it("rolls a monthly contract from 2010 straight to the current term", () => {
    const d = derive(
      facts({
        effective_date: "2010-01-15",
        initial_term_months: 12,
        renewal_term_months: 1,
        termination_notice_days: 3,
        auto_renewal: true,
      }),
    );

    expect(d).toMatchObject({
      expiration_date: "2011-01-14",
      current_term_end: "2026-10-14",
      next_renewal_date: "2026-10-15",
      notice_deadline: "2026-10-11",
      days_until_notice_deadline: 2,
    });
  });

  it("anchors on the day after the expiration when the start is unknown", () => {
    const d = derive(
      facts({ expiration_date: "2023-03-31", renewal_term_months: 3, auto_renewal: true }),
    );

    // Terms start Apr 1, Jul 1, Oct 1, Jan 1: the one covering 2026-10-09 ends Dec 31.
    expect(d.current_term_end).toBe("2026-12-31");
  });
});
