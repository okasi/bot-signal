import {
  buildBehavioralSignals,
  collectDeviceSignals,
  createBehavioralClientDetector,
  detectInstantClient,
  detectInstantClientAsync,
  identify,
  protect,
  STORAGE_TOKEN_COOKIE,
  STORAGE_TOKEN_KEY,
  VERSION,
} from "./browser.js";

const $ = (id) => document.getElementById(id);

/* ================================ theme ================================= */

const themeToggle = $("theme-toggle");

function currentTheme() {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

themeToggle.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("dbc-theme", next);
});

/* ============================ copy buttons ============================== */

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.classList.add("is-copied");
    const swapLabel = button.classList.contains("copy-mini");
    if (swapLabel && button.dataset.label === undefined) {
      button.dataset.label = button.textContent;
      button.textContent = "Copied";
    }
    setTimeout(() => {
      button.classList.remove("is-copied");
      if (swapLabel && button.dataset.label !== undefined) {
        button.textContent = button.dataset.label;
        delete button.dataset.label;
      }
    }, 1400);
  } catch {
    /* clipboard unavailable — ignore */
  }
}

$("copy-install").addEventListener("click", (event) => {
  copyText($("install-cmd").textContent.trim(), event.currentTarget);
});

for (const button of document.querySelectorAll("[data-copy-target]")) {
  button.addEventListener("click", () => {
    copyText($(button.dataset.copyTarget).innerText, button);
  });
}

/* ========================== instant detection =========================== */

const CHECKS = [
  ["isWebDriver", "navigator.webdriver is set — the standard automation beacon", "bad"],
  ["isAutomationArtifacts", "Soft umbrella for framework, legacy, or embedded-runtime leftovers", "bad"],
  ["isPlaywright", "Playwright binding, init-script, or exposed-function artifact", "bad"],
  ["isPuppeteer", "Puppeteer binding, evaluation, or exposed-function artifact", "bad"],
  ["isChromeDriver", "Distinctive ChromeDriver artifact", "bad"],
  ["isSuspiciousWebDriverDescriptor", "webdriver property was patched or deleted by a stealth layer", "bad"],
  ["isHeadless", "HeadlessChrome user agent or webdriver flag", "bad"],
  ["isSelenium", "Selenium markers on document", "bad"],
  ["isPhantomJS", "PhantomJS-specific callPhantom or _phantom global", "bad"],
  ["isNightmare", "Nightmare.js marker present", "bad"],
  ["isDomAutomation", "Chrome DOM-automation controller globals", "bad"],
  ["isMissingChromeObject", "Chromium without the browser-provided window.chrome object", "bad"],
  ["isEmptyPlugins", "Zero navigator.plugins on desktop Chromium", "bad"],
  ["isSoftwareRenderer", "SwiftShader / llvmpipe software GPU renderer", "bad"],
  ["isUserAgentDataMismatch", "User-Agent conflicts with Client Hints", "bad"],
  ["isNativeFunctionTampered", "Native functions or Navigator getters were patched", "bad"],
  ["isNavigatorIdentityInconsistent", "Navigator vendor, platform, product, or touch claims conflict with the UA", "bad"],
  ["isPluginArrayInconsistent", "Plugin or MIME arrays use non-native prototypes", "bad"],
  ["isIframeInconsistent", "A fresh iframe hands back the page's own window or navigator, or disagrees about webdriver", "bad"],
  ["isErrorStackAutomation", "Error stack contains an automation source marker", "bad"],
  ["isEngineInconsistent", "JavaScript engine identity conflicts with the browser the User-Agent claims", "bad"],
  ["isGpuPlatformMismatch", "WebGL renderer names a graphics backend the claimed platform cannot run", "bad"],
  ["isMediaQueryInconsistent", "The CSS resolution query contradicts the reported devicePixelRatio", "bad"],
  ["isScreenGeometryInconsistent", "Screen reports impossible geometry or colour depth", "bad"],
  ["isMissingProprietaryCodecs", "Chromium build without H.264 — an unbranded automation build", "bad"],
  ["isTimezoneInconsistent", "The IANA time zone Intl resolves contradicts the UTC offset Date reports", "bad"],
  ["isMissingGreaseBrand", "Client Hints brands omit the GREASE entry every Chromium build injects", "bad"],
  ["isCanvasNoiseInjected", "Two identical canvas renders read back different pixels", "bad"],
  ["isLanguageInconsistent", "navigator.language conflicts with navigator.languages", "bad"],
  ["isPluginMimeTypeInconsistent", "Plugin and MIME-type arrays disagree", "bad"],
  ["isSuspiciousResolution", "Screen smaller than any real device (136×170)", "bad"],
  ["isSuspiciousWindowDimensions", "Zero outer size, or no window chrome at the screen origin", "bad"],
  ["isDefaultAutomationViewport", "Screen or viewport matches an untouched automation default", "bad"],
  ["isSuspiciousHardware", "CPU and device-memory values are implausible or contradictory", "bad"],
  ["isZeroConnectionRtt", "Network Information reports zero RTT outside Android", "bad"],
  ["isCanvasTampered", "A deterministic canvas pixel moved beyond display-pipeline tolerance on readback", "bad"],
  ["isUserAgentValid", "User agent has the Mozilla prefix and no known bot, scripting, or automation token", "good"],
  ["isWebGLSupported", "A WebGL context can be created (headless Chromium 139+ has none)", "good"],
  ["isModern", "Chrome 121+ / Firefox 128+ / Safari 16.4+", "good"],
  ["isShaderF16Supported", "WebGPU shader-f16 feature (Chromium only, async run)", "shader"],
  ["isCdpDetected", "CDP serialized an Error object (async run)", "async-bad"],
  ["isNotificationPermissionInconsistent", "Notification and Permissions API states contradict (async run)", "async-bad"],
  ["isHighEntropyUserAgentDataMismatch", "High-entropy Client Hints conflict with the UA (async run)", "async-bad"],
  ["isWorkerInconsistent", "The worker realm names a different operating system than the page (async run)", "async-bad"],
  ["isWebDriverInWorker", "Worker navigator exposes webdriver (async run)", "async-bad"],
  ["isWorkerWebGLInconsistent", "Worker and page WebGL identities disagree (async run)", "async-bad"],
  ["isCdpDetectedInWorker", "CDP serialized an Error inside a worker (async run)", "async-bad"],
  ["isMissingMediaDevices", "Desktop Chromium enumerated no audio or video devices (async run)", "async-bad"],
  ["isVoiceListInconsistent", "Installed speech voices contradict the claimed platform or browser brand (async run)", "async-bad"],
  ["isChromium", "Chromium-based browser — decides which checks apply", "info"],
];

