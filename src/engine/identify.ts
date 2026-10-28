import type { AutomationKind } from "../automation.js";
import type { DeviceSignalsPayload } from "../identification/types.js";
import { detectServerClient } from "../server/scoreCore.js";
import type { ServerClientContext, ServerClientResult } from "../server/types.js";
import {
  buildIndexKeys,
  compareDigests,
  digestComponents,
  MIN_COMPARABLE_WEIGHT,
  type ComponentDigests,
} from "./matching.js";
import { MemoryVisitorStore } from "./memoryStore.js";
import { parseDevicePayload } from "./payload.js";
import { sealResult } from "./seal.js";
import {
  checkChallengeSolution,
  checkToken,
  createChallenge,
  signToken,
  type ChallengeFailure,
  type TokenClaims,
  type TokenFailure,
} from "./challenge.js";
import { deriveSecret, randomId } from "./crypto.js";
import { decide, resolvePolicy } from "./decide.js";
import type {
  DeviceIntelligenceOptions,
  EventQuery,
  IdentificationEvent,
  IdentifyInput,
  IdentifyResult,
  ChallengeVerification,
  TokenVerification,
  MatchMethod,
  SmartSignals,
  VelocitySignals,
  VelocityWindow,
  VisitorRecord,
  VisitorStore,
} from "./types.js";

const MINUTE = 60_000;
const WINDOWS: Array<[keyof VelocityWindow, number]> = [
  ["5m", 5 * MINUTE],
  ["1h", 60 * MINUTE],
  ["24h", 24 * 60 * MINUTE],
];
const MAX_INDEX_KEYS = 12;
const MAX_STORAGE_TOKENS = 5;
const MIN_SALT_LENGTH = 32;
const AMBIGUITY_MARGIN = 0.02;
const AUTOMATION_KINDS: readonly AutomationKind[] = [
  "unknown",
  "browser-automation",
  "lightpanda",
  "playwright",
  "patchright",
  "puppeteer",
  "selenium",
  "phantomjs",
  "nightmare",
  "curl",
  "python",
  "go",
  "java",
];

/** Points added to the 0–100 suspect score per triggered signal. */
export const SUSPECT_SCORE_WEIGHTS = {
  bot: 30,
  tampering: 20,
  ipBlocklist: 15,
  distinctLinkedId: 12,
  vpn: 10,
  virtualMachine: 10,
  highActivity: 10,
  countryHopping: 10,
  proxy: 8,
  ipHopping: 8,
  sharedIp: 8,
  incognito: 4,
  privacyBrowser: 2,
} as const;

