import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({
  getEnv: () => ({ APP_URL: "https://rss.example.test/path" }),
}));

import { requireSameOriginMutation } from "@/lib/http/same-origin";

describe("requireSameOriginMutation", () => {
  it("accepts an exact normalized same-origin request", () => {
    expect(() => requireSameOriginMutation(new Request("https://rss.example.test/api/appearance", {
      method: "POST",
      headers: { origin: "https://rss.example.test", "sec-fetch-site": "same-origin" },
    }))).not.toThrow();
  });

  it.each([
    { headers: {} as Record<string, string> },
    { headers: { origin: "https://evil.example" } },
    { headers: { origin: "https://rss.example.test", "sec-fetch-site": "cross-site" } },
  ])("rejects missing, mismatched, or cross-site origin metadata", ({ headers }) => {
    expect(() => requireSameOriginMutation(new Request("https://rss.example.test/api/appearance", {
      method: "POST",
      headers,
    }))).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});
