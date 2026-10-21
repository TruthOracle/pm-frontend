/**
 * Access policy for the credential-injecting ledger relay (api/proxy/ledger.mjs).
 *
 * The relay attaches a server-minted token that carries real authority — a ledger client holding
 * ParticipantAdmin and act-as on the treasury (truthoracle-contracts scripts/grant-rights.ts).
 * Whoever can reach it wields that authority, so the policy here is deny-by-default: a request is
 * forwarded only if it matches an explicit public allowlist (its body checked where the body
 * decides whose authority it uses), or the caller presents a valid admin session AND the request
 * is on the admin allow-list below. There is no wallet relay any more (review F0): market
 * resolution is the accounts backend's approval-backed route, and nothing in the browser signs as
 * the treasury.
 *
 * The allowlists below are derived from what the browser actually calls (see
 * frontend/lib/cantonParticipant.ts; the full inventory is pinned by test/relay-policy.test.mjs).
 * Adding a path here grants it to the entire internet (public lists) or to every operator alone
 * (admin lists) — check that the upstream endpoint is safe in those hands first.
 */

import { currentOperator, isConfigured } from "./adminSession.mjs";
import { adminPartyId } from "./upstream.mjs";

/**
 * Ledger endpoints safe to expose unauthenticated.
 *
 * The market reads are public data — this is a public prediction market, and the same
 * contracts are visible to any observer party; the active-contracts body is checked so the
 * treasury's private contracts are not (PUBLIC_TREASURY_TEMPLATES). `interactive-submission/*`
 * serves the participant-API wallet (VITE_USE_PARTICIPANT_API), which submits as the user's own
 * party; its body is checked too, because this relay's token may act as the treasury and the
 * participant executes a participant-hosted party's transaction with no external signature: a
 * prepare or execute acting or reading as the treasury, or naming whose ledger rights to use
 * (`userId`), is refused (inspectSubmission). Notably
 * ABSENT: /v2/users/* (which would let anyone grant themselves rights on the participant) and
 * /v2/parties.
 */
const LEDGER_ACS_PATH = "v2/state/active-contracts";
const LEDGER_PREPARE_PATH = "v2/interactive-submission/prepare";
const LEDGER_EXECUTE_PATH = "v2/interactive-submission/execute";
const LEDGER_PUBLIC_PATHS = new Set([
  LEDGER_ACS_PATH,
  "v2/state/ledger-end",
  "v2/state/connected-synchronizers",
  LEDGER_PREPARE_PATH,
  LEDGER_EXECUTE_PATH,
]);

/**
 * The treasury's contracts an anonymous caller may read (review F1). A query keyed by the treasury
 * returns everything the treasury sees — every customer's UserWallet balance and PendingPayout (each
 * cash-out) — so on the public branch the treasury is named only with TemplateFilters of public
 * market data (`<module>:<entity>`), and any other party only with TemplateFilters of the market's
 * own module (what the browser reads: lib/cantonParticipant.ts). Any other read as the treasury (the
 * payout queue's PendingPayouts), a wildcard or interface filter, another module's templates, or a
 * filter for any party needs an admin session.
 */
const PUBLIC_TREASURY_TEMPLATES = new Set([
  "Truthoracle:PredictionMarket",
  "Truthoracle:MarketCounter",
  "Truthoracle:OutcomeAttestation",
]);
const MARKET_MODULE = "Truthoracle";

/**
 * The admin branch (X1). One operator session used to open every upstream path: a `/v2/users`
 * rights grant, a command submitted for anyone — no second person involved. Now a session opens
 * only the entries below; everything else answers 403 `relay_write_disabled` whatever the
 * session. Treasury money moves and market resolution go through the accounts backend's
 * approval-backed routes (four-eyes, truthoracle-backend docs/RAMP.md §6.5).
 *
 * Ledger: GET-only diagnostics. Nothing in the console needs more — every ledger read it
 * makes is on the public list — and the ParticipantAdmin token must never allocate a
 * party, grant a right, upload a package or submit a command for anyone.
 */
const LEDGER_ADMIN_READS = new Set(["v2/version", "v2/packages", "v2/parties/participant-id"]);

export const RELAY_WRITE_DISABLED = "relay_write_disabled";

function normalise(path) {
  return String(path || "").split("?")[0].replace(/^\/+|\/+$/g, "");
}

