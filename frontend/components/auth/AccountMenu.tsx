/**
 * Header control for a signed-in person: avatar + name, a menu with the Account page
 * and Sign out. Sign out is a <button>, never an <a> — App.tsx intercepts anchor clicks
 * for its route-transition prefetch and would treat it as navigation.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "@chakra-ui/react";
import { ChevronDown, LogOut, ShieldCheck, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/auth/AuthContext";
import type { MeResponse, User } from "@/auth/types";
import { shortPartyId } from "@/lib/party";
import { initialsFrom } from "@/components/Account/accountUi";

/** Best available label: profile name → provider username → email → party → "Account". */
function displayNameFor(user: User | null, me: MeResponse | null): string {
  if (user?.displayName) return user.displayName;
  const identity = me?.identities.find((i) => i.status === "active" && (i.profile.name || i.profile.username));
  if (identity?.profile.name) return identity.profile.name;
  if (identity?.profile.username) return `@${identity.profile.username}`;
  if (user?.email) return user.email;
  if (user?.partyId) return shortPartyId(user.partyId);
  return "Account";
}

function Avatar({ name, url, className }: { name: string; url: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      <img
        src={url}
        alt=""
        // Google avatar URLs 403 when the referrer is a third-party origin.
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={`rounded-full object-cover ${className ?? "h-7 w-7"}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary ${className ?? "h-7 w-7"}`}
    >
      {initialsFrom(name)}
    </span>
  );
}

export function AccountMenu() {
  const { user, me, sessionKind, signOut } = useAuth();
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const name = displayNameFor(user, me);
  const isAdmin = sessionKind === "admin";

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      // signOut() rethrows only when the logout request itself failed (the header has
      // already been refreshed to whatever state is actually left).
      await signOut();
    } catch (err) {
      toast({
        title: "Sign out failed",
        description: err instanceof Error ? err.message : String(err),
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 max-w-[12rem] items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2.5 text-xs font-semibold text-slate-700 transition-colors hover:border-primary/30 hover:text-primary"
          aria-label={`Account menu for ${name}`}
        >
          <Avatar name={name} url={user?.avatarUrl ?? null} />
          <span className="hidden truncate sm:inline">{name}</span>
          {isAdmin ? (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
              Admin
            </span>
          ) : null}
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      {/* The site header sits at z-1001; the menu must clear it like WalletSelector's does. */}
      <DropdownMenuContent align="end" className="w-64 rounded-xl border-slate-200" style={{ zIndex: 1101 }}>
        <div className="flex items-center gap-3 px-3 py-2.5">
          <Avatar name={name} url={user?.avatarUrl ?? null} className="h-9 w-9" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
            {user?.email ? <p className="truncate text-xs text-slate-500">{user.email}</p> : null}
            {isAdmin ? (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                <ShieldCheck className="h-3 w-3" /> Admin session
              </span>
            ) : null}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account" className="flex cursor-pointer items-center gap-2 text-slate-700">
            <UserRound className="h-4 w-4" /> Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild disabled={signingOut}>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex w-full cursor-pointer items-center gap-2 text-slate-700"
          >
            <LogOut className="h-4 w-4" /> {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