const INSTANT_THRESHOLD = 0.5;
let instantFilter = "all";
let lastResult = null;

/** Ids of triggered signals whose weight is below the blocking threshold. */
function softSignalIds(result) {
  const soft = new Set();
  for (const signal of result.signals ?? []) {
    if (signal.triggered && signal.weight < INSTANT_THRESHOLD) {
      soft.add(signal.id);
    }
  }
  if (soft.has("isCdpDetected") || soft.has("isCdpDetectedInWorker")) {
    soft.add("isCdpDetected");
    soft.add("isCdpDetectedInWorker");
  }
  return soft;
}

function checkStatus(key, value, kind, soft) {
  if (kind === "info") {
    return {
      state: "na",
      result: typeof value === "boolean" ? String(value) : "n/a",
      verdict: "Informational",
    };
  }
  if (kind === "shader") {
    if (value === undefined) {
      return { state: "na", result: "n/a", verdict: "Run async check" };
    }
    if (value === null) {
      return { state: "na", result: "n/a", verdict: "Not available" };
    }
    if (value) {
      return { state: "pass", result: "true", verdict: "Not suspicious" };
    }
    return soft
      ? { state: "soft", result: "false", verdict: "Soft suspicious" }
      : { state: "flag", result: "false", verdict: "Suspicious" };
  }
  if (kind === "async-bad") {
    if (value === undefined) {
      return { state: "na", result: "n/a", verdict: "Run async check" };
    }
    if (value === null) {
      return { state: "na", result: "n/a", verdict: "Not available" };
    }
  }
  const flagged = kind === "good" ? !value : Boolean(value);
  const result = String(Boolean(value));
  if (!flagged) return { state: "pass", result, verdict: "Not suspicious" };
  return soft
    ? { state: "soft", result, verdict: "Soft suspicious" }
    : { state: "flag", result, verdict: "Suspicious" };
}

function countFlags(result) {
  const soft = softSignalIds(result);
  let flagged = 0;
  let softCount = 0;
  let total = 0;
  for (const [key, , kind] of CHECKS) {
    const { state } = checkStatus(key, result[key], kind, soft.has(key));
    if (state === "na") continue;
    total += 1;
    if (state === "flag") flagged += 1;
    if (state === "soft") softCount += 1;
  }
  return { flagged, softCount, triggered: flagged + softCount, total };
}

function renderChecks(result) {
  lastResult = result;
  const grid = $("check-grid");
  grid.replaceChildren();

  const soft = softSignalIds(result);
  const { triggered, softCount, total } = countFlags(result);
  const softNote = softCount ? ` (${softCount} soft)` : "";
  $("instant-count").textContent = `${triggered} suspicious${softNote} · ${total - triggered} not suspicious · ${total} checks`;

  let shown = 0;
  CHECKS.forEach(([key, desc, kind], index) => {
    const { state, result: resultText, verdict } = checkStatus(key, result[key], kind, soft.has(key));
    const isTriggered = state === "flag" || state === "soft";
    const visible =
      instantFilter === "all" ||
      (instantFilter === "flagged" && isTriggered) ||
      (instantFilter === "passed" && state === "pass");
    if (!visible) return;

    shown += 1;
    const card = document.createElement("article");
    const modifier = state === "flag" ? " check-card--flagged" : state === "soft" ? " check-card--soft" : "";
    card.className = `check-card${modifier}`;
    card.style.animationDelay = `${Math.min(index * 22, 400)}ms`;

    card.innerHTML = `
      <span class="check-card__name">${key}</span>
      <span class="check-card__result check-card__result--${state}">
        <span class="check-card__result-label">Result</span>
        <span class="check-card__result-value">${resultText}</span>
      </span>
      <span class="check-card__verdict check-card__verdict--${state}">${verdict}</span>
      <span class="check-card__desc">${desc}</span>
    `;
    grid.appendChild(card);
  });

  if (shown === 0) {
    const empty = document.createElement("p");
    empty.className = "check-grid__empty";
    empty.textContent =
      instantFilter === "flagged"
        ? "Nothing suspicious — this browser passes every instant check."
        : "No checks match this filter.";
    grid.appendChild(empty);
  }
}

function setBanner(prefix, tone, title, detail) {
  const banner = $(`${prefix}-banner`);
  banner.classList.remove("banner--ok", "banner--bad", "banner--pending");
  banner.classList.add(`banner--${tone}`);
  $(`${prefix}-banner-title`).textContent = title;
  $(`${prefix}-banner-detail`).textContent = detail;
  const pill = $(`${prefix}-banner-pill`);
  pill.className = `pill pill--${tone === "pending" ? "pending" : tone}`;
  pill.textContent = tone === "ok" ? "legit" : tone === "bad" ? "suspicious" : "pending";
}

function scoreText(result) {
  return (result.suspicionScore ?? 0).toFixed(2);
}

function automationText(result) {
  const assessment = result.automation;
  if (!assessment?.isAutomated) return "";
  return ` · likely ${assessment.kind} (${assessment.confidence} confidence)`;
}

function updateHero(result) {
  const { triggered, softCount, total } = countFlags(result);
  const card = $("hero-verdict");
  const highlight = $("hero-highlight");
  card.classList.remove("scan-card--ok", "scan-card--bad");
  highlight.classList.remove("is-human", "is-bot");

  if (result.isLegitClient) {
    card.classList.add("scan-card--ok");
    highlight.classList.add("is-human");
    highlight.textContent = "probably human?";
    $("hero-verdict-text").textContent = "Looks human";
    $("hero-verdict-detail").textContent = triggered
      ? `Score ${scoreText(result)} — ${softCount} soft signal${softCount === 1 ? "" : "s"}, none blocking`
      : "Every instant check passed";
  } else {
    card.classList.add("scan-card--bad");
    highlight.classList.add("is-bot");
    highlight.textContent = "acting like a bot?";
    $("hero-verdict-text").textContent = "Automation suspected";
    $("hero-verdict-detail").textContent = `Score ${scoreText(result)} · ${triggered} of ${total} checks flagged`;
  }

  $("hero-stat-instant").textContent = total;
  $("hero-stat-flagged").textContent = triggered;
}

