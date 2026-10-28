import { describe, expect, it, vi } from "vitest";
import {
  buildIndexKeys,
  buildRequestContext,
  compareDigests,
  computeSuspectScore,
  createDeviceIntelligence,
  createIdentifyHandler,
  digestComponents,
  InvalidPayloadError,
  MemoryVisitorStore,
  parseDevicePayload,
  sealResult,
  unsealResult,
  type IdentificationEvent,
  type SmartSignals,
} from "../src/server.js";
import { DEVICE_COMPONENT_NAMES, type DeviceComponents, type DeviceSignalsPayload } from "../src/identification/types.js";

const SALT = "test-salt-test-salt-test-salt-test-salt";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
const serverDetection = { lookupGeo: false, checkIpLists: false };

function components(overrides: Partial<DeviceComponents> = {}): DeviceComponents {
  const base = Object.fromEntries(DEVICE_COMPONENT_NAMES.map((name) => [name, `${name}-A`])) as DeviceComponents;
  return { ...base, ...overrides };
}

function payload(overrides: Partial<DeviceSignalsPayload> = {}): DeviceSignalsPayload {
  return {
    v: 1,
    components: components(),
    smartSignals: { incognito: false, privacyBrowser: null, virtualMachine: false, virtualMachineEvidence: null, tampering: [] },
    detection: { suspicionScore: 0, signals: [], automationKind: "unknown" },
    storageToken: null,
    durationMs: 10,
    ...overrides,
  };
}

const browserRequest = { userAgent: CHROME_UA, acceptLanguage: "en-US", clientIp: "84.212.7.19" };

function clock(start = 1_000_000_000_000) {
  let current = start;
  return { now: () => current, advance: (ms: number) => (current += ms) };
}

describe("parseDevicePayload", () => {
  it("accepts a valid payload and normalises missing components to null", () => {
    const input = payload();
    delete (input.components as Partial<DeviceComponents>).audio;
    const parsed = parseDevicePayload({ ...input, storageToken: "a".repeat(32) });
    expect(parsed.components.audio).toBeNull();
    expect(parsed.storageToken).toBe("a".repeat(32));
  });

  it.each([
    ["non-object", null],
    ["version", { ...payload(), v: 2 }],
    ["detection", { ...payload(), detection: [] }],
    ["score range", { ...payload(), detection: { suspicionScore: 2, signals: [], automationKind: "x" } }],
    ["score type", { ...payload(), detection: { suspicionScore: "0", signals: [], automationKind: "x" } }],
    ["NaN score", { ...payload(), detection: { suspicionScore: Number.NaN, signals: [], automationKind: "x" } }],
    ["negative score", { ...payload(), detection: { suspicionScore: -1, signals: [], automationKind: "x" } }],
    ["kind", { ...payload(), detection: { suspicionScore: 0, signals: [], automationKind: "bad kind!" } }],
    ["kind type", { ...payload(), detection: { suspicionScore: 0, signals: [], automationKind: 1 } }],
    ["signals list", { ...payload(), detection: { suspicionScore: 0, signals: "x", automationKind: "x" } }],
    ["too many signals", { ...payload(), detection: { suspicionScore: 0, signals: Array(101).fill("a"), automationKind: "x" } }],
    ["signal id", { ...payload(), detection: { suspicionScore: 0, signals: ["<script>"], automationKind: "x" } }],
    ["signal type", { ...payload(), detection: { suspicionScore: 0, signals: [1], automationKind: "x" } }],
    ["token", { ...payload(), storageToken: "short" }],
    ["token type", { ...payload(), storageToken: 5 }],
    ["duration", { ...payload(), durationMs: -1 }],
    ["duration type", { ...payload(), durationMs: "1" }],
    ["duration infinite", { ...payload(), durationMs: Infinity }],
    ["components", { ...payload(), components: "x" }],
    ["component length", { ...payload(), components: components({ canvas: "x".repeat(257) }) }],
    ["component type", { ...payload(), components: { ...components(), canvas: 1 } }],
    ["smart signals", { ...payload(), smartSignals: null }],
    ["incognito", { ...payload(), smartSignals: { ...payload().smartSignals, incognito: "yes" } }],
    ["privacy browser", { ...payload(), smartSignals: { ...payload().smartSignals, privacyBrowser: "evil" } }],
    ["vm", { ...payload(), smartSignals: { ...payload().smartSignals, virtualMachine: 1 } }],
    ["vm evidence", { ...payload(), smartSignals: { ...payload().smartSignals, virtualMachineEvidence: 5 } }],
    ["vm evidence length", { ...payload(), smartSignals: { ...payload().smartSignals, virtualMachineEvidence: "x".repeat(65) } }],
  ])("rejects invalid %s", (_label, input) => {
    expect(() => parseDevicePayload(input)).toThrow(InvalidPayloadError);
  });

  it("accepts privacy browser and vm evidence values", () => {
    const parsed = parseDevicePayload(
      payload({ smartSignals: { incognito: null, privacyBrowser: "brave", virtualMachine: true, virtualMachineEvidence: "VMware", tampering: ["isCanvasTampered"] } }),
    );
    expect(parsed.smartSignals.privacyBrowser).toBe("brave");
  });
});

