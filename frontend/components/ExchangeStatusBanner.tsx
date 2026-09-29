/**
 * Kalshi's `exchange_active` / `trading_active` for this platform (truthoracle-backend
 * docs/MARKETS.md §8). The backend polls its own index; the banner shows only when something
 * is off — an operator trading halt, or an index that stopped moving — and every trade CTA
 * reads `useExchangeStatus().tradingActive` before letting a click open the wallet.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, PauseCircle } from "lucide-react";
import { probeBackend } from "@/lib/backend";
import { fetchExchangeStatus } from "@/lib/marketsApi";
import type { ApiExchangeStatus } from "@/lib/marketsTypes";
import { formatDateTimeUTC } from "@/lib/time";

const REFRESH_MS = 30_000;

interface ExchangeStatusValue {
  status: ApiExchangeStatus | null;
  /** True unless the operator halted trading (unknown status = trading allowed, the ledger decides). */
  tradingActive: boolean;
  refresh: () => Promise<void>;
}

const ExchangeStatusContext = createContext<ExchangeStatusValue>({ status: null, tradingActive: true, refresh: async () => {} });

export function ExchangeStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ApiExchangeStatus | null>(null);

  const refresh = async () => {
    if ((await probeBackend()) !== "ok") return;
    try {
      setStatus(await fetchExchangeStatus());
    } catch {
      // keep the last known status; the next tick retries
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <ExchangeStatusContext.Provider value={{ status, tradingActive: status ? status.tradingActive : true, refresh }}>
      {children}
    </ExchangeStatusContext.Provider>
  );
}

export function useExchangeStatus(): ExchangeStatusValue {
  return useContext(ExchangeStatusContext);
}

export function ExchangeStatusBanner() {
  const { status } = useExchangeStatus();
  if (!status) return null;
  if (!status.tradingActive) {
    const resume = status.halt.estimatedResumeAt ? new Date(status.halt.estimatedResumeAt) : null;
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900" role="status">
        <PauseCircle className="mr-1.5 inline h-4 w-4" />
        <strong>Trading is paused.</strong> {status.halt.reason ?? "The operator halted trading."}
        {resume && !Number.isNaN(resume.getTime()) && <> Expected to resume {formatDateTimeUTC(resume)}.</>} Redemptions still work.
      </div>
    );
  }
  if (status.ledger.indexEnabled && (status.ledger.stale || status.ledger.lastError)) {
    return (
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-center text-xs text-slate-600" role="status">
        <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
        Market data may be behind the ledger: the index {status.ledger.lastError ? "reported an error" : "has not moved for a while"}. Trades still settle on-ledger.
      </div>
    );
  }
  return null;
}