function applyInstant(result, detailWhenOk, detailWhenBad) {
  renderChecks(result);
  updateHero(result);
  setBanner(
    "instant",
    result.isLegitClient ? "ok" : "bad",
    result.isLegitClient
      ? "This browser is below the automation threshold"
      : "Instant checks flagged this browser",
    result.isLegitClient ? detailWhenOk : detailWhenBad,
  );
}

function runInstant(detail = "") {
  const result = detectInstantClient(window);
  const { triggered, softCount } = countFlags(result);
  const passDetail =
    triggered === 0
      ? "detectInstantClient(window) — score 0.00, no signals"
      : `Score ${scoreText(result)} < 0.50 threshold · ${softCount} soft signal${softCount === 1 ? "" : "s"}`;
  applyInstant(
    result,
    detail || passDetail,
    detail || `Score ${scoreText(result)} ≥ 0.50 threshold${automationText(result)} — see the flagged cards below`,
  );
}

async function runAsync() {
  setBanner("instant", "pending", "Running async checks…", "Checking WebGPU, CDP, permissions, Client Hints, and workers");
  const result = await detectInstantClientAsync(window);
  const shader =
    result.isShaderF16Supported === null
      ? "WebGPU check not applicable in this browser"
      : `WebGPU shader-f16: ${result.isShaderF16Supported ? "supported" : "missing"}`;
  applyInstant(
    result,
    `Score ${scoreText(result)} · ${shader}`,
    `Score ${scoreText(result)} · ${shader}${automationText(result)}`,
  );
}

$("run-instant").addEventListener("click", () => runInstant());
$("copy-detection").addEventListener("click", (event) => {
  if (!lastResult) runInstant();
  copyText(JSON.stringify({
    version: VERSION,
    url: location.href,
    navigator: {
      userAgent: navigator.userAgent,
      appVersion: navigator.appVersion,
      platform: navigator.platform,
      webdriver: navigator.webdriver,
      brands: navigator.userAgentData?.brands,
    },
    result: lastResult,
  }, null, 2), event.currentTarget);
});
$("run-async").addEventListener("click", () => {
  runAsync();
});

for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => {
    for (const other of document.querySelectorAll(".chip")) other.classList.remove("chip--on");
    chip.classList.add("chip--on");
    instantFilter = chip.dataset.filter;
    if (lastResult) renderChecks(lastResult);
  });
}

/* bot simulation */

function showReset() {
  $("sim-reset").hidden = false;
}

$("sim-webdriver").addEventListener("click", (event) => {
  Object.defineProperty(navigator, "webdriver", { get: () => true, configurable: true });
  event.currentTarget.disabled = true;
  showReset();
  runInstant("Injected navigator.webdriver = true — this is what Selenium and Puppeteer expose");
});

$("sim-playwright").addEventListener("click", (event) => {
  window.__playwright = { demo: true };
  event.currentTarget.disabled = true;
  showReset();
  runInstant("Injected window.__playwright — a classic automation artifact");
});

$("sim-reset").addEventListener("click", () => location.reload());

/* ======================= behavioral — live trail ======================== */

const canvas = $("trail-canvas");
const ctx = canvas.getContext("2d");
const TRAIL_WINDOW_MS = 6_000;

const trail = [];
const marks = []; // clicks & synthetic events
const counts = { moves: 0, scrolls: 0, keys: 0, clicks: 0, touches: 0, synthetic: 0 };
let trailSequence = 0;

function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

new ResizeObserver(sizeCanvas).observe(canvas);

function toCanvas(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX / window.innerWidth) * rect.width,
    y: (clientY / window.innerHeight) * rect.height,
  };
}

function bumpCounter(id, key) {
  counts[key] += 1;
  $(id).textContent = counts[key];
}

window.addEventListener(
  "mousemove",
  (event) => {
    bumpCounter("count-moves", "moves");
    if (!event.isTrusted) bumpCounter("count-synthetic", "synthetic");
    trail.push({ ...toCanvas(event.clientX, event.clientY), t: performance.now(), trusted: event.isTrusted, seq: trailSequence });
    trailSequence += 1;
    if (trail.length > 600) trail.shift();
  },
  { passive: true },
);

// Touch draws the same trail as the mouse, so a phone or tablet shows a real
// gesture path instead of an empty canvas. Only single-finger activity is
// plotted; pinch and rotate interleave contacts and would zig-zag.
function recordTouch(event) {
  bumpCounter("count-touches", "touches");
  if (!event.isTrusted) bumpCounter("count-synthetic", "synthetic");
  if (event.touches.length !== 1) return;
  const point = event.changedTouches[0];
  if (!point) return;
  trail.push({ ...toCanvas(point.clientX, point.clientY), t: performance.now(), trusted: event.isTrusted, seq: trailSequence });
  trailSequence += 1;
  if (trail.length > 600) trail.shift();
}

window.addEventListener("touchstart", recordTouch, { passive: true });
window.addEventListener("touchmove", recordTouch, { passive: true });

window.addEventListener(
  "click",
  (event) => {
    bumpCounter("count-clicks", "clicks");
    if (!event.isTrusted) bumpCounter("count-synthetic", "synthetic");
    marks.push({ ...toCanvas(event.clientX, event.clientY), t: performance.now(), trusted: event.isTrusted });
  },
  { passive: true },
);

window.addEventListener("wheel", (event) => {
  bumpCounter("count-scrolls", "scrolls");
  if (!event.isTrusted) bumpCounter("count-synthetic", "synthetic");
}, { passive: true });

