/**
 * Sessions: where this account is signed in (GET /me/sessions). Revoking is immediate
 * on the server (per-user index, §6.6); the current session is marked and never gets
 * a revoke button — "Sign out" in the header is the way to end it.
 */
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@chakra-ui/react";
import { LogOut, Monitor, RefreshCw, Smartphone } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import type { Session } from "@/auth/types";
import { backendFetch } from "@/lib/backend";
import { accountErrorMessage } from "@/lib/backendErrors";
import { Pill, ProviderIcon, SectionCard, fmtDateTime, providerLabel, smallBtn } from "./accountUi";

/** "Chrome on macOS" is all anyone needs; the raw UA string goes in the tooltip. */
function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

export default function SessionsSection() {
  const auth = useAuth();
  const toast = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await backendFetch<{ sessions: Session[] }>("/api/v1/me/sessions");
      setSessions([...res.sessions].sort((a, b) => Number(b.current) - Number(a.current)));
      setError(null);
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    setBusy(id);
    try {
      await backendFetch<{ ok: true }>(`/api/v1/me/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast({ title: "Session signed out", status: "success", duration: 3000, isClosable: true });
      await load();
    } catch (e) {
      toast({ title: "Could not sign out that session", description: accountErrorMessage(e), status: "error", duration: 6000, isClosable: true });
    } finally {
      setBusy(null);
    }
  };

  const revokeOthers = async () => {
    setBusy("others");
    try {
      const res = await backendFetch<{ revoked: number }>("/api/v1/me/sessions/revoke-others", { method: "POST" });
      toast({
        title: res.revoked === 1 ? "1 other session signed out" : `${res.revoked} other sessions signed out`,
        status: "success",
        duration: 4000,
        isClosable: true,
      });
      await load();
    } catch (e) {
      toast({ title: "Could not sign out other sessions", description: accountErrorMessage(e), status: "error", duration: 6000, isClosable: true });
    } finally {
      setBusy(null);
    }
  };

  const others = sessions.filter((s) => !s.current);

  return (
    <SectionCard
      icon={<Monitor className="h-4 w-4" />}
      title="Sessions"
      description="Devices and browsers currently signed in to this account."
      action={
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} disabled={loading} className={smallBtn} title="Refresh" aria-label="Refresh sessions">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => void revokeOthers()}
            disabled={busy !== null || others.length === 0}
            className={smallBtn}
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out other sessions
          </button>
        </div>
      }
    >
      {error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : loading && sessions.length === 0 ? (
        <p className="text-sm text-slate-500">Loading sessions…</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-slate-500">No active sessions.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                {/iPhone|iPad|Android/.test(s.userAgent ?? "") ? <Smartphone className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900" title={s.userAgent ?? undefined}>
                    {describeUserAgent(s.userAgent)}
                  </span>
                  {s.current && <Pill tone="ok">This device</Pill>}
                  {s.kind === "admin" && <Pill tone="info">Admin</Pill>}
                </div>
                <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <ProviderIcon provider={s.authMethod} className="h-3 w-3" /> {providerLabel(s.authMethod)}
                  </span>
                  {s.ip && <span>{s.ip}</span>}
                  <span>Signed in {fmtDateTime(s.createdAt)}</span>
                  {s.lastSeenAt && <span>Last seen {fmtDateTime(s.lastSeenAt)}</span>}
                  <span>Expires {fmtDateTime(s.expiresAt)}</span>
                </div>
              </div>
              {!s.current && (
                <button type="button" onClick={() => void revoke(s.id)} disabled={busy !== null} className={smallBtn}>
                  <LogOut className="h-3.5 w-3.5" /> {busy === s.id ? "Signing out…" : "Sign out"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {auth.expiresAt && (
        <p className="mt-3 text-[11px] text-slate-400">Your current session expires {fmtDateTime(auth.expiresAt)}.</p>
      )}
    </SectionCard>
  );
}
