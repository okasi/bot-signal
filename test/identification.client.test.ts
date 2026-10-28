import { describe, expect, it, vi } from "vitest";

vi.mock("../src/detectInstantClient.js", () => ({
  detectInstantClient: () => ({
    suspicionScore: 0.2,
    signals: [
      { id: "isNativeFunctionTampered", triggered: true },
      { id: "isEmptyPlugins", triggered: false },
    ],
    automation: { kind: "unknown" },
  }),
}));

import {
  collectDeviceComponents,
  readArchitectureComponent,
  readAudioComponent,
  readBrowserComponent,
  readCanvasComponent,
  readFontsComponent,
  readHardwareComponent,
  readIntlComponent,
  readLanguagesComponent,
  readMathComponent,
  readMediaQueriesComponent,
  readPlatformComponent,
  readPluginsComponent,
  readScreenComponent,
  readTimezoneComponent,
  readTouchComponent,
  readVendorComponent,
  readWebGlComponent,
  readWebGlParamsComponent,
} from "../src/identification/components.js";
import {
  collectDeviceSignals,
  identify,
  readStorageToken,
  STORAGE_TOKEN_KEY,
  writeStorageToken,
} from "../src/identification/client.js";
import { hash64 } from "../src/identification/hash.js";
import {
  detectIncognito,
  detectPrivacyBrowser,
  detectVirtualMachine,
  getTamperingSignals,
} from "../src/identification/smartSignals.js";
import type { ExtendedWindow, InstantClientResult } from "../src/types.js";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
const FIREFOX_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";
const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const TOKEN = "t".repeat(32);

interface MockOptions {
  pixels?: number[];
  renderer?: string | null;
  vendor?: string;
  no2d?: boolean;
  noWebGl?: boolean;
  noParameterFn?: boolean;
  noExtensions?: boolean;
  calibri?: boolean;
}

function createCanvas(options: MockOptions = {}) {
  const ctx2d = {
    font: "",
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(options.pixels ?? [1, 2, 3, 4, 5, 6, 7, 8]) }),
    measureText(this: { font: string }) {
      return { width: options.calibri && this.font.includes("Calibri") ? 99 : 50 };
    },
  };
  const gl = {
    getExtension: () =>
      options.renderer === null ? null : { UNMASKED_RENDERER_WEBGL: 1, UNMASKED_VENDOR_WEBGL: 2 },
    getParameter: options.noParameterFn
      ? undefined
      : (parameter: number) => {
          if (parameter === 1) return options.renderer ?? "ANGLE (NVIDIA RTX 3080)";
          if (parameter === 2) return options.vendor ?? "Google Inc. (NVIDIA)";
          if (parameter === 0x0d3a) return new Int32Array([16384, 16384]);
          if (parameter === 0x0d50) return 0;
          return 4096;
        },
    getSupportedExtensions: options.noExtensions ? undefined : () => ["b", "a"],
  };
  return {
    width: 0,
    height: 0,
    getContext: (type: string) => {
      if (type === "2d") return options.no2d ? null : ctx2d;
      return options.noWebGl ? null : gl;
    },
  };
}

class FakeOfflineAudioContext {
  destination = {};
  static pending = false;
  createOscillator() {
    return { type: "", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn() };
  }
  createDynamicsCompressor() {
    const param = () => ({ value: 0 });
    return { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect: vi.fn() };
  }
  startRendering() {
    if (FakeOfflineAudioContext.pending) return new Promise(() => {});
    return Promise.resolve({ getChannelData: () => new Float32Array(5_000).fill(0.5) });
  }
}

function createStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

function createWindow(
  overrides: Record<string, unknown> = {},
  navigatorOverrides: Record<string, unknown> = {},
  canvasOptions: MockOptions = {},
): ExtendedWindow {
  return {
    document: { createElement: () => createCanvas(canvasOptions), cookie: "" },
    navigator: {
      userAgent: CHROME_UA,
      languages: ["en-US", "sv"],
      language: "en-US",
      platform: "Win32",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0,
      vendor: "Google Inc.",
      plugins: [{ name: "PDF Viewer" }, { name: "" }],
      storage: { estimate: async () => ({ quota: 100_000_000_000 }) },
      ...navigatorOverrides,
    },
    screen: { width: 1920, height: 1080, colorDepth: 24 },
    devicePixelRatio: 2,
    matchMedia: (query: string) => ({ matches: query === "(color-gamut: p3)" }),
    localStorage: createStorage(),
    location: { protocol: "https:", href: "https://example.com/" },
    performance: { now: () => 5, memory: { jsHeapSizeLimit: 4_000_000_000 } },
    OfflineAudioContext: FakeOfflineAudioContext,
    ...overrides,
  } as unknown as ExtendedWindow;
}