window.addEventListener("keydown", (event) => {
  bumpCounter("count-keys", "keys");
  if (!event.isTrusted) bumpCounter("count-synthetic", "synthetic");
}, { passive: true });

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawCheckpoint(point, color, alpha, radius) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawTrail() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  const now = performance.now();

  while (trail.length && now - trail[0].t > TRAIL_WINDOW_MS) trail.shift();
  while (marks.length && now - marks[0].t > TRAIL_WINDOW_MS) marks.shift();

  const accent = cssVar("--accent") || "#2a78d6";
  const bad = cssVar("--bad") || "#d03b3b";

  // path
  for (let i = 1; i < trail.length; i += 1) {
    const a = trail[i - 1];
    const b = trail[i];
    if (b.t - a.t > 400) continue; // gap — pointer left the window
    const age = (now - b.t) / TRAIL_WINDOW_MS;
    ctx.strokeStyle = b.trusted ? accent : bad;
    ctx.globalAlpha = Math.max(0, 1 - age) * 0.85;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // movement checkpoints
  for (const point of trail) {
    if (point.seq % 8 !== 0) continue;
    const age = (now - point.t) / TRAIL_WINDOW_MS;
    const alpha = Math.max(0, 1 - age) * 0.42;
    drawCheckpoint(point, point.trusted ? accent : bad, alpha, point.trusted ? 1.7 : 2.1);
  }

  // clicks
  for (const mark of marks) {
    const age = (now - mark.t) / TRAIL_WINDOW_MS;
    ctx.globalAlpha = Math.max(0, 1 - age);
    ctx.strokeStyle = mark.trusted ? accent : bad;
    ctx.lineWidth = mark.trusted ? 2.5 : 3.5;
    ctx.beginPath();
    ctx.arc(mark.x, mark.y, 8 + age * 12, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  requestAnimationFrame(drawTrail);
}

requestAnimationFrame(drawTrail);

/* ===================== behavioral — observation ========================= */

const SCORE_THRESHOLD = 0.55;
let observing = false;

function meterTone(score, threshold) {
  if (score >= threshold) return "bad";
  if (score >= threshold * 0.6) return "warn";
  return "good";
}

function paintMeter(fillId, valueId, score, threshold) {
  const fill = $(fillId);
  fill.style.width = `${Math.min(score * 100, 100)}%`;
  fill.classList.remove("meter__fill--warn", "meter__fill--bad");
  const tone = meterTone(score, threshold);
  if (tone !== "good") fill.classList.add(`meter__fill--${tone}`);
  $(valueId).textContent = score.toFixed(3);
}

function renderSignals(result) {
  const list = $("signal-list");
  list.replaceChildren();
  for (const signal of result.signals) {
    const item = document.createElement("li");
    item.className = `signal${signal.triggered ? " signal--hit" : ""}`;
    item.innerHTML = `
      <span class="signal__id">${signal.id}</span>
      <span class="signal__state">${signal.triggered ? "hit" : "clear"}</span>
      <span class="signal__meta">
        ${signal.description} · weight ${signal.weight.toFixed(2)}
        <span class="signal__weight" style="--w: ${signal.weight * 100}%" aria-hidden="true"></span>
      </span>
    `;
    list.appendChild(item);
  }
}

function renderBehavioralResult(result, live = false) {
  paintMeter("score-fill", "score-value", result.suspicionScore, SCORE_THRESHOLD);
  renderSignals(result);

  if (live) return;

  const hits = result.signals.filter((signal) => signal.triggered).length;
  const c = result.sampleCounts;
  setBanner(
    "behavioral",
    result.isLegitClient ? "ok" : "bad",
    result.isLegitClient ? "Interaction looks human" : "Interaction looks scripted",
    `${(result.observationMs / 1000).toFixed(1)}s observed · ${c.mouseMoves} moves, ${c.scrolls} scrolls, ` +
      `${c.keyPresses} keys, ${c.clicks} clicks · ${hits} signal${hits === 1 ? "" : "s"} hit · ` +
      `confidence ${result.confidence}`,
  );

  const heroScore = $("hero-stat-score");
  heroScore.textContent = result.suspicionScore.toFixed(2);
  heroScore.style.color = result.isLegitClient ? "" : `var(--bad-text)`;
}

async function observe(durationMs = 5_000) {
  if (observing) return null;
  observing = true;

  const button = $("observe-btn");
  button.disabled = true;
  setBanner("behavioral", "pending", "Observing…", "Move or swipe, scroll, tap, and type like you normally would");

  // Defer until the click that triggered us has finished dispatching.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const detector = createBehavioralClientDetector({
    context: window,
    scoreThreshold: SCORE_THRESHOLD,
    pollIntervalMs: 250,
    onUpdate: (live) => renderBehavioralResult(live, true),
  });

  const started = performance.now();
  const label = button.textContent;
  const tick = setInterval(() => {
    const left = Math.max(0, durationMs - (performance.now() - started));
    button.textContent = `Observing… ${(left / 1000).toFixed(1)}s`;
  }, 100);

  try {
    const result = await detector.observe(durationMs);
    renderBehavioralResult(result);
    return result;
  } finally {
    clearInterval(tick);
    button.textContent = label;
    button.disabled = false;
    observing = false;
  }
}

$("observe-btn").addEventListener("click", () => {
  observe();
});

/* replay a scripted interaction — every dispatched event is synthetic
   (isTrusted === false), exactly like a naive bot driving the page via JS */

async function replayBotScript() {
  const button = $("replay-bot");
  button.disabled = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const observation = observe(4_000);

  await sleep(300);

  // perfectly linear mouse sweep
  const startX = window.innerWidth * 0.15;
  const startY = window.innerHeight * 0.7;
  for (let step = 0; step <= 24; step += 1) {
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: startX + step * (window.innerWidth * 0.02),
        clientY: startY - step * 6,
        bubbles: true,
      }),
    );
    await sleep(16);
  }

  // metronome scrolling
  for (let step = 0; step < 6; step += 1) {
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true }));
    await sleep(90);
  }

  // robotic typing into the visible sample field
  const typingInput = $("type-input");
  typingInput.value = "";
  typingInput.focus();
  for (const char of "bot typing") {
    typingInput.value += char;
    typingInput.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
    typingInput.dispatchEvent(new InputEvent("input", { data: char, inputType: "insertText", bubbles: true }));
    await sleep(35);
  }

  // click with no organic mouse path
  window.dispatchEvent(
    new MouseEvent("click", { clientX: window.innerWidth * 0.8, clientY: startY, bubbles: true }),
  );

  await observation;
  button.disabled = false;
}

$("replay-bot").addEventListener("click", () => {
  replayBotScript();
});

/* ===================== server-signal simulator ========================== */

const SERVER_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SERVER_SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

