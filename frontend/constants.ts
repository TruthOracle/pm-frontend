export const NETWORK = import.meta.env.VITE_APP_NETWORK ?? "devnet";

/** Deployed TruthOracle DAML package ID (from Canton participant after DAR upload). */
export const TRUTHORACLE_PACKAGE_ID =
  import.meta.env.VITE_TRUTHORACLE_PACKAGE_ID ??
  "54bb6ae431649ce7e6e422093009054a1675bdd3da8f511f6d260d032ef8b9b3";

/** Canton participant Ledger API base URL (for Interactive Submission API) */
export const PARTICIPANT_URL =
  import.meta.env.VITE_CANTON_PARTICIPANT_URL ?? 
  "https://api.validator.dev.digik.cantor8.tech/api/ledger";
