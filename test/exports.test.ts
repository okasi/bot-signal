import { describe, expect, it } from "vitest";
import * as browserApi from "../src/browser.js";
import * as rootApi from "../src/index.js";
import * as serverApi from "../src/server.js";

describe("public entry points", () => {
  it("exports the browser API from the browser entry", () => {
    expect(browserApi).toMatchObject({
      detectInstantClient: expect.any(Function),
      detectInstantClientAsync: expect.any(Function),
      buildInstantSignals: expect.any(Function),
      aggregateInstantSuspicionScore: expect.any(Function),
      resolveInstantConfidence: expect.any(Function),
      createBehavioralClientDetector: expect.any(Function),
      analyzeBehavioralSamples: expect.any(Function),
      isSoftwareRenderer: expect.any(Function),
    });
    expect("detectServerClientAsync" in browserApi).toBe(false);
  });

  it("exports the server API from the server entry", () => {
    expect(serverApi).toMatchObject({
      detectServerClient: expect.any(Function),
      detectServerClientAsync: expect.any(Function),
      createIpListChecker: expect.any(Function),
      parseIp: expect.any(Function),
      preloadIpLists: expect.any(Function),
      isValidJa3Hash: expect.any(Function),
      normalizeTlsFingerprint: expect.any(Function),
    });
    expect("detectInstantClient" in serverApi).toBe(false);
  });

  it("exports both browser and server APIs from the root entry", () => {
    expect(rootApi).toMatchObject({
      detectInstantClient: expect.any(Function),
      createBehavioralClientDetector: expect.any(Function),
      detectServerClientAsync: expect.any(Function),
      getIpListChecker: expect.any(Function),
    });
  });
});
