import { describe, expect, it, vi } from "vitest";
import detectInstantClient, {
  detectInstantClientAsync,
  detectSuspiciousClient,
  detectSuspiciousClientAsync,
  isChromiumBrowser,
} from "../src/detectSuspiciousClient.js";
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
    chrome: { runtime: {} },
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

  it("is an alias of detectSuspiciousClient", () => {
    const context = createMockContext();
    expect(detectInstantClient(context)).toEqual(detectSuspiciousClient(context));
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
    const result = detectSuspiciousClient(
      createMockContext({
        document: { __selenium_unwrapped: true },
      }),
    );

    expect(result.isSelenium).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags suspicious resolutions", () => {
    const result = detectSuspiciousClient(
      createMockContext({
        screen: { width: 100, height: 100 } as ExtendedWindow["screen"],
      }),
    );

    expect(result.isSuspiciousResolution).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags invalid user agents", () => {
    const result = detectSuspiciousClient(
      createMockContext({
        navigator: {
          userAgent: "python-requests/2.31.0",
        } as ExtendedWindow["navigator"],
      }),
    );

    expect(result.isUserAgentValid).toBe(false);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags Chromium without chrome.runtime", () => {
    const result = detectSuspiciousClient(
      createMockContext({
        chrome: undefined,
      }),
    );

    expect(result.isMissingChromeObject).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags software WebGL renderers", () => {
    const context = createMockContext();
    const canvas = context.document.createElement("canvas");
    vi.mocked(canvas.getContext).mockReturnValue(
      createWebGLContext("Google SwiftShader") as never,
    );

    const result = detectSuspiciousClient(context);

    expect(result.isSoftwareRenderer).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags suspicious window dimensions", () => {
    const result = detectSuspiciousClient(
      createMockContext({
        outerWidth: 1280,
        outerHeight: 720,
        innerWidth: 1280,
        innerHeight: 720,
        screenX: 0,
        screenY: 0,
      }),
    );

    expect(result.isSuspiciousWindowDimensions).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags empty plugins on Chromium", () => {
    const result = detectSuspiciousClient(
      createMockContext({
        navigator: {
          plugins: { length: 0 },
        } as ExtendedWindow["navigator"],
      }),
    );

    expect(result.isEmptyPlugins).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags Playwright artifacts", () => {
    const result = detectSuspiciousClient(
      createMockContext({
        __playwright: true,
      }),
    );

    expect(result.isAutomationArtifacts).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags ChromeDriver document artifacts", () => {
    const result = detectSuspiciousClient(
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
    const result = detectSuspiciousClient(
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

  it("matches the deprecated async alias", async () => {
    const context = createMockContext();
    await expect(detectInstantClientAsync(context)).resolves.toEqual(
      await detectSuspiciousClientAsync(context),
    );
  });
});

describe("detectSuspiciousClientAsync", () => {
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

    const result = await detectSuspiciousClientAsync(context);

    expect(result.isShaderF16Supported).toBe(true);
    expect(result.isLegitClient).toBe(true);
  });

  it("flags Chromium without shader-f16 support", async () => {
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

    const result = await detectSuspiciousClientAsync(context);

    expect(result.isShaderF16Supported).toBe(false);
    expect(result.isLegitClient).toBe(false);
  });

  it("skips shader-f16 on non-Chromium browsers", async () => {
    const context = createMockContext({
      navigator: {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
      } as ExtendedWindow["navigator"],
    });

    const result = await detectSuspiciousClientAsync(context);

    expect(result.isShaderF16Supported).toBe(null);
    expect(result.isLegitClient).toBe(true);
  });
});
