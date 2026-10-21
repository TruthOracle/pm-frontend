/**
 * The operator's resolution console on the market page (review F0). ResolveT0, Resolve from
 * attestations and VoidMarket are requested from the accounts backend (lib/marketResolution.ts):
 * the four-eyes `market.resolve`, which a second person approves under Operator console →
 * Approvals before the backend signs it as the treasury with its own clock. The browser signs
 * nothing as the treasury. Only what the backend would accept now is offered, to a session with
 * the ops role (an approver sees the state and decides under Approvals), and an open request is
 * shown instead of a second one. The body is checked as the backend's DTO checks it before it is
 * sent; the T0 sources are the backend's allowlist. Resolve names the attestations the backend
 * reads as usable, preselected and each one untickable; the unusable ones are listed with why. The
 * last submission says how it stands. With decision signatures on, a request the backend runs at
 * once (single control) asks for the operator wallet's signature first (C23); until it is signed or
 * cancelled the request's fields stay as asked and the box names what is signed (R3-05).
 */
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@chakra-ui/react";
import { useAuth } from "@/auth/AuthContext";
import { WALLET_DISPLAY_NAME } from "@/config";
import { fetchAdminSessionInfo } from "@/lib/backendAdmin";
import {
  fetchMarketResolution,
  lastSubmissionSentence,
  offeredChoices,
  pendingResolutionSentence,
  requestMarketResolution,
  resolutionAnswerSentence,
  resolutionErrorMessage,
  resolutionInputProblem,
  resolutionRoleProblem,
  resolutionSignedRequest,
  resolutionWhat,
  resolveAttestationRows,
  resolvePickProblem,
  utcSeconds,
  wireOutcome,
  type MarketResolutionAnswer,
  type MarketResolutionChoice,
  type MarketResolutionInput,
  type MarketResolutionState,
} from "@/lib/marketResolution";
import { isSignatureStep, makeMessageSigner, sendDecisionSigned, sendDecisionUnsigned } from "@/lib/rampAdmin";
import type { ApiAdminSession } from "@/lib/rampAdminTypes";
import type { OutcomeAttestationRecord, PredictionMarketRecord } from "@/utils/activeContracts";
import type { OutcomeArg } from "@/utils/cantonCommands";
import { useCantonWallet } from "@/wallets";

interface Props {
  market: PredictionMarketRecord;
  /** The market's OutcomeAttestations as the treasury sees them (the public ledger read): offered only while the backend's GET sends none. */
  attestations: OutcomeAttestationRecord[];
  /** After the backend executed a request: refresh the market and the page's views. */
  onSubmitted: () => Promise<void> | void;
}

const T0_OUTCOMES: OutcomeArg[] = ["Yes", "No", "VoidOutcome"];

