import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { detectServerClientAsync } from "bot-signal/server";
import type { ServerClientContext, ServerDetectorOptions } from "bot-signal/server";
import { createDecisionServer, readConfig } from "../../examples/nginx/server.mjs";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
const nginxBin = process.env.NGINX_BIN ?? "nginx";
const servers: Server[] = [];
const cleanups: Array<() => Promise<void>> = [];

async function listen(server: Server): Promise<number> {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  return address.port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const server of servers.splice(0)) {
    if (server.listening) await close(server);
  }
});

function detector() {
  return vi.fn((context: ServerClientContext, options: ServerDetectorOptions = {}) =>
    detectServerClientAsync(context, { ...options, lookupGeo: false, checkIpLists: false }),
  );
}

async function decisionService(options = {}) {
  const server = createDecisionServer({ log: vi.fn(), ...options });
  const port = await listen(server);
  return { server, url: `http://127.0.0.1:${port}/check` };
}

async function request(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; headers: Headers; body: string }>((resolve, reject) => {
    const req = httpRequest(url, { method: init.method, headers: init.headers, signal: AbortSignal.timeout(10_000) }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (typeof value === "string") headers.set(name, value);
        }
        resolve({ status: response.statusCode!, headers, body: Buffer.concat(chunks).toString() });
      });
    });
    req.on("error", reject);
    req.end(init.body);
  });
}

