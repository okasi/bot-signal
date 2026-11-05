import { describe, expect, it, vi } from "vitest";
import * as edge from "../src/edge.js";
import {
  challengeDifficulty,
  checkChallengeSolution,
  checkToken,
  createChallenge,
  createDeviceIntelligence,
  createIdentifyHandler,
  decide,
  DEFAULT_POLICIES,
  MemoryVisitorStore,
  resolvePolicy,
  signToken,
  type Challenge,
  type IdentificationEvent,
  type SmartSignals,
} from "../src/server.js";
import { fromBase64, safeEqual } from "../src/engine/crypto.js";
import { solveChallenge } from "../src/identification/challenge.js";
import { createHash } from "node:crypto";
import { leadingZeroBits, sha256Hex, sha256Words } from "../src/identification/sha256.js";
import { DEVICE_COMPONENT_NAMES, type DeviceComponents, type DeviceSignalsPayload } from "../src/identification/types.js";

const SALT = "protect-salt-protect-salt-protect-salt-01";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
const serverDetection = { lookupGeo: false, checkIpLists: false };
const request = { userAgent: CHROME_UA, acceptLanguage: "en-US", clientIp: "84.212.7.19" };

function payload(overrides: Partial<DeviceSignalsPayload> = {}, variant = "A"): DeviceSignalsPayload {
  return {
    v: 1,
    components: Object.fromEntries(DEVICE_COMPONENT_NAMES.map((n) => [n, `${n}-${variant}`])) as DeviceComponents,
    smartSignals: { incognito: false, privacyBrowser: null, virtualMachine: false, virtualMachineEvidence: null, tampering: [] },
    detection: { suspicionScore: 0, signals: [], automationKind: "unknown" },
    storageToken: null,
    durationMs: 1,
    ...overrides,
  };
}

/** Score 26: tampering 20 + incognito 4 + privacy browser 2 → challenge on signup, allow on content. */
const greyZone = () =>
  payload({
    smartSignals: { incognito: true, privacyBrowser: "brave", virtualMachine: false, virtualMachineEvidence: null, tampering: ["isCanvasNoiseInjected"] },
  });

function clock(start = 1_700_000_000_000) {
  let current = start;
  return { now: () => current, advance: (ms: number) => (current += ms) };
}

const zero = { "5m": 0, "1h": 0, "24h": 0 };
function event(signals: Partial<SmartSignals> = {}, bot: Partial<SmartSignals["bot"]> = {}): IdentificationEvent {
  return {
    smartSignals: {
      bot: { result: "notDetected", automationKind: "unknown", serverScore: 0, clientScore: 0, signals: [], ...bot },
      velocity: { events: zero, distinctIp: zero, distinctCountry: zero, distinctLinkedId: zero, ipDistinctVisitors: zero },
      suspectScore: 0,
      ...signals,
    },
  } as IdentificationEvent;
}

describe("decide", () => {
  const signup = DEFAULT_POLICIES.signup;

  it("allows clean visitors and verified crawlers where appropriate", () => {
    expect(decide(event(), signup)).toEqual({ decision: "allow", reasons: [], difficulty: 16 });
    expect(decide(event({}, { result: "good" }), DEFAULT_POLICIES.content).decision).toBe("allow");
    expect(decide(event({}, { result: "good" }), signup).decision).toBe("block");
  });

  it("blocks definitive automation and very high scores", () => {
    expect(decide(event({}, { result: "bad", serverScore: 0.9, automationKind: "curl" }), signup)).toMatchObject({ decision: "block", reasons: ["automation detected (curl)"] });
    expect(decide(event({}, { result: "bad", clientScore: 1 }), signup).decision).toBe("block");
    expect(decide(event({}, { result: "bad", clientScore: 1 }), { ...signup, blockBadBots: false }).decision).toBe("challenge");
    expect(decide(event({ suspectScore: 80 }), signup).decision).toBe("block");
  });

  it("challenges grey-zone traffic with reasons", () => {
    expect(decide(event({}, { result: "bad", clientScore: 0.6 }), signup).reasons).toEqual(["weak automation signals"]);
    expect(decide(event({ suspectScore: 30 }), signup)).toMatchObject({ decision: "challenge", difficulty: 18 });
    const busy = { "5m": 50, "1h": 50, "24h": 50 };
    const velocity = { events: zero, distinctIp: zero, distinctCountry: zero, distinctLinkedId: busy, ipDistinctVisitors: busy };
    expect(decide(event({ velocity }), signup).reasons).toEqual(["50 accounts on this device in 24 h", "50 devices on this IP in 1 h"]);
  });

  it("resolves policies and difficulty", () => {
    expect(resolvePolicy("unknown-action")).toEqual(DEFAULT_POLICIES.default);
    expect(resolvePolicy("signup", { signup: { challengeAt: 5 } }).challengeAt).toBe(5);
    expect(challengeDifficulty(0)).toBe(16);
    expect(challengeDifficulty(100)).toBe(22);
  });
});

