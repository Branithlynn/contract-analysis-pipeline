// Moved to shared when the embedders, which the api uses too, started throwing it. Re-exported so
// the worker keeps one import path for it.
export { LlmError, type LlmErrorKind, type LlmErrorOptions } from "@nexus/shared/node";
