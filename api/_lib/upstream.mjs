/**
 * The treasury's party id as the server reads it, for the ledger relay's policy (proxyGuard.mjs).
 * The relay itself (api/proxy/ledger.mjs) resolves its own target and Keycloak prefixes, and
 * nothing on the server reaches the Enterprise Wallet any more.
 */

export const adminPartyId = () => (process.env.VITE_ENTERPRISE_WALLET_PARTY_ID || "").trim();
