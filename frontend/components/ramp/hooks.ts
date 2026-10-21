/**
 * React glue for the ramp screens. The decisions live in lib/rampLogic.ts (tested); these hooks
 * only hold state and timers: the retry key of one order attempt, the stale-safe quote, the
 * order page's polling loop, and a ticking clock for countdowns.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isBackendError } from "@/lib/backend";
import {
  fetchRampOrder,
  quoteRamp,
  rampErrorMessage,
  type RampDestinationInput,
  type RampDirection,
  type RampMethod,
  type RampOrder,
  type RampQuote,
} from "@/lib/ramp";
import {
  isCurrentQuote,
  isFinalStatus,
  isStaleReply,
  newIdempotencyKey,
  pollDelayMs,
  pollFailureVerdict,
  quoteInputsKey,
} from "@/lib/rampLogic";

/**
 * One retry token per attempt, made on first use (never during render: `crypto.randomUUID`
 * throws on insecure origins) and replaced when `attempt` — what is being asked for — changes.
 */
export function useAttemptKey(attempt: string): () => string {
  const ref = useRef<{ attempt: string; key: string } | null>(null);
  return useCallback(() => {
    if (!ref.current || ref.current.attempt !== attempt) ref.current = { attempt, key: newIdempotencyKey() };
    return ref.current.key;
  }, [attempt]);
}

export function destinationKey(d: RampDestinationInput | null): string {
  if (!d) return "";
  return d.kind === "card" ? `card:${d.paymentMethodId}` : `bank:${d.bankAccountId}`;
}

function destinationFromKey(key: string): RampDestinationInput | undefined {
  const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "card" && id) return { kind: "card", paymentMethodId: id };
  if (kind === "bank" && id) return { kind: "bank", bankAccountId: id };
  return undefined;
}

export interface QuoteState {
  quote: RampQuote | null;
  error: string | null;
  loading: boolean;
}

export interface QuoteHandle extends QuoteState {
  /** Ask again for the same inputs (after `409 ramp_quote_changed` the figures on screen are stale). */
  requote: () => void;
}

/**
 * The backend's quote for what the form shows, debounced. A reply counts only when it is the
 * latest request and was asked for the inputs on screen now (lib/rampLogic isCurrentQuote);
 * older requests are aborted.
 */
export function useRampQuote(
  direction: RampDirection,
  amount: string | null,
  method: RampMethod | null,
  destKey: string,
): QuoteHandle {
  const key = amount ? quoteInputsKey({ direction, amount, method, destination: destKey }) : "";
  const [nonce, setNonce] = useState(0);
  const requote = useCallback(() => setNonce((n) => n + 1), []);
  const [state, setState] = useState<QuoteState & { key: string }>({
    key: "",
    quote: null,
    error: null,
    loading: false,
  });
  const seq = useRef(0);
  const current = useRef(key);
  current.current = key;

  useEffect(() => {
    const mySeq = ++seq.current;
    if (!amount) return;
    setState({ key, quote: null, error: null, loading: true });
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      const destination = direction === "offramp" ? destinationFromKey(destKey) : undefined;
      quoteRamp(
        { direction, amount, ...(method ? { method } : {}), ...(destination ? { destination } : {}) },
        ctrl.signal,
      )
        .then((quote) => {
          if (isCurrentQuote(mySeq, seq.current, key, current.current))
            setState({ key, quote, error: null, loading: false });
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          if (isCurrentQuote(mySeq, seq.current, key, current.current))
            setState({ key, quote: null, error: rampErrorMessage(e), loading: false });
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [key, direction, amount, method, destKey, nonce]);

  return state.key === key && key ? { ...state, requote } : { quote: null, error: null, loading: false, requote };
}

/** `Date.now()`, re-rendered every `ms` while mounted (countdowns). */
export function useNow(ms = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export type OrderPollState = "loading" | "live" | "retrying" | "stopped" | "done";

/**
 * Follow one order: poll `GET /ramp/orders/:id` with backoff (2.5 s doubling to 30 s while nothing
 * changes), pause while the tab is hidden, stop at a final status or on a definitive 4xx, and never
 * let a reply older than the order on screen overwrite it (a poll racing a Cancel). `accept` lets
 * an action's own answer (cancel, attach) in through the same staleness gate; `refresh` polls now.
 */
export function useRampOrder(orderId: string, enabled: boolean) {
  const [order, setOrder] = useState<RampOrder | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [state, setState] = useState<OrderPollState>("loading");
  const shown = useRef<RampOrder | null>(null);
  const kick = useRef<() => void>(() => undefined);

  const accept = useCallback((next: RampOrder) => {
    // Timestamps are compared within one order only; another id replaces what is shown.
    if (shown.current?.id === next.id && isStaleReply(next, shown.current)) return;
    shown.current = next;
    setOrder(next);
  }, []);

  useEffect(() => {
    // The router keeps this page mounted when only :orderId changes: never show the last order.
    shown.current = null;
    setOrder(null);
    setError(null);
    setState("loading");
    if (!enabled || !orderId) return;
    let disposed = false;
    let done = false;
    let busy = false;
    let idle = 0;
    let timer: number | undefined;
    const schedule = (ms: number) => {
      if (!disposed && !done) timer = window.setTimeout(() => void tick(), ms);
    };
    const tick = async () => {
      timer = undefined;
      if (disposed || done || busy) return;
      if (typeof document !== "undefined" && document.hidden) return; // resumed by visibilitychange
      busy = true;
      try {
        const next = await fetchRampOrder(orderId);
        if (disposed) return;
        const before = shown.current;
        accept(next);
        const now = shown.current ?? next;
        idle = before && before.updatedAt === now.updatedAt && before.status === now.status ? idle + 1 : 0;
        setError(null);
        if (isFinalStatus(now.status)) {
          done = true;
          setState("done");
        } else {
          setState("live");
          schedule(pollDelayMs(idle, now.status, now.method));
        }
      } catch (e) {
        if (disposed) return;
        setError(e);
        const status = isBackendError(e) ? e.status : 0;
        if (pollFailureVerdict(status) === "stop") {
          done = true;
          setState("stopped");
        } else {
          idle += 1;
          setState("retrying");
          schedule(pollDelayMs(idle, shown.current?.status ?? "created"));
        }
      } finally {
        busy = false;
      }
    };
    const onVisibility = () => {
      if (!document.hidden && timer === undefined && !busy) {
        idle = 0;
        void tick();
      }
    };
    kick.current = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      done = false;
      idle = 0;
      void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      kick.current = () => undefined;
    };
  }, [orderId, enabled, accept]);

  const refresh = useCallback(() => kick.current(), []);
  return { order, error, state, accept, refresh };
}
