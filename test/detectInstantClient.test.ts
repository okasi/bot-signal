import { describe, expect, it, vi } from "vitest";
import {
  checkShaderF16Support,
  detectInstantClient,
  detectInstantClientAsync,
  isAutomationArtifacts,
  isEmptyPlugins,
  isMissingChromeObject,
  isSoftwareRenderer,
  isSuspiciousWindowDimensions,
  isChromiumBrowser,
} from "../src/detectInstantClient.js";
import type { ExtendedWindow } from "../src/types.js";

function createWebGLContext(renderer = "ANGLE (NVIDIA GeForce RTX 3080)") {
  return {
    getExtension: vi.fn().mockReturnValue({
      UNMASKED_RENDERER_WEBGL: 0x9246,
    }),
    getParameter: vi.fn().mockReturnValue(renderer),
  };
}

function createMockContext(
  overrides: Partial<ExtendedWindow> = {},
): ExtendedWindow {
  const canvas = {
    getContext: vi.fn().mockReturnValue(createWebGLContext()),
  };

  const baseDocument = {
    createElement: vi.fn().mockReturnValue(canvas),
  };

  const baseNavigator = Object.assign(
    Object.create({ webdriver: false }),
    {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      plugins: { length: 3 },
    },
  );

  const baseScreen = {
    width: 1920,
    height: 1080,
  };

  const {
    document: documentOverrides,
    navigator: navigatorOverrides,
    screen: screenOverrides,
    ...rest
  } = overrides;

  const navigator = Object.assign(
    Object.create({ webdriver: false }),
    baseNavigator,
    navigatorOverrides,
  ) as ExtendedWindow["navigator"];

  return {
    chrome: {},
    outerWidth: 1920,
    outerHeight: 1080,
    innerWidth: 1900,
    innerHeight: 970,
    screenX: 100,
    screenY: 50,
    ...rest,
    document: {
      ...baseDocument,
      ...documentOverrides,
    } as ExtendedWindow["document"],
    navigator,
    screen: {
      ...baseScreen,
      ...screenOverrides,
    } as ExtendedWindow["screen"],
  } as ExtendedWindow;
}