describe("decision service", () => {
  it("starts the shipped CLI through a symlink and applies real detection", async () => {
    const reserve = createServer();
    const port = await listen(reserve);
    await close(reserve);
    const dir = mkdtempSync(join(tmpdir(), "bot-signal-cli-"));
    cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
    const entry = join(dir, "service.mjs");
    symlinkSync(fileURLToPath(new URL("../../examples/nginx/server.mjs", import.meta.url)), entry);
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, BOT_SIGNAL_MODE: "enforce", BOT_SIGNAL_PORT: String(port), BOT_SIGNAL_THRESHOLD: "0.5" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    cleanups.push(() => stopProcess(child));
    let output = "";
    child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
    for (let attempt = 0; attempt < 200 && !output.includes("decision service:"); attempt++) {
      if (child.exitCode !== null) throw new Error(`CLI exited before startup: ${output}`);
      await setTimeout(20);
    }
    expect(output).toContain(`127.0.0.1:${port} (enforce)`);
    const url = `http://127.0.0.1:${port}/check`;
    expect((await request(url, { headers: { "X-Bot-Signal-Client-IP": "127.0.0.1", "User-Agent": CHROME_UA } })).status).toBe(204);
    expect((await request(url, { headers: { "X-Bot-Signal-Client-IP": "127.0.0.1", "User-Agent": "curl/8.0.0" } })).status).toBe(403);
  });

  it("validates defaults and deployment settings", () => {
    expect(readConfig({})).toEqual({ mode: "observe", port: 3001, scoreThreshold: 0.5 });
    expect(readConfig({ BOT_SIGNAL_MODE: "enforce", BOT_SIGNAL_PORT: "4001", BOT_SIGNAL_THRESHOLD: "0.8" }))
      .toEqual({ mode: "enforce", port: 4001, scoreThreshold: 0.8 });
    expect(() => createDecisionServer({ mode: "typo" })).toThrow("mode must");
  });

  it.each(["", "typo"])("rejects invalid mode %j", (value) => {
    expect(() => readConfig({ BOT_SIGNAL_MODE: value })).toThrow("BOT_SIGNAL_MODE");
  });

  it.each(["", "0", "65536", "1.5", "NaN"])("rejects invalid port %j", (value) => {
    expect(() => readConfig({ BOT_SIGNAL_PORT: value })).toThrow("BOT_SIGNAL_PORT");
  });

  it.each(["", "0", "-1", "1.1", "NaN", "Infinity"])("rejects invalid threshold %j", (value) => {
    expect(() => readConfig({ BOT_SIGNAL_THRESHOLD: value })).toThrow("BOT_SIGNAL_THRESHOLD");
  });

  it("allows a browser and denies curl using the existing detector", async () => {
    const { url } = await decisionService({ mode: "enforce", detect: detector() });
    const browser = await request(url, { headers: { "X-Bot-Signal-Client-IP": "127.0.0.1", "User-Agent": CHROME_UA } });
    expect(browser.status).toBe(204);
    expect(browser.headers.get("x-bot-signal-score")).toBe("0");
    expect(browser.headers.get("cache-control")).toBe("no-store");
    expect(browser.body).toBe("");
    const curl = await request(url, { headers: { "X-Bot-Signal-Client-IP": "127.0.0.1", "User-Agent": "curl/8.0.0" } });
    expect(curl.status).toBe(403);
    expect(curl.headers.get("x-bot-signal-decision")).toBe("deny");
  });

  it("uses the configured threshold without changing detection rules", async () => {
    const { url } = await decisionService({ mode: "enforce", detect: detector(), detectorOptions: { scoreThreshold: 0.8 } });
    const result = await request(url, { headers: { "X-Bot-Signal-Client-IP": "::1", "User-Agent": "curl/8.0.0" } });
    expect(result.status).toBe(204);
    expect(result.headers.get("x-bot-signal-score")).toBe("0.75");
  });

  it("observes suspicious requests without denying or logging private headers", async () => {
    const log = vi.fn();
    const { url } = await decisionService({ detect: detector(), log });
    const response = await request(url, { headers: {
      "X-Bot-Signal-Client-IP": "127.0.0.1", "User-Agent": "curl/8.0.0", Authorization: "Bearer private", Cookie: "session=private",
    } });
    expect(response.status).toBe(204);
    expect(response.headers.get("x-bot-signal-decision")).toBe("deny");
    expect(response.headers.get("x-bot-signal-mode")).toBe("observe");
    expect(log).toHaveBeenCalledWith({ mode: "observe", decision: "deny", allowed: true, suspicionScore: 0.75, signals: ["scripting-user-agent"] });
  });

  it.each([undefined, "invalid", "127.0.0.1, 8.8.8.8"])("rejects missing or malformed trusted IP %j", async (ip) => {
    const detect = detector();
    const { url } = await decisionService({ detect });
    const response = await request(url, { headers: ip ? { "X-Bot-Signal-Client-IP": ip } : {} });
    expect(response.status).toBe(503);
    expect(detect).not.toHaveBeenCalled();
  });

  it("does not use forwarded IP, browser verdicts, TLS or crawler claims", async () => {
    const detect = detector();
    const { url } = await decisionService({ detect });
    const response = await request(url, { headers: {
      "X-Bot-Signal-Client-IP": "2001:db8::1", "X-Forwarded-For": "8.8.8.8", "X-Real-IP": "8.8.4.4",
      "X-Bot-Signal-Decision": "allow", "X-JA3-Hash": "forged", "X-Bot-Signal-TLS-Fingerprint": "forged",
      "X-Bot-Signal-Crawler-Verification": "verified", "X-Timezone": "UTC", "User-Agent": CHROME_UA,
    } });
    expect(response.status).toBe(204);
    const context = detect.mock.calls[0][0];
    expect(context.clientIp).toBe("2001:db8::1");
    expect(context).not.toHaveProperty("crawlerVerificationStatus");
    expect(context).not.toHaveProperty("tlsFingerprint");
    expect(context).not.toHaveProperty("clientTimezone");
  });

  it("rejects unknown endpoints and methods before detection", async () => {
    const detect = detector();
    const { url } = await decisionService({ detect });
    expect((await request(url.replace("/check", "/other"))).status).toBe(404);
    const response = await request(url, { method: "POST", body: "private body" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(detect).not.toHaveBeenCalled();
  });

  it.each(["observe", "enforce"])("fails closed on detector errors in %s mode", async (mode) => {
    const log = vi.fn();
    const { url } = await decisionService({ mode, log, detect: vi.fn().mockRejectedValue(new Error("private failure details")) });
    const response = await request(url, { headers: { "X-Bot-Signal-Client-IP": "127.0.0.1" } });
    expect(response.status).toBe(503);
    expect(response.body).toBe("");
    expect(log).toHaveBeenCalledWith({ mode, error: "detection-failed" });
  });
});

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}

async function gateway(options = {}) {
  const detect = detector();
  const auth = createDecisionServer({ mode: "enforce", log: vi.fn(), detect, ...options });
  const authPort = await listen(auth);
  const appRequests: Array<{ method?: string; headers: IncomingHttpHeaders; body: string; url?: string }> = [];
  const app = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    appRequests.push({ method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString(), url: req.url });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(appRequests.at(-1)));
  });
  const appPort = await listen(app);
  const reserve = createServer();
  const gatewayPort = await listen(reserve);
  await close(reserve);
  const dir = mkdtempSync(join(tmpdir(), "bot-signal-nginx-"));
  cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
  const example = readFileSync(fileURLToPath(new URL("../../examples/nginx/server.conf", import.meta.url)), "utf8")
    .replace("127.0.0.1:8080", `127.0.0.1:${gatewayPort}`)
    .replace("127.0.0.1:3001", `127.0.0.1:${authPort}`)
    .replace("127.0.0.1:3000", `127.0.0.1:${appPort}`)
    .replace("proxy_read_timeout 3s", "proxy_read_timeout 200ms");
  writeFileSync(join(dir, "server.conf"), example);
  writeFileSync(join(dir, "nginx.conf"), `
worker_processes 1;
error_log stderr warn;
pid nginx.pid;
events { worker_connections 64; }
http {
    access_log off;
    client_body_temp_path client_body;
    proxy_temp_path proxy_temp;
    include server.conf;
}
`);
  try {
    execFileSync(nginxBin, ["-p", `${dir}/`, "-c", "nginx.conf", "-t"], { stdio: "pipe" });
  } catch (error) {
    throw new Error(`Nginx is required with auth_request support. Install it or set NGINX_BIN. ${String(error)}`);
  }
  const child = spawn(nginxBin, ["-p", `${dir}/`, "-c", "nginx.conf", "-g", "daemon off;"], { stdio: ["ignore", "ignore", "pipe"] });
  let errors = "";
  child.stderr?.on("data", (chunk) => { errors += chunk.toString(); });
  cleanups.push(() => stopProcess(child));
  const url = `http://127.0.0.1:${gatewayPort}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Nginx exited: ${errors}`);
    try {
      // Internal location: readiness request must not reach detection or the app.
      if ((await request(`${url}/_bot_signal`)).status === 404) {
        return { url, auth, detect, appRequests };
      }
    } catch {
      // Wait for the fresh test process to open its listener.
    }
    await setTimeout(20);
  }
  throw new Error(`Nginx did not start: ${errors}`);
}

