import { Link } from "react-router-dom";
import { YourPositionBox } from "./MarketPositionCards";
import MarketOperatorResolution from "./MarketOperatorResolution";
import type { WalletHolding } from "@/lib/walletHoldings";
import { fmtCountdown } from "./marketHelpers";
import { formatMoney } from "@/lib/instruments";
import type { OutcomeAttestationRecord } from "@/utils/activeContracts";
import type { OutcomeArg } from "@/utils/cantonCommands";

type ResolutionContext = {
  market: any;
  phase: any;
  nowSecs: any;
  busy: any;
  account: any;
  /** Anonymous visitor: the position boxes point at sign-in, not at connecting a wallet. */
  signInFirst?: boolean;
  /** The backend session is an operator's: the resolution console (lib/marketResolution.ts) shows. */
  operator: boolean;
  /** Only the browser relay's admin session: the console says where resolution moved. */
  relayAdmin: boolean;
  attestations: OutcomeAttestationRecord[];
  /** After the backend executed a resolution request. */
  onResolutionSubmitted: () => Promise<void> | void;
  handlePropose: any;
  handleChallenge: any;
  handleFinalize: any;
  userPosition: any;
  /** Every token the external wallet reports; YourPositionBox shows the market's collateral. */
  holdings: WalletHolding[] | null;
  probYes: any;
  probNo: any;
};

export default function MarketResolutionPanel({ context }: { context: ResolutionContext }) {
  const { market, phase, nowSecs, busy, account, signInFirst = false, operator, relayAdmin, attestations, onResolutionSubmitted, handlePropose, handleChallenge, handleFinalize, userPosition, holdings, probYes, probNo } = context;
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex-1 space-y-4">
            {/* T3 optimistic flow */}
            {market.policy.challengeSecs > 0 && (
              <div className="trade-panel border-oracle-purple/30">
                <div className="mb-3 text-center">
                  <h2 className="text-sm font-bold text-foreground">Optimistic Resolution (T3)</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Bond {formatMoney(market.policy.bond, market.collateral)} · challenges escalate to the objective tier, never a vote.
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

            {/* Operator resolution: requested from the accounts backend, approved by a second person (review F0).
                Keyed by market: another market never inherits a pending signature step, reason or answer. */}
            {operator ? (
              <MarketOperatorResolution key={market.marketId} market={market} attestations={attestations} onSubmitted={onResolutionSubmitted} />
            ) : relayAdmin ? (
              <div className="trade-panel border-oracle-no/20 text-xs text-muted-foreground">
                Market resolution runs through the accounts backend now: a request, then a second person&apos;s approval. Sign in
                there as an operator under <Link to="/admin" className="quiet-link">Operator console</Link> to request it.
              </div>
            ) : null}
          </div>
          <div className="w-full space-y-4 lg:w-80 lg:shrink-0"><YourPositionBox account={account} signInFirst={signInFirst} userPosition={userPosition} holdings={holdings} collateral={market.collateral} probYes={probYes} probNo={probNo} /></div>

    </div>
  );
}
