import {
  createBehavioralClientDetector,
  detectInstantClient,
  detectInstantClientAsync,
} from "./browser.js";

const INSTANT_LABELS = {
  isWebDriver: "navigator.webdriver",
  isPhantomJS: "PhantomJS globals",
  isNightmare: "Nightmare.js marker",
  isSelenium: "Selenium document markers",
  isDomAutomation: "DOM automation controller",
  isHeadless: "Headless / webdriver",
  isSuspiciousResolution: "Tiny screen resolution",
  isUserAgentValid: "Valid Mozilla UA prefix",
  isWebGLSupported: "WebGL available",
  isModern: "Modern browser version",
  isMissingChromeObject: "Missing chrome object (Chromium)",
  isSoftwareRenderer: "Software WebGL renderer",
  isSuspiciousWindowDimensions: "Suspicious window metrics",
  isEmptyPlugins: "Empty plugins array",
  isAutomationArtifacts: "Automation artifacts",
  isSuspiciousWebDriverDescriptor: "Suspicious webdriver descriptor",
  isChromium: "Chromium-based browser",
  isShaderF16Supported: "WebGPU shader-f16 (async)",
  isLegitClient: "Overall: legit client",
};

const instantVerdict = document.getElementById("instant-verdict");
const instantLabel = document.getElementById("instant-label");
const instantStatus = document.getElementById("instant-status");
const instantBadge = document.getElementById("instant-badge");
const instantTable = document.getElementById("instant-table");

const behavioralVerdict = document.getElementById("behavioral-verdict");
const behavioralLabel = document.getElementById("behavioral-label");
const behavioralStatus = document.getElementById("behavioral-status");
const behavioralBadge = document.getElementById("behavioral-badge");
const behavioralSignals = document.getElementById("behavioral-signals");
const scoreFill = document.getElementById("score-fill");
const scoreText = document.getElementById("score-text");

function setVerdict(container, labelEl, badgeEl, isLegit, label) {
  container.classList.toggle("legit", isLegit);
  container.classList.toggle("suspicious", !isLegit);
  labelEl.textContent = label;
  badgeEl.textContent = isLegit ? "Legit" : "Suspicious";
  badgeEl.className = `badge ${isLegit ? "ok" : "bad"}`;
}

function renderInstantRows(result) {
  instantTable.replaceChildren();
  for (const [key, value] of Object.entries(result)) {
    if (!(key in INSTANT_LABELS)) {
      continue;
    }

    const row = document.createElement("tr");
    const name = document.createElement("td");
    const state = document.createElement("td");

    name.innerHTML = `<code>${key}</code><br><span style="color:var(--muted)">${INSTANT_LABELS[key]}</span>`;

    const badge = document.createElement("span");
    if (key === "isLegitClient") {
      badge.className = `badge ${value ? "ok" : "bad"}`;
      badge.textContent = value ? "pass" : "fail";
    } else if (key === "isShaderF16Supported") {
      badge.className = `badge ${value === null ? "neutral" : value ? "ok" : "bad"}`;
      badge.textContent = value === null ? "n/a" : value ? "yes" : "no";
    } else {
      badge.className = `badge ${value ? "bad" : "ok"}`;
      badge.textContent = value ? "triggered" : "clear";
    }

    state.appendChild(badge);
    row.append(name, state);
    instantTable.appendChild(row);
  }
}

async function runInstant() {
  instantStatus.textContent = "Running detectInstantClient…";
  const result = detectInstantClient(window);
  renderInstantRows(result);
  setVerdict(
    instantVerdict,
    instantLabel,
    instantBadge,
    result.isLegitClient,
    result.isLegitClient ? "Looks like a legit browser" : "Instant checks flagged this client",
  );
  instantStatus.textContent = `UA: ${navigator.userAgent}`;
}

async function runAsync() {
  instantStatus.textContent = "Running detectInstantClientAsync…";
  const result = await detectInstantClientAsync(window);
  renderInstantRows(result);
  setVerdict(
    instantVerdict,
    instantLabel,
    instantBadge,
    result.isLegitClient,
    result.isLegitClient ? "Looks like a legit browser" : "Instant checks flagged this client",
  );
  instantStatus.textContent = `shader-f16: ${result.isShaderF16Supported}`;
}

function renderBehavioral(result) {
  const percent = Math.round(result.suspicionScore * 100);
  scoreFill.style.width = `${percent}%`;
  scoreText.textContent = `Score: ${result.suspicionScore.toFixed(3)} (threshold 0.55)`;

  setVerdict(
    behavioralVerdict,
    behavioralLabel,
    behavioralBadge,
    result.isLegitClient,
    result.isLegitClient ? "Behavior looks human" : "Behavior looks automated",
  );
  behavioralStatus.textContent = `Observed ${result.observationMs}ms · ${result.sampleCounts.mouseMoves} mouse moves`;

  behavioralSignals.replaceChildren();
  for (const signal of result.signals) {
    const item = document.createElement("li");
    item.className = signal.triggered ? "triggered" : "";
    item.innerHTML = `<span>${signal.id}</span><span>${signal.triggered ? "triggered" : "clear"}</span>`;
    behavioralSignals.appendChild(item);
  }
}

async function startBehavioral() {
  const button = document.getElementById("start-behavioral");
  button.disabled = true;
  behavioralStatus.textContent = "Observing interaction for 3 seconds…";

  try {
    const detector = createBehavioralClientDetector({
      context: window,
      scoreThreshold: 0.55,
    });
    const result = await detector.observe(3_000);
    renderBehavioral(result);
  } finally {
    button.disabled = false;
  }
}

document.getElementById("run-instant").addEventListener("click", () => {
  void runInstant();
});
document.getElementById("run-async").addEventListener("click", () => {
  void runAsync();
});
document.getElementById("start-behavioral").addEventListener("click", () => {
  void startBehavioral();
});

document.getElementById("inject-webdriver").addEventListener("click", () => {
  Object.defineProperty(navigator, "webdriver", {
    get: () => true,
    configurable: true,
  });
  instantStatus.textContent = "Injected navigator.webdriver = true";
  void runInstant();
});

document.getElementById("inject-playwright").addEventListener("click", () => {
  window.__playwright = { version: "demo" };
  instantStatus.textContent = "Injected window.__playwright";
  void runInstant();
});

void runInstant();
