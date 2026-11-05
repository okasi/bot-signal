import { getPropertySafely, readWebGlIdentity } from "../checks.js";
import type { ExtendedWindow } from "../types.js";
import { hash64 } from "./hash.js";
import type { DeviceComponents } from "./types.js";

/** Font families probed by width measurement. Order is part of the component. */
export const PROBED_FONTS = [
  "Arial Black",
  "Arial Narrow",
  "Bahnschrift",
  "Calibri",
  "Cambria",
  "Candara",
  "Century Gothic",
  "Comic Sans MS",
  "Consolas",
  "Constantia",
  "Corbel",
  "Courier New",
  "Franklin Gothic Medium",
  "Futura",
  "Garamond",
  "Geneva",
  "Georgia",
  "Gill Sans",
  "Helvetica Neue",
  "Impact",
  "Lucida Console",
  "Lucida Grande",
  "Menlo",
  "Monaco",
  "MS Gothic",
  "Noto Sans",
  "Optima",
  "Palatino",
  "Roboto",
  "Segoe UI",
  "SF Pro Text",
  "Tahoma",
  "Trebuchet MS",
  "Ubuntu",
  "Verdana",
  "DejaVu Sans",
  "Liberation Sans",
  "Cantarell",
] as const;

const FONT_BASES = ["monospace", "sans-serif", "serif"] as const;
const FONT_SAMPLE = "mmmmmmmmmmlli1WQ@#";
const AUDIO_TIMEOUT_MS = 1_000;
const MAX_COMPONENT_LENGTH = 256;

function clip(value: string): string {
  return value.length > MAX_COMPONENT_LENGTH
    ? value.slice(0, MAX_COMPONENT_LENGTH)
    : value;
}

function safely<T>(read: () => T | null): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

function create2dContext(
  context: ExtendedWindow,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const canvas = context.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d");
}

