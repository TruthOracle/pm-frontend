/**
 * Party-id formatting shared by every component that names a Canton party — the
 * header menu, the link prompt, the wallet card, the account page and the payouts
 * table all render the same party the same way.
 */

/**
 * "alice::1220abcd…ef12" — enough of the hint and fingerprint to tell two of the
 * user's wallets apart, short enough to sit inside a button label.
 */
export function shortPartyId(party: string): string {
  const sep = party.indexOf("::");
  if (sep < 0) return party.length > 18 ? `${party.slice(0, 10)}…${party.slice(-6)}` : party;
  const hint = party.slice(0, sep);
  const fingerprint = party.slice(sep + 2);
  const shortHint = hint.length > 12 ? `${hint.slice(0, 12)}…` : hint;
  return `${shortHint}::${fingerprint.slice(0, 8)}…${fingerprint.slice(-4)}`;
}