export default function MarketOperatorResolution({ market, attestations, onSubmitted }: Props) {
  const toast = useToast();
  const auth = useAuth();
  const { account, signMessage } = useCantonWallet();
  const [state, setState] = useState<MarketResolutionState | null>(null);
  // The operator's roles (GET /admin/session): requests need ops. Unknown (null) → offered, the backend refuses.
  const [session, setSession] = useState<ApiAdminSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<OutcomeArg>("Yes");
  const [source, setSource] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<MarketResolutionChoice | null>(null);
  const [answer, setAnswer] = useState<MarketResolutionAnswer | null>(null);
  // The usable attestations the operator unticked, by cid: a reload keeps them out, a newly usable one arrives ticked.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set());
  // C23: the backend asked for the operator's signature over this exact request (nothing was saved).
  const [signing, setSigning] = useState<{ input: MarketResolutionInput; reason: string; message: string } | null>(null);

  const marketId = market.marketId;
  const load = useCallback(async () => {
    try {
      setState(await fetchMarketResolution(marketId));
      setLoadError(null);
    } catch (e) {
      setState(null);
      setLoadError(resolutionErrorMessage(e));
    }
  }, [marketId]);

  // Re-read when the market moves on (a trade re-creates the contract; resolution changes its status).
  useEffect(() => {
    void load();
  }, [load, market.status, market.contractId]);

  useEffect(() => {
    let live = true;
    fetchAdminSessionInfo()
      .then((s) => live && setSession(s))
      .catch(() => live && setSession(null));
    return () => {
      live = false;
    };
  }, []);

  const failed = (what: string, e: unknown) =>
    toast({ title: `${what} failed`, description: resolutionErrorMessage(e), status: "error", duration: 9000, isClosable: true });

  const settle = async (result: MarketResolutionAnswer) => {
    setAnswer(result);
    const s = resolutionAnswerSentence(result);
    toast({ title: s.title, description: s.description, status: s.status, duration: 10000, isClosable: true });
    if (result.approval.status === "executed") await onSubmitted();
    await load();
  };

  const request = async (input: MarketResolutionInput) => {
    const why = reason.trim();
    setBusy(input.choice);
    try {
      const result = await sendDecisionUnsigned(
        (signature) => requestMarketResolution(marketId, input, why, signature),
        resolutionSignedRequest(marketId, input),
      );
      if (isSignatureStep(result)) {
        setSigning({ input, reason: why, message: result.signatureMessage });
        return;
      }
      await settle(result);
    } catch (e) {
      failed(`${input.choice} request`, e);
    } finally {
      setBusy(null);
    }
  };

  // The second click: the wallet popup is the first thing it awaits, then the same request goes out signed.
  const signAndRequest = async () => {
    if (!signing) return;
    const s = signing;
    const sign = makeMessageSigner({ walletParty: account?.partyId, operatorParty: auth.user?.partyId ?? null, walletName: WALLET_DISPLAY_NAME, signMessage });
    setBusy(s.input.choice);
    try {
      const result = await sendDecisionSigned((signature) => requestMarketResolution(marketId, s.input, s.reason, signature), s.message, sign);
      setSigning(null);
      await settle(result);
    } catch (e) {
      failed(`${s.input.choice} request`, e);
    } finally {
      setBusy(null);
    }
  };

  const offered = offeredChoices(state, session);
  const roleProblem = state ? resolutionRoleProblem(session) : null;
  const w = state?.windows;
  // The allowlist the backend checks a T0 source against (its index of the market's policy).
  const sources = state?.market.sources ?? market.policy.sources;
  const sourceUri = (source || sources[0] || "").trim();
  const t0Input: MarketResolutionInput = { choice: "ResolveT0", outcome: wireOutcome(outcome), sourceUri };
  // The backend's read of the attestations (usable or why not) when it sends one; else the ledger read, all of it.
  const pickable = state?.attestations != null;
  const rows = resolveAttestationRows(state?.attestations ?? null, attestations, unticked);
  const picked = rows.filter((a) => a.selected);
  const resolveInput: MarketResolutionInput = { choice: "Resolve", attestationCids: picked.map((a) => a.cid) };
  // The DTO's checks before anything is sent: the reason's length, then each choice's own fields.
  const reasonProblem = resolutionInputProblem({ choice: "VoidMarket" }, reason);
  const t0Problem = sourceUri ? resolutionInputProblem(t0Input, "") : null;
  const pickProblem = resolvePickProblem(rows);
  const resolveProblem = pickProblem ?? resolutionInputProblem(resolveInput, "");
  const blocked = busy !== null || signing !== null || reason.trim() === "" || reasonProblem !== null;
  const outcomes = [...new Set(picked.map((a) => a.outcome))];
  const toggle = (cid: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  const btnCls = "w-full rounded-lg border border-border py-2 text-sm font-semibold text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="trade-panel border-oracle-no/20">
      <div className="mb-3 text-center">
        <h2 className="text-sm font-bold text-foreground">Operator resolution</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Requested here, approved by a second person under Operator console → Approvals, then signed by the backend as the treasury. Irreversible.
        </p>
      </div>
      {loadError && <p className="mb-2 text-xs text-oracle-no">{loadError}</p>}
      {!state && !loadError && <p className="text-xs text-muted-foreground">Reading what the backend would accept…</p>}
      {state?.pending && <p className="mb-3 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-foreground">{pendingResolutionSentence(state.pending)}</p>}
      {state?.lastSubmission && (
        <p className={`mb-3 text-xs ${state.lastSubmission.status === "failed" ? "text-oracle-no" : "text-muted-foreground"}`}>{lastSubmissionSentence(state.lastSubmission)}</p>
      )}
      {answer && answer.approval.status !== "pending" && <p className="mb-3 text-xs text-muted-foreground">{resolutionAnswerSentence(answer).description}</p>}
      {roleProblem && <p className="mb-3 text-xs text-muted-foreground">{roleProblem}</p>}
      {state && w && !state.pending && !roleProblem && offered.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing can be requested now ({state.market.status ?? market.status}{state.asOf ? ` at ${utcSeconds(state.asOf)} by the backend clock` : ""}). T0{" "}
          {utcSeconds(w.resolveT0From)} – {utcSeconds(w.resolveT0To)} · attestations from {utcSeconds(w.resolveFrom)} · void from {utcSeconds(w.voidFrom)}.
        </p>
      )}

      {w && offered.length > 0 && (
        <>
          <input className="input-field mb-3 text-sm" value={reason} disabled={signing !== null} onChange={(e) => setReason(e.target.value)} placeholder="Reason (kept on the request and the audit row)" />
          {reasonProblem && <p className="-mt-2 mb-3 text-[11px] text-oracle-no">{reasonProblem}</p>}
          {offered.includes("ResolveT0") && (
            <div className="mb-4">
              <p className="mb-2 text-[11px] text-muted-foreground">T0 window {utcSeconds(w.resolveT0From)} – {utcSeconds(w.resolveT0To)}</p>
              <div className="mb-2 flex flex-col gap-2">
                {T0_OUTCOMES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={signing !== null}
                    onClick={() => setOutcome(r)}
                    className={`rounded-lg py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                      outcome === r
                        ? r === "Yes"
                          ? "border-2 border-oracle-yes bg-oracle-yes/20 text-oracle-yes"
                          : r === "No"
                            ? "border-2 border-oracle-no bg-oracle-no/20 text-oracle-no"
                            : "border-2 border-border bg-secondary text-foreground"
                        : "border border-border text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    {r === "Yes" ? "Yes wins" : r === "No" ? "No wins" : "Void market"}
                  </button>
                ))}
              </div>
              {sources.length > 0 ? (
                <select value={sourceUri} disabled={signing !== null} onChange={(e) => setSource(e.target.value)} className="input-field mb-2 text-sm">
                  {sources.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              ) : (
                <input className="input-field mb-2 text-sm" value={source} disabled={signing !== null} onChange={(e) => setSource(e.target.value)} placeholder="https://… (the page the result was read from)" />
              )}
              {t0Problem && <p className="mb-2 text-[11px] text-oracle-no">{t0Problem}</p>}
              <button
                type="button"
                className="w-full rounded-lg bg-oracle-no/20 py-2.5 text-sm font-bold text-oracle-no ring-1 ring-oracle-no/30 hover:bg-oracle-no/30 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={blocked || !sourceUri || t0Problem !== null}
                onClick={() => void request(t0Input)}
              >
                {busy === "ResolveT0" ? "Requesting…" : `Request T0: ${outcome === "VoidOutcome" ? "void" : `${outcome} wins`}`}
              </button>
            </div>
          )}
          {offered.includes("Resolve") && (
            <div className="mb-4 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
              <div className="mb-1 font-medium text-foreground">
                Attestations ({pickable ? `${picked.length} of ${rows.length} ticked` : rows.length}){market.policy.quorum > 0 ? ` — need ${market.policy.quorum} agreeing` : ""}
                {outcomes.length > 1 ? " — they disagree, the ledger refuses them together" : ""}
              </div>
              {rows.map((a) => (
                <div key={a.cid} className={a.usable ? "" : "opacity-70"}>
                  <label className="flex justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      {pickable && <input type="checkbox" checked={a.selected} disabled={!a.usable || busy !== null || signing !== null} onChange={() => toggle(a.cid)} />}
                      <span className="truncate">{a.sourceUri ?? "?"} · {utcSeconds(a.fetchedAt)}</span>
                    </span>
                    <span className={a.outcome === "Yes" ? "text-oracle-yes" : a.outcome === "No" ? "text-oracle-no" : ""}>
                      {a.outcome ?? "?"}{a.signed ? " ✓T1" : ""}
                    </span>
                  </label>
                  {a.why && <p className="text-[11px] text-oracle-no">{a.why}</p>}
                </div>
              ))}
              {resolveProblem && <p className="mt-2 text-[11px] text-oracle-no">{resolveProblem}</p>}
              <button
                type="button"
                className={`mt-2 ${btnCls}`}
                disabled={blocked || picked.length === 0 || resolveProblem !== null}
                onClick={() => void request(resolveInput)}
              >
                {busy === "Resolve" ? "Requesting…" : `Request resolution from ${picked.length} attestation${picked.length === 1 ? "" : "s"} (T1/T2)`}
              </button>
            </div>
          )}
          {offered.includes("VoidMarket") && (
            <button type="button" className={btnCls} disabled={blocked} onClick={() => void request({ choice: "VoidMarket" })}>
              {busy === "VoidMarket" ? "Requesting…" : `Request void (grace elapsed ${utcSeconds(w.voidFrom)})`}
            </button>
          )}
        </>
      )}

      {signing && (
        <div className="mt-3 rounded-lg border border-border px-3 py-2 text-xs text-foreground">
          <p>This backend runs the request at once (single control) and wants your {WALLET_DISPLAY_NAME} wallet&apos;s signature over it first. Nothing was saved yet.</p>
          {/* R3-05: what the signature commits to, as asked at the first click; the fields above stay as they were until Cancel. */}
          <p className="mt-1 font-semibold">You sign: {resolutionWhat(signing.input)} on market #{marketId}, reason &ldquo;{signing.reason}&rdquo;</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={btnCls} disabled={busy !== null} onClick={() => void signAndRequest()}>
              {busy !== null ? "Waiting for your wallet…" : `Sign and request ${signing.input.choice}`}
            </button>
            <button type="button" className={btnCls} disabled={busy !== null} onClick={() => setSigning(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