const throwingWindow = new Proxy({}, {
  get() {
    throw new Error("blocked");
  },
}) as ExtendedWindow;

describe("hash64", () => {
  it("is deterministic, seeded and fixed-width", () => {
    expect(hash64("abc")).toBe(hash64("abc"));
    expect(hash64("abc")).not.toBe(hash64("abd"));
    expect(hash64("abc", 1)).not.toBe(hash64("abc"));
    expect(hash64("")).toHaveLength(16);
  });
});

describe("identification components", () => {
  it("reads canvas pixels and handles missing canvas data", () => {
    expect(readCanvasComponent(createWindow())).toMatch(/^[0-9a-f]{16}$/);
    expect(readCanvasComponent(createWindow({}, {}, { no2d: true }))).toBeNull();
    expect(readCanvasComponent(createWindow({}, {}, { pixels: [] }))).toBeNull();
    expect(readCanvasComponent(throwingWindow)).toBeNull();
  });

  it("reads WebGL identity and parameters", () => {
    expect(readWebGlComponent(createWindow())).toBe("Google Inc. (NVIDIA)~ANGLE (NVIDIA RTX 3080)");
    expect(readWebGlComponent(createWindow({}, {}, { renderer: "x".repeat(300) }))).toHaveLength(256);
    expect(readWebGlComponent(createWindow({}, {}, { renderer: null }))).toBeNull();
    expect(readWebGlParamsComponent(createWindow())).toMatch(/^[0-9a-f]{16}$/);
    expect(readWebGlParamsComponent(createWindow({}, {}, { noExtensions: true }))).toMatch(/^[0-9a-f]{16}$/);
    expect(readWebGlParamsComponent(createWindow({}, {}, { noWebGl: true }))).toBeNull();
    expect(readWebGlParamsComponent(createWindow({}, {}, { noParameterFn: true }))).toBeNull();
  });

  it("detects fonts by width differences", () => {
    expect(readFontsComponent(createWindow({}, {}, { calibri: true }))).toBe(hash64("Calibri"));
    expect(readFontsComponent(createWindow())).toBe(hash64(""));
    expect(readFontsComponent(createWindow({}, {}, { no2d: true }))).toBeNull();
  });

  it("normalises screen orientation", () => {
    expect(readScreenComponent(createWindow())).toBe("1080x1920x24@2");
    expect(readScreenComponent(createWindow({ screen: { width: 390, height: 844, colorDepth: 24 }, devicePixelRatio: undefined }))).toBe("390x844x24@1");
    expect(readScreenComponent(throwingWindow)).toBeNull();
  });

  it("reads locale components with and without a window Intl", () => {
    const zoneIntl = (timeZone: string | undefined) => ({
      DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone, locale: "sv-SE", calendar: "gregory", numberingSystem: "latn" }) }),
      NumberFormat: () => ({ resolvedOptions: () => ({ locale: "sv-SE" }) }),
    });
    expect(readTimezoneComponent(createWindow({ Intl: zoneIntl("Europe/Stockholm") }))).toBe("Europe/Stockholm");
    expect(readTimezoneComponent(createWindow({ Intl: zoneIntl(undefined) }))).toBeNull();
    expect(readTimezoneComponent(createWindow())).toEqual(expect.any(String));
    expect(readIntlComponent(createWindow({ Intl: zoneIntl("UTC") }))).toBe("sv-SE|gregory|latn|sv-SE");
    expect(readIntlComponent(createWindow())).toEqual(expect.any(String));
  });

  it("reads navigator components", () => {
    expect(readLanguagesComponent(createWindow())).toBe("en-US,sv");
    expect(readLanguagesComponent(createWindow({}, { languages: [] }))).toBe("en-US");
    expect(readLanguagesComponent(createWindow({}, { languages: undefined, language: "" }))).toBeNull();
    expect(readPlatformComponent(createWindow({}, { userAgentData: { brands: [], platform: "Windows" } }))).toBe("Windows");
    expect(readPlatformComponent(createWindow())).toBe("Win32");
    expect(readPlatformComponent(createWindow({}, { platform: "" }))).toBeNull();
    expect(readHardwareComponent(createWindow())).toBe("8|8");
    expect(readHardwareComponent(createWindow({}, { hardwareConcurrency: undefined, deviceMemory: undefined }))).toBe("?|?");
    expect(readTouchComponent(createWindow())).toBe("0|0");
    expect(readTouchComponent(createWindow({ ontouchstart: null }, { maxTouchPoints: undefined }))).toBe("0|1");
    expect(readVendorComponent(createWindow())).toBe("Google Inc.");
    expect(readVendorComponent(createWindow({}, { vendor: undefined }))).toBeNull();
    expect(readPluginsComponent(createWindow())).toBe(hash64("PDF Viewer"));
    expect(readPluginsComponent(createWindow({}, { plugins: undefined }))).toBeNull();
  });

  it("reads math, media, architecture and browser family", () => {
    expect(readMathComponent(createWindow())).toBe(readMathComponent(createWindow({ Math })));
    expect(readMediaQueriesComponent(createWindow())).toContain("color-gamut=p3");
    expect(readMediaQueriesComponent(createWindow())).toContain("hover=?");
    expect(readMediaQueriesComponent(createWindow({ matchMedia: undefined }))).toBeNull();
    expect(readArchitectureComponent()).toMatch(/^\d+$/);
    expect(readBrowserComponent(createWindow())).toBe("chrome/windows");
    expect(readBrowserComponent(createWindow({}, { userAgent: FIREFOX_UA }))).toBe("firefox/linux");
    expect(readBrowserComponent(createWindow({}, { userAgent: undefined }))).toBe("other/other");
  });

  it("renders audio, falls back to the webkit prefix, and times out", async () => {
    expect(await readAudioComponent(createWindow())).toBe(String(0.5 * 500));
    expect(await readAudioComponent(createWindow({ OfflineAudioContext: undefined, webkitOfflineAudioContext: FakeOfflineAudioContext }))).not.toBeNull();
    expect(await readAudioComponent(createWindow({ OfflineAudioContext: undefined }))).toBeNull();
    expect(await readAudioComponent(createWindow({ OfflineAudioContext: class { constructor() { throw new Error("no"); } } }))).toBeNull();
    FakeOfflineAudioContext.pending = true;
    expect(await readAudioComponent(createWindow(), 5)).toBeNull();
    FakeOfflineAudioContext.pending = false;
  });

  it("collects every component", async () => {
    const components = await collectDeviceComponents(createWindow());
    expect(Object.values(components).every((value) => value !== null)).toBe(true);
    expect(components.browser).toBe("chrome/windows");
  });
});

