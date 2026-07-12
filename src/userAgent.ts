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

/** Scripting HTTP client claimed by a well-formed User-Agent product token. */
export function getScriptingUserAgentKind(
  userAgent: string,
): ScriptingUserAgentKind | null {
  return (
    SCRIPTING_USER_AGENT_PATTERNS.find(({ pattern }) => pattern.test(userAgent))
      ?.kind ?? null
  );
}
