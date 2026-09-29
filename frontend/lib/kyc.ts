/**
 * Identity-verification client (ARCHITECTURE.md §9, API.md → KYC).
 *
 * The backend owns the state machine; this module only reads it, opens a provider
 * session, and — for Sumsub — loads the WebSDK on demand. Nothing about the person
 * (names, documents) is kept here beyond the lifetime of one mock-form submit, and
 * nothing is logged: the fingerprints that enforce one-person-one-account are
 * computed server-side from data the browser never sees again.
 */

import { backendFetch } from "@/lib/backend";
import { backendErrorMessage, KYC_DUPLICATE_SENTENCE, type ErrorSentences } from "@/lib/backendErrors";
import type { KycStatus, KycSummary, KycVerification } from "@/auth/types";

export type { KycStatus } from "@/auth/types";
export { KYC_DUPLICATE_SENTENCE };

/** `GET /api/v1/kyc` */
export type KycReport = KycSummary & { history: KycVerification[] };

/** `POST /api/v1/kyc/sessions` */
export type KycSessionResponse =
  | { provider: "sumsub"; accessToken: string; expiresAt: string; levelName: string; verificationId: string }
  | { provider: "mock"; verificationId: string; levelName: string };

export type MockOutcome = "approved" | "rejected_retry" | "rejected_final";
export type MockDocType = "PASSPORT" | "ID_CARD" | "DRIVERS" | "RESIDENCE_PERMIT";

/** `POST /api/v1/kyc/mock/submit` — test provider only; the route is absent otherwise. */
export interface MockKycSubmission {
  verificationId: string;
  outcome: MockOutcome;
  person: { firstName: string; lastName: string; dob: string; country: string };
  documents: { docType: MockDocType; country: string; number: string }[];
}

export interface MockKycResult {
  verification: KycVerification;
  userKycStatus: KycStatus;
}

export function fetchKyc(): Promise<KycReport> {
  return backendFetch<KycReport>("/api/v1/kyc");
}

export function createKycSession(): Promise<KycSessionResponse> {
  return backendFetch<KycSessionResponse>("/api/v1/kyc/sessions", { method: "POST" });
}

