/**
 * Saved cards (`GET /ramp/payment-methods`): each with how much can still go back to it. Removing
 * one frees a card slot; the card can then no longer take cash-outs, and paying with it again
 * counts as a new card.
 */
import { useState } from "react";
import { CreditCard, Trash2 } from "lucide-react";
import { cardLabel, fiatLabel, rampErrorMessage, removeRampCard, type RampCard } from "@/lib/ramp";
import { ConfirmDialog, SectionCard, smallBtn } from "@/components/Account/accountUi";

/** What removing a card can answer, worded for a card rather than an order. */
const REMOVE_SENTENCES = {
  ramp_order_state: "A cash-out to this card is still on its way. Remove the card once it has finished.",
  not_found: "This card was already removed. Reload the page.",
};

function cashoutLine(card: RampCard, currency: string): string {
  if (card.status === "blocked") return "This card cannot take cash-outs at the moment.";
  switch (card.cashout.mode) {
    case "refund":
      return `Up to ${fiatLabel(card.cashout.available, currency)} can go back to this card.`;
    case "oct":
      return "Cash-outs can be paid to this card.";
    default:
      return "Cash-outs cannot go to this card.";
  }
}

export function RampSavedCards({
  cards,
  failed,
  currency,
  onChanged,
}: {
  cards: RampCard[];
  failed: boolean;
  currency: string;
  onChanged: () => void;
}) {
  const [target, setTarget] = useState<RampCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await removeRampCard(target.id);
      setTarget(null);
      onChanged();
    } catch (e) {
      setError(rampErrorMessage(e, REMOVE_SENTENCES));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      id="cards"
      icon={<CreditCard className="h-4 w-4" />}
      title="Saved cards"
      description="Cards you paid with. A cash-out to a card refunds that card's own purchases."
    >
      {failed && <p className="text-xs text-red-700">Your cards could not be loaded. Reload to try again.</p>}
      {!failed && cards.length === 0 && <p className="text-sm text-slate-500">No saved cards.</p>}
      <ul className="divide-y divide-slate-100">
        {cards.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div>
              <div className="font-semibold text-slate-900">
                {cardLabel(c)}
                {c.issuerCountry ? (
                  <span className="ml-2 text-xs font-normal text-slate-500">issued in {c.issuerCountry}</span>
                ) : null}
              </div>
              <div className="text-xs text-slate-600">{cashoutLine(c, currency)}</div>
            </div>
            <button
              type="button"
              className={smallBtn}
              onClick={() => {
                setError(null);
                setTarget(c);
              }}
              aria-label={`Remove ${cardLabel(c)}`}
            >
              <Trash2 className="h-3 w-3" /> Remove
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title="Remove this card?"
        description={
          target
            ? `${cardLabel(target)} can then no longer take cash-outs, and paying with it again counts as a new card.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        busy={busy}
        error={error}
        onConfirm={() => void remove()}
      />
    </SectionCard>
  );
}

export default RampSavedCards;
