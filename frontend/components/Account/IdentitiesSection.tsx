/**
 * Sign-in methods: every identity attached to the account (§6) — Google and Telegram.
 * Wallets are not sign-in methods; they live in WalletsSection (§8). Unlinking is a
 * revocation, not a deletion — the row stays, so the same Google/Telegram can never
 * create a second account, and an unlinked row is re-attached from THIS list with a
 * fresh proof (POST /me/identities/:id/reattach, auth/reattach.ts), never by signing in
 * with it (that fails closed with identity_unlinked).
 */
import { useState } from "react";
import { useToast } from "@chakra-ui/react";
import { KeyRound, Link2, Lock, RotateCcw, Unlink } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import type { Identity, MeResponse } from "@/auth/types";
import { backendFetch } from "@/lib/backend";
import { accountErrorMessage, type ErrorSentences } from "@/lib/backendErrors";
import {
  ConfirmDialog,
  Pill,
  ProviderIcon,
  SectionCard,
  fmtDateTime,
  primaryBtn,
  providerLabel,
  smallBtn,
} from "./accountUi";

const UNLINK_ERRORS: ErrorSentences = {
  last_identity: "You can't unlink your only sign-in method. Add another sign-in method first.",
  identity_locked_by_kyc:
    "This sign-in method is attached to your identity verification and can't be unlinked while the approval stands.",
};

/** What identifies this identity to a human: email, @username, name, or the raw subject. */
function identityHandle(identity: Identity): string {
  if (identity.email) return identity.email;
  if (identity.profile.username) return `@${identity.profile.username}`;
  return identity.profile.name ?? identity.subject;
}

export default function IdentitiesSection({ me }: { me: MeResponse }) {
  const auth = useAuth();
  const toast = useToast();
  const [target, setTarget] = useState<Identity | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = me.identities.filter((i) => i.status === "active");
  const unlinked = me.identities.filter((i) => i.status !== "active");

  const unlink = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await backendFetch<{ ok: true }>(`/api/v1/me/identities/${encodeURIComponent(target.id)}`, { method: "DELETE" });
      await auth.refresh();
      setTarget(null);
      toast({ title: `${providerLabel(target.provider)} sign-in unlinked`, status: "success", duration: 4000, isClosable: true });
    } catch (e) {
      setError(accountErrorMessage(e, UNLINK_ERRORS));
    } finally {
      setBusy(false);
    }
  };

  /** Why Unlink is off for this row, or null when it is allowed. */
  const unlinkBlock = (identity: Identity): string | null => {
    if (identity.kycLocked) return UNLINK_ERRORS.identity_locked_by_kyc ?? null;
    if (active.length <= 1) return UNLINK_ERRORS.last_identity ?? null;
    return null;
  };

  return (
    <SectionCard
      icon={<KeyRound className="h-4 w-4" />}
      title="Sign-in methods"
      description="Any of these signs you into this account. Keep at least one; a method attached to your identity verification stays locked."
      action={
        <button type="button" onClick={() => auth.openLogin("link")} className={primaryBtn}>
          <Link2 className="h-4 w-4" /> Link another
        </button>
      }
    >
      <ul className="divide-y divide-slate-100">
        {active.map((identity) => {
          const block = unlinkBlock(identity);
          return (
            <li key={identity.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                <ProviderIcon provider={identity.provider} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{providerLabel(identity.provider)}</span>
                  {identity.kycLocked && (
                    <Pill tone="info" title="Attached to your identity verification; cannot be unlinked while the approval stands.">
                      <Lock className="h-3 w-3" /> KYC-locked
                    </Pill>
                  )}
                </div>
                <div className="truncate font-mono text-xs text-slate-600" title={identity.subject}>
                  {identityHandle(identity)}
                </div>
                <div className="text-[11px] text-slate-400">
                  Added {fmtDateTime(identity.verifiedAt)}
                  {identity.lastUsedAt ? ` · last used ${fmtDateTime(identity.lastUsedAt)}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setTarget(identity);
                }}
                disabled={block !== null}
                title={block ?? "Unlink this sign-in method"}
                className={smallBtn}
              >
                <Unlink className="h-3.5 w-3.5" /> Unlink
              </button>
            </li>
          );
        })}
      </ul>

      {unlinked.length > 0 && (
        <details className="mt-3 text-xs text-slate-500">
          <summary className="cursor-pointer font-semibold text-slate-600">
            Unlinked methods ({unlinked.length})
          </summary>
          <p className="mt-2 text-slate-500">
            These still belong to this account and cannot open a new one. Signing in with one is refused; to use
            it again, re-attach it here — you will be asked to prove it once more.
          </p>
          <ul className="mt-2 space-y-1.5">
            {unlinked.map((identity) => (
              <li key={identity.id} className="flex flex-wrap items-center gap-2 text-slate-500">
                <ProviderIcon provider={identity.provider} className="h-3.5 w-3.5" />
                <span>{providerLabel(identity.provider)}</span>
                <span className="font-mono" title={identity.subject}>
                  {identityHandle(identity)}
                </span>
                <Pill tone="neutral">Unlinked</Pill>
                <button
                  type="button"
                  onClick={() => auth.openLogin("reattach", identity)}
                  title={`Re-attach this ${providerLabel(identity.provider)} sign-in with a fresh proof`}
                  className={`${smallBtn} ml-auto`}
                >
                  <RotateCcw className="h-3 w-3" /> Re-attach
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title={target ? `Unlink ${providerLabel(target.provider)}?` : ""}
        description={
          target
            ? `You will no longer be able to sign in with ${identityHandle(target)}. It stays reserved for this account and can be re-attached later from this section.`
            : ""
        }
        confirmLabel="Unlink"
        destructive
        busy={busy}
        error={error}
        onConfirm={() => void unlink()}
      />
    </SectionCard>
  );
}
