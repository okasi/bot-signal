import { getPropertySafely } from "../checks.js";
import { detectInstantClient } from "../detectInstantClient.js";
import type { ExtendedWindow } from "../types.js";
import { solveChallenge, type ChallengeLike, type SolveOptions } from "./challenge.js";
import { collectDeviceComponents } from "./components.js";
import { collectClientSmartSignals } from "./smartSignals.js";
import type { DeviceSignalsPayload } from "./types.js";

export const STORAGE_TOKEN_KEY = "bot-signal:token";
export const STORAGE_TOKEN_COOKIE = "bsid";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function now(context: ExtendedWindow): number {
  const performance = getPropertySafely(context, "performance") as
    | { now?: () => number }
    | undefined;
  return typeof performance?.now === "function" ? performance.now() : Date.now();
}

/** Reads the server-issued token from localStorage, falling back to the first-party cookie. */
export function readStorageToken(context: ExtendedWindow): string | null {
  try {
    const stored = context.localStorage?.getItem(STORAGE_TOKEN_KEY);
    if (stored && TOKEN_PATTERN.test(stored)) {
      return stored;
    }
  } catch {
    // Storage can throw when blocked by privacy settings; fall through to cookies.
  }

  try {
    const match = context.document.cookie.match(
      new RegExp(`(?:^|;\\s*)${STORAGE_TOKEN_COOKIE}=([^;]+)`),
    );
    const cookie = match?.[1];
    return cookie && TOKEN_PATTERN.test(cookie) ? cookie : null;
  } catch {
    return null;
  }
}

