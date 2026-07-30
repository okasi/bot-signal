import { describe, expect, it, vi } from "vitest";
import {
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
  isErrorStackAutomation,
  isIframeInconsistent,
  isNativeFunctionTampered,
  isNavigatorIdentityInconsistent,
  isPluginArrayInconsistent,
  isSuspiciousHardware,
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
  ] as Array<Partial<ExtendedWindow>>)("scores Selenium marker %#", (marker) => {
    expect(detectInstantClient(createContext(marker)).isSelenium).toBe(true);
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

    expect(isNativeFunctionTampered(createContext({ Function: fakeFunction }))).toBe(true);
    expect(isNativeFunctionTampered(createContext({ Function: throwingFunction }))).toBe(true);
    expect(isNativeFunctionTampered(createContext({ Function: malformedFunction }))).toBe(true);
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
    class PluginMock {}
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
      contentWindow: { navigator: child },
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

    for (const overrides of [
      { webdriver: true },
      { userAgent: "different" },
      { platform: "Linux" },
      { languages: ["sv-SE"] },
      { hardwareConcurrency: 99 },
    ]) {
      expect(isIframeInconsistent(iframeContext(overrides).context)).toBe(true);
    }
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
    expect(isSuspiciousHardware(createContext({ navigator: { deviceMemory: 32 } as ExtendedNavigator }))).toBe(true);
    expect(isSuspiciousHardware(createContext({ navigator: { hardwareConcurrency: 65 } as ExtendedNavigator }))).toBe(true);
    expect(isSuspiciousHardware(createContext({ navigator: { hardwareConcurrency: 40, deviceMemory: 8 } as ExtendedNavigator }))).toBe(true);
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
    expect(isCanvasTampered(withCanvas([18, 34, 51, 255]))).toBe(true);
    expect(isCanvasTampered(withCanvas([17, 35, 51, 255]))).toBe(true);
    expect(isCanvasTampered(withCanvas([17, 34, 52, 255]))).toBe(true);
    expect(isCanvasTampered(withCanvas([17, 34, 51, 254]))).toBe(true);
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
            debug() {
              throw new Error("blocked");
            },
          } as unknown as Console,
        }),
      ),
    ).resolves.toBeNull();
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
    { userAgent: "different" },
    { language: "sv-SE" },
    { languages: ["sv-SE"] },
    { platform: "Linux" },
    { hardwareConcurrency: 99 },
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
