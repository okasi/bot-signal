import { describe, expect, it, vi } from "vitest";
import {
  aggregateInstantSuspicionScore,
  checkCdpRuntime,
  checkHighEntropyUserAgentData,
  checkNotificationPermissionConsistency,
  checkWorkerConsistency,
  buildInstantSignals,
  detectInstantClient,
  detectInstantClientAsync,
  isAutomationArtifacts,
  isCanvasTampered,
  isDefaultAutomationViewport,
  isEngineInconsistent,
  isErrorStackAutomation,
  isGpuPlatformMismatch,
  isIframeInconsistent,
  isLanguageInconsistent,
  isMediaQueryInconsistent,
  isMissingProprietaryCodecs,
  isNativeFunctionTampered,
  isNavigatorIdentityInconsistent,
  isPluginArrayInconsistent,
  isPlaywright,
  isPuppeteer,
  checkMediaDevices,
  isBotUserAgent,
  isScreenGeometryInconsistent,
  isSoftwareRenderer,
  isSuspiciousHardware,
  isSuspiciousWebDriverDescriptor,
  isSuspiciousWindowDimensions,
  isZeroConnectionRtt,
} from "../src/detectInstantClient.js";
import type { ExtendedNavigator, ExtendedWindow } from "../src/types.js";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

function createContext(
  overrides: Partial<ExtendedWindow> = {},
): ExtendedWindow {
  const navigatorOverrides = overrides.navigator as
    | Partial<ExtendedNavigator>
    | undefined;
  const documentOverrides = overrides.document;
  const screenOverrides = overrides.screen;
  const navigator = Object.assign(
    Object.create({ webdriver: false }),
    {
      userAgent: CHROME_UA,
      appVersion: CHROME_UA,
      vendor: "Google Inc.",
      platform: "Win32",
      productSub: "20030107",
      maxTouchPoints: 0,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      connection: { rtt: 50 },
      plugins: { length: 3 },
      mimeTypes: { length: 2 },
      language: "en-US",
      languages: ["en-US", "en"],
      ...navigatorOverrides,
    },
  ) as ExtendedNavigator;
  const webGl = {
    getExtension: vi.fn().mockReturnValue({ UNMASKED_RENDERER_WEBGL: 1 }),
    getParameter: vi.fn().mockReturnValue("ANGLE (NVIDIA)"),
  };
  const canvas = {
    getContext: vi.fn((kind: string) => (kind === "webgl" ? webGl : null)),
  };
  const context = {
    chrome: {},
    Function,
    Error,
    outerWidth: 1920,
    outerHeight: 1080,
    innerWidth: 1900,
    innerHeight: 970,
    screenX: 100,
    screenY: 50,
    setTimeout,
    clearTimeout,
    document: {
      createElement: vi.fn().mockReturnValue(canvas),
      ...documentOverrides,
    },
    navigator,
    screen: { width: 1920, height: 1080, ...screenOverrides },
    ...overrides,
  } as ExtendedWindow;
  context.navigator = navigator;
  context.document = {
    createElement: vi.fn().mockReturnValue(canvas),
    ...documentOverrides,
  } as ExtendedWindow["document"];
  context.screen = {
    width: 1920,
    height: 1080,
    ...screenOverrides,
  } as ExtendedWindow["screen"];
  return context;
}

function createWorkerContext() {
  class WorkerMock {
    static instances: WorkerMock[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    terminate = vi.fn();

    constructor(public readonly url: string) {
      WorkerMock.instances.push(this);
    }
  }

  class BlobMock {
    constructor(
      public readonly parts: BlobPart[],
      public readonly options?: BlobPropertyBag,
    ) {}
  }

  const revokeObjectURL = vi.fn();
  const context = createContext({
    Worker: WorkerMock as unknown as typeof Worker,
    Blob: BlobMock as unknown as typeof Blob,
    URL: {
      createObjectURL: vi.fn().mockReturnValue("blob:worker"),
      revokeObjectURL,
    } as unknown as typeof URL,
  });

  return { BlobMock, context, revokeObjectURL, WorkerMock };
}

function cleanWorkerSnapshot(context: ExtendedWindow) {
  return {
    userAgent: context.navigator.userAgent,
    language: context.navigator.language,
    languages: Array.from(context.navigator.languages),
    platform: context.navigator.platform,
    hardwareConcurrency: context.navigator.hardwareConcurrency,
    cdpDetected: false,
  };
}

describe("expanded automation artifacts", () => {
  it("detects a headless marker in navigator.appVersion", () => {
    expect(
      detectInstantClient(
        createContext({
          navigator: { appVersion: "HeadlessChrome/121" } as ExtendedNavigator,
        }),
      ).isHeadless,
    ).toBe(true);
  });

  it.each([
    { process: { type: "renderer" } },
    { process: { versions: { electron: "31" } } },
    { navigator: { appVersion: "Electron/31" } },
    { external: { toString: () => "Sequentum" } },
    { awesomium: true },
    { document: { __fxdriver_evaluate: true } },
  ] as Array<Partial<ExtendedWindow>>)("detects legacy/runtime artifact %#", (marker) => {
    expect(isAutomationArtifacts(createContext(marker))).toBe(true);
  });

  it("does not confuse an ordinary process or external object for automation", () => {
    expect(
      isAutomationArtifacts(
        createContext({
          process: { type: "browser", versions: {} },
          external: { toString: () => "[object External]" },
        }),
      ),
    ).toBe(false);
    expect(
      detectInstantClient(
        createContext({
          external: {
            toString() {
              throw new Error("blocked");
            },
          },
        }),
      ).isAutomationArtifacts,
    ).toBe(false);
  });

  it("survives throwing page-owned automation marker getters", () => {
    const context = createContext();
    for (const property of [
      "process",
      "__playwright",
      "__puppeteer_evaluation_script__",
      "_WEBDRIVER_ELEM_CACHE",
      "callSelenium",
      "Function",
    ]) {
      Object.defineProperty(context, property, {
        configurable: true,
        get() {
          throw new Error("blocked marker getter");
        },
      });
    }
    Object.defineProperty(context.document, "__selenium_evaluate", {
      configurable: true,
      get() {
        throw new Error("blocked document marker getter");
      },
    });
    Object.defineProperty(context.navigator, "webdriver", {
      configurable: true,
      get() {
        throw new Error("blocked navigator marker getter");
      },
    });

    expect(() => detectInstantClient(context)).not.toThrow();
    expect(detectInstantClient(context)).toMatchObject({
      isWebDriver: false,
      isPlaywright: true,
      isPuppeteer: true,
      isChromeDriver: true,
      isSelenium: false,
    });

    const nestedProcessGetter = createContext({
      process: new Proxy(
        {},
        {
          get() {
            throw new Error("blocked process field getter");
          },
        },
      ),
    });
    expect(() => detectInstantClient(nestedProcessGetter)).not.toThrow();

    const throwingDocumentAttribute = createContext({
      document: {
        documentElement: {
          hasAttribute() {
            throw new Error("blocked document attribute check");
          },
        },
      } as unknown as Document,
    });
    expect(() => detectInstantClient(throwingDocumentAttribute)).not.toThrow();
  });

  it("keeps generic runtime names soft and ignores falsey collisions", () => {
    const marker = detectInstantClient(createContext({ RunPerfTest: true }));
    expect(marker.isAutomationArtifacts).toBe(true);
    expect(marker.isLegitClient).toBe(true);
    expect(marker.automation).toMatchObject({
      isAutomated: false,
      kind: "unknown",
    });
    expect(marker.signals.find(({ id }) => id === "isAutomationArtifacts"))
      .toMatchObject({ weight: 0.35, confidence: "low", triggered: true });
    expect(
      isAutomationArtifacts(createContext({ RunPerfTest: undefined })),
    ).toBe(false);
  });

  it("detects exposed automation bindings and document attributes", () => {
    const playwrightBinding = Function(
      "/* exposeBindingHandle supports a single argument */",
    );
    const puppeteerBinding = Function("/* This is the Puppeteer binding */");
    const installed = () => undefined;
    (installed as typeof installed & { __installed: boolean }).__installed = true;

    expect(isPlaywright(createContext({ playwrightBinding } as Partial<ExtendedWindow>)))
      .toBe(true);
    expect(isPuppeteer(createContext({ puppeteerBinding } as Partial<ExtendedWindow>)))
      .toBe(true);
    expect(isPuppeteer(createContext({ puppeteer_bridge() {} } as Partial<ExtendedWindow>)))
      .toBe(true);
    expect(isAutomationArtifacts(createContext({ exposed: installed } as Partial<ExtendedWindow>)))
      .toBe(true);

    const attributed = createContext({
      document: {
        documentElement: {
          hasAttribute: (name: string) => name === "webdriver",
        },
      } as unknown as Document,
    });
    expect(isAutomationArtifacts(attributed)).toBe(true);

    const throwingFunction = {
      prototype: {
        bind: Function.prototype.bind,
        toString() {
          throw new Error("blocked");
        },
      },
    } as unknown as FunctionConstructor;
    const tampered = detectInstantClient(
      createContext({
        Function: throwingFunction,
        pageFunction() {},
      } as Partial<ExtendedWindow>),
    );
    expect(tampered.isNativeFunctionTampered).toBe(true);

    const throwingPrototype = {
      bind: Function.prototype.bind,
    } as { bind: typeof Function.prototype.bind; toString?: unknown };
    Object.defineProperty(throwingPrototype, "toString", {
      get() {
        throw new Error("blocked getter");
      },
    });
    const throwingGetterFunction = {
      prototype: throwingPrototype,
    } as unknown as FunctionConstructor;
    const getterTampered = detectInstantClient(
      createContext({ Function: throwingGetterFunction }),
    );
    expect(getterTampered.isNativeFunctionTampered).toBe(true);

    const revoked = Proxy.revocable(() => undefined, {});
    revoked.revoke();
    expect(
      isAutomationArtifacts(
        createContext({ revoked: revoked.proxy } as Partial<ExtendedWindow>),
      ),
    ).toBe(false);
  });

  it("detects callSelenium without treating a Phantom wallet as automation", async () => {
    expect(detectInstantClient(createContext({ callSelenium: true })).isSelenium)
      .toBe(true);
    const walletContext = createContext({
      phantom: { solana: {} },
      navigator: {
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({ features: new Set() }),
        },
      } as ExtendedNavigator,
    } as Partial<ExtendedWindow>);
    const wallet = detectInstantClient(walletContext);
    expect(wallet).toMatchObject({
      isPhantomJS: false,
      isAutomationArtifacts: false,
      isLegitClient: true,
      automation: { isAutomated: false, kind: "unknown" },
    });
    const asyncWallet = await detectInstantClientAsync(walletContext);
    expect(asyncWallet).toMatchObject({
      isAutomationArtifacts: false,
      isShaderF16Supported: false,
      isLegitClient: true,
      automation: { isAutomated: false, kind: "unknown" },
    });
    expect(asyncWallet.suspicionScore).toBeCloseTo(0.3);
  });

  it.each([
    { _Selenium_IDE_Recorder: true },
    { _selenium: true },
    { calledSelenium: true },
    { document: { __selenium_evaluate: true } },
    { document: { __selenium_unwrapped: true } },
    { document: { __webdriver_evaluate: true } },
    { document: { __driver_evaluate: true } },
    { document: { __fxdriver_evaluate: true } },
    { document: { __driver_unwrapped: true } },
    { document: { __webdriver_unwrapped: true } },
    { document: { "driver-evaluate": true } },
    { document: { "webdriver-evaluate": true } },
    { document: { webdriverCommand: true } },
    { document: { "webdriver-evaluate-response": true } },
    { document: { webdriver: true } },
    { document: { _Selenium_IDE_Recorder: true } },
    { document: { _selenium: true } },
    { document: { calledSelenium: true } },
    { document: { __webdriverFunc: true } },
    { document: { __lastWatirAlert: true } },
    { document: { __lastWatirConfirm: true } },
    { document: { __lastWatirPrompt: true } },
    { document: { ChromeDriverw: true } },
  ] as Array<Partial<ExtendedWindow>>)("scores Selenium marker %#", (marker) => {
    expect(detectInstantClient(createContext(marker)).isSelenium).toBe(true);
  });

  it("detects a truthy accessor-backed Selenium document marker", () => {
    const context = createContext();
    Object.defineProperty(context.document, "__selenium_evaluate", {
      configurable: true,
      enumerable: true,
      get() {
        return true;
      },
    });

    expect(detectInstantClient(context).isSelenium).toBe(true);
  });

  it("detects Sannysoft's nested document cache marker conservatively", () => {
    expect(
      detectInstantClient(
        createContext({ document: { "$cdc_marker": { cache_: true } } }),
      ).isChromeDriver,
    ).toBe(true);
    expect(
      detectInstantClient(
        createContext({ document: { "$cdc_marker": { cache_: false } } }),
      ).isChromeDriver,
    ).toBe(false);
    expect(
      detectInstantClient(
        createContext({ document: { "$abc_other": { cache_: true } } }),
      ).isChromeDriver,
    ).toBe(false);
    const functionCache = Object.assign(() => undefined, { cache_: true });
    expect(
      detectInstantClient(
        createContext({ document: { "$wdc_function": functionCache } }),
      ).isChromeDriver,
    ).toBe(true);
  });
});