describe("challenges and tokens", () => {
  it("lets a grey-zone visitor through after solving the invisible challenge", async () => {
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection });
    const result = await intel.identify({ payload: greyZone(), request, action: "signup" });
    expect(result.decision).toBe("challenge");
    expect(result.token).toBeNull();
    expect(result.reasons[0]).toMatch(/suspect score/);

    const challenge = result.challenge!;
    const solved = await solveChallenge(challenge);
    const verified = await intel.verifyChallenge({ challenge, nonce: solved.nonce });
    expect(verified.valid).toBe(true);

    const check = await intel.verifyToken(verified.token, { action: "signup" });
    expect(check.valid).toBe(true);
    expect(check.claims).toMatchObject({ challengePassed: true, action: "signup", visitorId: result.event.visitorId });
    expect(check.event?.eventId).toBe(result.event.eventId);

    expect((await intel.verifyChallenge({ challenge, nonce: solved.nonce })).reason).toBe("replayed");
    expect((await intel.verifyToken(verified.token)).reason).toBe("replayed");
  });

  it("verifies a token even after its event was deleted", async () => {
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection });
    const result = await intel.identify({ payload: payload(), request, action: "content" });
    await intel.deleteVisitor(result.event.visitorId);
    expect(await intel.verifyToken(result.token)).toMatchObject({ valid: true, event: null });
  });

  it("issues a token immediately for clean visitors and rejects misuse", async () => {
    const time = clock();
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection, now: time.now });
    const result = await intel.identify({ payload: payload(), request, action: "login" });
    expect(result).toMatchObject({ decision: "allow", challenge: null, action: "login" });

    expect((await intel.verifyToken(result.token, { action: "checkout" })).reason).toBe("wrong-action");
    expect((await intel.verifyToken(`${result.token}x`)).reason).toBe("bad-signature");
    expect((await intel.verifyToken("nope")).reason).toBe("malformed");
    expect((await intel.verifyToken(42)).reason).toBe("malformed");
    expect((await intel.verifyToken("x.y.z")).reason).toBe("malformed");
    time.advance(10 * 60_000);
    expect((await intel.verifyToken(result.token)).reason).toBe("expired");
  });

  it("defaults the action and blocks bots without a token or challenge", async () => {
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection });
    const clean = await intel.identify({ payload: payload(), request });
    expect(clean.action).toBe("default");
    const bot = await intel.identify({ payload: payload(), request: { userAgent: "python-requests/2.31", clientIp: "5.6.7.8" }, action: "signup" });
    expect(bot).toMatchObject({ decision: "block", token: null, challenge: null });
  });

  it("rejects forged, wrong, expired and orphaned solutions", async () => {
    const time = clock();
    const store = new MemoryVisitorStore({ now: time.now });
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection, now: time.now, store });
    const { challenge, event: stored } = await intel.identify({ payload: greyZone(), request, action: "signup" });
    const solved = await solveChallenge(challenge!);

    expect((await intel.verifyChallenge(null)).reason).toBe("malformed");
    expect((await intel.verifyChallenge({ challenge, nonce: -1 })).reason).toBe("malformed");
    expect((await intel.verifyChallenge({ challenge: { ...challenge, salt: "x".repeat(65) }, nonce: 1 })).reason).toBe("malformed");
    expect((await intel.verifyChallenge({ challenge: { ...challenge, difficulty: 1 }, nonce: solved.nonce })).reason).toBe("bad-signature");

    // solveChallenge returns the first valid nonce, so the next failing nonce is found by scanning upward.
    let wrong = solved.nonce + 1;
    while (leadingZeroBits(sha256Words(`${challenge!.salt}${wrong}`)) >= challenge!.difficulty) wrong += 1;
    expect((await intel.verifyChallenge({ challenge, nonce: wrong })).reason).toBe("wrong-solution");

    await store.deleteVisitor(stored.visitorId);
    const orphan = await intel.verifyChallenge({ challenge, nonce: solved.nonce });
    expect(orphan.valid ? null : orphan.reason).toBe("expired");

    const second = await intel.identify({ payload: greyZone(), request, action: "signup" });
    time.advance(5 * 60_000);
    const late = await intel.verifyChallenge({ challenge: second.challenge, nonce: (await solveChallenge(second.challenge!)).nonce });
    expect(late.valid ? null : late.reason).toBe("expired");
  });

  it("detects insufficient work deterministically", async () => {
    const secret = "secret";
    const challenge = await createChallenge(secret, { eventId: "e", action: "a", difficulty: 24, ttlMs: 1000, now: 0 });
    expect(challenge.difficulty).toBe(24);
    expect((await createChallenge(secret, { eventId: "e", action: "a", difficulty: 1, ttlMs: 1, now: 0 })).difficulty).toBe(12);
    // A 24-bit target is effectively never met by nonce 0; a valid signature still fails on work.
    const result = await checkChallengeSolution(secret, { challenge, nonce: 0 }, 0);
    expect(result).toEqual({ ok: false, reason: "wrong-solution" });
    expect(await checkChallengeSolution(secret, { challenge: { ...challenge, algorithm: "md5" }, nonce: 0 }, 0)).toEqual({ ok: false, reason: "malformed" });
  });

  it("verifies tokens without an action filter", async () => {
    const token = await signToken("s", { eventId: "e", visitorId: "v", action: "a", decision: "allow", challengePassed: false, expiresAt: 10, nonce: "n" });
    expect(await checkToken("s", token, undefined, 0)).toMatchObject({ ok: true });
  });
});