describe("matching", () => {
  it("salts digests so deployments cannot correlate visitors", () => {
    const a = digestComponents(components(), SALT);
    const b = digestComponents(components(), `${SALT}-other`);
    expect(a.canvas).not.toBe(b.canvas);
    expect(compareDigests(a, b).score).toBe(0);
  });

  it("skips null components in digests and index groups", () => {
    const digests = digestComponents(components({ canvas: null }), SALT);
    expect(digests.canvas).toBeUndefined();
    expect(buildIndexKeys(digests)).toHaveLength(2);
  });

  it("weights matched and changed components", () => {
    const a = digestComponents(components(), SALT);
    const b = digestComponents(components({ screen: "other" }), SALT);
    const similarity = compareDigests(a, b);
    expect(similarity.changed).toEqual(["screen"]);
    expect(similarity.score).toBeGreaterThan(0.95);
    expect(compareDigests({}, {}).score).toBe(0);
  });
});

describe("sealResult", () => {
  const key = Buffer.alloc(32, 1);

  it("round-trips and rejects tampering", () => {
    const sealed = sealResult({ visitorId: "v" }, key);
    expect(unsealResult(sealed, key.toString("base64"))).toEqual({ visitorId: "v" });
    const bytes = Buffer.from(sealed, "base64url");
    bytes[bytes.length - 1] ^= 1;
    expect(() => unsealResult(bytes.toString("base64url"), key)).toThrow();
    expect(() => unsealResult("AAAA", key)).toThrow(/malformed/);
  });

  it("requires a 32-byte key", () => {
    expect(() => sealResult({}, "c2hvcnQ=")).toThrow(/32 bytes/);
  });
});

