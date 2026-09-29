/**
 * Small presentational pieces shared by the Account page sections (and the payouts
 * table's confirm step). Kept here rather than in components/ui so the app-wide
 * primitives stay generic; everything in this file knows about accounts.
 */
import { useState, type ReactNode } from "react";
import { Check, Copy, Wallet } from "lucide-react";
import { FaGoogle, FaTelegramPlane } from "react-icons/fa";
import type { IdentityProvider, Money } from "@/auth/types";
import { WALLET_DISPLAY_NAME } from "@/config";
import { fmtCC } from "@/components/market/marketHelpers";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTimeUTC } from "@/lib/time";

export type PillTone = "neutral" | "pending" | "ok" | "warn" | "bad" | "info";

const PILL_CLASSES: Record<PillTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-orange-200 bg-orange-50 text-orange-800",
  bad: "border-red-200 bg-red-50 text-red-700",
  info: "border-sky-200 bg-sky-50 text-sky-800",
};

export function Pill({ tone = "neutral", title, children }: { tone?: PillTone; title?: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PILL_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

export function SectionCard({
  id,
  icon,
  title,
  description,
  action,
  children,
}: {
  id?: string;
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    // scroll-mt keeps the sticky header from covering an anchored section (/account#verification).
    <section id={id} className="scroll-mt-32 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-primary">{icon}</span>
            <h2 className="text-base font-extrabold text-slate-950">{title}</h2>
          </div>
          {description && <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="px-5 py-4 sm:px-6">{children}</div>
    </section>
  );
}

/** Copies `value` and flips to a check mark for a moment so the click is visibly acknowledged. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied (insecure context, permissions); the full value
      // is still selectable in the row, so there is nothing to report.
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * One confirm dialog for every destructive account action. The error sentence stays
 * inside the dialog so the person can read why it failed and decide again, instead of
 * the dialog closing on a toast they may miss.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  busy = false,
  error,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (!busy || next) && onOpenChange(next)}>
      <DialogContent className="rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-slate-950">{title}</DialogTitle>
          <DialogDescription className="text-slate-600">{description}</DialogDescription>
        </DialogHeader>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Keep
          </Button>
          <Button type="button" variant={destructive ? "destructive" : "default"} disabled={busy} onClick={onConfirm}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Money strings carry ten decimals; people read four. This is the one sanctioned
 * `Number()` of a Money value — for DISPLAY only, where a double's 15 significant
 * digits are plenty. Arithmetic on Money stays server-side (§8.4).
 */
export function fmtMoney(m: Money | null | undefined): string {
  if (m == null) return "0";
  const n = Number(m);
  return Number.isFinite(n) ? fmtCC(n) : m;
}

/** `m > 0` without parsing: a Money string is positive iff it has a non-zero digit and no leading minus. */
export function moneyIsPositive(m: Money | null | undefined): boolean {
  if (m == null) return false;
  const trimmed = m.trim();
  return !trimmed.startsWith("-") && /[1-9]/.test(trimmed);
}

/** "Sachin K" → "SK", "alice@example.com" → "A", "@bob_smith" → "BS", "" → "?". */
export function initialsFrom(source: string): string {
  const parts = source.replace(/^@/, "").replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatDateTimeUTC(iso) || iso;
}

export function providerLabel(provider: IdentityProvider): string {
  switch (provider) {
    case "google":
      return "Google";
    case "telegram":
      return "Telegram";
    case "canton_wallet":
      return `${WALLET_DISPLAY_NAME} wallet`;
    default:
      return provider;
  }
}

export function ProviderIcon({ provider, className = "h-4 w-4" }: { provider: IdentityProvider; className?: string }) {
  if (provider === "google") return <FaGoogle className={className} aria-hidden />;
  if (provider === "telegram") return <FaTelegramPlane className={className} aria-hidden />;
  return <Wallet className={className} aria-hidden />;
}

export const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50";
export const secondaryBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50";
export const dangerBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";
export const smallBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50";
