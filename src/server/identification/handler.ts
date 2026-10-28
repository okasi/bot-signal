import type { ServerClientContext } from "../types.js";
import type { DeviceIntelligence } from "./identify.js";
import { InvalidPayloadError } from "./payload.js";
import type { IdentificationEvent } from "./types.js";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_LINKED_ID_LENGTH = 256;
const MAX_TAG_ENTRIES = 20;

export interface IdentifyHandlerOptions {
  /**
   * Returns the client IP. Required unless `trustProxyHeader` is set,
   * because a standard `Request` has no socket address.
   */
  getClientIp?: (request: Request) => string | undefined;
  /**
   * Header your own proxy/CDN sets with the client IP, e.g. `x-forwarded-for`
   * or `cf-connecting-ip`. Only use a header your edge overwrites; otherwise
   * clients can spoof it. The first comma-separated entry is used.
   */
  trustProxyHeader?: string;
  /** Header your TLS terminator sets with the JA3/JA4 fingerprint (never a client value). */
  tlsFingerprintHeader?: string;
  /** Header your edge sets with a crawler verification verdict (`verified`/`spoofed`/`unverified`). */
  crawlerVerificationHeader?: string;
  /** Extra response fields for the browser. By default only ids and confidence are returned. */
  exposeToClient?: (event: IdentificationEvent) => Record<string, unknown>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function header(request: Request, name: string | undefined): string | undefined {
  return name ? (request.headers.get(name) ?? undefined) : undefined;
}

function parseTag(value: unknown): Record<string, string | number | boolean> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value)
    .filter(([, item]) => ["string", "number", "boolean"].includes(typeof item))
    .slice(0, MAX_TAG_ENTRIES)
    .map(([key, item]) => [key.slice(0, 64), typeof item === "string" ? item.slice(0, 256) : item]);
  return Object.fromEntries(entries) as Record<string, string | number | boolean>;
}

/** Collects trusted request metadata from headers your infrastructure controls. */
export function buildRequestContext(
  request: Request,
  options: IdentifyHandlerOptions,
): ServerClientContext {
  const forwarded = header(request, options.trustProxyHeader)?.split(",")[0]?.trim();
  const crawler = header(request, options.crawlerVerificationHeader);
  return {
    clientIp: options.getClientIp?.(request) ?? (forwarded || undefined),
    userAgent: header(request, "user-agent"),
    acceptLanguage: header(request, "accept-language"),
    secChUa: header(request, "sec-ch-ua"),
    secChUaPlatform: header(request, "sec-ch-ua-platform"),
    secChUaMobile: header(request, "sec-ch-ua-mobile"),
    secFetchSite: header(request, "sec-fetch-site"),
    secFetchMode: header(request, "sec-fetch-mode"),
    secFetchDest: header(request, "sec-fetch-dest"),
    tlsFingerprint: header(request, options.tlsFingerprintHeader),
    crawlerVerificationStatus:
      crawler === "verified" || crawler === "spoofed" || crawler === "unverified"
        ? crawler
        : undefined,
  };
}

/**
 * Framework-agnostic `POST` handler (`Request` → `Response`) for Next.js
 * route handlers, Hono, Bun, Deno, Remix and anything else built on Fetch.
 * Pair it with `identify()` from `bot-signal/browser`.
 */
export function createIdentifyHandler(
  intelligence: DeviceIntelligence,
  options: IdentifyHandlerOptions = {},
): (request: Request) => Promise<Response> {
  if (!options.getClientIp && !options.trustProxyHeader) {
    throw new Error("bot-signal: createIdentifyHandler needs getClientIp or trustProxyHeader");
  }

  return async (request) => {
    if (request.method !== "POST") {
      return json(405, { error: "method_not_allowed" });
    }

    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      return json(413, { error: "payload_too_large" });
    }

    let body: { payload?: unknown; linkedId?: unknown; tag?: unknown; url?: unknown };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      return json(400, { error: "invalid_json" });
    }
    if (typeof body !== "object" || body === null) {
      return json(400, { error: "invalid_json" });
    }

    try {
      const result = await intelligence.identify({
        payload: body.payload,
        request: buildRequestContext(request, options),
        linkedId:
          typeof body.linkedId === "string" ? body.linkedId.slice(0, MAX_LINKED_ID_LENGTH) : undefined,
        tag: parseTag(body.tag),
        url: typeof body.url === "string" ? body.url.slice(0, 2048) : undefined,
      });

      return json(200, {
        eventId: result.event.eventId,
        visitorId: result.event.visitorId,
        confidence: result.event.confidence,
        sealedResult: result.sealedResult,
        storageToken: result.storageToken,
        ...options.exposeToClient?.(result.event),
      });
    } catch (error) {
      if (error instanceof InvalidPayloadError) {
        return json(400, { error: "invalid_payload", message: error.message });
      }
      throw error;
    }
  };
}
