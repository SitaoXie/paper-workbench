export const MIN_OUTPUT_TOKENS = 512;
export const MAX_OUTPUT_TOKENS = 65_536;
export const DEFAULT_OUTPUT_TOKENS = MAX_OUTPUT_TOKENS;

// Source characters are an operator budget, not a provider token measurement.
export const MIN_CONTEXT_CHARS = 8_000;
export const MAX_CONTEXT_CHARS = 8_000_000;
export const DEFAULT_CONTEXT_CHARS = 1_000_000;