const SERVER_SIGNALS = [
  {
    id: "abuse-listed-ip",
    weight: 0.6,
    confidence: "high",
    desc: "IP is on the AbuseIPDB 30-day blocklist",
    context: { clientIp: "203.0.113.66", isAbuseListedIp: true },
  },
  {
    id: "scripting-user-agent",
    weight: 0.75,
    confidence: "medium",
    desc: "User-Agent claims curl / Python / Go / Java",
    context: { userAgent: "curl/8.5.0" },
  },
  {
    id: "bot-user-agent",
    weight: 0.9,
    confidence: "high",
    desc: "User-Agent claims a known bot, HTTP, or automation client",
    context: { userAgent: "Mozilla/5.0 Googlebot/2.1" },
  },
  {
    id: "known-suspicious-tls",
    weight: 0.55,
    confidence: "high",
    desc: "JA3/JA4 matches a caller-supplied suspicious value",
    context: { tlsFingerprint: "custom-suspicious-fingerprint" },
    options: { suspiciousTlsFingerprints: ["custom-suspicious-fingerprint"] },
  },
  {
    id: "tls-user-agent-mismatch",
    weight: 0.5,
    confidence: "high",
    desc: "A recognized TLS client family conflicts with the User-Agent",
    context: {
      tlsFingerprint: "recognized-scripting-client-fingerprint",
      userAgent: SERVER_CHROME_UA,
    },
    options: {
      suspiciousTlsFingerprintEntries: [
        {
          id: "trusted-scripting-client",
          label: "Trusted scripting-client fingerprint",
          hash: "recognized-scripting-client-fingerprint",
          families: ["scripting"],
          confidence: "high",
        },
      ],
    },
  },
  {
    id: "timezone-mismatch",
    weight: 0.45,
    confidence: "high",
    desc: "Client timezone ≠ GeoIP timezone (>60 min)",
    context: { clientTimezone: "Europe/Berlin", ipTimezone: "America/New_York" },
  },
  {
    id: "client-hints-mismatch",
    weight: 0.65,
    confidence: "high",
    desc: "Chromium User-Agent version conflicts with sec-ch-ua",
    context: { userAgent: SERVER_CHROME_UA, secChUa: '\"Chromium\";v=\"149\"' },
  },
  {
    id: "client-user-agent-mismatch",
    weight: 0.8,
    confidence: "high",
    desc: "HTTP and browser-reported User-Agents conflict",
    context: { userAgent: SERVER_CHROME_UA, clientUserAgent: "different-agent" },
  },
  {
    id: "client-language-mismatch",
    weight: 0.45,
    confidence: "medium",
    desc: "Accept-Language conflicts with Navigator languages",
    context: {
      acceptLanguage: "en-US,en;q=0.9",
      clientLanguage: "sv-SE",
      clientLanguages: ["sv-SE"],
    },
  },
  {
    id: "client-platform-mismatch",
    weight: 0.55,
    confidence: "high",
    desc: "User-Agent OS conflicts with browser or Client Hints platform",
    context: {
      userAgent: SERVER_CHROME_UA,
      clientPlatform: "Linux x86_64",
      secChUaPlatform: '"Linux"',
    },
  },
  {
    id: "client-hints-mobile-mismatch",
    weight: 0.55,
    confidence: "high",
    desc: "sec-ch-ua-mobile conflicts with the User-Agent",
    context: { userAgent: SERVER_CHROME_UA, secChUaMobile: "?1" },
  },
  {
    id: "missing-browser-headers",
    weight: 0.35,
    confidence: "medium",
    desc: "Browser UA lacks Fetch Metadata headers (opt-in)",
    context: { userAgent: SERVER_CHROME_UA },
    options: { requireBrowserHeaders: true },
  },
  {
    id: "datacenter-browser-mismatch",
    weight: 0.35,
    confidence: "medium",
    desc: "Datacenter IP with a residential browser UA",
    context: { clientIp: "3.0.0.1", isDatacenterIp: true, userAgent: SERVER_CHROME_UA },
  },
  {
    id: "missing-tls-fingerprint",
    weight: 0.25,
    confidence: "medium",
    desc: "Browser UA without any TLS fingerprint",
    context: { userAgent: SERVER_CHROME_UA, tlsFingerprint: undefined },
    options: { requireTlsFingerprint: true },
  },
  {
    id: "accept-language-geo-mismatch",
    weight: 0.2,
    confidence: "low",
    desc: "No Accept-Language region matches the GeoIP country",
    context: { acceptLanguage: "ru-RU", ipCountry: "BR" },
  },
  {
    id: "icloud-private-relay",
    weight: 0.15,
    confidence: "low",
    desc: "iCloud Private Relay egress address",
    context: { clientIp: "172.224.226.10", isIcloudPrivateRelay: true },
  },
];

const PRESETS = {
  clean: [],
  "curl-aws": ["scripting-user-agent"],
  "stealth-vpn": ["timezone-mismatch", "datacenter-browser-mismatch", "accept-language-geo-mismatch"],
  relay: ["icloud-private-relay"],
};

const PRESET_CONTEXTS = {
  clean: {
    clientIp: "84.212.7.19",
    ipCountry: "NO",
    ipTimezone: "Europe/Oslo",
    clientTimezone: "Europe/Oslo",
    userAgent: SERVER_CHROME_UA,
    tlsFingerprint: "cd08e31494f9531f560d64c695473da9",
  },
  "curl-aws": {
    clientIp: "3.0.0.1",
    isDatacenterIp: true,
    userAgent: "curl/8.5.0",
  },
  "stealth-vpn": {
    clientIp: "45.86.200.14",
    ipCountry: "BR",
    ipTimezone: "America/Sao_Paulo",
    clientTimezone: "Asia/Singapore",
    userAgent: SERVER_CHROME_UA,
    acceptLanguage: "en-GB,en;q=0.9",
    tlsFingerprint: "cd08e31494f9531f560d64c695473da9",
    isDatacenterIp: true,
  },
  relay: {
    clientIp: "172.224.226.10",
    ipCountry: "GB",
    ipTimezone: "Europe/London",
    clientTimezone: "Europe/London",
    userAgent: SERVER_SAFARI_UA,
    tlsFingerprint: "773906b0efdefa24a7f2b8eb6985bf37",
    isIcloudPrivateRelay: true,
  },
};

const SERVER_THRESHOLD = 0.5;
const serverState = new Map(SERVER_SIGNALS.map((signal) => [signal.id, false]));

function activeServerSignalIds() {
  const ids = new Set();
  for (const signal of SERVER_SIGNALS) {
    if (!serverState.get(signal.id)) continue;
    ids.add(signal.id);
    for (const implied of signal.implies ?? []) ids.add(implied);
  }

  if (ids.has("known-suspicious-tls") || ids.has("tls-user-agent-mismatch")) {
    ids.delete("missing-tls-fingerprint");
  }

  return ids;
}

