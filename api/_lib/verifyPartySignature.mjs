/**
 * Verify an Ed25519 signature produced by the Cantor8 wallet popup's `signMessage`.
 *
 * Canton external-party keys are Ed25519, so the maths is fixed. What is NOT fixed is
 * the wire encoding: `@cantor8/wallet-connect-sdk` is a pure postMessage transport for
 * this method —
 *
 *     signMessage(e, t) { return this.transport.request("signMessage", { message: e, partyId: t }, !0) }
 *
 * — so it returns the popup's string verbatim and the SDK's own types say only
 * `Promise<string>`. Neither the encoding (hex / base64 / base64url) nor the exact
 * preimage (raw UTF-8 bytes vs. a hash of them) is discoverable from the package.
 *
 * Rather than guess one and ship a verifier that silently rejects every real login, we
 * try the small closed set of plausible combinations and report which one matched.
 * `describeAttempt` renders the diagnostic that pins the format down from a single
 * real signature — see ADMIN_AUTH.md.
 */

import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const PUBLIC_KEY_BYTES = 32;
const SIGNATURE_BYTES = 64;

/**
 * Decode a key/signature that may arrive hex, base64, or base64url encoded.
 * Length is the discriminator: a 32-byte value is 64 hex chars but ~44 base64 chars,
 * so an exact-length match after decoding identifies the encoding unambiguously.
 */
function decodeFixedWidth(value, expectedBytes) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const candidates = [];
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === expectedBytes * 2) {
    candidates.push(Buffer.from(raw, "hex"));
  }
  if (/^[A-Za-z0-9+/=]+$/.test(raw)) candidates.push(Buffer.from(raw, "base64"));
  if (/^[A-Za-z0-9_-]+$/.test(raw)) candidates.push(Buffer.from(raw, "base64url"));

  for (const buf of candidates) if (buf.length === expectedBytes) return buf;

  // Some Canton tooling prefixes the raw key with a scheme/format byte. Accept a
  // longer decode only when trimming a short prefix lands exactly on the key size.
  for (const buf of candidates) {
    if (buf.length > expectedBytes && buf.length <= expectedBytes + 8) {
      return buf.subarray(buf.length - expectedBytes);
    }
  }
  return null;
}

function publicKeyFrom(raw) {
  const keyBytes = decodeFixedWidth(raw, PUBLIC_KEY_BYTES);
  if (!keyBytes) return null;
  try {
    return createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, keyBytes]),
      format: "der",
      type: "spki",
    });
  } catch {
    return null;
  }
}

/**
 * Candidate preimages, in the order a wallet is most likely to have signed them.
 * Ed25519 hashes internally, so signing the raw message is the norm; the sha256
 * variant covers wallets that pre-hash before handing bytes to the signer.
 */
function preimages(message) {
  const utf8 = Buffer.from(message, "utf8");
  return [
    { form: "utf8", bytes: utf8 },
    { form: "sha256(utf8)", bytes: createHash("sha256").update(utf8).digest() },
  ];
}

/**
 * @returns {{ok: true, form: string} | {ok: false, reason: string}}
 */
export function verifyPartySignature({ message, signature, publicKey }) {
  if (!message) return { ok: false, reason: "missing message" };

  const key = publicKeyFrom(publicKey);
  if (!key) return { ok: false, reason: "public key is not a 32-byte Ed25519 key" };

  const sigBytes = decodeFixedWidth(signature, SIGNATURE_BYTES);
  if (!sigBytes) return { ok: false, reason: "signature is not a 64-byte Ed25519 signature" };

  for (const { form, bytes } of preimages(message)) {
    // Ed25519 takes a null algorithm — the scheme fixes its own hash.
    if (cryptoVerify(null, bytes, key, sigBytes)) return { ok: true, form };
  }
  return { ok: false, reason: "signature did not verify against the account public key" };
}

/**
 * Shape-only description of a failed attempt, safe to log: lengths and character
 * classes, never the signature bytes or anything that would help forge one.
 */
export function describeAttempt({ signature, publicKey }) {
  const shape = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "empty";
    const charset = /^[0-9a-fA-F]+$/.test(raw)
      ? "hex"
      : /^[A-Za-z0-9_-]+$/.test(raw)
        ? "base64url"
        : /^[A-Za-z0-9+/=]+$/.test(raw)
          ? "base64"
          : "other";
    const decoded = ["hex", "base64", "base64url"]
      .map((enc) => {
        try {
          return `${enc}=${Buffer.from(raw, enc).length}B`;
        } catch {
          return `${enc}=?`;
        }
      })
      .join(" ");
    return `${raw.length} chars, charset=${charset}, decodes ${decoded}`;
  };
  return `signature: ${shape(signature)}; publicKey: ${shape(publicKey)}`;
}
