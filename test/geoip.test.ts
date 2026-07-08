import { describe, expect, it, vi } from "vitest";
import { lookup } from "doc999tor-fast-geoip";
import { lookupClientIpGeo } from "../src/server/geoip.js";

vi.mock("doc999tor-fast-geoip", () => ({
  lookup: vi.fn(),
}));

describe("lookupClientIpGeo", () => {
  it("maps geo lookup fields", async () => {
    vi.mocked(lookup).mockResolvedValueOnce({
      country: "US",
      timezone: "America/New_York",
      city: "New York",
      region: "NY",
    });

    await expect(lookupClientIpGeo("8.8.8.8")).resolves.toEqual({
      ipCountry: "US",
      ipTimezone: "America/New_York",
      city: "New York",
      region: "NY",
    });
  });

  it("returns null when lookup misses or throws", async () => {
    vi.mocked(lookup).mockResolvedValueOnce(null);
    vi.mocked(lookup).mockRejectedValueOnce(new Error("bad ip"));

    await expect(lookupClientIpGeo("203.0.113.1")).resolves.toBeNull();
    await expect(lookupClientIpGeo("not-an-ip")).resolves.toBeNull();
  });

  it("omits empty geo fields", async () => {
    vi.mocked(lookup).mockResolvedValueOnce({
      country: "",
      timezone: "",
      city: "",
      region: "",
    });

    await expect(lookupClientIpGeo("192.0.2.1")).resolves.toEqual({
      ipCountry: undefined,
      ipTimezone: undefined,
      city: undefined,
      region: undefined,
    });
  });
});