/**
 * CSRF fence for the session-authorised branch. The cookie is already SameSite=Strict,
 * so a compliant browser never attaches it cross-site; this rejects the request even
 * if it somehow arrives with one (an old browser, a future cookie-attribute slip).
 * A missing Origin header passes — browsers always send it on cross-site fetches, and
 * non-browser clients don't hold the HttpOnly cookie to begin with.
 */
function crossOrigin(req) {
  const origin = req.headers?.origin;
  if (typeof origin !== "string" || !origin || origin === "null") {
    return origin === "null";
  }
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  const ownHost = String(req.headers?.["x-forwarded-host"] ?? req.headers?.host ?? "")
    .split(",")[0]
    .trim();
  return !ownHost || originHost !== ownHost;
}

function disabled(message) {
  return { allow: false, status: 403, error: RELAY_WRITE_DISABLED, message };
}

/**
 * The admin-branch rule for (kind, method, path): `{}` = forward as is, `null` = never. Exact
 * matches only, so a dot segment or a suffix (`v2/version/../users`) never borrows an entry. The
 * ledger is the only relay; any other kind (the deleted wallet relay's) has no rule at all.
 */
export function adminRule(kind, method, path) {
  const m = String(method || "GET").toUpperCase();
  const p = normalise(path);
  if (kind === "ledger") return m === "GET" && LEDGER_ADMIN_READS.has(p) ? {} : null;
  return null;
}

/**
 * @returns {{allow: true, operator: object|null, inspect?: Function}
 *         | {allow: false, status: number, error: string, message?: string}}
 */
export function authorise({ req, path, kind, method }) {
  const cleaned = normalise(path);

  // Read-only allowlist entries are GET-or-POST because the JSON Ledger API models
  // queries as POST bodies; the path itself is what constrains the capability — except the
  // active-contracts query and the interactive submission, whose bodies say whose authority
  // they use (inspected once read).
  if (kind === "ledger" && LEDGER_PUBLIC_PATHS.has(cleaned)) {
    if (cleaned === LEDGER_ACS_PATH) return { allow: true, operator: null, inspect: (raw) => inspectLedgerRead(raw, req) };
    if (cleaned === LEDGER_PREPARE_PATH || cleaned === LEDGER_EXECUTE_PATH)
      return { allow: true, operator: null, inspect: (raw) => inspectSubmission(cleaned, raw) };
    return { allow: true, operator: null };
  }

  // Before the session: a money path is refused the same way for everyone, so the
  // answer says nothing about whether the caller's session is valid.
  const rule = adminRule(kind, method ?? req.method, cleaned);
  if (!rule) {
    return disabled(
      `${String(method ?? req.method ?? "GET").toUpperCase()} ${cleaned || "/"} is not forwarded by the ${kind} relay. ` +
        "Treasury money moves go through the accounts backend's approval-backed admin routes.",
    );
  }

  const session = sessionGate(req);
  if (!session.allow) return session;
  return { allow: true, operator: session.operator };
}

/** The admin session: configured, same-origin, and a live operator. */
function sessionGate(req) {
  if (!isConfigured()) {
    // Fail CLOSED. An unconfigured deployment previously meant "wide open", which is
    // exactly the state this module exists to prevent.
    return {
      allow: false,
      status: 503,
      error:
        "This endpoint requires an admin session, but ADMIN_SESSION_SECRET is not set " +
        "on this deployment. See ADMIN_AUTH.md.",
    };
  }

  if (crossOrigin(req)) {
    return { allow: false, status: 403, error: "cross-origin request rejected" };
  }

  const operator = currentOperator(req);
  if (!operator) {
    return { allow: false, status: 401, error: "admin session required" };
  }
  return { allow: true, operator };
}

/**
 * The public active-contracts query (F1): forwarded as the JSON that was checked; a read beyond
 * the treasury's market data needs the admin session (the payout queue reads PendingPayouts so).
 *
 * @returns {{allow: true, body: string, operator: object|null} | {allow: false, status: number, error: string, message?: string}}
 */
export function inspectLedgerRead(raw, req) {
  let body;
  try {
    body = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? ""));
  } catch {
    return disabled("The ledger relay forwards only a JSON active-contracts query.");
  }
  if (!isPlainObject(body)) return disabled("The ledger relay forwards only a JSON object query.");
  const beyond = treasuryReadBeyondPublic(body);
  if (beyond === null) return { allow: true, body: JSON.stringify(body), operator: null };
  const session = sessionGate(req);
  if (!session.allow) {
    return { ...session, message: `Reading ${beyond} needs an admin session; the public relay serves only the treasury's market data.` };
  }
  return { allow: true, body: JSON.stringify(body), operator: session.operator };
}

