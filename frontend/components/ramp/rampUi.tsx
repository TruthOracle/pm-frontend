/**
 * Small presentational pieces shared by the ramp screens: a label/value row, a copyable field,
 * the neutral reasons list, the paused banner, and the cancel button with its confirm step.
 * Wording comes from lib/ramp.ts; nothing here decides anything.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { PauseCircle } from "lucide-react";
import { ConfirmDialog, CopyButton } from "@/components/Account/accountUi";
import {
  cancelRampOrder,
  fiatLabel,
  rampErrorMessage,
  rampReasonNeedsVerification,
  rampReasonSentences,
  type RampOrder,
} from "@/lib/ramp";
import { formatMoney } from "@/lib/instruments";
import { WALLET_DISPLAY_NAME } from "@/config";

export const inputCls =
  "mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-primary focus:outline-none";

export function Row({ label, value, children }: { label: string; value?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="flex items-center gap-1 text-right font-medium tabular-nums text-slate-900">
        {value}
        {children}
      </span>
    </div>
  );
}

/** A value the person types elsewhere (ERIP, a bank app): shown in full, selectable, with a copy button. */
export function CopyRow({ label, value, copyValue }: { label: string; value: string; copyValue?: string }) {
  return (
    <Row label={label}>
      <span className="select-all break-all font-mono">{value}</span>
      <CopyButton value={copyValue ?? value} label={`Copy ${label.toLowerCase()}`} />
    </Row>
  );
}

/** Why a direction is closed to this account, one neutral sentence per distinct reason. */
export function ReasonList({ reasons }: { reasons: readonly string[] }) {
  const lines = rampReasonSentences(reasons);
  if (lines.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      {lines.map(({ reason, sentence }) => (
        <li key={reason}>
          {sentence}{" "}
          {rampReasonNeedsVerification(reason) && (
            <Link to="/account#verification" className="font-semibold underline">
              Verify now
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A halt or the static switch: no new orders, but the ones in flight stay visible and cancellable. */
export function PausedBanner() {
  return (
    <div
      role="status"
      className="mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
    >
      <PauseCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
      <span>
        Buying and cashing out are paused right now. Orders already in progress continue, and you can still cancel an
        order that is waiting for you.
      </span>
    </div>
  );
}

function cancelDescription(order: RampOrder): string {
  // A withdrawal signed for it (on another device, or landing late) is a plain withdrawal once the
  // order is cancelled: the backend sends it to the wallet within a minute (review F5).
  if (order.direction === "offramp")
    return `The cash-out of ${formatMoney(order.tokenAmount, order.instrument)} is cancelled and nothing is paid out to your card or bank account. If you already signed its withdrawal, that withdrawal is sent to your ${WALLET_DISPLAY_NAME} wallet as a normal withdrawal instead (see Pending payouts).`;
  return order.method === "erip"
    ? `The order for ${fiatLabel(order.fiatAmount, order.fiatCurrency)} is cancelled. Do not pay it in ERIP afterwards.`
    : `The order for ${fiatLabel(order.fiatAmount, order.fiatCurrency)} is cancelled. If you already paid, the order follows the payment instead.`;
}

/** "Cancel order" with a confirm step; the dialog keeps the error so the person can decide again. */
export function CancelOrderButton({
  order,
  onCancelled,
  className,
  label = "Cancel order",
}: {
  order: RampOrder;
  onCancelled: (order: RampOrder) => void;
  className: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      onCancelled(await cancelRampOrder(order.id));
      setOpen(false);
    } catch (e) {
      setError(rampErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {label}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={order.direction === "offramp" ? "Cancel this cash-out?" : "Cancel this order?"}
        description={cancelDescription(order)}
        confirmLabel="Cancel order"
        destructive
        busy={busy}
        error={error}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