describe("createDeviceIntelligence", () => {
  it("requires a long salt", () => {
    expect(() => createDeviceIntelligence({ salt: "short" })).toThrow(/salt/);
    expect(() => createDeviceIntelligence({} as never)).toThrow(/salt/);
  });

  it("returns the same visitor after storage is cleared and survives small drift", async () => {
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection });
    const first = await intel.identify({ payload: payload(), request: browserRequest });
    expect(first.event.isNewVisitor).toBe(true);
    expect(first.event.matchedBy).toBe("new");

    const withToken = await intel.identify({ payload: payload({ storageToken: first.storageToken }), request: browserRequest });
    expect(withToken.event.visitorId).toBe(first.event.visitorId);
    expect(withToken.event.matchedBy).toBe("storage");
    expect(withToken.event.confidence).toBe(0.99);
    expect(withToken.storageToken).toBe(first.storageToken);

    const cleared = await intel.identify({ payload: payload({ components: components({ screen: "2560x1440x24@1" }) }), request: browserRequest });
    expect(cleared.event.visitorId).toBe(first.event.visitorId);
    expect(cleared.event.matchedBy).toBe("fingerprint");
    expect(cleared.event.visitCount).toBe(3);
  });

  it("assigns a different visitor to a different device", async () => {
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection });
    const a = await intel.identify({ payload: payload(), request: browserRequest });
    const other = Object.fromEntries(DEVICE_COMPONENT_NAMES.map((n) => [n, `${n}-B`])) as DeviceComponents;
    const b = await intel.identify({ payload: payload({ components: other }), request: browserRequest });
    expect(b.event.visitorId).not.toBe(a.event.visitorId);
  });

  it("does not let a copied token hijack another device's identity", async () => {
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection });
    const victim = await intel.identify({ payload: payload(), request: browserRequest });
    const other = Object.fromEntries(DEVICE_COMPONENT_NAMES.map((n) => [n, `${n}-B`])) as DeviceComponents;
    const attacker = await intel.identify({ payload: payload({ components: other, storageToken: victim.storageToken }), request: browserRequest });
    expect(attacker.event.visitorId).not.toBe(victim.event.visitorId);
    expect(attacker.storageToken).not.toBe(victim.storageToken);
  });

  it("uses lower token confidence on moderate drift and ignores unknown tokens", async () => {
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection });
    const first = await intel.identify({ payload: payload(), request: browserRequest });
    const drifted = components({ canvas: "x", fonts: "x", webgl: "x" });
    const result = await intel.identify({ payload: payload({ components: drifted, storageToken: first.storageToken }), request: browserRequest });
    expect(result.event.confidence).toBe(0.95);
    const unknown = await intel.identify({ payload: payload({ components: drifted, storageToken: "z".repeat(32) }), request: browserRequest });
    expect(unknown.event.matchedBy).toBe("fingerprint");
  });

  it("lowers confidence when identical devices are indistinguishable", async () => {
    const store = new MemoryVisitorStore();
    const intel = createDeviceIntelligence({ salt: SALT, store, serverDetection });
    const first = await intel.identify({ payload: payload(), request: browserRequest });
    const twin = await store.getVisitor(first.event.visitorId);
    await store.saveVisitor({ ...twin!, visitorId: "twin", storageTokens: [] });
    const result = await intel.identify({ payload: payload(), request: browserRequest });
    expect(result.event.confidence).toBe(0.78);
  });

  it("ignores candidates with too little comparable data", async () => {
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection });
    const sparse = Object.fromEntries(DEVICE_COMPONENT_NAMES.map((n) => [n, null])) as DeviceComponents;
    Object.assign(sparse, { webgl: "w", platform: "p", architecture: "a", math: "m" });
    const a = await intel.identify({ payload: payload({ components: sparse }), request: browserRequest });
    const b = await intel.identify({ payload: payload({ components: sparse }), request: browserRequest });
    expect(b.event.visitorId).not.toBe(a.event.visitorId);
  });

  it("produces bot, vpn, tampering, velocity and suspect score signals", async () => {
    const time = clock();
    const onEvent = vi.fn();
    const intel = createDeviceIntelligence({
      salt: SALT,
      now: time.now,
      highActivityThreshold: 2,
      sealKey: Buffer.alloc(32, 2),
      onEvent,
      serverDetection,
    });
    const risky = payload({
      smartSignals: { incognito: true, privacyBrowser: "brave", virtualMachine: true, virtualMachineEvidence: "VMware", tampering: ["isNativeFunctionTampered"] },
      detection: { suspicionScore: 1, signals: ["isWebDriver"], automationKind: "selenium" },
    });
    const accounts = ["a", "b", "c"];
    const countries: Array<[string, string]> = [["1.1.1.1", "SE"], ["2.2.2.2", "US"], ["3.3.3.3", "DE"]];
    let last: IdentificationEvent | undefined;
    for (const [index, linkedId] of accounts.entries()) {
      time.advance(1000);
      const [ip] = countries[index]!;
      const result = await intel.identify({
        payload: risky,
        request: { ...browserRequest, clientIp: ip, ipCountry: countries[index]![1], isDatacenterIp: true, isAbuseListedIp: true, isIcloudPrivateRelay: true, ipTimezone: "Asia/Tokyo", clientTimezone: "Europe/Stockholm" },
        linkedId,
        tag: { flow: "signup" },
        url: "https://example.com/signup",
      });
      last = result.event;
      expect(result.sealedResult).not.toBeNull();
    }
    const signals = last!.smartSignals;
    expect(signals.bot.result).toBe("bad");
    expect(signals.bot.automationKind).toBe("selenium");
    expect(signals.bot.signals).toContain("client:isWebDriver");
    expect(signals.vpn.detected).toBe(true);
    expect(signals.proxy).toBe(true);
    expect(signals.highActivity).toBe(true);
    expect(signals.velocity.distinctLinkedId["24h"]).toBe(3);
    expect(signals.velocity.distinctCountry["1h"]).toBe(3);
    expect(signals.suspectScore).toBe(100);
    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(last!.tag).toEqual({ flow: "signup" });
  });

  it("marks verified crawlers good and keeps unknown client kinds unknown", async () => {
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection });
    const result = await intel.identify({
      payload: payload({ detection: { suspicionScore: 0, signals: [], automationKind: "madeup" } }),
      request: { ...browserRequest, crawlerVerificationStatus: "verified", clientIp: undefined },
    });
    expect(result.event.smartSignals.bot.result).toBe("good");
    expect(result.event.smartSignals.bot.automationKind).toBe("unknown");
    expect(result.event.smartSignals.velocity.ipDistinctVisitors["24h"]).toBe(0);
    expect(result.event.ip).toBeNull();
  });

  it("keeps a recognised client automation kind when the server sees none", async () => {
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection });
    const result = await intel.identify({
      payload: payload({ detection: { suspicionScore: 1, signals: ["isPlaywright"], automationKind: "playwright" } }),
      request: { userAgent: CHROME_UA },
    });
    expect(result.event.smartSignals.bot.automationKind).toBe("playwright");
    const unknown = await intel.identify({
      payload: payload({ detection: { suspicionScore: 0, signals: [], automationKind: "madeup" } }),
      request: { userAgent: CHROME_UA },
    });
    expect(unknown.event.smartSignals.bot.automationKind).toBe("unknown");
  });

  it("uses server automation attribution for scripted clients", async () => {
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection });
    const result = await intel.identify({
      payload: payload({ components: components({ timezone: null, languages: null, platform: null }) }),
      request: { userAgent: "curl/8.4.0", clientIp: "5.5.5.5" },
    });
    expect(result.event.smartSignals.bot.result).toBe("bad");
    expect(result.event.smartSignals.bot.automationKind).toBe("curl");
  });

  it("supports event lookup, search and GDPR deletion", async () => {
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection });
    const { event } = await intel.identify({ payload: payload(), request: browserRequest, linkedId: "user-1" });
    expect(await intel.getEvent(event.eventId)).toEqual(event);
    expect(await intel.searchEvents({ linkedId: "user-1" })).toHaveLength(1);
    expect((await intel.getVisitor(event.visitorId))?.visitCount).toBe(1);
    expect(await intel.deleteVisitor(event.visitorId)).toBe(true);
    expect(await intel.deleteVisitor(event.visitorId)).toBe(false);
    expect(await intel.getEvent(event.eventId)).toBeUndefined();
  });
});

