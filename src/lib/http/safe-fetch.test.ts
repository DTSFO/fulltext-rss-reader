import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  httpRequest: vi.fn(),
  httpsRequest: vi.fn(),
  lookup: vi.fn(),
}));

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return {
    ...actual,
    default: { ...actual, lookup: mocks.lookup },
    lookup: mocks.lookup,
  };
});
vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return {
    ...actual,
    default: { ...actual, request: mocks.httpRequest },
    request: mocks.httpRequest,
  };
});
vi.mock("node:https", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:https")>();
  return {
    ...actual,
    default: { ...actual, request: mocks.httpsRequest },
    request: mocks.httpsRequest,
  };
});

import { assertPublicHttpUrl, isPublicIpAddress, normalizeHttpUrl, safeFetchText } from "./safe-fetch";

beforeEach(() => {
  mocks.httpRequest.mockReset();
  mocks.httpsRequest.mockReset();
  mocks.lookup.mockReset();
});

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

describe("safeFetchText", () => {
  it("connects to the validated IP while preserving the HTTPS hostname", async () => {
    mocks.lookup.mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }]);
    mockResponse(mocks.httpsRequest, {
      body: "<rss />",
      headers: { "content-type": "application/rss+xml" },
      status: 200,
    });

    const response = await safeFetchText("https://feeds.example.com/rss.xml?full=1");
    const requestOptions = mocks.httpsRequest.mock.calls[0]?.[0] as HttpsTestRequestOptions;

    expect(response.body).toBe("<rss />");
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(requestOptions).toEqual(
      expect.objectContaining({
        family: 4,
        hostname: "1.1.1.1",
        path: "/rss.xml?full=1",
        servername: "feeds.example.com",
      }),
    );
    expect(requestOptions.headers).toEqual(
      expect.objectContaining({
        "accept-encoding": "identity",
        host: "feeds.example.com",
      }),
    );
  });

  it("resolves and pins every redirect hop independently", async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }])
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]);
    mockResponse(mocks.httpRequest, {
      headers: { location: "https://cdn.example.net/feed.xml" },
      status: 302,
    });
    mockResponse(mocks.httpsRequest, {
      body: "feed",
      headers: { "content-type": "text/plain" },
      status: 200,
    });

    const response = await safeFetchText("http://feeds.example.com/start");
    const firstOptions = mocks.httpRequest.mock.calls[0]?.[0] as RequestOptions;
    const secondOptions = mocks.httpsRequest.mock.calls[0]?.[0] as HttpsTestRequestOptions;

    expect(response.finalUrl).toBe("https://cdn.example.net/feed.xml");
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
    expect(firstOptions.hostname).toBe("1.1.1.1");
    expect(secondOptions).toEqual(
      expect.objectContaining({
        hostname: "8.8.8.8",
        servername: "cdn.example.net",
      }),
    );
  });

  it("blocks a redirect hop that resolves to a private address", async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    mockResponse(mocks.httpsRequest, {
      headers: { location: "http://internal.example.test/admin" },
      status: 302,
    });

    await expect(safeFetchText("https://feeds.example.com/start")).rejects.toMatchObject({
      code: "FEED_FETCH_FAILED",
      message: "订阅地址不能指向本机或私有网络。",
    });
    expect(mocks.httpsRequest).toHaveBeenCalledTimes(1);
    expect(mocks.httpRequest).not.toHaveBeenCalled();
  });
});

function mockResponse(
  requestMock: typeof mocks.httpRequest,
  {
    body = "",
    headers = {},
    status,
  }: {
    body?: string;
    headers?: Record<string, string>;
    status: number;
  },
) {
  requestMock.mockImplementationOnce((options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const request = new EventEmitter() as ClientRequest;

    request.end = vi.fn(() => {
      queueMicrotask(() => {
        const response = new PassThrough();
        const incoming = response as unknown as IncomingMessage;
        incoming.statusCode = status;
        incoming.headers = headers;
        callback(incoming);
        response.end(body);
      });
      return request;
    }) as ClientRequest["end"];
    request.destroy = vi.fn((error?: Error) => {
      if (error) queueMicrotask(() => request.emit("error", error));
      return request;
    });

    return request;
  });
}

type HttpsTestRequestOptions = RequestOptions & { servername?: string };