describe("native and identity consistency", () => {
  it("accepts native core functions and no Navigator getter descriptors", () => {
    expect(isNativeFunctionTampered(createContext())).toBe(false);
    expect(isNativeFunctionTampered(createContext({ Function: undefined }))).toBe(false);
  });

  it("detects replaced Function methods and catches deceptive toString failures", () => {
    const fakeFunction = {
      prototype: {
        bind() {},
        toString() {
          return "function toString() {}";
        },
      },
    } as unknown as FunctionConstructor;
    const throwingFunction = {
      prototype: {
        bind() {},
        toString() {
          throw new Error("blocked");
        },
      },
    } as unknown as FunctionConstructor;
    const malformedFunction = {
      prototype: { bind() {}, toString: "not-a-function" },
    } as unknown as FunctionConstructor;
    const malformedBind = {
      prototype: {
        bind: "not-a-function",
        toString: Function.prototype.toString,
      },
    } as unknown as FunctionConstructor;

    expect(isNativeFunctionTampered(createContext({ Function: fakeFunction }))).toBe(true);
    expect(isNativeFunctionTampered(createContext({ Function: throwingFunction }))).toBe(true);
    expect(isNativeFunctionTampered(createContext({ Function: malformedFunction }))).toBe(true);
    expect(
      detectInstantClient(createContext({ Function: malformedFunction }))
        .isNativeFunctionTampered,
    ).toBe(true);
    expect(isNativeFunctionTampered(createContext({ Function: malformedBind })))
      .toBe(true);
  });

  it("detects patched Navigator getters but accepts native getters", () => {
    const patchedPrototype = Object.create(
      Object.getPrototypeOf(createContext().navigator),
      {
        languages: {
          configurable: true,
          get() {
            return ["en-US"];
          },
        },
      },
    );
    const patched = createContext();
    const { languages: _patchedLanguages, ...patchedValues } = patched.navigator;
    patched.navigator = Object.assign(
      Object.create(patchedPrototype),
      patchedValues,
    ) as ExtendedNavigator;

    const nativeGetter = Object.getOwnPropertyDescriptor(
      Map.prototype,
      "size",
    )?.get;
    const nativePrototype = Object.create(
      Object.getPrototypeOf(createContext().navigator),
      {
        plugins: { configurable: true, get: nativeGetter },
      },
    );
    const native = createContext();
    const { plugins: _nativePlugins, ...nativeValues } = native.navigator;
    native.navigator = Object.assign(
      Object.create(nativePrototype),
      nativeValues,
    ) as ExtendedNavigator;

    expect(isNativeFunctionTampered(patched)).toBe(true);
    expect(isNativeFunctionTampered(native)).toBe(false);

    const absent = createContext();
    delete (absent.navigator as Partial<ExtendedNavigator>).hardwareConcurrency;
    delete (absent.navigator as Partial<ExtendedNavigator>).languages;
    delete (absent.navigator as Partial<ExtendedNavigator>).plugins;
    expect(isNativeFunctionTampered(absent)).toBe(false);
  });

  it("detects a prototype webdriver getter patched to return false", () => {
    const context = createContext();
    const patchedPrototype = Object.create(Object.getPrototypeOf(context.navigator));
    Object.defineProperty(patchedPrototype, "webdriver", {
      configurable: true,
      get() {
        return false;
      },
    });
    context.navigator = Object.assign(
      Object.create(patchedPrototype),
      context.navigator,
    ) as ExtendedNavigator;

    expect(context.navigator.webdriver).toBe(false);
    expect(isNativeFunctionTampered(context)).toBe(true);
  });

  it("detects an invalid webdriver descriptor shape on a real Navigator", () => {
    const withDescriptor = (descriptor: PropertyDescriptor) => {
      const context = createContext();
      const prototype = Object.create(Object.getPrototypeOf(context.navigator));
      Object.defineProperty(prototype, "webdriver", descriptor);
      context.navigator = Object.assign(
        Object.create(prototype),
        context.navigator,
      ) as ExtendedNavigator;
      Object.defineProperty(context.navigator, Symbol.toStringTag, {
        value: "Navigator",
      });
      return context;
    };
    const getter = () => false;

    expect(
      isSuspiciousWebDriverDescriptor(
        withDescriptor({ value: false, enumerable: true, configurable: true }),
      ),
    ).toBe(true);
    expect(
      isSuspiciousWebDriverDescriptor(
        withDescriptor({
          get: getter,
          set: () => undefined,
          enumerable: true,
          configurable: true,
        }),
      ),
    ).toBe(true);
    expect(
      isSuspiciousWebDriverDescriptor(
        withDescriptor({ get: getter, enumerable: false, configurable: true }),
      ),
    ).toBe(true);
    expect(
      isSuspiciousWebDriverDescriptor(
        withDescriptor({ get: getter, enumerable: true, configurable: false }),
      ),
    ).toBe(true);
    expect(
      isSuspiciousWebDriverDescriptor(
        withDescriptor({ get: getter, enumerable: true, configurable: true }),
      ),
    ).toBe(false);
  });

  it.each([
    [CHROME_UA, "Apple Computer, Inc.", "Win32"],
    ["Mozilla/5.0 Firefox/128.0", "Google Inc.", "Linux x86_64"],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Version/17.0 Safari/605.1.15",
      "Google Inc.",
      "MacIntel",
    ],
    [CHROME_UA, "Google Inc.", "Linux x86_64"],
    ["Mozilla/5.0 (Linux; Android 14) Chrome/121.0 Mobile", "Google Inc.", "Win32"],
    ["Mozilla/5.0 (X11; CrOS x86_64) Chrome/121.0", "Google Inc.", "Win32"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", "Apple Computer, Inc.", "Win32"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", "Apple Computer, Inc.", "Win32"],
    ["Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0", "", "Win32"],
  ])("detects UA identity contradiction %#", (userAgent, vendor, platform) => {
    expect(
      isNavigatorIdentityInconsistent(
        createContext({ navigator: { userAgent, vendor, platform } as ExtendedNavigator }),
      ),
    ).toBe(true);
  });

  it("detects productSub and mobile touch contradictions", () => {
    expect(
      isNavigatorIdentityInconsistent(
        createContext({ navigator: { productSub: "" } as ExtendedNavigator }),
      ),
    ).toBe(true);
    expect(
      isNavigatorIdentityInconsistent(
        createContext({
          navigator: {
            userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/121 Mobile",
            vendor: "Google Inc.",
            platform: "Linux armv8l",
            productSub: "20030107",
            maxTouchPoints: 0,
          } as ExtendedNavigator,
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ["custom-agent", "Somewhere", undefined],
    [CHROME_UA, "Win32", 0],
    ["Mozilla/5.0 (Linux; Android 14) Chrome/121 Mobile", "Linux armv8l", 5],
    ["Mozilla/5.0 (X11; CrOS x86_64) Chrome/121", "Linux x86_64", 0],
    ["Mozilla/5.0 (iPad; CPU OS 17_0)", "MacIntel", 5],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", "MacIntel", 0],
    ["Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0", "Linux x86_64", 0],
  ])("accepts compatible identity %#", (userAgent, platform, maxTouchPoints) => {
    const vendor = /Firefox/.test(userAgent)
      ? ""
      : /Safari/.test(userAgent) && !/Chrome/.test(userAgent)
        ? "Apple Computer, Inc."
        : "Google Inc.";
    expect(
      isNavigatorIdentityInconsistent(
        createContext({
          navigator: {
            userAgent,
            vendor,
            platform,
            productSub: /Chrome|Safari/.test(userAgent) ? "20030107" : undefined,
            maxTouchPoints,
          } as ExtendedNavigator,
        }),
      ),
    ).toBe(false);
  });
});

describe("plugin, iframe, stack, and soft consistency checks", () => {
  it("validates PluginArray and MimeTypeArray containers and entries", () => {
    class PluginArrayMock extends Array<Plugin> {}
    class MimeTypeArrayMock extends Array<MimeType> {}
    class PluginMock {
      toString() {
        return "[object Plugin]";
      }
    }
    class MimeTypeMock {}

    const missing = createContext({
      navigator: { plugins: undefined, mimeTypes: undefined } as unknown as ExtendedNavigator,
    });
    expect(isPluginArrayInconsistent(missing)).toBe(false);

    expect(
      isPluginArrayInconsistent(
        createContext({ PluginArray: PluginArrayMock as unknown as ExtendedWindow["PluginArray"] }),
      ),
    ).toBe(true);
    expect(
      isPluginArrayInconsistent(
        createContext({ MimeTypeArray: MimeTypeArrayMock as unknown as ExtendedWindow["MimeTypeArray"] }),
      ),
    ).toBe(true);

    const wrongPlugin = createContext({
      Plugin: PluginMock as unknown as ExtendedWindow["Plugin"],
      navigator: { plugins: { 0: {}, length: 1 } } as unknown as ExtendedNavigator,
    });
    const wrongMime = createContext({
      MimeType: MimeTypeMock as unknown as ExtendedWindow["MimeType"],
      navigator: { mimeTypes: { 0: {}, length: 1 } } as unknown as ExtendedNavigator,
    });
    expect(isPluginArrayInconsistent(wrongPlugin)).toBe(true);
    expect(isPluginArrayInconsistent(wrongMime)).toBe(true);

    const valid = createContext({
      PluginArray: PluginArrayMock as unknown as ExtendedWindow["PluginArray"],
      MimeTypeArray: MimeTypeArrayMock as unknown as ExtendedWindow["MimeTypeArray"],
      Plugin: PluginMock as unknown as ExtendedWindow["Plugin"],
      MimeType: MimeTypeMock as unknown as ExtendedWindow["MimeType"],
      navigator: {
        plugins: new PluginArrayMock(new PluginMock() as Plugin),
        mimeTypes: new MimeTypeArrayMock(new MimeTypeMock() as MimeType),
      } as unknown as ExtendedNavigator,
    });
    expect(isPluginArrayInconsistent(valid)).toBe(false);

    const badPluginString = new PluginMock();
    badPluginString.toString = () => "[object Object]";
    expect(
      isPluginArrayInconsistent(
        createContext({
          navigator: {
            plugins: { 0: badPluginString, length: 1 },
          } as unknown as ExtendedNavigator,
        }),
      ),
    ).toBe(true);

    const throwingPluginString = new PluginMock();
    throwingPluginString.toString = () => {
      throw new Error("blocked plugin toString");
    };
    expect(
      isPluginArrayInconsistent(
        createContext({
          navigator: {
            plugins: { 0: throwingPluginString, length: 1 },
          } as unknown as ExtendedNavigator,
        }),
      ),
    ).toBe(true);
  });

  function iframeContext(
    childOverrides: Partial<Navigator> = {},
    append = vi.fn(),
  ) {
    const context = createContext();
    const remove = vi.fn();
    const child = { ...context.navigator, ...childOverrides } as Navigator;
    const iframe = {
      style: {},
      contentWindow: { navigator: child, chrome: {} },
      remove,
    };
    context.document = {
      documentElement: { appendChild: append },
      createElement: vi.fn().mockReturnValue(iframe),
    } as unknown as Document;
    return { context, iframe, remove };
  }

  it("compares fresh iframe Navigator values and cleans up", () => {
    const consistent = iframeContext();
    expect(isIframeInconsistent(consistent.context)).toBe(false);
    expect(consistent.remove).toHaveBeenCalledOnce();

    // `webdriver` is browser-set, so a single difference is already decisive.
    expect(isIframeInconsistent(iframeContext({ webdriver: true }).context)).toBe(
      true,
    );

    // One drifting Navigator value is what an extension does, not a spoofer.
    for (const overrides of [
      { userAgent: "different" },
      { platform: "Linux" },
      { languages: ["sv-SE"] },
    ]) {
      expect(isIframeInconsistent(iframeContext(overrides).context)).toBe(false);
    }

    // Opera reduces hardwareConcurrency in the top document only, so realm
    // drift there never counts — not even alongside another difference.
    expect(
      isIframeInconsistent(iframeContext({ hardwareConcurrency: 99 }).context),
    ).toBe(false);
    expect(
      isIframeInconsistent(
        iframeContext({ hardwareConcurrency: 99, platform: "Linux" }).context,
      ),
    ).toBe(false);

    // Two or more of the remaining values together are a spoofed persona.
    for (const overrides of [
      { userAgent: "different", platform: "Linux" },
      { languages: ["sv-SE"], platform: "Linux" },
      { userAgent: "different", languages: ["sv-SE"] },
    ]) {
      expect(isIframeInconsistent(iframeContext(overrides).context)).toBe(true);
    }
  });

  it("detects proxied iframe realms and ignores iframe Chrome state", () => {
    const sharedNavigator = iframeContext();
    sharedNavigator.iframe.contentWindow.navigator = sharedNavigator.context.navigator;
    expect(isIframeInconsistent(sharedNavigator.context)).toBe(true);

    const sharedTimer = iframeContext();
    Object.assign(sharedTimer.iframe.contentWindow, {
      setTimeout: sharedTimer.context.setTimeout,
    });
    expect(isIframeInconsistent(sharedTimer.context)).toBe(true);

    const selfGetHook = iframeContext();
    Object.assign(selfGetHook.iframe.contentWindow, {
      self: { get() {} },
    });
    expect(isIframeInconsistent(selfGetHook.context)).toBe(true);

    const sharedWindow = iframeContext();
    sharedWindow.iframe.contentWindow = sharedWindow.context as unknown as {
      navigator: Navigator;
      chrome: object;
    };
    expect(isIframeInconsistent(sharedWindow.context)).toBe(true);

    // Chromium forks and Electron legitimately omit `chrome` on a fresh
    // about:blank frame, so its absence there is not evidence of anything.
    const missingChrome = iframeContext();
    delete (missingChrome.iframe.contentWindow as { chrome?: object }).chrome;
    expect(isIframeInconsistent(missingChrome.context)).toBe(false);
  });

  it("treats unavailable or blocked iframes as not applicable", () => {
    expect(isIframeInconsistent(createContext())).toBe(false);
    const noFrame = iframeContext();
    noFrame.iframe.contentWindow = null as unknown as Window;
    expect(isIframeInconsistent(noFrame.context)).toBe(false);
    expect(
      isIframeInconsistent(
        iframeContext({}, () => {
          throw new Error("blocked");
        }).context,
      ),
    ).toBe(false);
  });

  it("detects automation stack markers and handles unavailable stacks", () => {
    class AutomationError extends Error {
      override stack = "at pptr:evaluate";
    }
    class ThrowingError extends Error {
      constructor() {
        super();
        throw new Error("blocked");
      }
    }
    class StacklessError extends Error {
      override stack = undefined;
    }
    class DocumentationError extends Error {
      override stack =
        "at PuppeteerGuide (https://example.test/docs/PhantomJS-migration.js:1:1)";
    }

    expect(isErrorStackAutomation(createContext())).toBe(false);
    expect(isErrorStackAutomation(createContext({ Error: undefined }))).toBe(false);
    expect(
      isErrorStackAutomation(
        createContext({ Error: AutomationError as ErrorConstructor }),
      ),
    ).toBe(true);
    expect(
      isErrorStackAutomation(createContext({ Error: ThrowingError as ErrorConstructor })),
    ).toBe(false);
    expect(
      isErrorStackAutomation(createContext({ Error: StacklessError as ErrorConstructor })),
    ).toBe(false);
    expect(
      isErrorStackAutomation(
        createContext({ Error: DocumentationError as ErrorConstructor }),
      ),
    ).toBe(false);
  });

  it("detects zero outer window dimensions", () => {
    expect(
      isSuspiciousWindowDimensions(
        createContext({ outerWidth: 0, outerHeight: 0 }),
      ),
    ).toBe(true);
  });

  it("flags an empty languages list even when language is also empty", () => {
    expect(
      isLanguageInconsistent(
        createContext({
          navigator: { language: "", languages: [] } as unknown as ExtendedNavigator,
        }),
      ),
    ).toBe(true);
  });

  it("recognizes common default viewports", () => {
    expect(
      isDefaultAutomationViewport(
        createContext({ screen: { width: 800, height: 600 } as Screen }),
      ),
    ).toBe(true);
    expect(
      isDefaultAutomationViewport(
        createContext({ innerWidth: 1280, innerHeight: 720 }),
      ),
    ).toBe(true);
    expect(isDefaultAutomationViewport(createContext())).toBe(false);
  });

  it("detects implausible hardware combinations", () => {
    // Off the power-of-two grid every engine quantises deviceMemory to.
    expect(isSuspiciousHardware(createContext({ navigator: { deviceMemory: 6 } as ExtendedNavigator }))).toBe(true);
    expect(isSuspiciousHardware(createContext({ navigator: { deviceMemory: 128 } as ExtendedNavigator }))).toBe(true);
    // Workstations really do report 32 GB, so a large quantised value is fine.
    expect(isSuspiciousHardware(createContext({ navigator: { deviceMemory: 32 } as ExtendedNavigator }))).toBe(false);
    expect(isSuspiciousHardware(createContext({ navigator: { hardwareConcurrency: 129 } as ExtendedNavigator }))).toBe(true);
    expect(isSuspiciousHardware(createContext({ navigator: { hardwareConcurrency: 8.5 } as ExtendedNavigator }))).toBe(true);
    expect(isSuspiciousHardware(createContext({ navigator: { hardwareConcurrency: 0 } as ExtendedNavigator }))).toBe(true);
    expect(isSuspiciousHardware(createContext({ navigator: { hardwareConcurrency: 40, deviceMemory: 2 } as ExtendedNavigator }))).toBe(true);
    expect(isSuspiciousHardware(createContext({ navigator: { hardwareConcurrency: 40, deviceMemory: 8 } as ExtendedNavigator }))).toBe(false);
    expect(isSuspiciousHardware(createContext({ navigator: { hardwareConcurrency: 40, deviceMemory: undefined } as ExtendedNavigator }))).toBe(false);
    expect(isSuspiciousHardware(createContext())).toBe(false);
  });

  it("treats zero RTT as a soft desktop-only signal", () => {
    expect(isZeroConnectionRtt(createContext({ navigator: { connection: { rtt: 0 } } as ExtendedNavigator }))).toBe(true);
    expect(
      isZeroConnectionRtt(
        createContext({
          navigator: {
            userAgent: "Mozilla/5.0 (Linux; Android 14)",
            connection: { rtt: 0 },
          } as ExtendedNavigator,
        }),
      ),
    ).toBe(false);
    expect(isZeroConnectionRtt(createContext())).toBe(false);
    expect(isZeroConnectionRtt(createContext({ navigator: { connection: undefined } as ExtendedNavigator }))).toBe(false);
  });

  it("detects modified canvas pixels and handles unavailable canvas reads", () => {
    const canvasContext = (data: number[] | null) =>
      data === null
        ? null
        : {
            clearRect: vi.fn(),
            fillStyle: "",
            fillRect: vi.fn(),
            getImageData: vi.fn().mockReturnValue({ data }),
          };
    const withCanvas = (data: number[] | null) => {
      const context = createContext();
      context.document.createElement = vi.fn().mockReturnValue({
        getContext: vi.fn().mockReturnValue(canvasContext(data)),
      });
      return context;
    };

    expect(isCanvasTampered(withCanvas([17, 34, 51, 255]))).toBe(false);
    // Colour management and fingerprint-protection noise stay inside the band.
    expect(isCanvasTampered(withCanvas([18, 35, 52, 254]))).toBe(false);
    expect(isCanvasTampered(withCanvas([25, 42, 59, 247]))).toBe(false);
    // A rewritten readback lands far outside it.
    expect(isCanvasTampered(withCanvas([26, 34, 51, 255]))).toBe(true);
    expect(isCanvasTampered(withCanvas([17, 43, 51, 255]))).toBe(true);
    expect(isCanvasTampered(withCanvas([17, 34, 60, 255]))).toBe(true);
    expect(isCanvasTampered(withCanvas([17, 34, 51, 246]))).toBe(true);
    expect(isCanvasTampered(withCanvas([0, 0, 0, 0]))).toBe(true);
    expect(isCanvasTampered(withCanvas(null))).toBe(false);
    const blocked = createContext();
    blocked.document.createElement = vi.fn(() => {
      throw new Error("blocked");
    });
    expect(isCanvasTampered(blocked)).toBe(false);
  });
});

describe("async realm and browser checks", () => {
  it("keeps the legacy boolean buildInstantSignals argument compatible", () => {
    const result = detectInstantClient(createContext());
    const checks = result as Parameters<typeof buildInstantSignals>[0];
    const legacyChecks = { ...checks } as Record<string, boolean>;
    for (const id of [
      "isNativeFunctionTampered",
      "isNavigatorIdentityInconsistent",
      "isPluginArrayInconsistent",
      "isIframeInconsistent",
      "isErrorStackAutomation",
      "isDefaultAutomationViewport",
      "isSuspiciousHardware",
      "isZeroConnectionRtt",
      "isCanvasTampered",
    ]) {
      delete legacyChecks[id];
    }

    expect(
      buildInstantSignals(checks, false).find(
        (signal) => signal.id === "isShaderF16Supported",
      ),
    ).toMatchObject({ triggered: true });
    expect(
      buildInstantSignals(checks, true).some(
        (signal) => signal.id === "isShaderF16Supported",
      ),
    ).toBe(false);
    expect(buildInstantSignals(checks, null)).toHaveLength(result.signals.length);
    expect(
      buildInstantSignals(
        legacyChecks as Parameters<typeof buildInstantSignals>[0],
      ).filter((signal) => signal.triggered),
    ).toEqual([]);
  });

  it("detects CDP serialization and handles unavailable/throwing consoles", async () => {
    await expect(checkCdpRuntime(createContext({ console: undefined }))).resolves.toBeNull();
    await expect(
      checkCdpRuntime(createContext({ console: { debug: vi.fn() } as unknown as Console })),
    ).resolves.toBe(false);
    await expect(
      checkCdpRuntime(
        createContext({
          console: {
            debug(value: Error) {
              void value.stack;
            },
          } as unknown as Console,
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      checkCdpRuntime(
        createContext({
          console: {
            debug(value: Error) {
              setTimeout(() => void value.stack, 0);
            },
          } as unknown as Console,
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      checkCdpRuntime(
        createContext({
          navigator: {
            userAgent: "Mozilla/5.0 Firefox/128.0",
          } as ExtendedNavigator,
          console: {
            debug(value: Error) {
              void value.stack;
            },
          } as unknown as Console,
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      checkCdpRuntime(
        createContext({
          console: {
            debug() {
              throw new Error("blocked");
            },
          } as unknown as Console,
        }),
      ),
    ).resolves.toBeNull();
  });

  it("keeps CDP-only evidence below the default blocking threshold", () => {
    const checks = detectInstantClient(createContext()) as Parameters<
      typeof buildInstantSignals
    >[0];
    const signals = buildInstantSignals(checks, {
      isShaderF16Supported: false,
      isCdpDetected: true,
      isCdpDetectedInWorker: true,
    });

    expect(aggregateInstantSuspicionScore(signals)).toBeLessThan(0.5);
    expect(
      signals.filter(({ id }) =>
        id === "isCdpDetected" || id === "isCdpDetectedInWorker"
      ),
    ).toHaveLength(1);

    expect(
      buildInstantSignals(checks, {
        isCdpDetected: false,
        isCdpDetectedInWorker: true,
      }).find(({ id }) => id === "isCdpDetectedInWorker"),
    ).toMatchObject({ triggered: true, weight: 0.25 });
  });

  it("compares Notification and Permissions states", async () => {
    const withPermissions = (
      permission: NotificationPermission,
      query: () => Promise<{ state: PermissionState }>,
    ) =>
      createContext({
        Notification: { permission } as typeof Notification,
        navigator: {
          permissions: { query } as unknown as Permissions,
        } as ExtendedNavigator,
      });

    await expect(checkNotificationPermissionConsistency(createContext())).resolves.toBeNull();
    await expect(
      checkNotificationPermissionConsistency(
        createContext({ navigator: { permissions: {} } as ExtendedNavigator }),
      ),
    ).resolves.toBeNull();
    await expect(
      checkNotificationPermissionConsistency(
        withPermissions("default", async () => ({ state: "prompt" })),
      ),
    ).resolves.toBe(false);
    await expect(
      checkNotificationPermissionConsistency(
        withPermissions("denied", async () => ({ state: "prompt" })),
      ),
    ).resolves.toBe(true);
    await expect(
      checkNotificationPermissionConsistency(
        withPermissions("granted", async () => {
          throw new Error("blocked");
        }),
      ),
    ).resolves.toBeNull();
  });

  function withHighEntropy(
    userAgent: string,
    values?: Record<string, unknown>,
    reject = false,
  ) {
    return createContext({
      navigator: {
        userAgent,
        userAgentData: {
          brands: [],
          getHighEntropyValues: reject
            ? vi.fn().mockRejectedValue(new Error("blocked"))
            : vi.fn().mockResolvedValue(values ?? {}),
        },
      } as ExtendedNavigator,
    });
  }

  it("compares high-entropy version and mobile values", async () => {
    await expect(checkHighEntropyUserAgentData(createContext())).resolves.toBeNull();
    await expect(
      checkHighEntropyUserAgentData(
        createContext({ navigator: { userAgentData: { brands: [] } } as ExtendedNavigator }),
      ),
    ).resolves.toBeNull();
    await expect(
      checkHighEntropyUserAgentData(
        withHighEntropy(CHROME_UA, {
          fullVersionList: [{ brand: "Chromium", version: "149.0.0.0" }],
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      checkHighEntropyUserAgentData(
        withHighEntropy(CHROME_UA, {
          fullVersionList: [
            { brand: "Not A Brand", version: "99" },
            { brand: "Chromium", version: "121.0.0.0" },
          ],
          mobile: false,
          platform: "Windows",
        }),
      ),
    ).resolves.toBe(false);
    await expect(
      checkHighEntropyUserAgentData(withHighEntropy(CHROME_UA, { mobile: true })),
    ).resolves.toBe(true);
    await expect(
      checkHighEntropyUserAgentData(withHighEntropy(CHROME_UA, {}, true)),
    ).resolves.toBeNull();
  });

  it.each([
    ["Mozilla/5.0 (Linux; Android 14) Chrome/121 Mobile", "Windows"],
    ["Mozilla/5.0 (X11; CrOS x86_64) Chrome/121", "Linux"],
    [CHROME_UA, "Linux"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/121", "Windows"],
    ["Mozilla/5.0 (X11; Linux x86_64) Chrome/121", "Windows"],
  ])("detects high-entropy platform conflict %#", async (userAgent, platform) => {
    await expect(
      checkHighEntropyUserAgentData(withHighEntropy(userAgent, { platform })),
    ).resolves.toBe(true);
  });

  it("ignores high-entropy platform when the UA has no comparable OS", async () => {
    await expect(
      checkHighEntropyUserAgentData(withHighEntropy("custom-agent", { platform: "Other" })),
    ).resolves.toBe(false);
  });

  it("returns null when workers or blob URLs are unavailable", async () => {
    await expect(checkWorkerConsistency(createContext())).resolves.toEqual({
      isWorkerInconsistent: null,
      isCdpDetectedInWorker: null,
    });
    await expect(
      checkWorkerConsistency(createContext({ Worker: class {} as unknown as typeof Worker })),
    ).resolves.toEqual({ isWorkerInconsistent: null, isCdpDetectedInWorker: null });
    await expect(
      checkWorkerConsistency(
        createContext({
          Worker: class {} as unknown as typeof Worker,
          Blob,
          URL: {} as typeof URL,
        }),
      ),
    ).resolves.toEqual({ isWorkerInconsistent: null, isCdpDetectedInWorker: null });
  });

  it("returns null when worker construction fails", async () => {
    const { context } = createWorkerContext();
    const revokeObjectURL = context.URL?.revokeObjectURL as ReturnType<typeof vi.fn>;
    context.Worker = class {
      constructor() {
        throw new Error("blocked");
      }
    } as unknown as typeof Worker;
    await expect(checkWorkerConsistency(context)).resolves.toEqual({
      isWorkerInconsistent: null,
      isCdpDetectedInWorker: null,
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:worker");
  });

  it("returns null when worker blob creation fails", async () => {
    const { context } = createWorkerContext();
    context.Blob = class {
      constructor() {
        throw new Error("blocked");
      }
    } as unknown as typeof Blob;
    await expect(checkWorkerConsistency(context)).resolves.toEqual({
      isWorkerInconsistent: null,
      isCdpDetectedInWorker: null,
    });
  });

  it("compares worker values, captures CDP, and cleans resources", async () => {
    const { context, revokeObjectURL, WorkerMock } = createWorkerContext();
    const resultPromise = checkWorkerConsistency(context);
    const worker = WorkerMock.instances.at(-1)!;
    worker.onmessage?.({
      data: { ...cleanWorkerSnapshot(context), cdpDetected: true },
    } as MessageEvent);

    await expect(resultPromise).resolves.toEqual({
      isWorkerInconsistent: false,
      isCdpDetectedInWorker: true,
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:worker");
  });

  it("does not report worker CDP outside Chromium", async () => {
    const { context, WorkerMock } = createWorkerContext();
    context.navigator.userAgent = "Mozilla/5.0 Firefox/128.0";
    const resultPromise = checkWorkerConsistency(context);
    WorkerMock.instances.at(-1)!.onmessage?.({
      data: { ...cleanWorkerSnapshot(context), cdpDetected: true },
    } as MessageEvent);

    await expect(resultPromise).resolves.toMatchObject({
      isWorkerInconsistent: false,
      isCdpDetectedInWorker: null,
    });
  });

  it("starts independent async checks while WebGPU is still pending", async () => {
    let releaseAdapter: (() => void) | undefined;
    const adapter = new Promise<{ features: Set<string> }>((resolve) => {
      releaseAdapter = () => resolve({ features: new Set(["shader-f16"]) });
    });
    const query = vi.fn().mockResolvedValue({ state: "prompt" });
    const context = createContext({
      Notification: { permission: "default" } as typeof Notification,
      navigator: {
        gpu: { requestAdapter: vi.fn().mockReturnValue(adapter) },
        permissions: { query } as unknown as Permissions,
      } as ExtendedNavigator,
    });

    const resultPromise = detectInstantClientAsync(context);
    expect(query).toHaveBeenCalledOnce();
    releaseAdapter?.();
    await expect(resultPromise).resolves.toMatchObject({
      isShaderF16Supported: true,
      isNotificationPermissionInconsistent: false,
    });
  });

  it("recognizes conservative bot and automation User-Agent tokens", () => {
    expect(isBotUserAgent(undefined)).toBe(false);
    expect(isBotUserAgent("Mozilla/5.0 Chrome/121 Safari/537.36")).toBe(false);
    expect(isBotUserAgent("Mozilla/5.0 NotGooglebot/1.0")).toBe(false);
    expect(isBotUserAgent("Mozilla/5.0 MySelenium/4.0")).toBe(false);
    expect(
      isBotUserAgent(
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      ),
    ).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 Puppeteer/24.0")).toBe(true);
    expect(
      isBotUserAgent("AdsBot-Google (+http://www.google.com/adsbot.html)"),
    ).toBe(true);
    expect(
      isBotUserAgent(
        "Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 Mobile Safari/537.36 (compatible; AdsBot-Google-Mobile; +http://www.google.com/mobile/adsbot.html)",
      ),
    ).toBe(true);
    expect(isBotUserAgent("Google-InspectionTool/1.0")).toBe(true);
    expect(isBotUserAgent("GoogleOther")).toBe(true);
    expect(isBotUserAgent("GoogleOther-Image/1.0")).toBe(true);
    expect(isBotUserAgent("Wget/1.21.4")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 MyWget/1.21.4")).toBe(false);
    expect(isBotUserAgent("Mozilla/5.0 GoogleOtherwise/1.0")).toBe(false);

    const result = detectInstantClient(
      createContext({
        navigator: {
          userAgent:
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        } as ExtendedNavigator,
      }),
    );
    expect(result).toMatchObject({
      isUserAgentValid: false,
      isLegitClient: false,
      automation: { isAutomated: true, kind: "unknown", confidence: "high" },
    });
    expect(
      detectInstantClient(
        createContext({
          navigator: {
            userAgent: "Mozilla/5.0 Puppeteer/24.0",
          } as ExtendedNavigator,
        }),
      ).automation.kind,
    ).toBe("puppeteer");
  });

  it("normalizes a missing main-realm languages array for worker comparison", async () => {
    const { context, WorkerMock } = createWorkerContext();
    context.navigator.languages = undefined as unknown as string[];
    const resultPromise = checkWorkerConsistency(context);
    WorkerMock.instances.at(-1)!.onmessage?.({
      data: {
        userAgent: context.navigator.userAgent,
        language: context.navigator.language,
        languages: [],
        platform: context.navigator.platform,
        hardwareConcurrency: context.navigator.hardwareConcurrency,
        cdpDetected: false,
      },
    } as MessageEvent);
    await expect(resultPromise).resolves.toMatchObject({
      isWorkerInconsistent: false,
    });
  });

  it.each([
    { userAgent: "different", platform: "Linux" },
    { language: "sv-SE", languages: ["sv-SE"], platform: "Linux" },
    { userAgent: "different", languages: ["sv-SE"] },
  ])("detects worker Navigator mismatch %#", async (override) => {
    const { context, WorkerMock } = createWorkerContext();
    const resultPromise = checkWorkerConsistency(context);
    WorkerMock.instances.at(-1)!.onmessage?.({
      data: { ...cleanWorkerSnapshot(context), ...override, cdpDetected: "invalid" },
    } as unknown as MessageEvent);
    await expect(resultPromise).resolves.toEqual({
      isWorkerInconsistent: true,
      isCdpDetectedInWorker: null,
    });
  });

  it.each([
    { userAgent: "different" },
    { language: "sv-SE", languages: ["sv-SE"] },
    { platform: "Linux" },
    // Opera reports a reduced core count to the document but not to workers.
    { hardwareConcurrency: 99 },
    { hardwareConcurrency: 99, platform: "Linux" },
  ])("tolerates worker differences a stock browser produces %#", async (override) => {
    const { context, WorkerMock } = createWorkerContext();
    const resultPromise = checkWorkerConsistency(context);
    WorkerMock.instances.at(-1)!.onmessage?.({
      data: { ...cleanWorkerSnapshot(context), ...override, cdpDetected: false },
    } as unknown as MessageEvent);
    await expect(resultPromise).resolves.toMatchObject({
      isWorkerInconsistent: false,
    });
  });

  it("handles worker errors and timeouts", async () => {
    const failed = createWorkerContext();
    const failedPromise = checkWorkerConsistency(failed.context);
    failed.WorkerMock.instances.at(-1)!.onerror?.();
    await expect(failedPromise).resolves.toEqual({
      isWorkerInconsistent: null,
      isCdpDetectedInWorker: null,
    });

    vi.useFakeTimers();
    try {
      const timedOut = createWorkerContext();
      const timedOutPromise = checkWorkerConsistency(timedOut.context);
      await vi.advanceTimersByTimeAsync(500);
      await expect(timedOutPromise).resolves.toEqual({
        isWorkerInconsistent: null,
        isCdpDetectedInWorker: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("scores every async contradiction through the result", async () => {
    const context = withHighEntropy(CHROME_UA, {
      fullVersionList: [{ brand: "Chromium", version: "149" }],
    });
    context.console = {
      debug(value: Error) {
        void value.stack;
      },
    } as unknown as Console;
    context.Notification = { permission: "denied" } as typeof Notification;
    context.navigator.permissions = {
      query: vi.fn().mockResolvedValue({ state: "prompt" }),
    } as unknown as Permissions;
    context.navigator.gpu = {
      requestAdapter: vi.fn().mockResolvedValue({ features: new Set<string>() }),
    };

    const result = await detectInstantClientAsync(context);
    expect(result).toMatchObject({
      isShaderF16Supported: false,
      isCdpDetected: true,
      isNotificationPermissionInconsistent: true,
      isHighEntropyUserAgentDataMismatch: true,
      isWorkerInconsistent: null,
      isCdpDetectedInWorker: null,
      isLegitClient: false,
    });
    expect(result.signals.map((signal) => signal.id)).toEqual(
      expect.arrayContaining([
        "isShaderF16Supported",
        "isCdpDetected",
        "isNotificationPermissionInconsistent",
        "isHighEntropyUserAgentDataMismatch",
      ]),
    );
  });
});

describe("engine, GPU, and display consistency", () => {
  const FIREFOX_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";
  const SAFARI_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
  const IPHONE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0 Mobile/15E148 Safari/604.1";

  /** V8 prints native sources on one line (33 chars); JSC and SpiderMonkey use three (37). */
  function evalOfLength(length: number) {
    const source = "x".repeat(length);
    return Object.assign(() => undefined, { toString: () => source });
  }

  it("accepts an engine that matches the claimed browser", () => {
    expect(
      isEngineInconsistent(
        createContext({ eval: evalOfLength(33) } as Partial<ExtendedWindow>),
      ),
    ).toBe(false);
    expect(
      isEngineInconsistent(
        createContext({
          eval: evalOfLength(37),
          InternalError: class extends Error {},
          navigator: { userAgent: FIREFOX_UA } as ExtendedNavigator,
        } as Partial<ExtendedWindow>),
      ),
    ).toBe(false);
    expect(
      isEngineInconsistent(
        createContext({
          eval: evalOfLength(37),
          navigator: { userAgent: SAFARI_UA } as ExtendedNavigator,
        } as Partial<ExtendedWindow>),
      ),
    ).toBe(false);
  });

  it("flags a native eval shape from another engine", () => {
    expect(
      isEngineInconsistent(
        createContext({ eval: evalOfLength(37) } as Partial<ExtendedWindow>),
      ),
    ).toBe(true);
    expect(
      isEngineInconsistent(
        createContext({
          eval: evalOfLength(33),
          InternalError: class extends Error {},
          navigator: { userAgent: FIREFOX_UA } as ExtendedNavigator,
        } as Partial<ExtendedWindow>),
      ),
    ).toBe(true);
  });

  it("flags SpiderMonkey globals that contradict the user agent", () => {
    expect(
      isEngineInconsistent(
        createContext({
          mozInnerScreenX: 0,
        } as Partial<ExtendedWindow>),
      ),
    ).toBe(true);
    // Firefox UA without any Gecko-only global.
    expect(
      isEngineInconsistent(
        createContext({
          navigator: { userAgent: FIREFOX_UA } as ExtendedNavigator,
        }),
      ),
    ).toBe(true);
  });

  it("treats iOS browsers as WebKit whatever brand they claim", () => {
    expect(
      isEngineInconsistent(
        createContext({
          eval: evalOfLength(37),
          navigator: { userAgent: IPHONE_UA } as ExtendedNavigator,
        } as Partial<ExtendedWindow>),
      ),
    ).toBe(false);
  });

  it("ignores unknown user agents, missing eval, and wrapped eval", () => {
    expect(
      isEngineInconsistent(
        createContext({
          navigator: { userAgent: "curl/8.6.0" } as ExtendedNavigator,
        }),
      ),
    ).toBe(false);
    expect(isEngineInconsistent(createContext())).toBe(false);
    expect(
      isEngineInconsistent(
        createContext({ eval: evalOfLength(64) } as Partial<ExtendedWindow>),
      ),
    ).toBe(false);
    const hostile = createContext({
      eval: Object.assign(() => undefined, {
        toString() {
          throw new Error("blocked");
        },
      }),
    } as Partial<ExtendedWindow>);
    expect(isEngineInconsistent(hostile)).toBe(false);
  });

  function withRenderer(renderer: string, userAgent = CHROME_UA) {
    const webGl = {
      getExtension: vi
        .fn()
        .mockReturnValue({ UNMASKED_RENDERER_WEBGL: 1, UNMASKED_VENDOR_WEBGL: 2 }),
      getParameter: vi.fn((parameter: number) =>
        parameter === 1 ? renderer : "Google Inc.",
      ),
    };
    return createContext({
      document: {
        createElement: vi.fn().mockReturnValue({
          getContext: vi.fn((kind: string) => (kind === "webgl" ? webGl : null)),
        }),
      } as unknown as ExtendedWindow["document"],
      navigator: { userAgent } as ExtendedNavigator,
    });
  }

  it("flags a GPU backend the claimed platform cannot run", () => {
    expect(
      isGpuPlatformMismatch(
        withRenderer("ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro)"),
      ),
    ).toBe(true);
    expect(
      isGpuPlatformMismatch(withRenderer("Adreno (TM) 740")),
    ).toBe(true);
    expect(
      isGpuPlatformMismatch(
        withRenderer(
          "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0, D3D11)",
          SAFARI_UA,
        ),
      ),
    ).toBe(true);
  });

  it("accepts matching GPU and platform pairs", () => {
    expect(
      isGpuPlatformMismatch(
        withRenderer(
          "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0, D3D11)",
        ),
      ),
    ).toBe(false);
    expect(
      isGpuPlatformMismatch(
        withRenderer("ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro)", SAFARI_UA),
      ),
    ).toBe(false);
    expect(isGpuPlatformMismatch(createContext())).toBe(false);
  });

  it("ignores WebGL contexts that expose no unmasked identity", () => {
    const noExtension = createContext({
      document: {
        createElement: vi.fn().mockReturnValue({
          getContext: vi.fn().mockReturnValue({
            getExtension: vi.fn().mockReturnValue(null),
            getParameter: vi.fn(),
          }),
        }),
      } as unknown as ExtendedWindow["document"],
    });
    expect(isGpuPlatformMismatch(noExtension)).toBe(false);
    expect(isSoftwareRenderer(noExtension)).toBe(false);

    const noContext = createContext({
      document: {
        createElement: vi.fn().mockReturnValue({
          getContext: vi.fn().mockReturnValue(null),
        }),
      } as unknown as ExtendedWindow["document"],
    });
    expect(isGpuPlatformMismatch(noContext)).toBe(false);

    const nonStringVendor = createContext({
      document: {
        createElement: vi.fn().mockReturnValue({
          getContext: vi.fn().mockReturnValue({
            getExtension: vi
              .fn()
              .mockReturnValue({ UNMASKED_RENDERER_WEBGL: 1, UNMASKED_VENDOR_WEBGL: 2 }),
            getParameter: vi.fn((parameter: number) =>
              parameter === 1 ? "Adreno (TM) 740" : undefined,
            ),
          }),
        }),
      } as unknown as ExtendedWindow["document"],
    });
    expect(isGpuPlatformMismatch(nonStringVendor)).toBe(true);

    const nonStringRenderer = createContext({
      document: {
        createElement: vi.fn().mockReturnValue({
          getContext: vi.fn().mockReturnValue({
            getExtension: vi.fn().mockReturnValue({ UNMASKED_RENDERER_WEBGL: 1 }),
            getParameter: vi.fn().mockReturnValue(undefined),
          }),
        }),
      } as unknown as ExtendedWindow["document"],
    });
    expect(isGpuPlatformMismatch(nonStringRenderer)).toBe(false);
  });

  function withMediaQueries(
    answers: Record<string, boolean>,
    overrides: Partial<ExtendedWindow> = {},
  ) {
    return createContext({
      devicePixelRatio: 2,
      // Every query agrees with the reported values unless overridden.
      matchMedia: ((query: string) => ({
        matches: answers[query] ?? true,
      })) as ExtendedWindow["matchMedia"],
      screen: { width: 1920, height: 1080, colorDepth: 24 } as Screen,
      ...overrides,
    } as Partial<ExtendedWindow>);
  }

  it("flags media queries that contradict devicePixelRatio", () => {
    // devicePixelRatio 2 gives a 2% window, so the queries land on 1.96/2.04.
    expect(
      isMediaQueryInconsistent(
        withMediaQueries({ "(min-resolution: 1.96dppx)": false }),
      ),
    ).toBe(true);
    expect(
      isMediaQueryInconsistent(
        withMediaQueries({ "(max-resolution: 2.04dppx)": false }),
      ),
    ).toBe(true);
  });

  it("ignores an unusable devicePixelRatio", () => {
    expect(
      isMediaQueryInconsistent(
        withMediaQueries({}, { devicePixelRatio: 0 } as Partial<ExtendedWindow>),
      ),
    ).toBe(false);
    expect(
      isMediaQueryInconsistent(
        withMediaQueries({}, {
          devicePixelRatio: Number.NaN,
        } as Partial<ExtendedWindow>),
      ),
    ).toBe(false);
  });

  it("accepts consistent media queries and skips unsupported engines", () => {
    expect(isMediaQueryInconsistent(withMediaQueries({}))).toBe(false);
    expect(isMediaQueryInconsistent(createContext())).toBe(false);
    expect(
      isMediaQueryInconsistent(
        withMediaQueries({ "(min-resolution: 0dppx)": false }),
      ),
    ).toBe(false);
    // A media query that throws must not decide the verdict on its own.
    expect(
      isMediaQueryInconsistent(
        createContext({
          devicePixelRatio: 2,
          matchMedia: ((query: string) => {
            if (query === "(min-resolution: 0dppx)") {
              return { matches: true };
            }
            throw new Error("blocked");
          }) as ExtendedWindow["matchMedia"],
        } as Partial<ExtendedWindow>),
      ),
    ).toBe(false);
  });

  it("flags impossible screen geometry", () => {
    const withScreen = (screen: Partial<Screen>, extra: Partial<ExtendedWindow> = {}) =>
      isScreenGeometryInconsistent(
        createContext({
          screen: { width: 1920, height: 1080, ...screen } as Screen,
          ...extra,
        } as Partial<ExtendedWindow>),
      );

    expect(withScreen({ width: 0 })).toBe(true);
    expect(withScreen({ height: Number.POSITIVE_INFINITY })).toBe(true);
    expect(withScreen({ availWidth: 2000 })).toBe(true);
    expect(withScreen({ availHeight: 1200 })).toBe(true);
    expect(withScreen({ colorDepth: 21 })).toBe(true);
    expect(withScreen({ colorDepth: 24, pixelDepth: 30 })).toBe(true);
    expect(withScreen({}, { devicePixelRatio: 0 })).toBe(true);
    expect(withScreen({}, { devicePixelRatio: 9 })).toBe(true);
  });

  it("accepts real screen geometry", () => {
    expect(
      isScreenGeometryInconsistent(
        createContext({
          devicePixelRatio: 2,
          screen: {
            width: 1800,
            height: 1169,
            availWidth: 1800,
            availHeight: 1125,
            colorDepth: 30,
            pixelDepth: 30,
          } as Screen,
        } as Partial<ExtendedWindow>),
      ),
    ).toBe(false);
    expect(isScreenGeometryInconsistent(createContext())).toBe(false);
    const withoutDimensions = createContext();
    withoutDimensions.screen = {} as Screen;
    expect(isScreenGeometryInconsistent(withoutDimensions)).toBe(false);
  });

  function withCodecSupport(support: string | null, userAgent = CHROME_UA) {
    return createContext({
      document: {
        createElement: vi
          .fn()
          .mockReturnValue(
            support === null ? {} : { canPlayType: () => support },
          ),
      } as unknown as ExtendedWindow["document"],
      navigator: { userAgent } as ExtendedNavigator,
    });
  }

  it("flags a Chromium build without H.264", () => {
    expect(isMissingProprietaryCodecs(withCodecSupport(""))).toBe(true);
    expect(isMissingProprietaryCodecs(withCodecSupport("probably"))).toBe(false);
    expect(isMissingProprietaryCodecs(withCodecSupport(null))).toBe(false);
    expect(isMissingProprietaryCodecs(withCodecSupport("", SAFARI_UA))).toBe(false);
  });

  it("survives a document that refuses to create elements", () => {
    expect(
      isMissingProprietaryCodecs(
        createContext({
          document: {
            createElement: vi.fn(() => {
              throw new Error("blocked");
            }),
          } as unknown as ExtendedWindow["document"],
        }),
      ),
    ).toBe(false);
  });
});

describe("navigator and plugin tampering", () => {
  /** `Object.prototype.toString` only reports `[object Navigator]` for a real one. */
  function withNativeNavigator(properties: PropertyDescriptorMap) {
    const navigator = Object.create(
      Object.defineProperties({}, properties),
    ) as ExtendedNavigator;
    Object.defineProperty(navigator, Symbol.toStringTag, {
      value: "Navigator",
    });
    Object.assign(navigator, { userAgent: CHROME_UA });
    const context = createContext();
    context.navigator = navigator;
    return context;
  }

  it("flags a navigator accessor replaced by a data property", () => {
    expect(
      isNativeFunctionTampered(
        withNativeNavigator({
          hardwareConcurrency: { value: 8, configurable: true },
        }),
      ),
    ).toBe(true);
  });

  it("flags a navigator getter whose source is not native code", () => {
    expect(
      isNativeFunctionTampered(
        withNativeNavigator({
          hardwareConcurrency: {
            get: Object.assign(() => 8, {
              toString: () => "function get hardwareConcurrency() { [native code] }",
            }),
            configurable: true,
          },
        }),
      ),
    ).toBe(true);
  });

  function withPluginArray(
    item: ((index: number) => unknown) | undefined,
    mimeType?: unknown,
  ) {
    const plugin = { 0: mimeType, toString: () => "[object Plugin]" };
    const plugins = {
      0: plugin,
      length: 1,
      ...(item ? { item } : {}),
    } as unknown as PluginArray;
    return createContext({
      navigator: { plugins, mimeTypes: { length: 1 } } as ExtendedNavigator,
    });
  }

  it("flags a plugin array that does not wrap out-of-range indices", () => {
    expect(
      isPluginArrayInconsistent(withPluginArray(() => undefined)),
    ).toBe(true);
  });

  it("flags a MIME entry that does not link back to its plugin", () => {
    const context = withPluginArray(
      (index: number) => (context.navigator.plugins as PluginArray)[index % 1],
      { enabledPlugin: { name: "other" } },
    );
    expect(isPluginArrayInconsistent(context)).toBe(true);
  });

  it("accepts a native-shaped plugin array", () => {
    const context = withPluginArray(
      (index: number) => (context.navigator.plugins as PluginArray)[index % 1],
    );
    expect(isPluginArrayInconsistent(context)).toBe(false);

    const linked = withPluginArray(
      (index: number) => (linked.navigator.plugins as PluginArray)[index % 1],
      {},
    );
    (linked.navigator.plugins[0]![0] as { enabledPlugin?: unknown }).enabledPlugin =
      linked.navigator.plugins[0];
    expect(isPluginArrayInconsistent(linked)).toBe(false);
  });

  it("flags a plugin array whose item() throws", () => {
    expect(
      isPluginArrayInconsistent(
        withPluginArray(() => {
          throw new Error("blocked");
        }),
      ),
    ).toBe(true);
  });
});

describe("media device enumeration", () => {
  function withMediaDevices(
    devices: MediaDeviceInfo[] | Error,
    userAgent = CHROME_UA,
  ) {
    return createContext({
      navigator: {
        userAgent,
        mediaDevices: {
          enumerateDevices: vi.fn(() =>
            devices instanceof Error
              ? Promise.reject(devices)
              : Promise.resolve(devices),
          ),
        },
      } as unknown as ExtendedNavigator,
    });
  }

  it("flags desktop Chromium with no audio or video endpoints", async () => {
    await expect(checkMediaDevices(withMediaDevices([]))).resolves.toBe(true);
    await expect(
      checkMediaDevices(withMediaDevices([{ kind: "audiooutput" } as MediaDeviceInfo])),
    ).resolves.toBe(false);
  });

  it("does not apply to mobile, non-Chromium, or unavailable APIs", async () => {
    await expect(
      checkMediaDevices(
        withMediaDevices([], "Mozilla/5.0 (Linux; Android 14) Chrome/121.0.0.0 Mobile"),
      ),
    ).resolves.toBe(null);
    await expect(checkMediaDevices(createContext())).resolves.toBe(null);
    await expect(
      checkMediaDevices(withMediaDevices(new Error("blocked"))),
    ).resolves.toBe(null);
  });
});

/**
 * Opera 133 on macOS, captured from a real session. Its fingerprint
 * protection reports 2 CPU cores to the document while workers and
 * `about:blank` frames see the machine's real 10, and it reports
 * `screen.colorDepth` 24 on a 10-bit display. None of that is automation.
 */
describe("Opera fingerprint-protection regression", () => {
  const OPERA_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 OPR/133.0.0.0";
  const REAL_CORES = 10;
  const REPORTED_CORES = 2;

  function operaContext() {
    const context = createContext({
      devicePixelRatio: 2,
      matchMedia: ((query: string) => ({
        // Opera answers colour queries with the panel's real 10 bits per
        // channel even though screen.colorDepth says 24.
        matches: /\(min-color: (?:9|10)\)|\(max-color: 1[01]\)/.test(query)
          ? /: (?:10|11)\)/.test(query)
          : true,
      })) as ExtendedWindow["matchMedia"],
      navigator: {
        userAgent: OPERA_UA,
        platform: "MacIntel",
        language: "en-GB",
        languages: ["en-GB", "en"],
        hardwareConcurrency: REPORTED_CORES,
      } as ExtendedNavigator,
      screen: {
        width: 1800,
        height: 1169,
        availWidth: 1800,
        availHeight: 1125,
        colorDepth: 24,
        pixelDepth: 24,
      } as Screen,
    } as Partial<ExtendedWindow>);
    return context;
  }

  it("does not flag the iframe realm over a reduced core count", () => {
    const context = operaContext();
    const child = {
      ...context.navigator,
      hardwareConcurrency: REAL_CORES,
    } as Navigator;
    context.document = {
      documentElement: { appendChild: vi.fn() },
      createElement: vi.fn().mockReturnValue({
        style: {},
        contentWindow: { navigator: child, chrome: {} },
        remove: vi.fn(),
      }),
    } as unknown as ExtendedWindow["document"];

    expect(isIframeInconsistent(context)).toBe(false);
  });

  it("does not flag the worker realm over a reduced core count", async () => {
    const { context, WorkerMock } = createWorkerContext();
    Object.assign(context.navigator, {
      userAgent: OPERA_UA,
      hardwareConcurrency: REPORTED_CORES,
    });

    const resultPromise = checkWorkerConsistency(context);
    WorkerMock.instances.at(-1)!.onmessage?.({
      data: {
        userAgent: context.navigator.userAgent,
        language: context.navigator.language,
        languages: Array.from(context.navigator.languages),
        platform: context.navigator.platform,
        hardwareConcurrency: REAL_CORES,
        cdpDetected: false,
      },
    } as MessageEvent);

    await expect(resultPromise).resolves.toMatchObject({
      isWorkerInconsistent: false,
    });
  });

  it("does not flag media queries over a 24-bit colorDepth on a 10-bit panel", () => {
    expect(isMediaQueryInconsistent(operaContext())).toBe(false);
  });

  it("does not flag the screen geometry it reports", () => {
    expect(isScreenGeometryInconsistent(operaContext())).toBe(false);
  });
});
