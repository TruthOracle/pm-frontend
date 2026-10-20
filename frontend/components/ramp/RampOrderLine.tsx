/**
 * One order as a list line (open orders on the ramp card, the order history page): what it is,
 * how much, where it stands, and the next thing the person can do — pay, sign, cancel, or open it.
 */
import { Link } from "react-router-dom";
import { Pill } from "@/components/Account/accountUi";
import { formatMoney } from "@/lib/instruments";
import { formatShortDateTimeUTC } from "@/lib/time";
import { fiatLabel, rampCancelOffered, rampStatusView, readRampSignedAt, type RampOrder } from "@/lib/ramp";
import { CancelOrderButton } from "./rampUi";

export function orderSummary(order: RampOrder): string {
  if (order.direction === "onramp")
    return `${order.method === "erip" ? "Buy by ERIP" : "Buy by card"} · ${fiatLabel(order.fiatAmount, order.fiatCurrency)}`;
  return `${order.rail === "bank" ? "Cash-out to bank" : "Cash-out to card"} · ${formatMoney(order.tokenAmount, order.instrument)}`;
}

export function RampOrderLine({
  order,
  onChanged,
  showDate = false,
}: {
  order: RampOrder;
  onChanged: (order: RampOrder) => void;
  showDate?: boolean;
}) {
  const view = rampStatusView(order);
  const href = `/wallet/ramp/${encodeURIComponent(order.id)}`;
  const nextStep =
    order.status === "awaiting_withdrawal"
      ? "Sign in wallet"
      : order.status === "awaiting_payment" && order.method === "erip"
        ? "Payment details"
        : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
      <span className="flex flex-col">
        <span className="font-medium text-slate-800">{orderSummary(order)}</span>
        {showDate && <span className="text-[11px] text-slate-500">{formatShortDateTimeUTC(order.createdAt)}</span>}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Pill tone={view.tone}>{view.label}</Pill>
        {nextStep && (
          <Link to={href} className="font-semibold text-primary underline">
            {nextStep}
          </Link>
        )}
        {/* Never while a withdrawal this tab signed for the cash-out is on its way (review F5). */}
        {rampCancelOffered(order, { signedAt: readRampSignedAt(order.id), now: Date.now() }) && (
          <CancelOrderButton
            order={order}
            onCancelled={onChanged}
            label="Cancel"
            className="text-slate-500 underline"
          />
        )}
        <Link to={href} className="font-semibold text-primary underline">
          Details
        </Link>
      </span>
    </li>
  );
}

export default RampOrderLine;