describe("client smart signals", () => {
  it("detects Chromium incognito from storage quota", async () => {
    expect(await detectIncognito(createWindow())).toBe(false);
    const small = { estimate: async () => ({ quota: 100_000_000 }) };
    expect(await detectIncognito(createWindow({}, { storage: small }))).toBe(true);
    expect(await detectIncognito(createWindow({ performance: undefined }, { storage: small }))).toBe(true);
    expect(await detectIncognito(createWindow({}, { storage: { estimate: async () => ({}) } }))).toBeNull();
    expect(await detectIncognito(createWindow({}, { storage: {} }))).toBeNull();
    expect(await detectIncognito(createWindow({}, { storage: undefined }))).toBeNull();
    expect(await detectIncognito(createWindow({}, { storage: { estimate: () => Promise.reject(new Error("x")) } }))).toBeNull();
    expect(await detectIncognito(createWindow({}, { userAgent: "Unknown/1.0" }))).toBeNull();
    expect(await detectIncognito(createWindow({}, { userAgent: undefined }))).toBeNull();
  });

  it("detects Firefox and Safari private windows from OPFS errors", async () => {
    const rejecting = (error: unknown) => ({ getDirectory: () => Promise.reject(error) });
    expect(await detectIncognito(createWindow({}, { userAgent: FIREFOX_UA, storage: rejecting(new Error("Security error")) }))).toBe(true);
    expect(await detectIncognito(createWindow({}, { userAgent: FIREFOX_UA, storage: { getDirectory: async () => ({}) } }))).toBe(false);
    expect(await detectIncognito(createWindow({}, { userAgent: FIREFOX_UA, storage: {} }))).toBeNull();
    expect(await detectIncognito(createWindow({}, { userAgent: SAFARI_UA, storage: rejecting(new Error("unknown transient reason")) }))).toBe(true);
    expect(await detectIncognito(createWindow({}, { userAgent: SAFARI_UA, storage: rejecting(undefined) }))).toBe(false);
  });

  it("recognises privacy browsers", () => {
    expect(detectPrivacyBrowser(createWindow({}, { brave: { isBrave: () => Promise.resolve(true) } }))).toBe("brave");
    expect(detectPrivacyBrowser(createWindow())).toBeNull();
    const utc = (timeZone: string) => ({ DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }) });
    expect(detectPrivacyBrowser(createWindow({ Intl: utc("UTC") }, { userAgent: FIREFOX_UA, hardwareConcurrency: 2 }))).toBe("firefox-resist-fingerprinting");
    expect(detectPrivacyBrowser(createWindow({ Intl: utc("Etc/UTC") }, { userAgent: FIREFOX_UA, hardwareConcurrency: 2 }))).toBe("firefox-resist-fingerprinting");
    expect(detectPrivacyBrowser(createWindow({ Intl: utc("UTC") }, { userAgent: FIREFOX_UA, hardwareConcurrency: 8 }))).toBeNull();
    expect(detectPrivacyBrowser(createWindow({ Intl: utc("Europe/Stockholm") }, { userAgent: FIREFOX_UA, hardwareConcurrency: 2 }))).toBeNull();
    expect(detectPrivacyBrowser(createWindow({}, { userAgent: undefined }))).toBeNull();
    expect(detectPrivacyBrowser(throwingWindow)).toBeNull();
  });

  it("detects virtual machine renderers", () => {
    expect(detectVirtualMachine(createWindow({}, {}, { renderer: "SVGA3D; VMware SVGA II" }))).toEqual({ detected: true, evidence: "VMware" });
    expect(detectVirtualMachine(createWindow())).toEqual({ detected: false, evidence: null });
    expect(detectVirtualMachine(createWindow({}, {}, { renderer: null }))).toEqual({ detected: false, evidence: null });
  });

  it("extracts tampering signals", () => {
    const result = {
      signals: [
        { id: "isCanvasNoiseInjected", triggered: true },
        { id: "isWebDriver", triggered: true },
        { id: "isIframeInconsistent", triggered: false },
      ],
    } as InstantClientResult;
    expect(getTamperingSignals(result)).toEqual(["isCanvasNoiseInjected"]);
  });
});

