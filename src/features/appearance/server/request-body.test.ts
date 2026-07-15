import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Module = typeof import("@/features/appearance/server/request-body");
let readBoundedJson: Module["readBoundedJson"];

beforeAll(async () => {
  ({ readBoundedJson } = await import("@/features/appearance/server/request-body"));
});

function jsonRequest(body: string, contentLength?: number): Request {
  return new Request("https://rss.example.test/api/appearance", {
    method: "POST",
    headers: contentLength === undefined ? undefined : { "content-length": String(contentLength) },
    body,
  });
}

describe("bounded appearance request bodies", () => {
  it("accepts JSON below and exactly at the byte limit", async () => {
    await expect(readBoundedJson(jsonRequest("{}"), 7)).resolves.toEqual({});
    await expect(readBoundedJson(jsonRequest("1"), 1)).resolves.toBe(1);
    await expect(readBoundedJson(jsonRequest('{"a":1}'), 7)).resolves.toEqual({ a: 1 });
    const unicode = '{"文字":"值"}';
    await expect(readBoundedJson(jsonRequest(unicode), Buffer.byteLength(unicode, "utf8"))).resolves.toEqual({ 文字: "值" });
  });

  it("rejects a streamed body above the byte limit without parsing a prefix", async () => {
    await expect(readBoundedJson(jsonRequest('{"a":1} '), 7)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
    });
  });

  it("rejects an oversized declared content length before consuming the body", async () => {
    await expect(readBoundedJson(jsonRequest("{}", 8), 7)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
    });
  });

  it.each(["{\"a\":", "{}{}", "{\"a\":tru}"])("rejects incomplete, multiple-root, or malformed JSON: %s", async (body) => {
    await expect(readBoundedJson(jsonRequest(body), 128)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });
});