function serverScore(activeIds) {
  let keep = 1;
  for (const signal of SERVER_SIGNALS) {
    if (activeIds.has(signal.id)) keep *= 1 - signal.weight;
  }
  return 1 - keep;
}

function renderServer() {
  const activeIds = activeServerSignalIds();
  const score = serverScore(activeIds);
  const legit = score < SERVER_THRESHOLD;
  const active = SERVER_SIGNALS.filter((signal) => activeIds.has(signal.id));

  paintMeter("server-score-fill", "server-score-value", score, SERVER_THRESHOLD);
  setBanner(
    "server",
    legit ? "ok" : "bad",
    legit ? "Legit client" : "Request blocked",
    active.length === 0
      ? "No signals triggered"
      : `${active.length} signal${active.length === 1 ? "" : "s"}: ${active.map((s) => s.id).join(", ")}`,
  );

  // toggle row states
  for (const signal of SERVER_SIGNALS) {
    const row = $(`toggle-${signal.id}`);
    const on = activeIds.has(signal.id);
    row.classList.toggle("toggle-row--on", on);
    row.querySelector(".switch").setAttribute("aria-checked", String(on));
  }

  // Presets carry a coherent story. Custom mode merges illustrative fragments,
  // while its toggles intentionally score independently.
  const preset = $("preset-select").value;
  const context = preset in PRESET_CONTEXTS ? { ...PRESET_CONTEXTS[preset] } : {};
  const options = {};
  if (!(preset in PRESET_CONTEXTS)) {
    for (const signal of active) {
      Object.assign(context, signal.context);
      Object.assign(options, signal.options);
    }
  }
  const result = {
    suspicionScore: Number(score.toFixed(3)),
    isLegitClient: legit,
    signals: active.map((s) => ({ id: s.id, weight: s.weight, confidence: s.confidence })),
  };
  const optionsJson = Object.keys(options).length > 0
    ? `\n\n// options\n${JSON.stringify(options, null, 2)}`
    : "";
  $("server-json").textContent =
    `// illustrative context\n${JSON.stringify(context, null, 2)}${optionsJson}\n\n// independently simulated result\n${JSON.stringify(result, null, 2)}`;
}

function buildServerToggles() {
  const list = $("server-toggles");
  for (const signal of SERVER_SIGNALS) {
    const item = document.createElement("li");
    item.className = "toggle-row";
    item.id = `toggle-${signal.id}`;
    item.innerHTML = `
      <button class="switch" role="switch" aria-checked="false" aria-label="Toggle ${signal.id}"></button>
      <span class="toggle-row__text">
        <span class="toggle-row__id">${signal.id}</span>
        <span class="toggle-row__desc">${signal.desc} · ${signal.confidence} confidence</span>
      </span>
      <span class="toggle-row__weight">w ${signal.weight.toFixed(2)}</span>
    `;
    item.querySelector(".switch").addEventListener("click", () => {
      serverState.set(signal.id, !serverState.get(signal.id));
      if (serverState.get(signal.id) && signal.id === "missing-tls-fingerprint") {
        serverState.set("known-suspicious-tls", false);
        serverState.set("tls-user-agent-mismatch", false);
      }
      if (
        serverState.get(signal.id) &&
        (signal.id === "known-suspicious-tls" || signal.id === "tls-user-agent-mismatch")
      ) {
        serverState.set("missing-tls-fingerprint", false);
      }
      if (serverState.get(signal.id) && signal.id === "tls-user-agent-mismatch") {
        serverState.set("known-suspicious-tls", true);
      }
      if (!serverState.get(signal.id) && signal.id === "known-suspicious-tls") {
        serverState.set("tls-user-agent-mismatch", false);
      }
      $("preset-select").value = "custom";
      renderServer();
    });
    list.appendChild(item);
  }
}

$("preset-select").addEventListener("change", (event) => {
  const preset = event.target.value;
  if (preset === "custom") return;
  for (const signal of SERVER_SIGNALS) {
    serverState.set(signal.id, PRESETS[preset].includes(signal.id));
  }
  renderServer();
});

/* ===================== device intelligence demo server ==================== */

// The site is static, so the identification "server" runs in this tab: the
// real bot-signal/edge engine (WebCrypto, no Node built-ins). Its database is
// kept under its own storage key, separate from the client-side identifiers
// that "Wipe" removes, exactly as your real database is separate from the
// visitor's browser.
const DEMO_DB_KEY = "bot-signal-demo:db";
const DEMO_SALT = "bot-signal-public-demo-salt-do-not-reuse-0001";
const DEMO_ENDPOINT = "/demo/bot-signal";
let demoServer = null;