describe("solver", () => {
  const challenge = { algorithm: "sha256-leading-zero-bits" as const, salt: "solver", difficulty: 24, expiresAt: 0, eventId: "e", action: "a", signature: "s" };

  it("gives up after the timeout", async () => {
    await expect(solveChallenge(challenge, { batchSize: 1, timeoutMs: -1 })).rejects.toThrow(/timed out/);
  });

  it("yields between batches and still finds a solution", async () => {
    const solved = await solveChallenge({ ...challenge, difficulty: 8 }, { batchSize: 1 });
    expect(solved.hashes).toBe(solved.nonce + 1);
    expect(leadingZeroBits(sha256Words(`solver${solved.nonce}`))).toBeGreaterThanOrEqual(8);
  });
});

describe("handler challenge flow", () => {
  const post = (body: unknown) =>
    new Request("http://localhost/api/bot-signal", { method: "POST", body: JSON.stringify(body), headers: { "user-agent": CHROME_UA } });

  it("returns a challenge, accepts the solution and refuses a bad one", async () => {
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection });
    const handler = createIdentifyHandler(intel, { getClientIp: () => "84.212.7.19" });
    const first = (await (await handler(post({ payload: greyZone(), action: "signup" }))).json()) as { decision: string; challenge: Challenge };
    expect(first.decision).toBe("challenge");
    const solved = await solveChallenge(first.challenge);

    const ok = await handler(post({ solution: { challenge: first.challenge, nonce: solved.nonce } }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { token: string }).token).toMatch(/^bst1\./);

    const replay = await handler(post({ solution: { challenge: first.challenge, nonce: solved.nonce } }));
    expect(replay.status).toBe(403);
    expect(await replay.json()).toEqual({ decision: "block", error: "challenge_failed" });
  });

  it("ignores invalid action names", async () => {
    const intel = createDeviceIntelligence({ salt: SALT, serverDetection });
    const handler = createIdentifyHandler(intel, { getClientIp: () => "1.1.1.1" });
    const body = (await (await handler(post({ payload: payload(), action: "../../etc" }))).json()) as { decision: string };
    expect(body.decision).toBe("allow");
  });
});

describe("edge entry", () => {
  it("runs the engine with portable request scoring and no Node built-ins", async () => {
    const intel = edge.createDeviceIntelligence({ salt: SALT });
    const result = await intel.identify({ payload: payload(), request: { userAgent: CHROME_UA }, action: "content" });
    expect(result.decision).toBe("allow");
    const bot = await intel.identify({ payload: payload(), request: { userAgent: "curl/8.0" }, action: "signup" });
    expect(bot.decision).toBe("block");
    expect(typeof edge.VERSION).toBe("string");
  });

  it("accepts a custom server scorer", async () => {
    const detectServer = vi.fn(edge.detectServerClient);
    const intel = createDeviceIntelligence({ salt: SALT, detectServer });
    await intel.identify({ payload: payload(), request });
    expect(detectServer).toHaveBeenCalledOnce();
  });
});

describe("crypto helpers and store", () => {
  it("decodes padded and unpadded base64 and compares safely", () => {
    expect(Array.from(fromBase64("AQI="))).toEqual([1, 2]);
    expect(Array.from(fromBase64("AQI"))).toEqual([1, 2]);
    expect(safeEqual("ab", "abc")).toBe(false);
    expect(safeEqual("ab", "ac")).toBe(false);
    expect(safeEqual("ab", "ab")).toBe(true);
  });

  it("expires consumed keys", async () => {
    const time = clock();
    const store = new MemoryVisitorStore({ now: time.now });
    expect(await store.consumeOnce("k", time.now() + 10)).toBe(true);
    expect(await store.consumeOnce("k", time.now() + 10)).toBe(false);
    time.advance(20);
    expect(await store.consumeOnce("k", time.now() + 10)).toBe(true);
  });

  it("hashes like node:crypto", () => {
    for (const input of ["", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "åäö-bot-signal"]) {
      expect(sha256Hex(input)).toBe(createHash("sha256").update(input).digest("hex"));
    }
  });

  it("counts leading zero bits across words", () => {
    expect(leadingZeroBits(new Uint32Array([0, 0x0fffffff]))).toBe(36);
    expect(leadingZeroBits(new Uint32Array([0, 0]))).toBe(64);
  });
});