export function submitMockKyc(body: MockKycSubmission): Promise<MockKycResult> {
  return backendFetch<MockKycResult>("/api/v1/kyc/mock/submit", { method: "POST", body });
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const KYC_UNAVAILABLE_SENTENCE = "Verification is not available yet.";

/** Verification-flow flavour of the shared sentence table (lib/backendErrors.ts). */
const KYC_SENTENCES: ErrorSentences = {
  kyc_provider_unavailable: KYC_UNAVAILABLE_SENTENCE,
  backend_unconfigured: KYC_UNAVAILABLE_SENTENCE,
};

export function kycErrorMessage(e: unknown): string {
  return backendErrorMessage(e, KYC_SENTENCES);
}

export type KycTone = "neutral" | "pending" | "ok" | "warn" | "bad";

export interface KycStatusView {
  /** Short pill text. */
  label: string;
  tone: KycTone;
  /** One or two plain sentences for the panel body. */
  sentence: string;
  /** Whether "Start verification" (or "Try again" / "Continue") makes sense now. */
  canStart: boolean;
  startLabel: string;
}

/** Pill-only view of the summary status (used by the profile header and the wallet card). */
export function kycStatusPill(status: KycStatus): { label: string; tone: KycTone } {
  switch (status) {
    case "approved":
      return { label: "Verified", tone: "ok" };
    case "pending":
      return { label: "Under review", tone: "pending" };
    case "rejected":
      return { label: "Not verified", tone: "warn" };
    case "blocked_duplicate":
      return { label: "Blocked", tone: "bad" };
    default:
      return { label: "Not verified", tone: "neutral" };
  }
}

/**
 * Plain-language reading of `KycSummary`. The account-level `status` is the truth
 * (it already applies the precedence rules in §9.2); the latest verification only
 * refines the wording — retry vs final rejection, manual review, an abandoned start.
 */
export function describeKyc(summary: KycSummary): KycStatusView {
  const v = summary.verification;
  const configured = summary.provider !== null;
  const requirement = summary.requiredForWithdrawal
    ? "Identity verification is required before you can withdraw."
    : "Verification is optional right now; deposits and trading work without it.";

  if (summary.status === "blocked_duplicate") {
    return { label: "Blocked", tone: "bad", sentence: KYC_DUPLICATE_SENTENCE, canStart: false, startLabel: "" };
  }
  if (summary.status === "approved") {
    return {
      label: "Verified",
      tone: "ok",
      sentence: "Your identity is verified. Withdrawals are enabled for this account.",
      canStart: false,
      startLabel: "",
    };
  }
  if (summary.status === "pending") {
    if (v?.status === "initiated") {
      return {
        label: "Started",
        tone: "pending",
        sentence: `You started verification but did not finish it. ${requirement}`,
        canStart: configured,
        startLabel: "Continue verification",
      };
    }
    if (v?.status === "needs_review") {
      return {
        label: "Manual review",
        tone: "pending",
        sentence: "Your documents were received and are being reviewed by an operator. There is nothing more to do right now.",
        canStart: false,
        startLabel: "",
      };
    }
    return {
      label: "Under review",
      tone: "pending",
      sentence: "Your documents are being reviewed. This usually takes a few minutes; the status updates here automatically.",
      canStart: false,
      startLabel: "",
    };
  }
  if (summary.status === "rejected") {
    if (v?.status === "rejected_final") {
      return {
        label: "Rejected",
        tone: "bad",
        sentence: "Verification was rejected and cannot be retried online. Contact support.",
        canStart: false,
        startLabel: "",
      };
    }
    const labels = v?.rejectLabels?.length ? ` (${v.rejectLabels.join(", ").toLowerCase()})` : "";
    return {
      label: "Try again",
      tone: "warn",
      sentence: `Verification was not successful${labels}. You can try again with clearer documents.`,
      canStart: configured,
      startLabel: "Try again",
    };
  }
  // "none" (and anything the types do not name yet)
  return {
    label: "Not verified",
    tone: "neutral",
    sentence: configured ? requirement : `${KYC_UNAVAILABLE_SENTENCE} ${requirement}`,
    canStart: configured,
    startLabel: "Start verification",
  };
}

// ---------------------------------------------------------------------------
// Sumsub WebSDK — loaded on demand, never on pages that don't verify
// ---------------------------------------------------------------------------

export const SUMSUB_SDK_URL = "https://static.sumsub.com/idensic/static/sns-websdk-builder.js";
export const SUMSUB_CONTAINER_ID = "sumsub-websdk-container";

/**
 * Payload of `idCheck.onApplicantStatusChanged` — only the fields the panel reads.
 * Known values: reviewStatus init | pending | prechecked | queued | completed | onHold;
 * reviewAnswer GREEN | RED; reviewRejectType RETRY | FINAL. Typed as plain strings
 * because the SDK adds values without notice and a union with `string` in it collapses
 * to `string` anyway.
 */
export interface SumsubStatusPayload {
  reviewStatus?: string;
  reviewResult?: { reviewAnswer?: string; reviewRejectType?: string };
  levelName?: string;
}

/** Minimal surface of the builder returned by `snsWebSdk.init(...)`. */
export interface SnsWebSdkBuilder {
  withConf(conf: { lang?: string; email?: string; phone?: string; theme?: string }): SnsWebSdkBuilder;
  withOptions(options: { addViewportTag?: boolean; adaptIframeHeight?: boolean }): SnsWebSdkBuilder;
  on(event: string, handler: (payload: unknown) => void): SnsWebSdkBuilder;
  build(): SnsWebSdkInstance;
}

export interface SnsWebSdkInstance {
  launch(selector: string): void;
  destroy?(): void;
}

export interface SnsWebSdk {
  /** `refresh` is the token-expiration handler: it must resolve to a fresh access token. */
  init(accessToken: string, refresh: () => Promise<string>): SnsWebSdkBuilder;
}

declare global {
  interface Window {
    snsWebSdk?: SnsWebSdk;
  }
}

let sdkPromise: Promise<SnsWebSdk> | null = null;

/**
 * Promise-cached script loader. StrictMode mounts the panel twice; both mounts share
 * one promise (and therefore one `<script>`). A failed load removes that element and
 * resets the cache so the next click appends a fresh script — re-attaching listeners
 * to an already-errored element (whose load/error events have fired) would wait
 * forever, which is exactly what the old "reuse the existing tag" branch did.
 */
export function loadSumsubSdk(): Promise<SnsWebSdk> {
  if (typeof window === "undefined") return Promise.reject(new Error("Sumsub WebSDK needs a browser."));
  if (window.snsWebSdk) return Promise.resolve(window.snsWebSdk);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<SnsWebSdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.addEventListener(
      "load",
      () => {
        if (window.snsWebSdk) {
          resolve(window.snsWebSdk);
          return;
        }
        script.remove();
        reject(new Error("The verification widget loaded but did not initialise."));
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        script.remove();
        reject(new Error("The verification widget could not be loaded. Check your connection and try again."));
      },
      { once: true },
    );
    script.src = SUMSUB_SDK_URL;
    script.async = true;
    document.head.appendChild(script);
  }).catch((e) => {
    sdkPromise = null;
    throw e;
  });
  return sdkPromise;
}