function readDemoDb() {
  try {
    const records = JSON.parse(localStorage.getItem(DEMO_DB_KEY) ?? "[]");
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function loadDemoServer() {
  demoServer ??= import("./edge.js").then(async (engine) => {
    const store = new engine.MemoryVisitorStore();
    for (const record of readDemoDb()) await store.saveVisitor(record);
    const intel = engine.createDeviceIntelligence({ salt: DEMO_SALT, store });
    async function persist(visitorId) {
      try {
        const record = await store.getVisitor(visitorId);
        const others = readDemoDb().filter((entry) => entry.visitorId !== visitorId);
        localStorage.setItem(DEMO_DB_KEY, JSON.stringify([...others, record].filter(Boolean).slice(-25)));
      } catch {
        /* storage full or blocked: the demo keeps working in memory */
      }
    }
    return { engine, intel, store, persist };
  });
  return demoServer;
}

const SCENARIOS = {
  you: {
    desc: "Your real browser, exactly as it is. Most people sail through with no challenge at all.",
    request: () => ({ userAgent: navigator.userAgent, acceptLanguage: (navigator.languages ?? []).join(",") }),
    mutate: (payload) => payload,
  },
  grey: {
    desc: "Your device, but in a private window with an anti-fingerprinting extension that noises the canvas. Suspicious, not proof, so strict actions get an invisible challenge instead of a block.",
    request: () => ({ userAgent: navigator.userAgent, acceptLanguage: (navigator.languages ?? []).join(",") }),
    mutate: (payload) => ({
      ...payload,
      smartSignals: {
        ...payload.smartSignals,
        incognito: true,
        privacyBrowser: payload.smartSignals.privacyBrowser ?? "brave",
        tampering: [...new Set([...payload.smartSignals.tampering, "isCanvasNoiseInjected"])],
      },
    }),
  },
  farm: {
    desc: "Your device has already opened three other accounts today. Multi-accounting and promo abuse show up in velocity, even with fresh emails.",
    request: () => ({ userAgent: navigator.userAgent, acceptLanguage: (navigator.languages ?? []).join(",") }),
    mutate: (payload) => payload,
  },
  bot: {
    desc: "A Python script replaying the request from a server. The server sees the client for what it is and refuses it. No challenge is wasted on it.",
    request: () => ({ userAgent: "python-requests/2.31.0" }),
    mutate: (payload) => payload,
  },
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A `fetch` that routes bot-signal requests to the in-tab engine and reports each step. */
function demoFetch(scenarioKey, onStep = () => {}) {
  const scenario = SCENARIOS[scenarioKey];
  return async (_url, init) => {
    const { intel, persist } = await loadDemoServer();
    const body = JSON.parse(init.body);
    if (body.solution) {
      const verified = await intel.verifyChallenge(body.solution);
      onStep({ type: "verify", verified });
      return verified.valid
        ? jsonResponse(200, { decision: "allow", token: verified.token })
        : jsonResponse(403, { decision: "block", error: "challenge_failed" });
    }
    const result = await intel.identify({
      payload: scenario.mutate(body.payload),
      request: scenario.request(),
      action: body.action,
      linkedId: body.linkedId,
      url: body.url,
    });
    await persist(result.event.visitorId);
    onStep({ type: "identify", result, durationMs: body.payload.durationMs });
    return jsonResponse(200, {
      eventId: result.event.eventId,
      visitorId: result.event.visitorId,
      confidence: result.event.confidence,
      sealedResult: result.sealedResult,
      // Simulated attackers don't get to plant identifiers in your real browser.
      storageToken: scenarioKey === "you" ? result.storageToken : undefined,
      decision: result.decision,
      token: result.token,
      challenge: result.challenge,
    });
  };
}

/* ============================ device ID section ============================ */

const deviceHistory = [];

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const MATCH_TEXT = {
  new: "First visit: new device registered",
  storage: "Recognised by its first-party token",
  fingerprint: "Recognised by device fingerprint alone",
};

function smartItem(name, value, tone = "ok") {
  const item = document.createElement("li");
  item.className = `smart${tone === "hit" ? " smart--hit" : tone === "bad" ? " smart--bad" : ""}`;
  const label = document.createElement("span");
  label.className = "smart__name";
  label.textContent = name;
  const text = document.createElement("span");
  text.className = "smart__value";
  text.textContent = value;
  item.append(label, text);
  return item;
}

function renderSmartSignals(signals) {
  const velocity = signals.velocity;
  const list = $("device-smart");
  list.replaceChildren(
    smartItem("Bot", signals.bot.result === "bad" ? `detected · ${signals.bot.automationKind}` : signals.bot.result === "good" ? "verified crawler" : "not detected", signals.bot.result === "bad" ? "bad" : "ok"),
    smartItem("Incognito", signals.incognito === null ? "unknown" : signals.incognito ? "yes" : "no", signals.incognito ? "hit" : "ok"),
    smartItem("Privacy browser", signals.privacyBrowser ?? "none", signals.privacyBrowser ? "hit" : "ok"),
    smartItem("Tampering", signals.tampering.detected ? signals.tampering.signals.join(", ") : "none", signals.tampering.detected ? "hit" : "ok"),
    smartItem("Virtual machine", signals.virtualMachine ? "likely" : "no", signals.virtualMachine ? "hit" : "ok"),
    smartItem(
      "VPN / proxy",
      signals.vpn.detected || signals.proxy ? "detected" : signals.ipInfo.ip ? "no" : "needs your server (no IP here)",
      signals.vpn.detected || signals.proxy ? "hit" : "ok",
    ),
    smartItem("Visits · 24 h", String(velocity.events["24h"])),
    smartItem("Accounts on device · 24 h", String(velocity.distinctLinkedId["24h"]), velocity.distinctLinkedId["24h"] > 2 ? "hit" : "ok"),
  );
}

function renderDevice(event, note) {
  const previous = deviceHistory.at(-1);
  deviceHistory.push({ event, note });

  const id = $("device-visitor-id");
  id.textContent = event.visitorId;
  id.classList.remove("is-flash");
  void id.offsetWidth;
  id.classList.add("is-flash");
  $("hero-stat-visitor").textContent = event.visitorId.slice(0, 8);
  $("hero-stat-visitor").title = event.visitorId;

  const meta = $("device-match");
  const sameAfterWipe = note === "wipe" && previous && previous.event.visitorId === event.visitorId;
  meta.classList.toggle("is-good", Boolean(sameAfterWipe));
  meta.textContent = sameAfterWipe
    ? "Same visitor ID after wiping the cookie and localStorage token"
    : MATCH_TEXT[event.matchedBy];

  $("device-confidence").textContent = `${Math.round(event.confidence * 100)}%`;
  $("device-visits").textContent = event.visitCount;
  $("device-matched-by").textContent = event.matchedBy;
  $("device-suspect").textContent = `${event.smartSignals.suspectScore}/100`;
  renderSmartSignals(event.smartSignals);
  $("device-json").textContent = JSON.stringify(event, null, 2);

  const row = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = formatTime(event.timestamp);
  const what = document.createElement("span");
  const label = note === "wipe" ? "after wipe" : note === "forget" ? "after forget" : note === "load" ? "page load" : "again";
  what.innerHTML = `${label} · <code>${event.visitorId.slice(0, 12)}…</code> via ${event.matchedBy}`;
  const verdict = document.createElement("span");
  if (previous) {
    const same = previous.event.visitorId === event.visitorId;
    verdict.className = same ? "same" : "changed";
    verdict.textContent = same ? "same ID" : "new ID";
  } else {
    verdict.textContent = `${Math.round(event.confidence * 100)}%`;
  }
  row.append(time, what, verdict);
  $("device-log").prepend(row);
}

async function runIdentify(note) {
  const buttons = ["device-identify", "device-wipe", "device-forget"].map($);
  buttons.forEach((button) => (button.disabled = true));
  let captured = null;
  try {
    await identify(window, {
      endpoint: DEMO_ENDPOINT,
      fetch: demoFetch("you", (step) => {
        if (step.type === "identify") captured = step.result.event;
      }),
    });
    if (captured) renderDevice(captured, note);
  } catch (error) {
    $("device-visitor-id").textContent = "unavailable";
    $("device-match").textContent = `The identification engine could not load here (${error.message}).`;
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

function wipeClientIdentifiers() {
  try {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
  } catch {
    /* blocked storage */
  }
  document.cookie = `${STORAGE_TOKEN_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

$("device-identify").addEventListener("click", () => runIdentify("again"));
$("device-wipe").addEventListener("click", () => {
  wipeClientIdentifiers();
  runIdentify("wipe");
});
$("device-forget").addEventListener("click", async () => {
  const current = deviceHistory.at(-1)?.event;
  if (current) {
    const { intel } = await loadDemoServer();
    await intel.deleteVisitor(current.visitorId);
    try {
      localStorage.setItem(DEMO_DB_KEY, JSON.stringify(readDemoDb().filter((r) => r.visitorId !== current.visitorId)));
    } catch {
      /* blocked storage */
    }
  }
  wipeClientIdentifiers();
  runIdentify("forget");
});

/* ============================ protect section ============================= */

let protectScenario = "you";

function setProtectBanner(tone, title, detail, pill) {
  const banner = $("protect-banner");
  banner.classList.remove("banner--ok", "banner--bad", "banner--pending");
  banner.classList.add(`banner--${tone}`);
  $("protect-banner-title").textContent = title;
  $("protect-banner-detail").textContent = detail;
  const pillEl = $("protect-banner-pill");
  pillEl.className = `pill pill--${tone}`;
  pillEl.textContent = pill;
}

function addStep(tone, title, detail) {
  const item = document.createElement("li");
  item.className = `is-${tone}`;
  const strong = document.createElement("strong");
  strong.textContent = title;
  const span = document.createElement("span");
  span.textContent = detail;
  item.append(strong, span);
  $("protect-timeline").append(item);
}

function selectScenario(key) {
  protectScenario = key;
  for (const chip of document.querySelectorAll("[data-scenario]")) {
    const on = chip.dataset.scenario === key;
    chip.classList.toggle("chip--on", on);
    chip.setAttribute("aria-pressed", String(on));
  }
  $("protect-scenario-desc").textContent = SCENARIOS[key].desc;
}

for (const chip of document.querySelectorAll("[data-scenario]")) {
  chip.addEventListener("click", () => selectScenario(chip.dataset.scenario));
}

async function seedAccountFarm(action) {
  const { intel } = await loadDemoServer();
  const payload = await collectDeviceSignals(window);
  const stamp = Date.now().toString(36);
  for (let index = 1; index <= 3; index += 1) {
    await intel.identify({ payload, request: SCENARIOS.farm.request(), action, linkedId: `farm-${stamp}-${index}@example.com` });
  }
}

$("protect-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("protect-submit");
  const action = $("protect-action").value;
  const email = $("protect-email").value.trim() || "ada@example.com";
  submit.disabled = true;
  $("protect-timeline").replaceChildren();
  setProtectBanner("pending", "Checking…", "Identifying the device and asking the server", "working");

  try {
    if (protectScenario === "farm") {
      await seedAccountFarm(action);
      addStep("warn", "Earlier today: 3 signups from this device", "Simulated: farm-…-1, -2, -3 @example.com");
    }
    let identified = null;
    let challenge = null;
    const startedAt = performance.now();
    const result = await protect(window, {
      endpoint: DEMO_ENDPOINT,
      action,
      linkedId: email,
      fetch: demoFetch(protectScenario, (step) => {
        if (step.type === "identify") {
          identified = step.result;
          challenge = step.result.challenge;
          addStep("good", "Device signals collected in the browser", `${Math.round(step.durationMs)} ms · 18 components + smart signals, sent once`);
          const tone = step.result.decision === "allow" ? "good" : step.result.decision === "challenge" ? "warn" : "bad";
          const reasons = step.result.reasons.length ? step.result.reasons.join(" · ") : "nothing suspicious";
          addStep(tone, `Server decision for "${action}": ${step.result.decision}`, `Suspect score ${step.result.event.smartSignals.suspectScore}/100 · ${reasons}`);
        }
        if (step.type === "verify") {
          addStep(step.verified.valid ? "good" : "bad", step.verified.valid ? "Server verified the proof-of-work" : "Server rejected the proof-of-work", step.verified.valid ? "Signature, expiry and work checked; challenge marked as used" : step.verified.reason);
        }
      }),
    });
    const totalMs = Math.round(performance.now() - startedAt);

    if (result.challenged) {
      addStep("good", `Invisible challenge solved in ${result.solveMs} ms`, `${challenge?.difficulty ?? "?"}-bit SHA-256 proof-of-work in the background. The visitor saw nothing.`);
    }

    if (!result.token) {
      setProtectBanner("bad", "Blocked", identified?.reasons[0] ?? "The server refused this request", "blocked");
      return;
    }

    const { intel } = await loadDemoServer();
    const check = await intel.verifyToken(result.token, { action });
    addStep(check.valid ? "good" : "bad", "Your signup route verified the token", check.valid ? `valid · visitor ${check.claims.visitorId.slice(0, 10)}… · challengePassed: ${check.claims.challengePassed}` : check.reason);
    const replay = await intel.verifyToken(result.token, { action });
    addStep("good", "Replaying the same token is refused", `reason: ${replay.reason} (tokens are single-use and expire after 5 minutes)`);

    setProtectBanner(
      "ok",
      result.challenged ? "Account created after an invisible check" : "Account created",
      `${totalMs} ms end to end · no CAPTCHA shown`,
      result.challenged ? "challenged" : "allowed",
    );
  } catch (error) {
    setProtectBanner("bad", "Something went wrong", error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

/* ================================ boot ================================== */

$("footer-ua").textContent = navigator.userAgent;
buildServerToggles();
renderServer();
sizeCanvas();

// show the full (untriggered) signal set from the real library up front
renderSignals({
  signals: buildBehavioralSignals({
    mouseMoves: [],
    scrolls: [],
    keyPresses: [],
    clicks: [],
    observationMs: 0,
  }),
});

selectScenario("you");

// small delay so the radar sweep reads as a scan
setTimeout(() => {
  runInstant();
  runIdentify("load");
}, 650);
