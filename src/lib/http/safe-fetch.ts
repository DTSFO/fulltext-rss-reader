import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";
import { isIP } from "node:net";

import ipaddr from "ipaddr.js";

import { AppError } from "@/lib/errors/app-error";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_REDIRECTS = 5;

type SafeFetchOptions = {
  accept?: readonly string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
};

export type SafeTextResponse = {
  body: string;
  contentType: string;
  finalUrl: string;
  status: number;
};

type PublicAddress = {
  address: string;
  family: 4 | 6;
};

type ResolvedHttpTarget = {
  addresses: PublicAddress[];
  url: URL;
};

type PinnedResponse = {
  body: string;
  contentType: string;
  headers: IncomingHttpHeaders;
  status: number;
};

export function normalizeHttpUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      message: "请输入有效的订阅地址。",
      status: 400,
      cause: error,
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError({
      code: "VALIDATION_ERROR",
      message: "订阅地址仅支持 HTTP 或 HTTPS。",
      status: 400,
    });
  }

  if (url.username || url.password) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      message: "订阅地址不能包含用户名或密码。",
      status: 400,
    });
  }

  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }

  return url;
}

export function isPublicIpAddress(value: string) {
  if (!ipaddr.isValid(value)) {
    return false;
  }

  let address = ipaddr.parse(value);

  if (address.kind() === "ipv6") {
    const ipv6Address = address as ipaddr.IPv6;

    if (ipv6Address.isIPv4MappedAddress()) {
      address = ipv6Address.toIPv4Address();
    }
  }

  return address.range() === "unicast";
}

export async function assertPublicHttpUrl(value: string | URL) {
  return (await resolvePublicHttpTarget(value)).url;
}

async function resolvePublicHttpTarget(value: string | URL): Promise<ResolvedHttpTarget> {
  const url = normalizeHttpUrl(value.toString());
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);

  if (literalFamily) {
    if (!isPublicIpAddress(hostname)) {
      throw privateAddressError();
    }

    return {
      addresses: [{ address: hostname, family: literalFamily as 4 | 6 }],
      url,
    };
  }

  let addresses: Array<{ address: string; family: number }>;

  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new AppError({
      code: "FEED_FETCH_FAILED",
      message: "无法解析订阅源域名。",
      status: 422,
      cause: error,
    });
  }

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw privateAddressError();
  }

  return {
    addresses: addresses.map(({ address, family }) => ({
      address,
      family: family === 6 ? 6 : 4,
    })),
    url,
  };
}