describe("detectInstantClient", () => {
  it("flags a clean browser as legit", () => {
    const result = detectInstantClient(createMockContext());

    expect(result.isLegitClient).toBe(true);
    expect(result.isChromium).toBe(true);
    expect(result.isWebDriver).toBe(false);
    expect(result.isMissingChromeObject).toBe(false);
    expect(result.isSoftwareRenderer).toBe(false);
    expect(result.isSuspiciousWindowDimensions).toBe(false);
    expect(result.isEmptyPlugins).toBe(false);
    expect(result.isAutomationArtifacts).toBe(false);
  });

  it("flags webdriver clients", () => {
    const result = detectInstantClient(
      createMockContext({
        navigator: { webdriver: true },
      }),
    );

    expect(result.isWebDriver).toBe(true);
    expect(result.isHeadless).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags selenium markers", () => {
    const result = detectInstantClient(
      createMockContext({
        document: { __selenium_unwrapped: true },
      }),
    );

    expect(result.isSelenium).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags suspicious resolutions", () => {
    const result = detectInstantClient(
      createMockContext({
        screen: { width: 100, height: 100 } as ExtendedWindow["screen"],
      }),
    );

    expect(result.isSuspiciousResolution).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags invalid user agents", () => {
    const result = detectInstantClient(
      createMockContext({
        navigator: {
          userAgent: "python-requests/2.31.0",
        } as ExtendedWindow["navigator"],
      }),
    );

    expect(result.isUserAgentValid).toBe(false);
    expect(result.isLegitClient).toBe(false);
  });

  it("detects modern Safari user agents without treating them as Chromium", () => {
    const result = detectInstantClient(
      createMockContext({
        navigator: {
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        } as ExtendedWindow["navigator"],
      }),
    );

    expect(result.isModern).toBe(true);
    expect(result.isChromium).toBe(false);
  });

  it("treats malformed browser version tokens as non-modern", () => {
    const result = detectInstantClient(
      createMockContext({
        navigator: {
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/not-a-version Safari/537.36",
        } as ExtendedWindow["navigator"],
      }),
    );

    expect(result.isModern).toBe(false);
  });

  it("does not require chrome.runtime on ordinary Chromium pages", () => {
    const result = detectInstantClient(
      createMockContext({
        chrome: {},
      }),
    );

    expect(result.isMissingChromeObject).toBe(false);
    expect(
      result.signals.find((s) => s.id === "isMissingChromeObject")?.triggered,
    ).toBe(false);
    expect(result.suspicionScore).toBe(0);
    expect(result.isLegitClient).toBe(true);
  });

  it("treats a missing window.chrome as a soft signal (in-app browsers)", () => {
    const result = detectInstantClient(
      createMockContext({
        chrome: undefined,
      }),
    );

    // In-app browsers (Instagram, Facebook, WebViews) can have a Chrome UA but
    // no window.chrome — a soft signal that must not block on its own.
    expect(result.isMissingChromeObject).toBe(true);
    expect(
      result.signals.find((s) => s.id === "isMissingChromeObject")?.triggered,
    ).toBe(true);
    expect(result.suspicionScore).toBeLessThan(0.5);
    expect(result.isLegitClient).toBe(true);

    // A caller who wants zero tolerance can still block via the threshold.
    expect(
      detectInstantClient(createMockContext({ chrome: undefined }), {
        scoreThreshold: 0.3,
      }).isLegitClient,
    ).toBe(false);
  });

  it("flags software WebGL renderers", () => {
    const context = createMockContext();
    const canvas = context.document.createElement("canvas");
    vi.mocked(canvas.getContext).mockReturnValue(
      createWebGLContext("Google SwiftShader") as never,
    );

    const result = detectInstantClient(context);

    expect(result.isSoftwareRenderer).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("falls back to experimental WebGL before checking software renderers", () => {
    const context = createMockContext();
    const gl = createWebGLContext("ANGLE (AMD Radeon)");
    const getContext = vi
      .fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(gl);

    context.document.createElement = vi.fn().mockReturnValue({ getContext });

    expect(isSoftwareRenderer(context)).toBe(false);
    expect(getContext).toHaveBeenCalledWith("webgl");
    expect(getContext).toHaveBeenCalledWith("experimental-webgl");
  });

  it("passes software renderer check when WebGL debug info or renderer text is unavailable", () => {
    const noGl = createMockContext();
    noGl.document.createElement = vi.fn().mockReturnValue({
      getContext: vi.fn().mockReturnValue(null),
    });

    const noDebugInfo = createMockContext();
    noDebugInfo.document.createElement = vi.fn().mockReturnValue({
      getContext: vi.fn().mockReturnValue({
        getExtension: vi.fn().mockReturnValue(null),
      }),
    });

    const nonStringRenderer = createMockContext();
    nonStringRenderer.document.createElement = vi.fn().mockReturnValue({
      getContext: vi.fn().mockReturnValue({
        getExtension: vi.fn().mockReturnValue({
          UNMASKED_RENDERER_WEBGL: 0x9246,
        }),
        getParameter: vi.fn().mockReturnValue(123),
      }),
    });

    expect(isSoftwareRenderer(noGl)).toBe(false);
    expect(isSoftwareRenderer(noDebugInfo)).toBe(false);
    expect(isSoftwareRenderer(nonStringRenderer)).toBe(false);
  });

  it("treats suspicious window dimensions as a soft signal (F11 fullscreen)", () => {
    const result = detectInstantClient(
      createMockContext({
        outerWidth: 1280,
        outerHeight: 720,
        innerWidth: 1280,
        innerHeight: 720,
        screenX: 0,
        screenY: 0,
      }),
    );

    // Real users in F11 fullscreen produce this shape — soft, non-blocking.
    expect(result.isSuspiciousWindowDimensions).toBe(true);
    expect(result.suspicionScore).toBeLessThan(0.5);
    expect(result.isLegitClient).toBe(true);
  });

  it("treats empty plugins on desktop Chromium as a soft signal", () => {
    const result = detectInstantClient(
      createMockContext({
        navigator: {
          plugins: { length: 0 },
        } as ExtendedWindow["navigator"],
      }),
    );

    expect(result.isEmptyPlugins).toBe(true);
    expect(result.suspicionScore).toBeLessThan(0.5);
    expect(result.isLegitClient).toBe(true);
  });

  it("does not flag empty plugins on mobile Chrome", () => {
    const context = createMockContext({
      navigator: {
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
        plugins: { length: 0 },
      } as ExtendedWindow["navigator"],
    });

    // Mobile Chrome exposes no plugins by design.
    expect(isEmptyPlugins(context)).toBe(false);
    expect(detectInstantClient(context).isEmptyPlugins).toBe(false);
  });

  it("blocks when soft signals stack past the threshold", () => {
    // In-app browser that is also GPU-less: two soft signals combine.
    const context = createMockContext({ chrome: undefined });
    context.document.createElement = vi.fn().mockReturnValue({
      getContext: vi.fn().mockReturnValue(null),
    });

    const result = detectInstantClient(context);

    expect(result.isMissingChromeObject).toBe(true);
    expect(result.isWebGLSupported).toBe(false);
    expect(result.suspicionScore).toBeGreaterThanOrEqual(0.5);
    expect(result.isLegitClient).toBe(false);
  });

  it("exposes a weighted score and signal breakdown", () => {
    const result = detectInstantClient(createMockContext());

    expect(result.suspicionScore).toBe(0);
    expect(result.confidence).toBe("low");
    expect(result.signals.length).toBeGreaterThan(10);
    expect(result.signals.every((s) => s.triggered === false)).toBe(true);

    const blocked = detectInstantClient(
      createMockContext({ navigator: { webdriver: true } }),
    );
    expect(blocked.suspicionScore).toBe(1);
    expect(blocked.confidence).toBe("high");
    expect(blocked.signals.find((s) => s.id === "isWebDriver")?.score).toBe(1);
  });

  it("does not apply Chromium-only checks to Firefox user agents", () => {
    const context = createMockContext({
      chrome: undefined,
      navigator: {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
        plugins: { length: 0 },
      } as ExtendedWindow["navigator"],
    });

    expect(isMissingChromeObject(context)).toBe(false);
    expect(isEmptyPlugins(context)).toBe(false);
  });

  it("flags Playwright artifacts", () => {
    const result = detectInstantClient(
      createMockContext({
        __playwright: true,
      }),
    );

    expect(result.isAutomationArtifacts).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags automation artifact key patterns on window", () => {
    const context = createMockContext({
      cdc_test_marker_: true,
    } as Partial<ExtendedWindow>);

    expect(isAutomationArtifacts(context)).toBe(true);
  });

  it("flags direct Playwright manual and WebDriver cache artifacts", () => {
    expect(isAutomationArtifacts(createMockContext({ __pw_manual: true }))).toBe(
      true,
    );
    expect(
      isAutomationArtifacts(createMockContext({ _WEBDRIVER_ELEM_CACHE: {} })),
    ).toBe(true);
  });

  it("flags ChromeDriver document artifacts", () => {
    const result = detectInstantClient(
      createMockContext({
        document: {
          $cdc_asdfasdfasdf: true,
        } as ExtendedWindow["document"],
      }),
    );

    expect(result.isAutomationArtifacts).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags own-property webdriver tampering", () => {
    const result = detectInstantClient(
      createMockContext({
        navigator: {
          webdriver: false,
          plugins: { length: 3 },
        } as ExtendedWindow["navigator"],
      }),
    );

    expect(result.isSuspiciousWebDriverDescriptor).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags Chromium navigators missing webdriver on the prototype chain", () => {
    const context = createMockContext();
    // Simulate a stealth patch that deleted the prototype getter entirely.
    const bareNavigator = Object.assign(Object.create(null), {
      userAgent: context.navigator.userAgent,
      plugins: { length: 3 },
    }) as ExtendedWindow["navigator"];
    context.navigator = bareNavigator;

    const result = detectInstantClient(context);

    expect(result.isSuspiciousWebDriverDescriptor).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("passes suspicious dimension check when either condition is absent", () => {
    expect(
      isSuspiciousWindowDimensions(
        createMockContext({
          outerWidth: 1280,
          outerHeight: 720,
          innerWidth: 1279,
          innerHeight: 720,
          screenX: 0,
          screenY: 0,
        }),
      ),
    ).toBe(false);

    expect(
      isSuspiciousWindowDimensions(
        createMockContext({
          outerWidth: 800,
          outerHeight: 720,
          innerWidth: 800,
          innerHeight: 720,
          screenX: 0,
          screenY: 0,
        }),
      ),
    ).toBe(false);
  });
});

describe("isChromiumBrowser", () => {
  it("detects Chrome user agents", () => {
    expect(
      isChromiumBrowser(
        createMockContext({
          navigator: {
            userAgent:
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          } as ExtendedWindow["navigator"],
        }),
      ),
    ).toBe(true);
  });

  it("detects Edge user agents", () => {
    expect(
      isChromiumBrowser(
        createMockContext({
          navigator: {
            userAgent:
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
          } as ExtendedWindow["navigator"],
        }),
      ),
    ).toBe(true);
  });

  it("does not flag Firefox", () => {
    expect(
      isChromiumBrowser(
        createMockContext({
          navigator: {
            userAgent:
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
          } as ExtendedWindow["navigator"],
        }),
      ),
    ).toBe(false);
  });
});

describe("detectInstantClientAsync", () => {
  it("requires shader-f16 on Chromium browsers", async () => {
    const context = createMockContext({
      navigator: {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({
            features: new Set(["shader-f16"]),
          }),
        },
      } as ExtendedWindow["navigator"],
    });

    const result = await detectInstantClientAsync(context);

    expect(result.isShaderF16Supported).toBe(true);
    expect(result.isLegitClient).toBe(true);
  });

  it("adds a soft signal when Chromium lacks shader-f16", async () => {
    const context = createMockContext({
      navigator: {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({
            features: new Set<string>(),
          }),
        },
      } as ExtendedWindow["navigator"],
    });

    const result = await detectInstantClientAsync(context);

    // Missing shader-f16 also occurs on real older/integrated GPUs, so it is a
    // soft signal that does not block a clean browser on its own.
    expect(result.isShaderF16Supported).toBe(false);
    expect(
      result.signals.find((s) => s.id === "isShaderF16Supported")?.triggered,
    ).toBe(true);
    expect(result.suspicionScore).toBeLessThan(0.5);
    expect(result.isLegitClient).toBe(true);
  });

  it("honors a custom score threshold in the async path", async () => {
    const context = createMockContext({
      chrome: undefined,
      navigator: {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({
            features: new Set(["shader-f16"]),
          }),
        },
      } as ExtendedWindow["navigator"],
    });

    // Missing chrome.runtime alone (0.35) passes by default but blocks strictly.
    const lenient = await detectInstantClientAsync(context);
    const strict = await detectInstantClientAsync(context, {
      scoreThreshold: 0.3,
    });

    expect(lenient.isLegitClient).toBe(true);
    expect(strict.isLegitClient).toBe(false);
  });

  it("skips shader-f16 on non-Chromium browsers", async () => {
    const context = createMockContext({
      navigator: {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
      } as ExtendedWindow["navigator"],
    });

    const result = await detectInstantClientAsync(context);

    expect(result.isShaderF16Supported).toBe(null);
    expect(result.isLegitClient).toBe(true);
  });

  it("checkShaderF16Support passes non-Chromium browsers", async () => {
    const context = createMockContext({
      navigator: {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
      } as ExtendedWindow["navigator"],
    });

    await expect(checkShaderF16Support(context)).resolves.toBe(true);
  });

  it("checkShaderF16Support returns false without GPU, adapter, or on rejection", async () => {
    const noGpu = createMockContext();
    const noAdapter = createMockContext({
      navigator: {
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue(null),
        },
      } as ExtendedWindow["navigator"],
    });
    const rejected = createMockContext({
      navigator: {
        gpu: {
          requestAdapter: vi.fn().mockRejectedValue(new Error("blocked")),
        },
      } as ExtendedWindow["navigator"],
    });

    await expect(checkShaderF16Support(noGpu)).resolves.toBe(false);
    await expect(checkShaderF16Support(noAdapter)).resolves.toBe(false);
    await expect(checkShaderF16Support(rejected)).resolves.toBe(false);
  });
});
