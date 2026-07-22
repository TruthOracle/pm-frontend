export const NETWORK = import.meta.env.VITE_APP_NETWORK ?? "devnet";

/**
 * Deployed TruthOracle DAML package ID (from Canton participant after DAR upload).
 * Fallback = truthoracle-v11-1.0.0 (dynamic pm-AMM + tiered resolution).
 */
export const TRUTHORACLE_PACKAGE_ID =
  import.meta.env.VITE_TRUTHORACLE_PACKAGE_ID ??
  "fab6f39a9ce04e892b94462efb00f3f7f1944dd9aac3b0254229cc89b3db12a6";

/**
 * TruthOracle DAML package *name* (from daml.yaml `name:`).
 * The JSON Ledger API expects package-name references (e.g. "#truthoracle-v11:Module:Entity")
 * in active-contracts template filters, not raw package IDs.
 */
export const TRUTHORACLE_PACKAGE_NAME =
  import.meta.env.VITE_TRUTHORACLE_PACKAGE_NAME ?? "truthoracle-v11";

/** Canton participant Ledger API base URL (for Interactive Submission API) */
export const PARTICIPANT_URL =
  import.meta.env.VITE_CANTON_PARTICIPANT_URL ?? 
  "https://api.validator.dev.digik.cantor8.tech/api/ledger";