export async function safeFetchText(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeTextResponse> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const acceptedTypes = options.accept ?? ["application/rss+xml", "application/atom+xml", "application/xml", "text/xml", "text/html", "text/plain"];

  let currentTarget = await resolvePublicHttpTarget(input);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    let response: PinnedResponse;

    try {
      response = await requestPinnedText(currentTarget, {
        acceptedTypes,
        maxBytes,
        timeoutMs,
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError({
        code: "FEED_FETCH_FAILED",
        message:
          error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")
            ? "订阅源请求超时。"
            : "无法连接到订阅源。",
        status: 422,
        cause: error,
      });
    }

    if (response.status >= 300 && response.status < 400) {
      const location = firstHeaderValue(response.headers.location);

      if (!location) {
        throw new AppError({
          code: "FEED_FETCH_FAILED",
          message: "订阅源返回了无效的重定向。",
          status: 422,
        });
      }

      if (redirectCount === maxRedirects) {
        throw new AppError({
          code: "FEED_FETCH_FAILED",
          message: "订阅源重定向次数过多。",
          status: 422,
        });
      }

      currentTarget = await resolvePublicHttpTarget(new URL(location, currentTarget.url));
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new AppError({
        code: "FEED_FETCH_FAILED",
        message: `订阅源返回 HTTP ${response.status}。`,
        status: 422,
      });
    }

    return {
      body: response.body,
      contentType: response.contentType,
      finalUrl: currentTarget.url.toString(),
      status: response.status,
    };
  }

  throw new AppError({
    code: "FEED_FETCH_FAILED",
    message: "订阅源重定向次数过多。",
    status: 422,
  });
}

async function requestPinnedText(
  target: ResolvedHttpTarget,
  {
    acceptedTypes,
    maxBytes,
    timeoutMs,
  }: {
    acceptedTypes: readonly string[];
    maxBytes: number;
    timeoutMs: number;
  },
): Promise<PinnedResponse> {
  // Use the already-validated address as the socket destination. Keeping the
  // original hostname in Host/servername preserves virtual hosting and TLS
  // certificate verification without allowing a second DNS lookup to rebind.
  const address = target.addresses[0];
  const hostname = target.url.hostname.replace(/^\[|\]$/g, "");
  const requestOptions: RequestOptions | HttpsRequestOptions = {
    agent: false,
    family: address.family,
    headers: {
      accept: acceptedTypes.join(", "),
      "accept-encoding": "identity",
      host: target.url.host,
      "user-agent": "Example Author-RSS/0.1 (+https://demo.example.com)",
    },
    hostname: address.address,
    method: "GET",
    path: `${target.url.pathname}${target.url.search}`,
    port: target.url.port ? Number(target.url.port) : undefined,
  };

  if (target.url.protocol === "https:" && !isIP(hostname)) {
    (requestOptions as HttpsRequestOptions).servername = hostname;
  }

  const request = target.url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<PinnedResponse>((resolve, reject) => {
    let response: IncomingMessage | undefined;
    let settled = false;

    const finish = (result: PinnedResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      response?.destroy();
      reject(error);
    };

    const clientRequest = request(requestOptions, (incoming) => {
      response = incoming;
      const status = incoming.statusCode ?? 0;
      const contentType = firstHeaderValue(incoming.headers["content-type"])?.split(";", 1)[0]?.trim().toLowerCase() ?? "";

      if ((status >= 300 && status < 400) || status < 200 || status >= 300) {
        incoming.destroy();
        finish({ body: "", contentType, headers: incoming.headers, status });
        return;
      }

      const isAccepted = acceptedTypes.some((type) => contentType === type || contentType.endsWith("+xml"));

      if (contentType && !isAccepted) {
        fail(
          new AppError({
            code: "FEED_FETCH_FAILED",
            message: "订阅地址返回了不支持的内容类型。",
            status: 422,
            details: { contentType },
          }),
        );
        return;
      }

      const declaredLength = Number(firstHeaderValue(incoming.headers["content-length"]) ?? 0);

      if (declaredLength > maxBytes) {
        fail(responseTooLargeError());
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;

      incoming.on("data", (chunk: Buffer) => {
        totalBytes += chunk.byteLength;

        if (totalBytes > maxBytes) {
          fail(responseTooLargeError());
          return;
        }

        chunks.push(chunk);
      });
      incoming.once("end", () => {
        finish({
          body: Buffer.concat(chunks, totalBytes).toString("utf8"),
          contentType,
          headers: incoming.headers,
          status,
        });
      });
      incoming.once("error", fail);
      incoming.once("aborted", () => fail(new Error("Response aborted")));
    });

    const timer = setTimeout(() => {
      const error = new DOMException("Request timed out", "TimeoutError");
      response?.destroy(error);
      clientRequest.destroy(error);
      fail(error);
    }, timeoutMs);

    clientRequest.once("error", fail);
    clientRequest.end();
  });
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function privateAddressError() {
  return new AppError({
    code: "FEED_FETCH_FAILED",
    message: "订阅地址不能指向本机或私有网络。",
    status: 422,
  });
}

function responseTooLargeError() {
  return new AppError({
    code: "FEED_FETCH_FAILED",
    message: "订阅源响应内容过大。",
    status: 422,
  });
}
