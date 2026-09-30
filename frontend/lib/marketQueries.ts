/**
 * react-query hooks over lib/marketsApi.ts for the pages that render live market data. One
 * place for the cache keys and the polling policy: fresh for 10 s, refetched every 15 s while
 * the tab is visible (react-query pauses interval refetches in a background tab), never on
 * window focus alone (the interval already covers it).
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchCandlesticks,
  fetchEvent,
  fetchEventCandlesticks,
  fetchEventTrades,
  fetchEvents,
  fetchMarketTrades,
  fetchMarketsPage,
  type EventListQuery,
  type MarketListQuery,
} from "@/lib/marketsApi";
import type { ApiCandlesticks, ApiEvent, ApiEventCandlesticks, ApiMarket, ApiPage, ApiTradeList } from "@/lib/marketsTypes";
import { timeframeWindow, type CandleWindow, type Timeframe } from "@/lib/chartData";

export const LIVE_STALE_MS = 10_000;
export const LIVE_REFETCH_MS = 15_000;

const live = { staleTime: LIVE_STALE_MS, refetchInterval: LIVE_REFETCH_MS, refetchOnWindowFocus: false } as const;

/**
 * Candle windows are anchored on a minute boundary so consecutive polls share a cache key (and
 * the backend's own cache) instead of asking for a window that moved by a few seconds.
 */
export function anchoredWindow(tf: Timeframe, createdAtSec?: number | null, nowMs = Date.now()): CandleWindow {
  const nowSec = Math.floor(nowMs / 1000);
  const anchored = Math.ceil(nowSec / 60) * 60;
  return timeframeWindow(tf, anchored, createdAtSec);
}

export function useMarketCandles(ref: string | number | null, tf: Timeframe, createdAtSec?: number | null, enabled = true): UseQueryResult<ApiCandlesticks> {
  const win = anchoredWindow(tf, createdAtSec);
  return useQuery({
    // Keyed by the window, not the preset: a young market's ranges resolve to one window and share one fetch.
    queryKey: ["market-candles", String(ref), win.periodInterval, win.startTs, win.endTs],
    queryFn: () => fetchCandlesticks(ref as string | number, win),
    enabled: enabled && ref !== null && ref !== "",
    ...live,
    placeholderData: (prev) => prev,
  });
}

export function useEventCandles(ticker: string | null, tf: Timeframe, createdAtSec?: number | null, enabled = true): UseQueryResult<ApiEventCandlesticks> {
  const win = anchoredWindow(tf, createdAtSec);
  return useQuery({
    queryKey: ["event-candles", ticker, win.periodInterval, win.startTs, win.endTs],
    queryFn: () => fetchEventCandlesticks(ticker as string, win),
    enabled: enabled && !!ticker,
    ...live,
    placeholderData: (prev) => prev,
  });
}

export function useMarketTrades(ref: string | number | null, limit = 30, enabled = true): UseQueryResult<ApiTradeList> {
  return useQuery({
    queryKey: ["market-trades", String(ref), limit],
    queryFn: () => fetchMarketTrades(ref as string | number, { limit }),
    enabled: enabled && ref !== null && ref !== "",
    ...live,
  });
}

export function useEventTrades(ticker: string | null, limit = 40, enabled = true): UseQueryResult<ApiTradeList> {
  return useQuery({
    queryKey: ["event-trades", ticker, limit],
    queryFn: () => fetchEventTrades(ticker as string, { limit }),
    enabled: enabled && !!ticker,
    ...live,
  });
}

export function useEvent(ticker: string | null, enabled = true): UseQueryResult<ApiEvent> {
  return useQuery({
    queryKey: ["event", ticker],
    queryFn: () => fetchEvent(ticker as string),
    enabled: enabled && !!ticker,
    ...live,
    retry: (count, e) => (e as { status?: number }).status !== 404 && count < 2,
  });
}

export function useEventsList(query: EventListQuery, enabled = true): UseQueryResult<ApiPage<ApiEvent>> {
  return useQuery({
    queryKey: ["events", query],
    queryFn: () => fetchEvents(query),
    enabled,
    ...live,
    placeholderData: (prev) => prev,
  });
}

export function useMarketsList(query: MarketListQuery, enabled = true): UseQueryResult<ApiPage<ApiMarket>> {
  return useQuery({
    queryKey: ["markets", query],
    queryFn: () => fetchMarketsPage(query),
    enabled,
    ...live,
    placeholderData: (prev) => prev,
  });
}