/** Persists a server-issued token in localStorage and a first-party, SameSite=Lax cookie. */
export function writeStorageToken(context: ExtendedWindow, token: string): void {
  if (!TOKEN_PATTERN.test(token)) {
    return;
  }

  try {
    context.localStorage?.setItem(STORAGE_TOKEN_KEY, token);
  } catch {
    // Ignore: the cookie copy below still applies.
  }

  try {
    const secure = context.location?.protocol === "https:" ? "; Secure" : "";
    context.document.cookie = `${STORAGE_TOKEN_COOKIE}=${token}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // Cookies disabled.
  }
}

/**
 * Collects identification components, client Smart Signals and an instant
 * detection summary. Send the result to your server and call
 * `identify()` from `bot-signal/server`; never trust it on its own.
 */
export async function collectDeviceSignals(
  context: ExtendedWindow,
): Promise<DeviceSignalsPayload> {
  const startedAt = now(context);
  const instant = detectInstantClient(context);
  const [components, smartSignals] = await Promise.all([
    collectDeviceComponents(context),
    collectClientSmartSignals(context, instant),
  ]);

  return {
    v: 1,
    components,
    smartSignals,
    detection: {
      suspicionScore: instant.suspicionScore,
      signals: instant.signals
        .filter((signal) => signal.triggered)
        .map((signal) => signal.id),
      automationKind: instant.automation.kind,
    },
    storageToken: readStorageToken(context),
    durationMs: Math.max(0, Math.round(now(context) - startedAt)),
  };
}

export interface IdentifyClientOptions {
  /** Your endpoint that runs the server-side `identify()`, e.g. `/api/identify`. */
  endpoint: string;
  /** Your own user/session/order id to attach to the event. */
  linkedId?: string;
  /** Arbitrary JSON-safe metadata stored with the event. */
  tag?: Record<string, string | number | boolean>;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** What the browser receives. Decisions stay on the server; this is for UX and debugging. */
export interface IdentifyClientResult {
  eventId: string;
  visitorId: string;
  confidence: number;
  /** Encrypted event for forwarding to another backend; `null` unless the server seals results. */
  sealedResult: string | null;
}

/**
 * Collects signals, posts them to your identification endpoint and stores the
 * returned first-party token. Throws if the endpoint fails.
 */
export async function identify(
  context: ExtendedWindow,
  options: IdentifyClientOptions,
): Promise<IdentifyClientResult> {
  const doFetch = options.fetch ?? fetch;
  const payload = await collectDeviceSignals(context);

  const response = await doFetch(options.endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      payload,
      linkedId: options.linkedId,
      tag: options.tag,
      url: context.location?.href,
    }),
  });

  if (!response.ok) {
    throw new Error(`bot-signal identify failed: HTTP ${response.status}`);
  }

  const body = (await response.json()) as IdentifyClientResult & {
    storageToken?: string;
  };
  if (body.storageToken) {
    writeStorageToken(context, body.storageToken);
  }

  return {
    eventId: body.eventId,
    visitorId: body.visitorId,
    confidence: body.confidence,
    sealedResult: body.sealedResult ?? null,
  };
}

export type ProtectDecision = "allow" | "block";

export interface ProtectOptions extends IdentifyClientOptions {
  /** What the visitor is doing: `signup`, `login`, `checkout`, `content`, `api` or your own. */
  action: string;
  /** Proof-of-work tuning. */
  solve?: SolveOptions;
}

export interface ProtectResult {
  /** `allow` when a token was issued (directly or after a challenge), else `block`. */
  decision: ProtectDecision;
  /** Send this with your form/API call and check it server-side with `verifyToken`. */
  token: string | null;
  visitorId: string;
  eventId: string;
  confidence: number;
  /** Whether the visitor had to solve an invisible proof-of-work challenge. */
  challenged: boolean;
  /** Milliseconds spent on the challenge, when one was required. */
  solveMs: number | null;
}

interface EndpointResponse {
  eventId: string;
  visitorId: string;
  confidence: number;
  sealedResult?: string | null;
  storageToken?: string;
  decision?: "allow" | "challenge" | "block";
  token?: string | null;
  challenge?: ChallengeLike | null;
}

async function postJson(
  doFetch: typeof fetch,
  endpoint: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; body: EndpointResponse }> {
  const response = await doFetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = response.ok || response.status === 403
    ? ((await response.json()) as EndpointResponse)
    : ({} as EndpointResponse);
  return { ok: response.ok, status: response.status, body: parsed };
}

/**
 * CAPTCHA replacement in one call: identifies the device, lets the server
 * decide, transparently solves a proof-of-work challenge if asked, and
 * returns a single-use token for your form or API request. No widget, no
 * puzzles. A 403 counts as `block`; throws only on network/server errors.
 */
export async function protect(
  context: ExtendedWindow,
  options: ProtectOptions,
): Promise<ProtectResult> {
  const doFetch = options.fetch ?? fetch;
  const payload = await collectDeviceSignals(context);
  const first = await postJson(doFetch, options.endpoint, {
    payload,
    action: options.action,
    linkedId: options.linkedId,
    tag: options.tag,
    url: context.location?.href,
  });
  // 403 is a block decision (custom endpoints often answer blocked traffic that way), not an outage.
  if (!first.ok && first.status !== 403) {
    throw new Error(`bot-signal protect failed: HTTP ${first.status}`);
  }

  const result = first.body;
  if (result.storageToken) {
    writeStorageToken(context, result.storageToken);
  }
  const base = { visitorId: result.visitorId, eventId: result.eventId, confidence: result.confidence };

  if (result.decision === "challenge" && result.challenge) {
    const solved = await solveChallenge(result.challenge, options.solve);
    const second = await postJson(doFetch, options.endpoint, {
      solution: { challenge: result.challenge, nonce: solved.nonce },
    });
    const token = second.ok ? (second.body.token ?? null) : null;
    return { ...base, decision: token ? "allow" : "block", token, challenged: true, solveMs: solved.durationMs };
  }

  const token = result.decision === "allow" ? (result.token ?? null) : null;
  return { ...base, decision: token ? "allow" : "block", token, challenged: false, solveMs: null };
}