describe("real Nginx gateway", () => {
  it("allows a browser and forwards trusted diagnostics to the app", async () => {
    const { url, appRequests } = await gateway();
    const response = await request(`${url}/account?tab=1`, { headers: {
      "User-Agent": CHROME_UA, "X-Bot-Signal-Decision": "forged", "X-Bot-Signal-Score": "1", "X-Bot-Signal-Mode": "forged",
    } });
    expect(response.status).toBe(200);
    expect(appRequests).toHaveLength(1);
    expect(appRequests[0].url).toBe("/account?tab=1");
    expect(appRequests[0].headers).toMatchObject({ "x-bot-signal-decision": "allow", "x-bot-signal-score": "0", "x-bot-signal-mode": "enforce" });
  });

  it("denies curl before the app is called even with a forged allow header", async () => {
    const { url, appRequests } = await gateway();
    const response = await request(url, { headers: { "User-Agent": "curl/8.0.0", "X-Bot-Signal-Decision": "allow" } });
    expect(response.status).toBe(403);
    expect(appRequests).toHaveLength(0);
  });

  it("replaces forged IP metadata and forwards only approved detector inputs", async () => {
    const { url, detect } = await gateway();
    const response = await request(url, { headers: {
      "User-Agent": CHROME_UA, "Accept-Language": "en-US,en;q=0.9", "Sec-CH-UA": '"Chromium";v="121"',
      "Sec-CH-UA-Platform": '"Windows"', "Sec-CH-UA-Mobile": "?0", "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", "X-Bot-Signal-Client-IP": "198.51.100.10",
      "X-Forwarded-For": "8.8.8.8", "X-Real-IP": "8.8.4.4", "X-JA3-Hash": "forged",
      "X-Bot-Signal-Crawler-Verification": "verified", Authorization: "Bearer private", Cookie: "session=private",
    } });
    expect(response.status).toBe(200);
    expect(detect).toHaveBeenCalledOnce();
    expect(detect.mock.calls[0][0]).toEqual({
      clientIp: "127.0.0.1", userAgent: CHROME_UA, acceptLanguage: "en-US,en;q=0.9", secChUa: '"Chromium";v="121"',
      secChUaPlatform: '"Windows"', secChUaMobile: "?0", secFetchSite: "same-origin", secFetchMode: "navigate", secFetchDest: "document",
    });
  });

  it("keeps observation mode diagnostics while allowing suspicious traffic", async () => {
    const { url, appRequests } = await gateway({ mode: "observe" });
    const response = await request(url, { headers: { "User-Agent": "curl/8.0.0" } });
    expect(response.status).toBe(200);
    expect(appRequests[0].headers).toMatchObject({ "x-bot-signal-decision": "deny", "x-bot-signal-mode": "observe" });
  });

  it("preserves POST method and body for the app, but sends neither to detection", async () => {
    const seen: Array<{ method?: string; body: string; headers: IncomingHttpHeaders }> = [];
    const { url, auth, appRequests } = await gateway();
    auth.on("request", (req) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => seen.push({ method: req.method, body: Buffer.concat(chunks).toString(), headers: req.headers }));
    });
    const response = await request(`${url}/submit`, { method: "POST", body: "private application payload", headers: {
      "User-Agent": CHROME_UA, Authorization: "Bearer private", Cookie: "session=private",
    } });
    expect(response.status).toBe(200);
    expect(appRequests[0]).toMatchObject({ method: "POST", body: "private application payload" });
    expect(appRequests[0].headers.authorization).toBe("Bearer private");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "GET", body: "" });
    expect(seen[0].headers.authorization).toBeUndefined();
    expect(seen[0].headers.cookie).toBeUndefined();
    expect(seen[0].headers["content-length"]).toBeUndefined();
  });

  it("does not expose the internal decision endpoint", async () => {
    const { url, detect, appRequests } = await gateway();
    expect((await request(`${url}/_bot_signal`)).status).toBe(404);
    expect(detect).not.toHaveBeenCalled();
    expect(appRequests).toHaveLength(0);
  });

  it("does not cache an allow verdict for a later suspicious request", async () => {
    const { url, detect, appRequests } = await gateway();
    expect((await request(url, { headers: { "User-Agent": CHROME_UA } })).status).toBe(200);
    expect((await request(url, { headers: { "User-Agent": "curl/8.0.0" } })).status).toBe(403);
    expect(detect).toHaveBeenCalledTimes(2);
    expect(appRequests).toHaveLength(1);
  });

  it("fails closed when the decision service is unavailable", async () => {
    const { url, auth, appRequests } = await gateway();
    await close(auth);
    expect((await request(url, { headers: { "User-Agent": CHROME_UA } })).status).toBe(500);
    expect(appRequests).toHaveLength(0);
  });

  it("fails closed when detection throws", async () => {
    const { url, appRequests } = await gateway({ detect: vi.fn().mockRejectedValue(new Error("failure")) });
    expect((await request(url, { headers: { "User-Agent": CHROME_UA } })).status).toBe(500);
    expect(appRequests).toHaveLength(0);
  });

  it("fails closed when the decision service exceeds the proxy timeout", async () => {
    const { url, appRequests } = await gateway({ detect: () => new Promise(() => {}) });
    expect((await request(url, { headers: { "User-Agent": CHROME_UA } })).status).toBe(500);
    expect(appRequests).toHaveLength(0);
  });
});