/** What `body` reads beyond public market data as the treasury (or for any party), or null. */
function treasuryReadBeyondPublic(body) {
  const treasury = adminPartyId();
  for (const format of [body.eventFormat, body.filter]) {
    if (format === undefined) continue;
    if (!isPlainObject(format)) return "an unreadable filter";
    if (format.filtersForAnyParty !== undefined) return "every party's contracts";
    if (format.filtersByParty === undefined) continue;
    if (!isPlainObject(format.filtersByParty)) return "an unreadable filter";
    for (const [party, filter] of Object.entries(format.filtersByParty)) {
      // Fail closed: without the treasury's id no query can be told apart from one keyed by it.
      if (!treasury) return "contracts while VITE_ENTERPRISE_WALLET_PARTY_ID is not set";
      if (party === treasury) {
        if (!templatesOnly(filter, (template) => PUBLIC_TREASURY_TEMPLATES.has(template))) return "the treasury's private contracts";
      } else if (!templatesOnly(filter, (template) => template.startsWith(`${MARKET_MODULE}:`))) {
        return "contracts other than the market's own templates";
      }
    }
  }
  return null;
}

/** `{cumulative: [{identifierFilter: {TemplateFilter: {value: {templateId}}}}, …]}`, every `<module>:<entity>` allowed. */
function templatesOnly(filter, allowed) {
  if (!isPlainObject(filter) || !Array.isArray(filter.cumulative) || filter.cumulative.length === 0) return false;
  if (Object.keys(filter).some((key) => key !== "cumulative")) return false;
  return filter.cumulative.every((entry) => {
    if (!isPlainObject(entry) || Object.keys(entry).length !== 1 || !isPlainObject(entry.identifierFilter)) return false;
    const kinds = Object.keys(entry.identifierFilter);
    const value = entry.identifierFilter.TemplateFilter?.value;
    if (kinds.length !== 1 || kinds[0] !== "TemplateFilter" || !isPlainObject(value)) return false;
    const parts = typeof value.templateId === "string" ? value.templateId.split(":") : [];
    return parts.length >= 3 && allowed(parts.slice(-2).join(":"));
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}


/**
 * Top-level fields of a prepare or execute that choose whose ledger rights the participant checks:
 * the ledger user (`userId`, `applicationId` before Canton 3.3), in any spelling. Without one the
 * participant uses the relay token's own user; a body naming another user could borrow that user's
 * act-as rights for a party other than the treasury. The browser never sends one.
 */
const RIGHTS_FIELDS = new Map([
  ["userid", "userId"],
  ["applicationid", "applicationId"],
]);

/** The canonical name of the first top-level field of `body` that names whose ledger rights to use, or undefined (never the caller's spelling, which is not echoed). */
function rightsField(body) {
  for (const key of Object.keys(body)) {
    const field = RIGHTS_FIELDS.get(key.replace(/[_-]/g, "").toLowerCase());
    if (field) return field;
  }
  return undefined;
}

/**
 * The public interactive submission: a prepare or execute that acts or reads as the treasury, or
 * names whose ledger rights to use (RIGHTS_FIELDS), is refused, and every one while the treasury's
 * id is unset (fail closed). This relay's ledger token holds act-as on the treasury, and the
 * participant executes a participant-hosted party's transaction with no external signature, so an
 * anonymous prepare + execute could otherwise sign as the treasury. The browser submits only as
 * the user's own party (CantonWalletContext with VITE_USE_PARTICIPANT_API: trades, withdrawals,
 * payout cancels). Forwarded as the JSON checked.
 *
 * @returns {{allow: true, body: string, operator: null} | {allow: false, status: number, error: string, message: string}}
 */
export function inspectSubmission(path, raw) {
  const step = normalise(path) === LEDGER_EXECUTE_PATH ? "execute" : "prepare";
  const treasury = adminPartyId();
  if (!treasury) {
    return disabled(
      `VITE_ENTERPRISE_WALLET_PARTY_ID is not set on this deployment, so the relay cannot tell a ${step} acting as the treasury ` +
        "from any other and forwards none.",
    );
  }
  let body;
  try {
    body = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? ""));
  } catch {
    return disabled(`The ledger relay forwards only a JSON ${step} request.`);
  }
  if (!isPlainObject(body)) return disabled(`The ledger relay forwards only a JSON object ${step} request.`);
  const rights = rightsField(body);
  if (rights !== undefined) {
    return disabled(
      `The public ledger relay does not ${step} a request that names whose ledger rights to use (${rights}): the relay's own ` +
        "token decides that, and the browser never sends one.",
    );
  }
  const parties = step === "prepare" ? preparedParties(body) : executedParties(body);
  if (typeof parties === "string") return disabled(parties);
  if (parties.includes(treasury)) {
    return disabled(
      `The public ledger relay does not ${step} a transaction that acts or reads as the treasury. Treasury commands are the ` +
        "accounts backend's (approval-backed); the browser submits only as the user's own party.",
    );
  }
  return { allow: true, body: JSON.stringify(body), operator: null };
}

