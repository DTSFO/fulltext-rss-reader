import { lookup } from "node:dns/promises";
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
  const url = normalizeHttpUrl(value.toString());
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw privateAddressError();
    }

    return url;
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

  return url;
}

export async function safeFetchText(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeTextResponse> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const acceptedTypes = options.accept ?? ["application/rss+xml", "application/atom+xml", "application/xml", "text/xml", "text/html", "text/plain"];

  let currentUrl = await assertPublicHttpUrl(input);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    let response: Response;

    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: acceptedTypes.join(", "),
          "user-agent": "Example Author-RSS/0.1 (+https://demo.example.com)",
        },
      });
    } catch (error) {
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
      const location = response.headers.get("location");

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

      currentUrl = await assertPublicHttpUrl(new URL(location, currentUrl));
      continue;
    }

    if (!response.ok) {
      throw new AppError({
        code: "FEED_FETCH_FAILED",
        message: `订阅源返回 HTTP ${response.status}。`,
        status: 422,
      });
    }

    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const isAccepted = acceptedTypes.some((type) => contentType === type || contentType.endsWith("+xml"));

    if (contentType && !isAccepted) {
      throw new AppError({
        code: "FEED_FETCH_FAILED",
        message: "订阅地址返回了不支持的内容类型。",
        status: 422,
        details: { contentType },
      });
    }

    const declaredLength = Number(response.headers.get("content-length") ?? 0);

    if (declaredLength > maxBytes) {
      throw responseTooLargeError();
    }

    let body: string;

    try {
      body = await readBoundedText(response, maxBytes);
    } catch (error) {
      if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
        throw new AppError({
          code: "FEED_FETCH_FAILED",
          message: "订阅源响应超时。",
          status: 422,
          cause: error,
        });
      }

      throw error;
    }

    return {
      body,
      contentType,
      finalUrl: currentUrl.toString(),
      status: response.status,
    };
  }

  throw new AppError({
    code: "FEED_FETCH_FAILED",
    message: "订阅源重定向次数过多。",
    status: 422,
  });
}

async function readBoundedText(response: Response, maxBytes: number) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw responseTooLargeError();
    }

    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
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
