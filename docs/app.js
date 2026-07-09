import {
  buildBehavioralSignals,
  createBehavioralClientDetector,
  detectInstantClient,
  detectInstantClientAsync,
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
  ["isAutomationArtifacts", "ChromeDriver, Puppeteer, or Playwright leftovers on window/document", "bad"],
  ["isSuspiciousWebDriverDescriptor", "webdriver property was patched or deleted by a stealth layer", "bad"],
  ["isHeadless", "HeadlessChrome user agent or webdriver flag", "bad"],
  ["isSelenium", "Selenium markers on document", "bad"],
  ["isPhantomJS", "PhantomJS globals on window", "bad"],
  ["isNightmare", "Nightmare.js marker present", "bad"],
  ["isDomAutomation", "Chrome DOM-automation controller globals", "bad"],
  ["isMissingChromeObject", "Chromium claiming no chrome.runtime object", "bad"],
  ["isEmptyPlugins", "Zero navigator.plugins on desktop Chromium", "bad"],
  ["isSoftwareRenderer", "SwiftShader / llvmpipe software GPU renderer", "bad"],
  ["isSuspiciousResolution", "Screen smaller than any real device (136×170)", "bad"],
  ["isSuspiciousWindowDimensions", "No window chrome and parked exactly at the screen origin", "bad"],
  ["isUserAgentValid", "User agent has the universal 'Mozilla/5.0 (' prefix", "good"],
  ["isWebGLSupported", "A WebGL context can be created (headless Chromium 139+ has none)", "good"],
  ["isModern", "Chrome 121+ / Firefox 128+ / Safari 16.4+", "good"],
  ["isShaderF16Supported", "WebGPU shader-f16 feature (Chromium only, async run)", "shader"],
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
    detail || `Score ${scoreText(result)} ≥ 0.50 threshold — see the flagged cards below`,
  );
}

async function runAsync() {
  setBanner("instant", "pending", "Running async checks…", "Requesting a WebGPU adapter");
  const result = await detectInstantClientAsync(window);
  const shader =
    result.isShaderF16Supported === null
      ? "WebGPU check not applicable in this browser"
      : `WebGPU shader-f16: ${result.isShaderF16Supported ? "supported" : "missing"}`;
  applyInstant(result, `Score ${scoreText(result)} · ${shader}`, `Score ${scoreText(result)} · ${shader}`);
}

$("run-instant").addEventListener("click", () => runInstant());
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
const counts = { moves: 0, scrolls: 0, keys: 0, clicks: 0, synthetic: 0 };

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
    trail.push({ ...toCanvas(event.clientX, event.clientY), t: performance.now(), trusted: event.isTrusted });
    if (trail.length > 600) trail.shift();
  },
  { passive: true },
);

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

  // clicks
  for (const mark of marks) {
    const age = (now - mark.t) / TRAIL_WINDOW_MS;
    ctx.globalAlpha = Math.max(0, 1 - age);
    ctx.strokeStyle = mark.trusted ? accent : bad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mark.x, mark.y, 7 + age * 10, 0, Math.PI * 2);
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
  setBanner("behavioral", "pending", "Observing…", "Move, scroll, click, and type like you normally would");

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
    id: "known-suspicious-tls",
    weight: 0.55,
    confidence: "high",
    desc: "JA3 matches curl / Python / Go / Java",
    context: { tlsFingerprint: "b2114619bfb604579bbb31b673619900", userAgent: "curl/8.5.0" },
  },
  {
    id: "timezone-mismatch",
    weight: 0.45,
    confidence: "high",
    desc: "Client timezone ≠ GeoIP timezone (>60 min)",
    context: { clientTimezone: "Europe/Berlin", ipTimezone: "America/New_York" },
  },
  {
    id: "tls-user-agent-mismatch",
    weight: 0.5,
    confidence: "high",
    desc: "TLS fingerprint contradicts the User-Agent",
    context: { tlsFingerprint: "e7d705a3286e19ea42f587b344ee6865", userAgent: SERVER_CHROME_UA },
    implies: ["known-suspicious-tls"],
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
  "curl-aws": ["known-suspicious-tls"],
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
    tlsFingerprint: "b2114619bfb604579bbb31b673619900",
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

  if (ids.has("known-suspicious-tls") && ids.has("datacenter-browser-mismatch")) {
    ids.add("tls-user-agent-mismatch");
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

  // representative context JSON — presets carry a coherent story of their
  // own; custom toggling composes self-contained signal fragments
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
    `// context\n${JSON.stringify(context, null, 2)}${optionsJson}\n\n// result\n${JSON.stringify(result, null, 2)}`;
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

// small delay so the radar sweep reads as a scan
setTimeout(() => runInstant(), 650);
