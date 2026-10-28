import { getPropertySafely } from "../checks.js";
import { detectInstantClient } from "../detectInstantClient.js";
import type { ExtendedWindow } from "../types.js";
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
