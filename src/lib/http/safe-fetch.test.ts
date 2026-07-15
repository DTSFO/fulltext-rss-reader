import { describe, expect, it } from "vitest";

import { assertPublicHttpUrl, isPublicIpAddress, normalizeHttpUrl } from "./safe-fetch";

describe("normalizeHttpUrl", () => {
  it("normalizes host casing, default port, whitespace, and fragments", () => {
    expect(normalizeHttpUrl(" HTTPS://Example.COM:443/rss.xml#latest ").toString()).toBe(
      "https://example.com/rss.xml",
    );
  });

  it("rejects credentials and unsupported protocols", () => {
    expect(() => normalizeHttpUrl("https://user:pass@example.com/feed")).toThrow();
    expect(() => normalizeHttpUrl("file:///etc/passwd")).toThrow();
  });
});

describe("isPublicIpAddress", () => {
  it("allows public unicast addresses", () => {
    expect(isPublicIpAddress("1.1.1.1")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("rejects loopback, private, link-local, and metadata addresses", () => {
    expect(isPublicIpAddress("127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("10.0.0.1")).toBe(false);
    expect(isPublicIpAddress("169.254.169.254")).toBe(false);
    expect(isPublicIpAddress("::1")).toBe(false);
    expect(isPublicIpAddress("fc00::1")).toBe(false);
  });
});

describe("assertPublicHttpUrl", () => {
  it("rejects private literal addresses before requesting them", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1/feed.xml")).rejects.toMatchObject({
      code: "FEED_FETCH_FAILED",
    });
  });
});
