import type { LlmExtraction } from "@nexus/shared";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types.js";

// Returns the json the provider would have parsed. Throw an LlmError to simulate a failure.
export type MockResponder = (req: LlmRequest) => unknown;

const notFound = { value: null, quote: "", confidence: "low" } as const;

// Typed as LlmExtraction so a schema change breaks the build here instead of every test using the mock.
export const MOCK_EXTRACTION: LlmExtraction = {
  document_type: { value: "other", quote: "", confidence: "low" },
  vendor_name: notFound,
  customer_name: notFound,
  payment_terms: notFound,
  governing_law: notFound,
  liability_cap: notFound,
  effective_date: notFound,
  expiration_date: notFound,
  initial_term_months: notFound,
  renewal_term_months: notFound,
  termination_notice_days: notFound,
  auto_renewal: notFound,
  total_contract_value: notFound,
  risk_clauses: [],
  summary: "Mock extraction.",
};

// For unit tests, CI and LLM_PROVIDER=mock: runs the whole pipeline without a model or network.
export class MockProvider implements LlmProvider {
  readonly name = "mock";
  readonly model = "mock";
  readonly calls: LlmRequest[] = [];

  constructor(private readonly responder: MockResponder = () => MOCK_EXTRACTION) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const json = await this.responder(req);
    const chars = req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0);
    return {
      json,
      rawText: JSON.stringify(json),
      // Rough chars/4 so usage numbers on the dashboard look plausible in a demo.
      usage: { inputTokens: Math.ceil(chars / 4), outputTokens: 100 },
      model: this.model,
      latencyMs: 0,
    };
  }
}