export interface DeviceIntelligence {
  /**
   * Identifies the device, stores the event and decides allow / challenge /
   * block for `input.action`. Returns a verification token when allowed and
   * a proof-of-work challenge when the visitor must prove work first.
   */
  identify(input: IdentifyInput): Promise<IdentifyResult>;
  /** Verifies a solved challenge (single use) and issues a verification token. */
  verifyChallenge(solution: unknown): Promise<ChallengeVerification>;
  /**
   * Server-side check of the token your form/API receives: signature,
   * expiry, action and single use. The CAPTCHA `siteverify` equivalent.
   */
  verifyToken(token: unknown, options?: { action?: string }): Promise<TokenVerification>;
  getEvent(eventId: string): Promise<IdentificationEvent | undefined>;
  searchEvents(query: EventQuery): Promise<IdentificationEvent[]>;
  getVisitor(visitorId: string): Promise<VisitorRecord | undefined>;
  /** Deletes a visitor and all their events (GDPR erasure). */
  deleteVisitor(visitorId: string): Promise<boolean>;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

interface Match {
  record: VisitorRecord | undefined;
  matchedBy: MatchMethod;
  confidence: number;
}

async function findMatch(
  store: VisitorStore,
  payload: DeviceSignalsPayload,
  digests: ComponentDigests,
  matchThreshold: number,
  tokenThreshold: number,
): Promise<Match> {
  if (payload.storageToken) {
    const record = await store.findVisitorByStorageToken(payload.storageToken);
    if (record) {
      const similarity = compareDigests(record.digests, digests);
      // A copied token alone must not take over an identity: the device has to roughly agree.
      if (similarity.score >= tokenThreshold) {
        return {
          record,
          matchedBy: "storage",
          confidence: similarity.score >= 0.9 ? 0.99 : 0.95,
        };
      }
    }
  }

  const ranked = (await store.findCandidates(buildIndexKeys(digests)))
    .map((record) => ({ record, similarity: compareDigests(record.digests, digests) }))
    .filter(({ similarity }) => similarity.comparableWeight >= MIN_COMPARABLE_WEIGHT)
    .sort((a, b) => b.similarity.score - a.similarity.score);

  const best = ranked[0];
  if (!best || best.similarity.score < matchThreshold) {
    return { record: undefined, matchedBy: "new", confidence: 0.9 };
  }

  // Identical hardware fleets (same laptop model, same image) look alike: say so.
  const runnerUp = ranked[1];
  const ambiguous =
    runnerUp !== undefined &&
    best.similarity.score - runnerUp.similarity.score <= AMBIGUITY_MARGIN;
  const confidence = Math.min(0.98, best.similarity.score) * (ambiguous ? 0.8 : 1);

  return {
    record: best.record,
    matchedBy: "fingerprint",
    confidence: Math.round(confidence * 100) / 100,
  };
}

function countWindows(
  events: Array<{ timestamp: number; value: string | null }>,
  now: number,
  distinct: boolean,
): VelocityWindow {
  const result = {} as VelocityWindow;
  for (const [name, span] of WINDOWS) {
    const inWindow = events.filter((event) => event.timestamp >= now - span);
    result[name] = distinct
      ? new Set(inWindow.map((event) => event.value).filter((value) => value !== null)).size
      : inWindow.length;
  }
  return result;
}

async function computeVelocity(
  store: VisitorStore,
  visitorId: string,
  ip: string | null,
  current: { timestamp: number; country: string | null; linkedId: string | null },
  now: number,
): Promise<VelocitySignals> {
  const since = now - WINDOWS[WINDOWS.length - 1]![1];
  const visitorEvents: Array<{
    timestamp: number;
    ip: string | null;
    country: string | null;
    linkedId: string | null;
  }> = [...(await store.queryEvents({ visitorId, since })), { ...current, ip }];
  const ipEvents: Array<{ timestamp: number; visitorId: string }> =
    ip === null
      ? []
      : [...(await store.queryEvents({ ip, since })), { timestamp: current.timestamp, visitorId }];

  const byVisitor = (pick: (event: (typeof visitorEvents)[number]) => string | null) =>
    visitorEvents.map((event) => ({ timestamp: event.timestamp, value: pick(event) }));

  return {
    events: countWindows(byVisitor(() => null), now, false),
    distinctIp: countWindows(byVisitor((event) => event.ip), now, true),
    distinctCountry: countWindows(byVisitor((event) => event.country), now, true),
    distinctLinkedId: countWindows(byVisitor((event) => event.linkedId), now, true),
    ipDistinctVisitors: countWindows(
      ipEvents.map((event) => ({ timestamp: event.timestamp, value: event.visitorId })),
      now,
      true,
    ),
  };
}

function hasSignal(result: ServerClientResult, id: string): boolean {
  return result.signals.some((signal) => signal.id === id && signal.triggered);
}

function resolveAutomationKind(
  server: ServerClientResult,
  payload: DeviceSignalsPayload,
): AutomationKind {
  if (server.automation.isAutomated) {
    return server.automation.kind;
  }
  return (
    AUTOMATION_KINDS.find((kind) => kind === payload.detection.automationKind) ??
    "unknown"
  );
}

export function computeSuspectScore(signals: Omit<SmartSignals, "suspectScore">): number {
  const w = SUSPECT_SCORE_WEIGHTS;
  const v = signals.velocity;
  const points =
    (signals.bot.result === "bad" ? w.bot : 0) +
    (signals.tampering.detected ? w.tampering : 0) +
    (signals.ipBlocklist ? w.ipBlocklist : 0) +
    (v.distinctLinkedId["24h"] >= 3 ? w.distinctLinkedId : 0) +
    (signals.vpn.detected ? w.vpn : 0) +
    (signals.virtualMachine ? w.virtualMachine : 0) +
    (signals.highActivity ? w.highActivity : 0) +
    (v.distinctCountry["1h"] >= 2 ? w.countryHopping : 0) +
    (signals.proxy ? w.proxy : 0) +
    (v.distinctIp["24h"] > 5 ? w.ipHopping : 0) +
    (v.ipDistinctVisitors["1h"] > 10 ? w.sharedIp : 0) +
    (signals.incognito === true ? w.incognito : 0) +
    (signals.privacyBrowser !== null ? w.privacyBrowser : 0);
  return Math.min(100, points);
}

/** Fills client-reported fields the server can cross-check, unless the caller already set them. */
function mergeRequestContext(
  request: ServerClientContext,
  payload: DeviceSignalsPayload,
): ServerClientContext {
  const { timezone, languages, platform } = payload.components;
  return {
    clientTimezone: timezone ?? undefined,
    clientLanguages: languages ? languages.split(",") : undefined,
    clientLanguage: languages ? languages.split(",")[0] : undefined,
    clientPlatform: platform ?? undefined,
    ...request,
  };
}

/**
 * Self-hosted device intelligence: persistent visitor IDs, Smart Signals,
 * velocity and a suspect score — computed on your server, stored in your
 * database, never sent to a third party.
 */
export function createDeviceIntelligence(
  options: DeviceIntelligenceOptions,
): DeviceIntelligence {
  if (typeof options.salt !== "string" || options.salt.length < MIN_SALT_LENGTH) {
    throw new Error(`bot-signal: salt must be a secret string of at least ${MIN_SALT_LENGTH} characters`);
  }

  const now = options.now ?? Date.now;
  const store = options.store ?? new MemoryVisitorStore({ now });
  const matchThreshold = options.matchThreshold ?? 0.85;
  const tokenThreshold = options.tokenMatchThreshold ?? 0.5;
  const highActivityThreshold = options.highActivityThreshold ?? 200;
  const tokenTtlMs = options.tokenTtlMs ?? 5 * 60_000;
  const challengeTtlMs = options.challengeTtlMs ?? 2 * 60_000;
  const detectServer =
    options.detectServer ??
    ((context: ServerClientContext) => detectServerClient(context, options.serverDetection));
  const secrets = Promise.all([
    deriveSecret(options.salt, "token"),
    deriveSecret(options.salt, "challenge"),
  ]);

  async function issueToken(claims: Omit<TokenClaims, "expiresAt" | "nonce">): Promise<string> {
    const [tokenSecret] = await secrets;
    return signToken(tokenSecret, { ...claims, expiresAt: now() + tokenTtlMs, nonce: randomId(9) });
  }

  async function identify(input: IdentifyInput): Promise<IdentifyResult> {
    const payload = parseDevicePayload(input.payload);
    const timestamp = now();
    const digests = await digestComponents(payload.components, options.salt);
    const match = await findMatch(store, payload, digests, matchThreshold, tokenThreshold);

    const server = await detectServer(mergeRequestContext(input.request, payload));
    const ip = server.context.clientIp ?? null;
    const country = server.context.ipCountry ?? null;
    const linkedId = input.linkedId ?? null;

    const visitorId = match.record?.visitorId ?? randomId(15);
    const storageToken =
      match.matchedBy === "storage" && payload.storageToken
        ? payload.storageToken
        : randomId(24);
    const record: VisitorRecord = {
      visitorId,
      digests,
      indexKeys: unique([...buildIndexKeys(digests), ...(match.record?.indexKeys ?? [])]).slice(0, MAX_INDEX_KEYS),
      storageTokens: unique([storageToken, ...(match.record?.storageTokens ?? [])]).slice(0, MAX_STORAGE_TOKENS),
      firstSeenAt: match.record?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
      visitCount: (match.record?.visitCount ?? 0) + 1,
    };

    const velocity = await computeVelocity(
      store,
      visitorId,
      ip,
      { timestamp, country, linkedId },
      timestamp,
    );

    const isVerifiedCrawler = server.context.crawlerVerificationStatus === "verified";
    const isBad = !server.isLegitClient || payload.detection.suspicionScore >= 0.5;
    const tampering = payload.smartSignals.tampering;
    const vpnMethods = {
      timezoneMismatch: hasSignal(server, "timezone-mismatch"),
      privateRelay: server.context.isIcloudPrivateRelay === true,
      datacenter: server.context.isDatacenterIp === true,
    };
    const partial: Omit<SmartSignals, "suspectScore"> = {
      bot: {
        result: isVerifiedCrawler ? "good" : isBad ? "bad" : "notDetected",
        automationKind: resolveAutomationKind(server, payload),
        serverScore: server.suspicionScore,
        clientScore: payload.detection.suspicionScore,
        signals: [
          ...server.signals.filter((signal) => signal.triggered).map((signal) => signal.id),
          ...payload.detection.signals.map((id) => `client:${id}`),
        ],
      },
      vpn: {
        detected: vpnMethods.timezoneMismatch || vpnMethods.privateRelay || vpnMethods.datacenter,
        methods: vpnMethods,
      },
      proxy: server.context.isDatacenterIp === true || server.context.isAbuseListedIp === true,
      ipBlocklist: server.context.isAbuseListedIp === true,
      incognito: payload.smartSignals.incognito,
      privacyBrowser: payload.smartSignals.privacyBrowser,
      virtualMachine: payload.smartSignals.virtualMachine,
      tampering: { detected: tampering.length > 0, signals: tampering },
      highActivity: velocity.events["24h"] > highActivityThreshold,
      velocity,
      ipInfo: {
        ip,
        country,
        timezone: server.context.ipTimezone ?? null,
        datacenterProvider: server.context.datacenterProvider ?? null,
      },
    };

    const event: IdentificationEvent = {
      eventId: `${timestamp}.${randomId(6)}`,
      visitorId,
      timestamp,
      confidence: match.confidence,
      matchedBy: match.matchedBy,
      isNewVisitor: match.record === undefined,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      visitCount: record.visitCount,
      ip,
      country,
      url: input.url ?? null,
      linkedId,
      tag: input.tag ?? null,
      smartSignals: { ...partial, suspectScore: computeSuspectScore(partial) },
    };

    await store.saveVisitor(record);
    await store.addEvent(event);
    await options.onEvent?.(event);

    const action = input.action ?? "default";
    const verdict = decide(event, resolvePolicy(action, options.policies));
    const [, challengeSecret] = await secrets;

    return {
      event,
      storageToken,
      sealedResult: options.sealKey ? await sealResult(event, options.sealKey) : null,
      action,
      decision: verdict.decision,
      reasons: verdict.reasons,
      token:
        verdict.decision === "allow"
          ? await issueToken({ eventId: event.eventId, visitorId, action, decision: "allow", challengePassed: false })
          : null,
      challenge:
        verdict.decision === "challenge"
          ? await createChallenge(challengeSecret, {
              eventId: event.eventId,
              action,
              difficulty: verdict.difficulty,
              ttlMs: challengeTtlMs,
              now: timestamp,
            })
          : null,
    };
  }

  async function verifyChallenge(solution: unknown): Promise<ChallengeVerification> {
    const [, challengeSecret] = await secrets;
    const checked = await checkChallengeSolution(challengeSecret, solution, now());
    if (!checked.ok) {
      return { valid: false, reason: checked.reason, token: null };
    }
    const { challenge } = checked;
    if (!(await store.consumeOnce(`challenge:${challenge.salt}`, challenge.expiresAt))) {
      return { valid: false, reason: "replayed" satisfies ChallengeFailure, token: null };
    }
    const event = await store.getEvent(challenge.eventId);
    if (!event) {
      return { valid: false, reason: "expired", token: null };
    }
    return {
      valid: true,
      reason: null,
      token: await issueToken({
        eventId: event.eventId,
        visitorId: event.visitorId,
        action: challenge.action,
        decision: "allow",
        challengePassed: true,
      }),
    };
  }

  async function verifyToken(
    token: unknown,
    verifyOptions: { action?: string } = {},
  ): Promise<TokenVerification> {
    const [tokenSecret] = await secrets;
    const checked = await checkToken(tokenSecret, token, verifyOptions.action, now());
    if (!checked.ok) {
      return { valid: false, reason: checked.reason, claims: null, event: null };
    }
    if (!(await store.consumeOnce(`token:${checked.claims.nonce}`, checked.claims.expiresAt))) {
      return { valid: false, reason: "replayed" satisfies TokenFailure, claims: null, event: null };
    }
    return {
      valid: true,
      reason: null,
      claims: checked.claims,
      event: (await store.getEvent(checked.claims.eventId)) ?? null,
    };
  }

  return {
    identify,
    verifyChallenge,
    verifyToken,
    getEvent: (eventId) => store.getEvent(eventId),
    searchEvents: (query) => store.queryEvents(query),
    getVisitor: (visitorId) => store.getVisitor(visitorId),
    deleteVisitor: (visitorId) => store.deleteVisitor(visitorId),
  };
}
