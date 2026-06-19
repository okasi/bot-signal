import type { ExtendedWindow } from "./types.js";

/** Chrome, Edge, and other Chromium-based browsers */
export function isChromiumBrowser(context: ExtendedWindow): boolean {
  const userAgent = context.navigator.userAgent;
  return userAgent.includes("Chrome/") || userAgent.includes("Edg/");
}

/**
 * Checks WebGPU `shader-f16` support on Chromium browsers.
 * Real Chrome/Edge 113+ clients typically expose this feature; bots often do not.
 *
 * @see https://scrapfly.io/web-scraping-tools/gpu-fingerprint/webgpu/shader-f16
 */
export async function checkShaderF16Support(
  context: ExtendedWindow,
): Promise<boolean> {
  if (!isChromiumBrowser(context)) {
    return true;
  }

  const gpu = context.navigator.gpu;
  if (!gpu) {
    return false;
  }

  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return false;
    }

    return adapter.features.has("shader-f16");
  } catch {
    return false;
  }
}