export interface LaunchSumsubArgs {
  accessToken: string;
  /** Called by the SDK when the token expires; POSTs `/kyc/sessions` again. */
  refreshToken: () => Promise<string>;
  /** The account's email, prefilled in the widget (Sumsub also keeps it on the applicant). */
  email?: string | null;
  onStatusChanged?: (payload: SumsubStatusPayload) => void;
  /** Documents submitted or resubmitted: the review starts server-side. */
  onSubmitted?: () => void;
  onError?: (payload: unknown) => void;
  containerId?: string;
}

/**
 * Build and launch the widget into `#<containerId>` — synchronous, so a caller that
 * awaited `loadSumsubSdk()` can check its own cancellation flag between the load and
 * the launch (StrictMode: mount₁ awaits the SDK, cleanup₁, mount₂ awaits the same
 * promise; without that check launch₁ would still mount an iframe and then destroy
 * it under launch₂). Returns the instance so the caller can destroy it.
 */
export function launchSumsub(sdk: SnsWebSdk, args: LaunchSumsubArgs): SnsWebSdkInstance {
  const email = (args.email ?? "").trim();
  const instance = sdk
    .init(args.accessToken, args.refreshToken)
    .withConf({ lang: "en", ...(email ? { email } : {}) })
    .withOptions({ addViewportTag: false, adaptIframeHeight: true })
    .on("idCheck.onApplicantStatusChanged", (payload) => {
      args.onStatusChanged?.((payload ?? {}) as SumsubStatusPayload);
    })
    .on("idCheck.onApplicantSubmitted", () => {
      args.onSubmitted?.();
    })
    .on("idCheck.onApplicantResubmitted", () => {
      args.onSubmitted?.();
    })
    .on("idCheck.onError", (payload) => {
      args.onError?.(payload);
    })
    .build();
  instance.launch(`#${args.containerId ?? SUMSUB_CONTAINER_ID}`);
  return instance;
}

/** Load + launch in one step; `isCancelled` is consulted after the load and before the launch. */
export async function launchSumsubVerification(
  args: LaunchSumsubArgs & { isCancelled?: () => boolean },
): Promise<SnsWebSdkInstance | null> {
  const sdk = await loadSumsubSdk();
  if (args.isCancelled?.()) return null;
  return launchSumsub(sdk, args);
}
