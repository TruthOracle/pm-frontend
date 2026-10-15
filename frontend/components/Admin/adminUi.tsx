/** Shared look and plumbing of the operator console cards (CatalogPanel, InstrumentsPanel, TokensPanel, RewardsPanel). */
import { useCallback, useState } from "react";
import { useToast } from "@chakra-ui/react";
import { authErrorMessage } from "@/auth/wallet";

export const field = "input-field";
export const label = "mb-1 block text-xs font-semibold text-slate-600";
export const btn =
  "rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60";
export const btnQuiet =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60";
export const btnDanger =
  "rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60";

export function Card({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-950">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * Runs one operator action with the console's busy state, reload and toasts: `what` names the
 * action (it is the busy key and the failure title), `done` the success toast — a sentence, or a
 * function of the result when the sentence needs it (the command id of a mint). Resolves true on
 * success so a form can clear itself.
 */
export type Run = <T>(what: string, fn: () => Promise<T>, done: string | ((result: T) => string)) => Promise<boolean>;

/**
 * The one `run` every console card uses, so they all report the same way. `reload` runs after a
 * successful action and before the toast; a reload that fails is reported as the action's failure
 * (the action itself did commit — the toast says so).
 */
export function useRun(reload?: () => Promise<void>): { busy: string | null; run: Run } {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback<Run>(
    async (what, fn, done) => {
      setBusy(what);
      try {
        const result = await fn();
        try {
          await reload?.();
        } catch (e) {
          toast({
            title: `${what} succeeded, but the console could not reload`,
            description: authErrorMessage(e),
            status: "warning",
            duration: 8000,
            isClosable: true,
          });
        }
        toast({
          title: typeof done === "function" ? done(result) : done,
          status: "success",
          duration: 5000,
          isClosable: true,
        });
        return true;
      } catch (e) {
        toast({ title: `${what} failed`, description: authErrorMessage(e), status: "error", duration: 8000, isClosable: true });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [reload, toast],
  );
  return { busy, run };
}

/** `abcdef…1234` for a party id or contract id in a table cell; the full value goes in `title`. */
export function truncateId(s: string, head = 10, tail = 6): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