/** The parties a prepare acts and reads as (`actAs`, `readAs`, and their snake_case spellings), or why they cannot be read. */
function preparedParties(body) {
  const parties = [];
  for (const key of ["actAs", "readAs", "act_as", "read_as"]) {
    const value = body[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || !value.every((p) => typeof p === "string")) return `prepare ${key} must be a list of party ids.`;
    parties.push(...value.map((p) => p.trim()));
  }
  return parties;
}

/** The parties an execute signs for (`partySignatures`) and submits as (the prepared transaction's act_as), or why they cannot be read. */
function executedParties(body) {
  if (body.prepared_transaction !== undefined || body.party_signatures !== undefined) {
    return "execute takes preparedTransaction and partySignatures, not their snake_case spellings.";
  }
  const parties = [];
  const signed = body.partySignatures;
  if (signed !== undefined) {
    const list = isPlainObject(signed) ? (signed.signatures ?? []) : null;
    if (!Array.isArray(list) || !list.every((s) => isPlainObject(s) && typeof s.party === "string")) return "execute partySignatures is unreadable.";
    parties.push(...list.map((s) => s.party.trim()));
  }
  let actAs;
  try {
    actAs = preparedActAs(body.preparedTransaction);
  } catch (e) {
    return `The prepared transaction cannot be read, so whom it acts as is unknown (${e instanceof Error ? e.message : "unreadable"}).`;
  }
  if (actAs.length === 0) return "The prepared transaction names no submitting party.";
  return [...parties, ...actAs.map((p) => p.trim())];
}

/**
 * The submitting parties of an interactive-submission `preparedTransaction` (base64 protobuf
 * `PreparedTransaction`): metadata (field 2) → submitter_info (field 2) → act_as (field 1, repeated
 * string), every occurrence merged as protobuf merges them. Strict on purpose — standard base64,
 * tags and lengths of at most 5 bytes, no groups, nothing past the end: whatever this reader cannot
 * follow is refused, so it never sees fewer parties than the participant's parser would.
 */
export function preparedActAs(text) {
  if (typeof text !== "string" || !text || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    throw new Error("not standard base64");
  }
  const bytes = Buffer.from(text, "base64");
  const parties = [];
  for (const metadata of lengthDelimited(bytes, 2)) {
    for (const submitter of lengthDelimited(metadata, 2)) {
      for (const party of lengthDelimited(submitter, 1)) parties.push(party.toString("utf8"));
    }
  }
  return parties;
}

/** Every length-delimited occurrence of field `number` in one message, after walking all of it. */
function lengthDelimited(bytes, number) {
  const out = [];
  let at = 0;
  while (at < bytes.length) {
    const [tag, next] = varint(bytes, at, 5);
    at = next;
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 0 || tag > 0xffffffff) throw new Error("invalid protobuf tag");
    if (wire === 0) at = varint(bytes, at, 10)[1];
    else if (wire === 1) at += 8;
    else if (wire === 5) at += 4;
    else if (wire === 2) {
      const [length, start] = varint(bytes, at, 5);
      at = start + length;
      if (at <= bytes.length && field === number) out.push(bytes.subarray(start, at));
    } else throw new Error(`protobuf wire type ${wire}`);
    if (at > bytes.length) throw new Error("truncated protobuf field");
  }
  return out;
}

function varint(bytes, at, maxBytes) {
  let value = 0;
  for (let i = 0; i < maxBytes; i += 1) {
    if (at + i >= bytes.length) throw new Error("truncated protobuf varint");
    const b = bytes[at + i];
    value += (b & 0x7f) * 2 ** (7 * i);
    if (b < 0x80) return [value, at + i + 1];
  }
  throw new Error("protobuf varint too long");
}
