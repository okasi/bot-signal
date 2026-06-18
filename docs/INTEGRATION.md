# Integration Guides

## Express

```ts
import express from "express";
import { detectServerClientAsync } from "is-suspicious-client";

const app = express();

app.set("trust proxy", true); // required for req.ip behind reverse proxy

app.use(async (req, res, next) => {
  const result = await detectServerClientAsync({
    clientIp: req.ip,
    clientTimezone: req.headers["x-timezone"] as string,
    userAgent: req.headers["user-agent"],
    acceptLanguage: req.headers["accept-language"],
    tlsFingerprint: req.headers["x-ja3-hash"] as string,
  });

  res.locals.botCheck = result;

  if (!result.isLegitClient && req.path !== "/blocked") {
    return res.status(403).json({
      error: "suspicious_client",
      score: result.suspicionScore,
      signals: result.signals.filter((s) => s.triggered),
    });
  }

  next();
});
```

### Client timezone beacon

```html
<script type="module">
  fetch("/api/beacon", {
    method: "POST",
    headers: {
      "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });
</script>
```

---

## Next.js (App Router)

### Client component guard

```tsx
// components/BotGuard.tsx
"use client";

import { useEffect, useState } from "react";
import { detectInstantClient } from "is-suspicious-client";

export function BotGuard({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    setAllowed(detectInstantClient(window).isLegitClient);
  }, []);

  if (allowed === null) return null; // or skeleton
  if (!allowed) return <p>Access denied.</p>;
  return <>{children}</>;
}
```

### Route handler (server)

```ts
// app/api/checkout/route.ts
import { detectServerClientAsync } from "is-suspicious-client";
import { headers } from "next/headers";

export async function POST(req: Request) {
  const h = await headers();

  const result = await detectServerClientAsync({
    clientIp: h.get("x-forwarded-for")?.split(",")[0] ?? "127.0.0.1",
    clientTimezone: h.get("x-timezone") ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
    acceptLanguage: h.get("accept-language") ?? undefined,
  });

  if (!result.isLegitClient) {
    return Response.json({ error: "blocked" }, { status: 403 });
  }

  // proceed...
}
```

---

## Hono

```ts
import { Hono } from "hono";
import { detectServerClientAsync } from "is-suspicious-client";

const app = new Hono();

app.use("*", async (c, next) => {
  const result = await detectServerClientAsync({
    clientIp: c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for"),
    clientTimezone: c.req.header("x-timezone"),
    userAgent: c.req.header("user-agent"),
    tlsFingerprint: c.req.header("x-ja3-hash"),
  });

  c.set("botCheck", result);

  if (!result.isLegitClient) {
    return c.json({ error: "suspicious" }, 403);
  }

  await next();
});
```

---

## Cloudflare Worker

GeoIP is built into Cloudflare — combine with this library's TLS and timezone checks:

```ts
import { detectServerClient } from "is-suspicious-client";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const cf = request.cf as { country?: string; timezone?: string };

    const result = detectServerClient({
      clientIp: request.headers.get("cf-connecting-ip") ?? undefined,
      ipCountry: cf?.country,
      ipTimezone: cf?.timezone,
      clientTimezone: request.headers.get("x-timezone") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
      tlsFingerprint: request.headers.get("cf-ja3-hash") ?? undefined,
      // Skip node geoip in Workers — pass CF data instead
    }, { lookupGeo: false, checkIpLists: false });

    if (!result.isLegitClient) {
      return new Response("Forbidden", { status: 403 });
    }

    return fetch(request);
  },
};
```

> For full blocklist checks in Workers, bundle `data/` and set `dataDir`, or run checks on your origin.

---

## nginx — pass JA3 to upstream

```nginx
# Requires ngx_http_ssl_ja3_module or OpenResty
proxy_set_header X-JA3-Hash $http_ssl_ja3_hash;
proxy_set_header X-Real-IP $remote_addr;
```

---

## Full-stack pattern

```
┌─────────────┐     X-Timezone beacon      ┌─────────────┐
│   Browser   │ ─────────────────────────► │   Server    │
│             │                            │             │
│  Instant ✓  │     API requests + IP      │  Server ✓   │
│  Behavioral │ ◄────────────────────────► │  Blocklists │
└─────────────┘                            └─────────────┘
```

1. **Page load:** `detectInstantClient(window)` — block obvious automation
2. **Beacon:** send `X-Timezone` header once
3. **Interaction:** `createBehavioralClientDetector().observe(10_000)` on sensitive flows
4. **Every API call:** `detectServerClientAsync({ clientIp, ... })` on the server

---

## Tuning thresholds

| Use case | `scoreThreshold` | Notes |
|----------|------------------|-------|
| Hard block | `0.35` | More false positives |
| Balanced | `0.50` – `0.55` | Default |
| Challenge only | `0.65` | CAPTCHA / extra verification |
| Log only | `1.0` | Never fails `isLegitClient` |

Log `result.signals.filter(s => s.triggered)` to tune for your traffic.