describe("storage token", () => {
  it("reads from localStorage, then cookie", () => {
    expect(readStorageToken(createWindow({ localStorage: createStorage({ [STORAGE_TOKEN_KEY]: TOKEN }) }))).toBe(TOKEN);
    const cookieWindow = createWindow({ localStorage: createStorage({ [STORAGE_TOKEN_KEY]: "bad" }) });
    cookieWindow.document.cookie = `a=1; bsid=${TOKEN}`;
    expect(readStorageToken(cookieWindow)).toBe(TOKEN);
    cookieWindow.document.cookie = "bsid=bad";
    expect(readStorageToken(cookieWindow)).toBeNull();
    expect(readStorageToken(createWindow({ localStorage: undefined }))).toBeNull();
  });

  it("survives blocked storage APIs", () => {
    const blocked = createWindow({
      localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } },
    });
    Object.defineProperty(blocked.document, "cookie", {
      get: () => { throw new Error("blocked"); },
      set: () => { throw new Error("blocked"); },
    });
    expect(readStorageToken(blocked)).toBeNull();
    expect(() => writeStorageToken(blocked, TOKEN)).not.toThrow();
  });

  it("writes first-party token with Secure only on https", () => {
    const secure = createWindow();
    writeStorageToken(secure, TOKEN);
    expect(secure.localStorage.getItem(STORAGE_TOKEN_KEY)).toBe(TOKEN);
    expect(secure.document.cookie).toContain("; Secure");
    const plain = createWindow({ location: undefined, localStorage: undefined });
    writeStorageToken(plain, TOKEN);
    expect(plain.document.cookie).not.toContain("Secure");
    const untouched = createWindow();
    writeStorageToken(untouched, "x");
    expect(untouched.document.cookie).toBe("");
  });
});

describe("collectDeviceSignals and identify", () => {
  it("builds a payload with detection summary", async () => {
    const payload = await collectDeviceSignals(createWindow());
    expect(payload.v).toBe(1);
    expect(payload.detection).toEqual({ suspicionScore: 0.2, signals: ["isNativeFunctionTampered"], automationKind: "unknown" });
    expect(payload.smartSignals.tampering).toEqual(["isNativeFunctionTampered"]);
    expect(payload.durationMs).toBe(0);
    const withoutPerformance = await collectDeviceSignals(createWindow({ performance: undefined }));
    expect(withoutPerformance.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("posts the payload and stores the issued token", async () => {
    const context = createWindow();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ eventId: "e", visitorId: "v", confidence: 0.9, storageToken: TOKEN })),
    );
    const result = await identify(context, { endpoint: "/api/identify", linkedId: "user-1", tag: { a: 1 }, fetch: fetchMock });
    expect(result).toEqual({ eventId: "e", visitorId: "v", confidence: 0.9, sealedResult: null });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ linkedId: "user-1", url: "https://example.com/" });
    expect(context.localStorage.getItem(STORAGE_TOKEN_KEY)).toBe(TOKEN);
  });

  it("uses global fetch, keeps sealed results, and throws on HTTP errors", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ eventId: "e", visitorId: "v", confidence: 1, sealedResult: "s" })));
    expect((await identify(createWindow({ location: undefined }), { endpoint: "/x" })).sealedResult).toBe("s");
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    await expect(identify(createWindow(), { endpoint: "/x" })).rejects.toThrow(/HTTP 500/);
    globalThis.fetch = original;
  });
});