/** Hash of a fixed 2D scene's pixels (text, emoji, blending, arcs). */
export function readCanvasComponent(context: ExtendedWindow): string | null {
  return safely(() => {
    const ctx = create2dContext(context, 200, 50);
    if (!ctx) {
      return null;
    }

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#f60";
    ctx.fillRect(100, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.font = "11pt 'Times New Roman'";
    ctx.fillText("Cwm fjordbank gly \u{1F603}", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.2)";
    ctx.font = "18pt Arial";
    ctx.fillText("bot-signal \u00e5\u00e4\u00f6", 4, 45);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgb(255,0,255)";
    ctx.beginPath();
    ctx.arc(50, 25, 20, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();

    const { data } = ctx.getImageData(0, 0, 200, 50);
    if (data.length === 0) {
      return null;
    }

    // Hash pixels, not toDataURL(): PNG encoding is not byte-stable.
    let text = "";
    for (let index = 0; index < data.length; index += 4) {
      text += String.fromCharCode(
        data[index]!,
        data[index + 1]!,
        data[index + 2]!,
        data[index + 3]!,
      );
    }
    return hash64(text);
  });
}

export function readWebGlComponent(context: ExtendedWindow): string | null {
  const identity = readWebGlIdentity(context);
  return identity ? clip(`${identity.vendor}~${identity.renderer}`) : null;
}

const WEBGL_PARAMETERS = [
  0x0d33, // MAX_TEXTURE_SIZE
  0x84e8, // MAX_RENDERBUFFER_SIZE
  0x8869, // MAX_VERTEX_ATTRIBS
  0x8dfb, // MAX_VERTEX_UNIFORM_VECTORS
  0x8dfd, // MAX_FRAGMENT_UNIFORM_VECTORS
  0x8872, // MAX_TEXTURE_IMAGE_UNITS
  0x8b4c, // MAX_VERTEX_TEXTURE_IMAGE_UNITS
  0x8b4d, // MAX_COMBINED_TEXTURE_IMAGE_UNITS
  0x0d3a, // MAX_VIEWPORT_DIMS
  0x846e, // ALIASED_LINE_WIDTH_RANGE
  0x846d, // ALIASED_POINT_SIZE_RANGE
  0x0d50, // SUBPIXEL_BITS
] as const;

/** Hash of WebGL limits and supported extensions. */
export function readWebGlParamsComponent(context: ExtendedWindow): string | null {
  return safely(() => {
    const canvas = context.document.createElement("canvas");
    const gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
    if (!gl || typeof gl.getParameter !== "function") {
      return null;
    }

    const values = WEBGL_PARAMETERS.map((parameter) => {
      const value: unknown = gl.getParameter(parameter);
      return value && typeof value === "object" && "length" in value
        ? Array.from(value as ArrayLike<number>).join("x")
        : String(value);
    });
    const extensions = (gl.getSupportedExtensions?.() ?? []).slice().sort();
    return hash64(`${values.join(",")}|${extensions.join(",")}`);
  });
}

/** Comma-separated list of installed fonts detected by width measurement, hashed. */
export function readFontsComponent(context: ExtendedWindow): string | null {
  return safely(() => {
    const ctx = create2dContext(context, 1, 1);
    if (!ctx) {
      return null;
    }

    const measure = (family: string): number => {
      ctx.font = `72px ${family}`;
      return ctx.measureText(FONT_SAMPLE).width;
    };
    const baseWidths = FONT_BASES.map(measure);
    const detected = PROBED_FONTS.filter((font) =>
      FONT_BASES.some(
        (base, index) => measure(`'${font}', ${base}`) !== baseWidths[index],
      ),
    );

    return hash64(detected.join(","));
  });
}

export function readScreenComponent(context: ExtendedWindow): string | null {
  return safely(() => {
    const { screen } = context;
    // Sort dimensions so rotating a phone or tablet is not a new device.
    const [short, long] = [screen.width, screen.height].sort((a, b) => a - b);
    return `${short}x${long}x${screen.colorDepth}@${context.devicePixelRatio ?? 1}`;
  });
}

export function readTimezoneComponent(context: ExtendedWindow): string | null {
  return safely(() => {
    const intl = context.Intl ?? Intl;
    const zone = intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone ? clip(zone) : null;
  });
}

export function readLanguagesComponent(context: ExtendedWindow): string | null {
  return safely(() => {
    const { languages, language } = context.navigator;
    const list = languages && languages.length > 0 ? languages : [language];
    return clip(list.filter(Boolean).join(",")) || null;
  });
}

export function readPlatformComponent(context: ExtendedWindow): string | null {
  return safely(() => {
    const platform =
      context.navigator.userAgentData?.platform || context.navigator.platform;
    return platform ? clip(platform) : null;
  });
}

export function readHardwareComponent(context: ExtendedWindow): string | null {
  return safely(
    () =>
      `${context.navigator.hardwareConcurrency ?? "?"}|${context.navigator.deviceMemory ?? "?"}`,
  );
}

export function readTouchComponent(context: ExtendedWindow): string | null {
  return safely(
    () =>
      `${context.navigator.maxTouchPoints ?? 0}|${"ontouchstart" in context ? 1 : 0}`,
  );
}

/** Floating-point results of transcendental functions differ per engine/CPU/libm. */
export function readMathComponent(context: ExtendedWindow): string | null {
  return safely(() => {
    const math = (getPropertySafely(context, "Math") as Math | undefined) ?? Math;
    return hash64(
      [
        math.acos(0.123124234234234242),
        math.acosh(1e308),
        math.asin(0.123124234234234242),
        math.asinh(1),
        math.atan(2),
        math.atanh(0.5),
        math.cbrt(100),
        math.cos(10.000000000123),
        math.cosh(1),
        math.exp(1),
        math.expm1(1),
        math.log1p(10),
        math.sin(-1e300),
        math.sinh(1),
        math.tan(-1e300),
        math.tanh(1),
        math.pow(Math.PI, -100),
      ].join(","),
    );
  });
}

const MEDIA_QUERIES: Array<[string, string[]]> = [
  ["color-gamut", ["rec2020", "p3", "srgb"]],
  ["dynamic-range", ["high", "standard"]],
  ["prefers-reduced-motion", ["reduce", "no-preference"]],
  ["prefers-contrast", ["more", "less", "custom", "no-preference"]],
  ["forced-colors", ["active", "none"]],
  ["inverted-colors", ["inverted", "none"]],
  ["pointer", ["fine", "coarse", "none"]],
  ["hover", ["hover", "none"]],
];

/** Hardware/accessibility media features. Theme (light/dark) is excluded: it changes by time of day. */
export function readMediaQueriesComponent(context: ExtendedWindow): string | null {
  return safely(() => {
    if (typeof context.matchMedia !== "function") {
      return null;
    }

    return MEDIA_QUERIES.map(([feature, values]) => {
      const match = values.find(
        (value) => context.matchMedia(`(${feature}: ${value})`).matches,
      );
      return `${feature}=${match ?? "?"}`;
    }).join(";");
  });
}

export function readIntlComponent(context: ExtendedWindow): string | null {
  return safely(() => {
    const intl = context.Intl ?? Intl;
    const date = intl.DateTimeFormat().resolvedOptions();
    const number = intl.NumberFormat().resolvedOptions();
    return clip(
      `${date.locale}|${date.calendar}|${date.numberingSystem}|${number.locale}`,
    );
  });
}

export function readVendorComponent(context: ExtendedWindow): string | null {
  return safely(() => clip(context.navigator.vendor ?? "") || null);
}

export function readPluginsComponent(context: ExtendedWindow): string | null {
  return safely(() => {
    const plugins = context.navigator.plugins;
    if (!plugins) {
      return null;
    }

    const names: string[] = [];
    for (let index = 0; index < plugins.length; index += 1) {
      const name = plugins[index]?.name;
      if (name) {
        names.push(name);
      }
    }
    return hash64(names.join(","));
  });
}

/** NaN payload byte reveals the CPU architecture family (x86 vs ARM). */
export function readArchitectureComponent(): string | null {
  return safely(() => {
    const floats = new Float32Array(1);
    const bytes = new Uint8Array(floats.buffer);
    floats[0] = Infinity;
    floats[0] = floats[0] - floats[0];
    return String(bytes[3]);
  });
}

const BROWSER_FAMILIES: Array<[RegExp, string]> = [
  [/Edg\//, "edge"],
  [/OPR\//, "opera"],
  [/SamsungBrowser\//, "samsung"],
  [/Firefox\//, "firefox"],
  [/Chrome\/|CriOS\//, "chrome"],
  [/Safari\//, "safari"],
];

const OS_FAMILIES: Array<[RegExp, string]> = [
  [/Windows/, "windows"],
  [/Android/, "android"],
  [/iPhone|iPad|iPod/, "ios"],
  [/Mac OS X|Macintosh/, "macos"],
  [/CrOS/, "chromeos"],
  [/Linux/, "linux"],
];

/** Browser and OS family without versions, so updates do not change the identity. */
export function readBrowserComponent(context: ExtendedWindow): string | null {
  return safely(() => {
    const userAgent = context.navigator.userAgent ?? "";
    const browser =
      BROWSER_FAMILIES.find(([pattern]) => pattern.test(userAgent))?.[1] ??
      "other";
    const os =
      OS_FAMILIES.find(([pattern]) => pattern.test(userAgent))?.[1] ?? "other";
    return `${browser}/${os}`;
  });
}

type AudioContextConstructor = new (
  channels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContext;

/** Sum of a compressed oscillator's rendered samples; differs by audio stack. */
export async function readAudioComponent(
  context: ExtendedWindow,
  timeoutMs = AUDIO_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const Offline = (getPropertySafely(context, "OfflineAudioContext") ??
      getPropertySafely(context, "webkitOfflineAudioContext")) as
      | AudioContextConstructor
      | undefined;
    if (typeof Offline !== "function") {
      return null;
    }

    const audio = new Offline(1, 5_000, 44_100);
    const oscillator = audio.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.value = 10_000;
    const compressor = audio.createDynamicsCompressor();
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;
    oscillator.connect(compressor);
    compressor.connect(audio.destination);
    oscillator.start(0);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const buffer = await Promise.race([audio.startRendering(), timeout]);
    clearTimeout(timer);
    if (!buffer) {
      return null;
    }

    const samples = buffer.getChannelData(0);
    let sum = 0;
    for (let index = 4_500; index < samples.length; index += 1) {
      sum += Math.abs(samples[index]!);
    }
    return sum.toString();
  } catch {
    return null;
  }
}

/** Collects every identification component. Never throws; unreadable components are `null`. */
export async function collectDeviceComponents(
  context: ExtendedWindow,
): Promise<DeviceComponents> {
  return {
    canvas: readCanvasComponent(context),
    webgl: readWebGlComponent(context),
    webglParams: readWebGlParamsComponent(context),
    audio: await readAudioComponent(context),
    fonts: readFontsComponent(context),
    screen: readScreenComponent(context),
    timezone: readTimezoneComponent(context),
    languages: readLanguagesComponent(context),
    platform: readPlatformComponent(context),
    hardware: readHardwareComponent(context),
    touch: readTouchComponent(context),
    math: readMathComponent(context),
    mediaQueries: readMediaQueriesComponent(context),
    intl: readIntlComponent(context),
    vendor: readVendorComponent(context),
    plugins: readPluginsComponent(context),
    architecture: readArchitectureComponent(),
    browser: readBrowserComponent(context),
  };
}
