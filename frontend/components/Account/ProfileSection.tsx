/**
 * Profile: who the account is. Display name is the only editable field (PATCH /me);
 * the avatar falls back to the first sign-in method's picture, then to initials.
 */
import { useEffect, useState } from "react";
import { useToast } from "@chakra-ui/react";
import { Pencil, UserRound } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import type { MeResponse, User } from "@/auth/types";
import { backendFetch } from "@/lib/backend";
import { kycStatusPill } from "@/lib/kyc";
import { accountErrorMessage } from "@/lib/backendErrors";
import { CopyButton, Pill, SectionCard, fmtDateTime, initialsFrom, primaryBtn, secondaryBtn } from "./accountUi";

export default function ProfileSection({ me }: { me: MeResponse }) {
  const auth = useAuth();
  const toast = useToast();
  const { user } = me;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.displayName ?? "");
  const [saving, setSaving] = useState(false);

  // A refresh() from elsewhere (link flow, KYC) may bring a new name; only mirror it
  // while the field is not being edited so typing is never clobbered.
  useEffect(() => {
    if (!editing) setName(user.displayName ?? "");
  }, [user.displayName, editing]);

  const avatar = user.avatarUrl ?? me.identities.find((i) => i.profile.picture)?.profile.picture ?? null;
  const kyc = kycStatusPill(user.kycStatus);

  const save = async () => {
    // `displayName` is nullable on the wire (API.md → PATCH /me): an emptied field is
    // sent as null to CLEAR the name, never as "" and never omitted (omitting would keep
    // the old value). The read side treats null and "" alike ("Unnamed account").
    const trimmed = name.trim();
    const displayName: string | null = trimmed.length > 0 ? trimmed : null;
    if (displayName === (user.displayName ?? null)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await backendFetch<{ user: User }>("/api/v1/me", { method: "PATCH", body: { displayName } });
      await auth.refresh();
      setEditing(false);
      toast({ title: "Profile updated", status: "success", duration: 3000, isClosable: true });
    } catch (e) {
      toast({
        title: "Could not save",
        description: accountErrorMessage(e),
        status: "error",
        duration: 6000,
        isClosable: true,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard icon={<UserRound className="h-4 w-4" />} title="Profile">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {avatar ? (
          <img src={avatar} alt="" className="h-14 w-14 shrink-0 rounded-full border border-slate-200 object-cover" />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-base font-extrabold text-primary">
            {initialsFrom(user.displayName || user.email || "")}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="Display name"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary"
              />
              <button type="submit" disabled={saving} className={primaryBtn}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setName(user.displayName ?? "");
                }}
                className={secondaryBtn}
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-extrabold text-slate-950">{user.displayName || "Unnamed account"}</span>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                <Pencil className="h-3 w-3" /> Edit
              </button>
              <Pill tone={kyc.tone} title="Identity verification status">
                {kyc.label}
              </Pill>
              {user.status !== "active" && <Pill tone="bad">{user.status}</Pill>}
            </div>
          )}
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs text-slate-500 sm:grid-cols-2">
            {user.email && (
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-semibold text-slate-400">Email</dt>
                <dd className="truncate text-slate-700">{user.email}</dd>
              </div>
            )}
            <div className="flex items-center gap-2">
              <dt className="w-24 shrink-0 font-semibold text-slate-400">Account id</dt>
              <dd className="flex items-center gap-1 font-mono text-slate-700" title={user.id}>
                {user.id.slice(0, 8)}
                <CopyButton value={user.id} label="Copy account id" />
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-semibold text-slate-400">Member since</dt>
              <dd className="text-slate-700">{fmtDateTime(user.createdAt)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-semibold text-slate-400">Last sign-in</dt>
              <dd className="text-slate-700">{fmtDateTime(user.lastLoginAt)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </SectionCard>
  );
}
