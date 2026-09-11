import { YourPositionBox } from "./MarketPositionCards";
import { fmtCC, fmtCountdown } from "./marketHelpers";
import type { OutcomeArg } from "@/utils/cantonCommands";

type ResolutionContext = {
  market: any;
  phase: any;
  nowSecs: any;
  busy: any;
  account: any;
  /** Anonymous visitor: the position boxes point at sign-in, not at connecting a wallet. */
  signInFirst?: boolean;
  setResolveOutcome: any;
  resolveOutcome: any;
  handleResolveT0: any;
  attestations: any;
  handleResolveWithAttestations: any;
  resolveSource: any;
  setResolveSource: any;
  handlePropose: any;
  handleChallenge: any;
  handleFinalize: any;
  userPosition: any;
  holdings: any;
  probYes: any;
  probNo: any;
  isAdmin: any;
  handleVoidMarket: any;
};

export default function MarketResolutionPanel({ context }: { context: ResolutionContext }) {
  const { market, phase, nowSecs, busy, account, signInFirst = false, isAdmin, setResolveOutcome, resolveOutcome, handleResolveT0, attestations, handleResolveWithAttestations, resolveSource, setResolveSource, handlePropose, handleChallenge, handleFinalize, handleVoidMarket, userPosition, holdings, probYes, probNo } = context;
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex-1 space-y-4">
            {/* T3 optimistic flow */}
            {market.policy.challengeSecs > 0 && (
              <div className="trade-panel border-oracle-purple/30">
                <div className="mb-3 text-center">
                  <h2 className="text-sm font-bold text-foreground">Optimistic Resolution (T3)</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Bond {fmtCC(market.policy.bondCC)} CC · challenges escalate to the objective tier, never a vote.
                  </p>
                </div>
                {phase === "expired" && (
                  <div className="flex gap-2">
                    {(["Yes", "No"] as OutcomeArg[]).map((o) => (
                      <button
                        key={o}
                        onClick={() => handlePropose(o)}
                        disabled={busy !== null || !account}
                        className={`flex-1 rounded-lg border py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                          o === "Yes"
                            ? "border-oracle-yes/30 text-oracle-yes hover:bg-oracle-yes/10"
                            : "border-oracle-no/30 text-oracle-no hover:bg-oracle-no/10"
                        }`}
                      >
                        Propose {o}
                      </button>
                    ))}
                  </div>
                )}
                {phase === "proposed" && market.proposal && (
                  <div className="space-y-3">
                    <div className="rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                      <div className="flex justify-between"><span>Proposed</span><span className="text-foreground">{market.proposal.proposedOutcome}</span></div>
                      <div className="flex justify-between"><span>Window closes</span><span>{fmtCountdown(market.proposal.proposedAt + market.policy.challengeSecs, nowSecs)}</span></div>
                      {market.proposal.challenger && (
                        <div className="flex justify-between text-oracle-no"><span>Challenged with</span><span>{market.proposal.challengerOutcome}</span></div>
                      )}
                    </div>
                    {!market.proposal.challenger && nowSecs <= market.proposal.proposedAt + market.policy.challengeSecs && (
                      <button
                        onClick={() => handleChallenge(market.proposal!.proposedOutcome === "Yes" ? "No" : "Yes")}
                        disabled={busy !== null || !account}
                        className="w-full rounded-lg border border-oracle-no/30 py-2 text-sm font-semibold text-oracle-no hover:bg-oracle-no/10 disabled:opacity-50"
                      >
                        Challenge with {market.proposal.proposedOutcome === "Yes" ? "No" : "Yes"} (+bond)
                      </button>
                    )}
                    {!market.proposal.challenger && nowSecs > market.proposal.proposedAt + market.policy.challengeSecs && (
                      <button
                        onClick={handleFinalize}
                        disabled={busy !== null || !account}
                        className="w-full rounded-lg bg-primary py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {busy === "finalize" ? "Finalizing…" : "Finalize proposal"}
                      </button>
                    )}
                    {market.proposal.challenger && (
                      <p className="text-center text-xs text-muted-foreground">
                        Awaiting objective escalation (reporter quorum / signed source).
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Admin resolution console */}
            {isAdmin && (
              <div className="trade-panel border-oracle-no/20">
                <div className="mb-4 text-center">
                  <h2 className="text-sm font-bold text-foreground">Operator Resolution</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Admin only — irreversible.</p>
                </div>

                {market.policy.operatorResolution && phase === "expired" && (
                  <>
                    <div className="mb-3 flex flex-col gap-2">
                      {(["Yes", "No", "VoidOutcome"] as OutcomeArg[]).map((r) => (
                        <button
                          key={r}
                          onClick={() => setResolveOutcome(r)}
                          className={`rounded-lg py-2 text-sm font-semibold transition-all ${
                            resolveOutcome === r
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
                    {market.policy.sources.length > 0 && (
                      <select
                        value={resolveSource || market.policy.sources[0]}
                        onChange={(e) => setResolveSource(e.target.value)}
                        className="input-field mb-3 text-sm"
                      >
                        {market.policy.sources.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={handleResolveT0}
                      className="mb-3 w-full rounded-lg bg-oracle-no/20 py-2.5 text-sm font-bold text-oracle-no ring-1 ring-oracle-no/30 hover:bg-oracle-no/30 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={busy !== null || !account}
                    >
                      {busy === "resolve" ? "Resolving…" : "Resolve (T0 operator)"}
                    </button>
                  </>
                )}

                {(market.policy.reporters.length > 0 || market.policy.sourceKeys.length > 0) && (
                  <div className="mb-3 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                    <div className="mb-1 font-medium text-foreground">
                      Attestations ({attestations.length})
                      {market.policy.quorum > 0 && ` — need ${market.policy.quorum} agreeing`}
                    </div>
                    {attestations.slice(0, 5).map((a) => (
                      <div key={a.contractId} className="flex justify-between">
                        <span className="truncate pr-2">{a.attester.slice(0, 18)}…</span>
                        <span className={a.outcome === "Yes" ? "text-oracle-yes" : a.outcome === "No" ? "text-oracle-no" : ""}>
                          {a.outcome}{a.hasSourceSignature ? " ✓T1" : ""}
                        </span>
                      </div>
                    ))}
                    <button
                      onClick={handleResolveWithAttestations}
                      disabled={busy !== null || attestations.length === 0}
                      className="mt-2 w-full rounded border border-border py-1.5 font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
                    >
                      Resolve from attestations (T1/T2)
                    </button>
                  </div>
                )}

                {nowSecs > market.expiresAt + market.gracePeriodSecs && (
                  <button
                    onClick={handleVoidMarket}
                    disabled={busy !== null}
                    className="w-full rounded-lg border border-border py-2 text-sm font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-50"
                  >
                    {busy === "void" ? "Voiding…" : "Void market (grace elapsed)"}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="w-full space-y-4 lg:w-80 lg:shrink-0"><YourPositionBox account={account} signInFirst={signInFirst} userPosition={userPosition} holdings={holdings} probYes={probYes} probNo={probNo} /></div>

    </div>
  );
}
