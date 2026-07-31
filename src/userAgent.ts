export type ScriptingUserAgentKind = "curl" | "python" | "go" | "java";

const SCRIPTING_USER_AGENT_PATTERNS: Array<{
  kind: ScriptingUserAgentKind;
  pattern: RegExp;
}> = [
  {
    kind: "curl",
    pattern: /(?:^|[\s;(])curl\/\d+(?:\.\d+)*(?=$|[\s;)])/i,
  },
  {
    kind: "python",
    pattern:
      /(?:^|[\s;(])(?:python-requests|urllib3|python-urllib|aiohttp|httpx)\/\d+(?:\.\d+)*(?=$|[\s;)])/i,
  },
  {
    kind: "go",
    pattern: /(?:^|[\s;(])Go-http-client\/\d+(?:\.\d+)*(?=$|[\s;)])/i,
  },
  {
    kind: "java",
    pattern:
      /(?:^|[\s;(])(?:Java|Java-http-client|Apache-HttpClient|okhttp)\/\d+(?:[._]\d+)*(?=$|[\s;)])/i,
  },
];

export type BotUserAgentKind =
  | "crawler"
  | "http-client"
  | "browser-automation"
  | "playwright"
  | "puppeteer"
  | "selenium"
  | "phantomjs";

const BOT_USER_AGENT_PATTERNS: Array<{
  kind: BotUserAgentKind;
  pattern: RegExp;
}> = [
  {
    kind: "crawler",
    pattern:
      /(?:^|[\s;(])(?:Googlebot(?:-[A-Za-z]+)?|Google-InspectionTool|GoogleOther(?:-[A-Za-z]+)?|bingbot|Baiduspider|YandexBot|DuckDuckBot|Applebot|PetalBot|AhrefsBot|SemrushBot|GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-SearchBot|Amazonbot|Bytespider|CCBot|PerplexityBot|YouBot|facebookexternalhit|Twitterbot)\/\d+(?:\.\d+)*(?=$|[\s;)])/i,
  },
  {
    kind: "crawler",
    pattern:
      /(?:^|[\s;(])(?:AdsBot-Google(?:-Mobile)?|GoogleOther(?:-[A-Za-z]+)?)(?=$|[\s;)])/i,
  },
  {
    kind: "http-client",
    pattern: /(?:^|[\s;(])Wget\/\d+(?:\.\d+)*(?=$|[\s;)])/i,
  },
  {
    kind: "browser-automation",
    pattern: /(?:^|[\s;(])HeadlessChrome\/\d+(?:\.\d+)*(?=$|[\s;)])/i,
  },
  {
    kind: "playwright",
    pattern: /(?:^|[\s;(])Playwright\/\d+(?:\.\d+)*(?=$|[\s;)])/i,
  },
  {
    kind: "puppeteer",
    pattern: /(?:^|[\s;(])Puppeteer\/\d+(?:\.\d+)*(?=$|[\s;)])/i,
  },
  {
    kind: "selenium",
    pattern: /(?:^|[\s;(])Selenium\/\d+(?:\.\d+)*(?=$|[\s;)])/i,
  },
  {
    kind: "phantomjs",
    pattern: /(?:^|[\s;(])(?:PhantomJS|SlimerJS)\/\d+(?:\.\d+)*(?=$|[\s;)])/i,
  },
];

/** Scripting HTTP client claimed by a well-formed User-Agent product token. */
export function getScriptingUserAgentKind(
  userAgent: string,
): ScriptingUserAgentKind | null {
  return (
    SCRIPTING_USER_AGENT_PATTERNS.find(({ pattern }) => pattern.test(userAgent))
      ?.kind ?? null
  );
}

/** Conservative known crawler, HTTP client, or browser-automation UA token. */
export function isBotUserAgent(userAgent: string | undefined): boolean {
  return getBotUserAgentKind(userAgent) !== null;
}

/** Family claimed by a conservative bot or automation product token. */
export function getBotUserAgentKind(
  userAgent: string | undefined,
): BotUserAgentKind | null {
  if (!userAgent) {
    return null;
  }

  return (
    BOT_USER_AGENT_PATTERNS.find(({ pattern }) => pattern.test(userAgent))
      ?.kind ?? null
  );
}
