/**
 * Re-attach an UNLINKED identity to the account that owns it — ARCHITECTURE.md §6.4,
 * API.md → Me: `POST /me/identities/:id/reattach → { identity }`.
 *
 * Unlink is a revocation, never a deletion, so the row still belongs to this account
 * and only this account (a session of the original `user_id`) may bring it back. The
 * route demands a FRESH proof for that provider — "body is the same as the matching
 * login route":
 *   google     { credential, nonce }            (GIS ID token echoing a server nonce)
 *   telegram   the Login Widget's user object   (server verifies `hash`)
 * Wallets are not sign-in methods (§7.3 is linking only): an unlinked wallet is re-linked
 * from the Wallets section by connecting it and signing a fresh link challenge, which
 * reactivates its row on the server.
 * The dialog therefore renders the ordinary provider button/widget for that provider
 * and hands the credential here instead of to the login route. The response's
 * identity id is checked against the one asked for so a server that re-attached
 * something else (or a stale dialog) is caught rather than silently celebrated.
 */
import { backendFetch } from "@/lib/backend";
import type { Identity, TelegramWidgetUser } from "./types";

export type ReattachProof = { credential: string; nonce: string } | TelegramWidgetUser;

export async function reattachIdentity(identity: Identity, proof: ReattachProof): Promise<Identity> {
  const res = await backendFetch<{ identity: Identity }>(
    `/api/v1/me/identities/${encodeURIComponent(identity.id)}/reattach`,
    { method: "POST", body: proof },
  );
  if (!res?.identity || res.identity.id !== identity.id) {
    throw new Error("The server re-attached a different sign-in method than the one selected. Reload the page and check your sign-in methods.");
  }
  if (res.identity.status !== "active") {
    throw new Error("The sign-in method is still unlinked. Contact support if this keeps happening.");
  }
  return res.identity;
}
