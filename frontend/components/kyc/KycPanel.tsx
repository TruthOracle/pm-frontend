/**
 * Identity verification panel (Account page → "Identity verification").
 *
 * Reads `GET /api/v1/kyc`, explains the status in plain words, and runs the
 * provider flow the backend hands back from `POST /api/v1/kyc/sessions`:
 *  - "sumsub": the WebSDK is loaded on demand and mounted into a container div
 *    here; token refreshes go back through the same session endpoint;
 *  - "mock": a small inline form, visibly labelled "Test mode", that drives the
 *    same server-side state machine (never registered in prod / mainnet).
 *
 * Personal details typed into the mock form live in component state only and
 * are sent once; nothing is cached or logged (§9.7).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@chakra-ui/react";
import { LoaderCircle, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import {
  createKycSession,
  describeKyc,
  fetchKyc,
  kycErrorMessage,
  launchSumsub,
  loadSumsubSdk,
  SUMSUB_CONTAINER_ID,
  type KycReport,
  type KycSessionResponse,
  type KycTone,
  type SnsWebSdkInstance,
} from "@/lib/kyc";
import MockKycForm from "./MockKycForm";
import { formatDateTimeUTC } from "@/lib/time";

const TONE_CLASSES: Record<KycTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-orange-200 bg-orange-50 text-orange-800",
  bad: "border-red-200 bg-red-50 text-red-700",
};

function StatusIcon({ tone }: { tone: KycTone }) {
  const cls = "h-5 w-5";
  if (tone === "ok") return <ShieldCheck className={`${cls} text-emerald-600`} />;
  if (tone === "bad" || tone === "warn") return <ShieldAlert className={`${cls} text-red-500`} />;
  return <ShieldQuestion className={`${cls} text-slate-400`} />;
}

export default function KycPanel() {
  const auth = useAuth();
  const toast = useToast();
  const [report, setReport] = useState<KycReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [session, setSession] = useState<KycSessionResponse | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const sdkRef = useRef<SnsWebSdkInstance | null>(null);

  const load = useCallback(async () => {
    try {
      setReport(await fetchKyc());
      setLoadError(null);
    } catch (e) {
      setLoadError(kycErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Depend on the stable refresh() callback, not the context value: `auth` changes
  // identity after every refresh, and a new syncAfterChange would re-run the widget
  // effect below — destroying and relaunching Sumsub mid-flow.
  const refreshAuth = auth.refresh;
  /** Re-read both the KYC report and `/me` (capabilities.canWithdraw flips on approval); neither throws. */
  const syncAfterChange = useCallback(async () => {
    await Promise.all([load(), refreshAuth()]);
  }, [load, refreshAuth]);

  // While a Sumsub review is pending the status flips server-side via webhook; poll
  // gently so the user sees "Verified" without reloading. Stops as soon as the status
  // leaves "pending".
  useEffect(() => {
    if (report?.status !== "pending") return;
    const id = window.setInterval(() => void syncAfterChange(), 10_000);
    return () => window.clearInterval(id);
  }, [report?.status, syncAfterChange]);

  const start = async () => {
    setFlowError(null);
    setStarting(true);
    try {
      setSession(await createKycSession());
    } catch (e) {
      setFlowError(kycErrorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  // Mount the Sumsub widget once the container div exists. The cleanup destroys the
  // instance; the `cancelled` flag is checked AFTER the SDK load and BEFORE the launch
  // (StrictMode runs mount → cleanup → mount, and both mounts await the same script
  // promise — launching from the first one would mount an iframe only to destroy it
  // under the second's).
  useEffect(() => {
    if (session?.provider !== "sumsub") return;
    let cancelled = false;
    const container = document.getElementById(SUMSUB_CONTAINER_ID);
    void (async () => {
      try {
        const sdk = await loadSumsubSdk();
        if (cancelled) return;
        sdkRef.current = launchSumsub(sdk, {
          accessToken: session.accessToken,
          email: auth.me?.user.email ?? null,
          refreshToken: async () => {
            const next = await createKycSession();
            if (next.provider !== "sumsub") throw new Error("Verification provider changed; reload the page.");
            return next.accessToken;
          },
          onStatusChanged: (payload) => {
            // "completed" carries the answer; "pending" means documents are uploaded and
            // the review started — both are worth reflecting in the status card.
            if (payload.reviewStatus === "completed" || payload.reviewStatus === "pending") {
              void syncAfterChange();
            }
          },
          // Documents (re)submitted: the backend flips to pending on the webhook; re-read now
          // so the card does not wait for the next poll.
          onSubmitted: () => void syncAfterChange(),
          onError: () => {
            setFlowError("The verification widget reported an error. You can close it and start again.");
          },
        });
      } catch (e) {
        if (cancelled) return;
        setFlowError(kycErrorMessage(e));
        // Drop the session so "Start verification" is back on screen: the container
        // would otherwise stay blank with the only way forward a page reload.
        setSession(null);
      }
    })();
    return () => {
      cancelled = true;
      sdkRef.current?.destroy?.();
      sdkRef.current = null;
      // Older SDK builds have no destroy(); clearing the container keeps a stale
      // iframe from surviving into the next launch.
      if (container) container.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, syncAfterChange]);

  const closeFlow = () => {
    setSession(null);
    void syncAfterChange();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <LoaderCircle className="h-4 w-4 animate-spin" /> Checking verification status…
      </div>
    );
  }

  if (!report) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        {loadError ?? "Verification status could not be loaded."}
        <button type="button" onClick={() => void load()} className="ml-2 font-semibold text-primary hover:underline">
          Retry
        </button>
      </div>
    );
  }

  const view = describeKyc(report);
  const attached = report.attachedIdentityId
    ? auth.me?.identities.find((i) => i.id === report.attachedIdentityId) ?? null
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <StatusIcon tone={view.tone} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASSES[view.tone]}`}>
                {view.label}
              </span>
              {report.provider && (
                <span className="text-[11px] uppercase tracking-wide text-slate-400">
                  {report.provider === "mock" ? "Test mode" : report.provider} · {report.levelName}
                </span>
              )}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{view.sentence}</p>
            {report.status === "approved" && attached && (
              <p className="mt-1 text-xs text-slate-500">
                Attached to your {attached.provider === "canton_wallet" ? "wallet" : attached.provider} sign-in
                {attached.email ? ` (${attached.email})` : attached.profile.username ? ` (@${attached.profile.username})` : ""}.
                That sign-in method cannot be unlinked while the approval stands.
              </p>
            )}
            {report.verification?.moderationComment && report.status === "rejected" && (
              <p className="mt-1 text-xs text-slate-500">Reviewer note: {report.verification.moderationComment}</p>
            )}
          </div>
        </div>
        {view.canStart && !session && (
          <button
            type="button"
            onClick={() => void start()}
            disabled={starting}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
          >
            {starting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {starting ? "Starting…" : view.startLabel}
          </button>
        )}
      </div>

      {flowError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{flowError}</div>
      )}

      {session?.provider === "sumsub" && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span>Secure verification by Sumsub. Have a photo ID ready.</span>
            <button type="button" onClick={closeFlow} className="font-semibold text-slate-600 hover:text-slate-900">
              Close
            </button>
          </div>
          <div id={SUMSUB_CONTAINER_ID} className="min-h-[24rem]" />
        </div>
      )}

      {session?.provider === "mock" && (
        <MockKycForm
          verificationId={session.verificationId}
          onDone={(status) => {
            toast({
              title: status === "approved" ? "Identity verified (test mode)" : "Test verification recorded",
              description:
                status === "approved"
                  ? "Withdrawals are now enabled for this account."
                  : `The test outcome was "${status.replace("_", " ")}".`,
              status: status === "approved" ? "success" : "info",
              duration: 6000,
              isClosable: true,
            });
            closeFlow();
          }}
          onCancel={closeFlow}
        />
      )}

      {report.history.length > 1 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer font-semibold text-slate-600">Previous attempts</summary>
          <ul className="mt-2 space-y-1">
            {report.history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-2">
                <span className="font-mono">#{h.attemptNo}</span>
                <span>{h.status.replace(/_/g, " ")}</span>
                <span className="text-slate-400">{formatDateTimeUTC(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
