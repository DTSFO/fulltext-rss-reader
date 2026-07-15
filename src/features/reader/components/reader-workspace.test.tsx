import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReaderWorkspace } from "./reader-workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

const feed = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Example Engineering",
  canonicalUrl: "https://example.com/rss.xml",
  siteUrl: "https://example.com/",
  iconUrl: null,
  lastFetchedAt: "2026-07-13T02:00:00.000Z",
  lastErrorCode: null,
  lastErrorMessage: null,
  categoryIds: ["22222222-2222-4222-8222-222222222222"],
};

const article = {
  id: "33333333-3333-4333-8333-333333333333",
  feedId: feed.id,
  feedTitle: feed.title,
  title: "一篇安静的测试文章",
  author: "Example Author",
  summary: "用于验证阅读器交互。",
  url: "https://example.com/posts/test",
  publishedAt: "2026-07-13T01:00:00.000Z",
  sortDate: "2026-07-13T01:00:00.000Z",
  isRead: false,
  isStarred: false,
};

function renderReader() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ReaderWorkspace username="demo-user" />
    </QueryClientProvider>,
  );
}

function json(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("ReaderWorkspace", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the add-feed dialog with the production feed and closes on Escape", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/feeds") return json({ data: { feeds: [] } });
      if (url === "/api/categories") return json({ data: { categories: [] } });
      if (url.startsWith("/api/articles")) return json({ data: { items: [], nextCursor: null } });
      return json({ error: { message: "Unexpected request" } }, 500);
    });
    const user = userEvent.setup();
    renderReader();

    await user.click((await screen.findAllByLabelText("添加订阅"))[0]);
    expect(screen.getByRole("dialog", { name: "添加订阅" })).toBeInTheDocument();
    expect(screen.getByLabelText("订阅地址")).toHaveValue("https://example.com/rss.xml");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "添加订阅" })).not.toBeInTheDocument();
  });

  it("requests unread and category-filtered article lists from navigation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/feeds") return json({ data: { feeds: [feed] } });
      if (url === "/api/categories") {
        return json({ data: { categories: [{ id: feed.categoryIds[0], name: "个人博客", feedCount: 1 }] } });
      }
      if (url.startsWith("/api/articles")) return json({ data: { items: [], nextCursor: null } });
      return json({ error: { message: "Unexpected request" } }, 500);
    });
    const user = userEvent.setup();
    renderReader();

    await user.click(await screen.findByRole("button", { name: "未读" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("unread=true"), expect.anything()));

    await user.click(screen.getByRole("button", { name: "个人博客 · 1" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`categoryId=${feed.categoryIds[0]}`), expect.anything()));
  });

  it("marks an opened article read and can star it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/feeds") return json({ data: { feeds: [feed] } });
      if (url === "/api/categories") return json({ data: { categories: [] } });
      if (url.startsWith("/api/articles?") || url === "/api/articles?") {
        return json({ data: { items: [article], nextCursor: null } });
      }
      if (url === `/api/articles/${article.id}` && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { isRead?: boolean; isStarred?: boolean };
        return json({ data: { state: { isRead: body.isRead ?? true, isStarred: body.isStarred ?? false } } });
      }
      if (url === `/api/articles/${article.id}`) {
        return json({
          data: {
            article: {
              ...article,
              feedContentHtml: "<p>Feed content</p>",
              extractedContentHtml: "<p>Clean full text</p>",
              extractionStatus: "complete",
              contentHtml: "<p>Clean full text</p>",
              usedFallback: false,
            },
          },
        });
      }
      return json({ error: { message: "Unexpected request" } }, 500);
    });
    const user = userEvent.setup();
    renderReader();

    await user.click(await screen.findByRole("button", { name: /一篇安静的测试文章/ }));
    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
      expect(patchCalls.some(([, init]) => String(init?.body).includes('"isRead":true'))).toBe(true);
    });

    await user.click(await screen.findByRole("button", { name: "收藏文章" }));
    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
      expect(patchCalls.some(([, init]) => String(init?.body).includes('"isStarred":true'))).toBe(true);
    });
  });
});
