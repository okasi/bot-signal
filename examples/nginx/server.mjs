import { createServer } from "node:http";
import { existsSync, realpathSync } from "node:fs";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import { detectServerClientAsync, preloadIpLists } from "bot-signal/server";

/** Read and validate deployment settings before accepting traffic. */
export function readConfig(env = process.env) {
  const mode = env.BOT_SIGNAL_MODE ?? "observe";
  const port = Number(env.BOT_SIGNAL_PORT ?? "3001");
  const scoreThreshold = Number(env.BOT_SIGNAL_THRESHOLD ?? "0.5");
  if (mode !== "observe" && mode !== "enforce") {
    throw new Error("BOT_SIGNAL_MODE must be observe or enforce");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("BOT_SIGNAL_PORT must be an integer between 1 and 65535");
  }
  if (!Number.isFinite(scoreThreshold) || scoreThreshold <= 0 || scoreThreshold > 1) {
    throw new Error("BOT_SIGNAL_THRESHOLD must be greater than 0 and at most 1");
  }
  return { mode, port, scoreThreshold };
}

/**
 * The caller must be a trusted local Nginx instance, which replaces the private
 * IP header and forwards only the request headers listed in server.conf.
 * Browser-supplied verdicts, fingerprints and crawler claims are not accepted.
 */
export function createDecisionServer({
  mode = "observe",
  detectorOptions = {},
  detect = detectServerClientAsync,
  log = (entry) => console.info(JSON.stringify(entry)),
} = {}) {
  if (mode !== "observe" && mode !== "enforce") {
    throw new Error("mode must be observe or enforce");
  }
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url !== "/check") {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET" }).end();
      return;
    }

    const header = (name) => {
      const value = req.headers[name];
      return typeof value === "string" ? value : undefined;
    };
    const clientIp = header("x-bot-signal-client-ip");
    if (!clientIp || !isIP(clientIp)) {
      // Misconfigured proxy metadata is an infrastructure error, not a bot verdict.
      res.writeHead(503).end();
      return;
    }

    try {
      const result = await detect({
        clientIp,
        userAgent: header("user-agent"),
        acceptLanguage: header("accept-language"),
        secChUa: header("sec-ch-ua"),
        secChUaPlatform: header("sec-ch-ua-platform"),
        secChUaMobile: header("sec-ch-ua-mobile"),
        secFetchSite: header("sec-fetch-site"),
        secFetchMode: header("sec-fetch-mode"),
        secFetchDest: header("sec-fetch-dest"),
      }, detectorOptions);
      const allowed = mode === "observe" || result.isLegitClient;
      const decision = result.isLegitClient ? "allow" : "deny";
      log({
        mode,
        decision,
        allowed,
        suspicionScore: result.suspicionScore,
        signals: result.signals.filter((signal) => signal.triggered).map((signal) => signal.id),
      });
      res.writeHead(allowed ? 204 : 403, {
        "X-Bot-Signal-Score": String(result.suspicionScore),
        "X-Bot-Signal-Decision": decision,
        "X-Bot-Signal-Mode": mode,
      }).end();
    } catch {
      log({ mode, error: "detection-failed" });
      // auth_request treats non-2xx/401/403 responses as an error and blocks.
      res.writeHead(503).end();
    }
  });
}

const entryPath = process.argv[1];
if (entryPath && existsSync(entryPath) && import.meta.url === pathToFileURL(realpathSync(entryPath)).href) {
  const { mode, port, scoreThreshold } = readConfig();
  preloadIpLists();
  const server = createDecisionServer({ mode, detectorOptions: { scoreThreshold } });
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.info(`bot-signal decision service: 127.0.0.1:${port} (${mode})`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => server.close());
  }
}