describe("computeSuspectScore", () => {
  it("is zero for a clean visitor", () => {
    const zero = { "5m": 0, "1h": 0, "24h": 0 };
    const clean: Omit<SmartSignals, "suspectScore"> = {
      bot: { result: "notDetected", automationKind: "unknown", serverScore: 0, clientScore: 0, signals: [] },
      vpn: { detected: false, methods: { timezoneMismatch: false, privateRelay: false, datacenter: false } },
      proxy: false,
      ipBlocklist: false,
      incognito: null,
      privacyBrowser: null,
      virtualMachine: false,
      tampering: { detected: false, signals: [] },
      highActivity: false,
      velocity: { events: zero, distinctIp: zero, distinctCountry: zero, distinctLinkedId: zero, ipDistinctVisitors: zero },
      ipInfo: { ip: null, country: null, timezone: null, datacenterProvider: null },
    };
    expect(computeSuspectScore(clean)).toBe(0);
    const busy = { "5m": 20, "1h": 20, "24h": 20 };
    expect(computeSuspectScore({ ...clean, velocity: { ...clean.velocity, distinctIp: busy, ipDistinctVisitors: busy } })).toBe(16);
  });
});

describe("MemoryVisitorStore", () => {
  it("prunes by retention and max events, and honours query limits", async () => {
    const time = clock();
    const store = new MemoryVisitorStore({ now: time.now, retentionMs: 1000, maxEvents: 2 });
    const event = (id: string, timestamp: number) => ({ eventId: id, visitorId: "v", timestamp, ip: "1.1.1.1", linkedId: null }) as IdentificationEvent;
    await store.addEvent(event("old", time.now() - 5000));
    await store.addEvent(event("a", time.now()));
    await store.addEvent(event("b", time.now()));
    await store.addEvent(event("c", time.now()));
    expect((await store.queryEvents({})).map((e) => e.eventId)).toEqual(["c", "b"]);
    expect(await store.queryEvents({ limit: 1 })).toHaveLength(1);
    expect(await store.queryEvents({ ip: "9.9.9.9" })).toHaveLength(0);
    expect(await store.queryEvents({ since: time.now() + 1 })).toHaveLength(0);
    expect(await store.findVisitorByStorageToken("nope")).toBeUndefined();
  });

  it("re-indexes visitors on save", async () => {
    const store = new MemoryVisitorStore();
    const record = { visitorId: "v", digests: {}, indexKeys: ["k1"], storageTokens: ["t1"], firstSeenAt: 0, lastSeenAt: 0, visitCount: 1 };
    await store.saveVisitor(record);
    await store.saveVisitor({ ...record, indexKeys: ["k2"], storageTokens: ["t2"] });
    expect(await store.findCandidates(["k1"])).toHaveLength(0);
    expect(await store.findCandidates(["k2", "missing"])).toHaveLength(1);
    expect(await store.findVisitorByStorageToken("t1")).toBeUndefined();
    expect((await store.findVisitorByStorageToken("t2"))?.visitorId).toBe("v");
  });

  it("uses defaults", async () => {
    const store = new MemoryVisitorStore();
    expect(await store.queryEvents({})).toEqual([]);
  });
});

