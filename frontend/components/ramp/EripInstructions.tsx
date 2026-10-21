/**
 * How to pay an ERIP order: the service code, the account number (the order's payment
 * reference) and the exact amount, each copyable; the provider's own steps verbatim (plain text,
 * never links); the deadline in UTC with a countdown; the provider's QR image when it is a real
 * PNG (lib/rampLogic safePngDataUrl); and its bank-app links when each passes safeDeeplinkUrl.
 * The backend validated all of it before storing it; this view checks again before rendering
 * (docs/RAMP.md §9.2). `mockHref` (dev deployments on the mock acquirer) opens its test payment.
 */
import { Link } from "react-router-dom";
import { formatDateTimeUTC } from "@/lib/time";
import type { RampOrder, RampPaymentNext } from "@/lib/ramp";
import { formatCountdown, formatFixed, safeDeeplinkUrl, safePngDataUrl } from "@/lib/rampLogic";
import { useNow } from "./hooks";
import { CopyRow } from "./rampUi";

const MAX_LINES = 10;
const MAX_LINE = 512;
const MAX_LINKS = 20;
const MAX_LINK_NAME = 64;

export function EripInstructions({
  order,
  next,
  mockHref,
}: {
  order: Pick<RampOrder, "expiresAt" | "fiatCurrency">;
  next: Extract<RampPaymentNext, { kind: "erip" }>;
  mockHref?: string | null;
}) {
  const now = useNow(1_000);
  const qr = safePngDataUrl(next.qrPng);
  const deadline = order.expiresAt;
  const left = deadline ? Date.parse(deadline) - now : NaN;
  const amount = formatFixed(next.amount, 2, false);
  const lines = (Array.isArray(next.instructions) ? next.instructions : [])
    .filter((l): l is string => typeof l === "string")
    .slice(0, MAX_LINES)
    .map((l) => l.slice(0, MAX_LINE));
  const links = (Array.isArray(next.deeplinks) ? next.deeplinks : [])
    .slice(0, MAX_LINKS)
    .map((l) => ({
      name: typeof l?.name === "string" ? l.name.trim().slice(0, MAX_LINK_NAME) : "",
      href: safeDeeplinkUrl(l?.url),
    }))
    .filter((l): l is { name: string; href: string } => l.name !== "" && l.href !== null);

  return (
    <section aria-labelledby="erip-title" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
      <h2 id="erip-title" className="text-sm font-bold text-slate-900">
        Pay in ERIP
      </h2>
      {deadline && (
        <p className="mt-1 text-xs text-slate-600">
          Pay before <b>{formatDateTimeUTC(deadline)}</b>{" "}
          {Number.isFinite(left) && (left > 0 ? `(${formatCountdown(left)} left)` : "(the deadline has passed)")}
        </p>
      )}
      <div className="mt-3 divide-y divide-emerald-100">
        <CopyRow label="Service code" value={next.serviceCode} />
        <CopyRow label="Account number" value={next.accountNumber} />
        <CopyRow label="Amount" value={`${amount} ${order.fiatCurrency}`} copyValue={amount} />
      </div>
      {lines.length > 0 && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-slate-700">
          {lines.map((line, i) => (
            <li key={i} className="whitespace-pre-wrap break-words">
              {line}
            </li>
          ))}
        </ol>
      )}
      {qr && (
        <figure className="mt-3 flex flex-col items-center gap-1">
          <img src={qr} alt="ERIP payment QR code" className="h-40 w-40 rounded bg-white p-2" />
          <figcaption className="text-[11px] text-slate-500">Scan it in your bank app.</figcaption>
        </figure>
      )}
      {links.length > 0 && (
        <div className="mt-3 text-xs text-slate-700">
          <p className="font-semibold">Open in your bank app</p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {links.map((l) => (
              <li key={`${l.name}|${l.href}`}>
                <a href={l.href} rel="noopener noreferrer" className="font-semibold text-primary underline">
                  {l.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mockHref && (
        <p className="mt-3 rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Test deployment: no real ERIP here.{" "}
          <Link to={mockHref} className="font-semibold underline">
            Simulate this payment
          </Link>
        </p>
      )}
      <p className="mt-3 text-[11px] leading-5 text-slate-600">
        Pay exactly {amount} {order.fiatCurrency} from a bank account or card in your own name, before the deadline. A
        different amount, or a payment after the deadline, is refunded instead of credited.
      </p>
    </section>
  );
}

export default EripInstructions;
