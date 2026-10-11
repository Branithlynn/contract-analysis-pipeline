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
  // Whether the stated expiration's quote was found in the document. Most tests don't care.
  expiration_verified?: boolean;
  // Defaults to a quote that has the date in it, which is what makes a date count as stated.
  expiration_quote?: string | null;
}): DeriveFields {
  return {
    effective_date: { value: values.effective_date ?? null },
    expiration_date: {
      value: values.expiration_date ?? null,
      quote:
        values.expiration_quote === undefined
          ? `expires on ${values.expiration_date ?? ""}`
          : values.expiration_quote,
      quote_verified: values.expiration_verified ?? true,
    },
    initial_term_months: { value: values.initial_term_months ?? null },
    renewal_term_months: { value: values.renewal_term_months ?? null },
    termination_notice_days: { value: values.termination_notice_days ?? null },
    auto_renewal: { value: values.auto_renewal ?? null },
  };
}

function derive(fields: DeriveFields, risks: { severity: "low" | "medium" | "high" }[] = []) {
  return deriveDates(fields, risks, 1, THRESHOLD, [], TODAY);
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

  it("has no notice deadline or renewal date when the contract does not auto renew", () => {
    // A notice period on a contract that just ends is for early termination. Showing it as a
    // "notice by" date would send someone chasing a deadline that does nothing.
    for (const autoRenewal of [false, null]) {
      const d = derive(
        facts({
          effective_date: "2026-06-01",
          initial_term_months: 36,
          termination_notice_days: 30,
          auto_renewal: autoRenewal,
        }),
      );

      expect(d.expiration_date).toBe("2029-05-31");
      expect(d.current_term_end).toBe("2029-05-31");
      expect(d.next_renewal_date).toBeNull();
      expect(d.notice_deadline).toBeNull();
      expect(d.days_until_notice_deadline).toBeNull();
      expect(d.alerts).toEqual([]);
    }
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

  it("keeps a stated expiration whose quote was found, even when the arithmetic differs", () => {
    const d = derive(
      facts({
        expiration_date: "2028-06-30",
        expiration_verified: true,
        effective_date: "2026-04-01",
        initial_term_months: 24,
      }),
    );

    expect(d.expiration_date).toBe("2028-06-30");
    expect(d.expiration_source).toBe("stated");
    expect(d.alerts.map((a) => a.code)).toEqual(["expiration_mismatch"]);
  });

  it("uses the computed expiration over a stated one whose quote was not found", () => {
    // What the 7b returned for the MSA sample: a date two years before the contract starts.
    const d = derive(
      facts({
        expiration_date: "2024-10-01",
        expiration_verified: false,
        effective_date: "2026-02-01",
        initial_term_months: 24,
        renewal_term_months: 12,
        termination_notice_days: 90,
        auto_renewal: true,
      }),
    );

    expect(d.expiration_date).toBe("2028-01-31");
    expect(d.expiration_source).toBe("computed");
    expect(d.current_term_end).toBe("2028-01-31");
    expect(d.notice_deadline).toBe("2027-11-02");
    expect(d.alerts).toEqual([
      {
        level: "warning",
        code: "expiration_mismatch",
        message:
          "Stated expiration 2024-10-01 differs from effective date + term (2028-01-31). Check the contract.",
      },
    ]);
  });

  it("ignores a date the model computed itself: verified quote, but the date is not in it", () => {
    // qwen on the nda sample, one day late.
    const d = derive(
      facts({
        expiration_date: "2028-09-10",
        expiration_verified: true,
        expiration_quote:
          "This Agreement continues for 24 months from the Effective Date and then expires.",
        effective_date: "2026-09-10",
        initial_term_months: 24,
        auto_renewal: false,
      }),
    );

    expect(d.expiration_date).toBe("2028-09-09");
    expect(d.expiration_source).toBe("computed");
    expect(d.current_term_end).toBe("2028-09-09");
    // Nothing was stated, so there is no mismatch to report.
    expect(d.alerts).toEqual([]);
  });

  it("keeps the model's own date, marked as such, when there is nothing to compute from", () => {
    // No effective date. Dropping the date would also drop the notice deadline of a contract that
    // renews by itself.
    const d = derive(
      facts({
        expiration_date: "2027-09-10",
        expiration_quote: "continues for 12 months from the Effective Date",
        initial_term_months: 12,
        renewal_term_months: 12,
        termination_notice_days: 60,
        auto_renewal: true,
      }),
    );

    expect(d).toMatchObject({
      expiration_date: "2027-09-10",
      expiration_source: "model",
      current_term_end: "2027-09-10",
      next_renewal_date: "2027-09-11",
      notice_deadline: "2027-07-12",
    });
    // Nothing was stated and nothing was computed, so there are no two dates to disagree.
    expect(d.alerts.map((a) => a.code)).not.toContain("expiration_mismatch");
  });

  it("prefers our own arithmetic over the model's as soon as there is something to compute from", () => {
    const d = derive(
      facts({
        expiration_date: "2027-09-10",
        expiration_quote: "continues for 12 months from the Effective Date",
        effective_date: "2026-09-10",
        initial_term_months: 12,
      }),
    );

    expect(d.expiration_date).toBe("2027-09-09");
    expect(d.expiration_source).toBe("computed");
  });

  it("counts a date written out in the verified quote as stated, and still flags a mismatch", () => {
    // gpt-5-mini on the consulting sample.
    const quote = "and continues until 31 August 2026, when it expires.";
    const agrees = derive(
      facts({
        expiration_date: "2026-08-31",
        expiration_quote: quote,
        effective_date: "2026-03-01",
        initial_term_months: 6,
      }),
    );
    const differs = derive(
      facts({
        expiration_date: "2026-08-31",
        expiration_quote: quote,
        effective_date: "2026-03-01",
        initial_term_months: 12,
      }),
    );

    expect(agrees.expiration_date).toBe("2026-08-31");
    expect(agrees.expiration_source).toBe("stated");
    // TODAY is past the end date and the contract does not renew.
    expect(agrees.alerts.map((a) => a.code)).toEqual(["expired"]);
    expect(differs.expiration_date).toBe("2026-08-31");
    expect(differs.expiration_source).toBe("stated");
    expect(differs.alerts.map((a) => a.code)).toEqual(["expired", "expiration_mismatch"]);
  });

  it("treats an unverified quote the same whether or not it has the date in it", () => {
    for (const quote of ["This Agreement continues until 31 August 2026.", "for 6 months", null]) {
      const d = derive(
        facts({
          expiration_date: "2026-08-31",
          expiration_verified: false,
          expiration_quote: quote,
          effective_date: "2026-03-01",
          initial_term_months: 12,
        }),
      );

      expect(d.expiration_date).toBe("2027-02-28");
      expect(d.expiration_source).toBe("computed");
      expect(d.alerts.map((a) => a.code)).toEqual(["expiration_mismatch"]);
    }
  });

  it("keeps an unverified stated expiration when there is nothing to compute it from", () => {
    const d = derive(
      facts({ expiration_date: "2027-06-30", expiration_verified: false, initial_term_months: 12 }),
    );

    expect(d.expiration_date).toBe("2027-06-30");
    expect(d.expiration_source).toBe("stated");
    expect(d.alerts).toEqual([]);
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
      [],
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
    expect(deriveDates(facts({}), [], null, THRESHOLD, [], TODAY).alerts).toEqual([]);
  });

  it("puts a suspected prompt injection first, with its pages", () => {
    const d = deriveDates(
      facts({}),
      [{ severity: "high" }],
      1,
      THRESHOLD,
      [{ page: 4 }, { page: 2 }, { page: 4 }],
      TODAY,
    );
    const noPages = deriveDates(facts({}), [], 1, THRESHOLD, [{ page: null }], TODAY);

    expect(d.alerts).toEqual([
      {
        level: "critical",
        code: "prompt_injection_suspected",
        message:
          "The document contains text addressed to an AI system on pages 2, 4. Values quoted from it were removed. Read the document yourself.",
      },
      { level: "warning", code: "high_risk", message: "1 high-severity risk clause(s)." },
    ]);
    expect(noPages.alerts.map((a) => a.message)).toEqual([
      "The document contains text addressed to an AI system. Values quoted from it were removed. Read the document yourself.",
    ]);
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
      [],
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
      deriveDates(jan31, [], 1, THRESHOLD, [], today).current_term_end;

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