describe("createIdentifyHandler", () => {
  const intel = () => createDeviceIntelligence({ salt: SALT, serverDetection });
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/identify", { method: "POST", body, headers: { "user-agent": CHROME_UA, ...headers } });

  it("requires an IP source", () => {
    expect(() => createIdentifyHandler(intel())).toThrow(/getClientIp/);
  });

  it("identifies, exposes only ids by default, and sanitises inputs", async () => {
    const handler = createIdentifyHandler(intel(), { trustProxyHeader: "x-forwarded-for" });
    const response = await handler(
      post(JSON.stringify({ payload: payload(), linkedId: "u".repeat(300), tag: { a: 1, b: { nested: true }, c: "x".repeat(300) }, url: "https://x" }), { "x-forwarded-for": "84.212.7.19, 10.0.0.1" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["confidence", "eventId", "sealedResult", "storageToken", "visitorId"]);
  });

  it("supports exposing extra fields and ignores non-object tags", async () => {
    const handler = createIdentifyHandler(intel(), { getClientIp: () => "84.212.7.19", exposeToClient: (event) => ({ suspectScore: event.smartSignals.suspectScore }) });
    const response = await handler(post(JSON.stringify({ payload: payload(), tag: ["x"] })));
    expect(((await response.json()) as { suspectScore: number }).suspectScore).toBe(0);
  });

  it("rejects bad requests", async () => {
    const handler = createIdentifyHandler(intel(), { getClientIp: () => undefined });
    expect((await handler(new Request("http://localhost", { method: "GET" }))).status).toBe(405);
    expect((await handler(post("x".repeat(70_000)))).status).toBe(413);
    expect((await handler(post("{"))).status).toBe(400);
    expect((await handler(post("null"))).status).toBe(400);
    expect((await handler(post(JSON.stringify({ payload: { v: 9 } })))).status).toBe(400);
  });

  it("rethrows unexpected errors", async () => {
    const broken = { ...intel(), identify: () => Promise.reject(new Error("db down")) };
    const handler = createIdentifyHandler(broken, { getClientIp: () => "1.1.1.1" });
    await expect(handler(post(JSON.stringify({ payload: payload() })))).rejects.toThrow("db down");
  });

  it("builds request context only from configured trusted headers", () => {
    const request = new Request("http://localhost", {
      headers: { "x-ja3": "abc", "x-crawler": "verified", "x-forwarded-for": "" },
    });
    const context = buildRequestContext(request, { trustProxyHeader: "x-forwarded-for", tlsFingerprintHeader: "x-ja3", crawlerVerificationHeader: "x-crawler" });
    expect(context).toMatchObject({ tlsFingerprint: "abc", crawlerVerificationStatus: "verified", clientIp: undefined });
    const bogus = buildRequestContext(new Request("http://localhost", { headers: { "x-crawler": "trust-me" } }), { crawlerVerificationHeader: "x-crawler" });
    expect(bogus.crawlerVerificationStatus).toBeUndefined();
    expect(buildRequestContext(request, {}).tlsFingerprint).toBeUndefined();
  });
});
