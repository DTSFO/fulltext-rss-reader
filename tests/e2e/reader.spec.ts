import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const feedId = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";
const articleId = "33333333-3333-4333-8333-333333333333";

const feed = {
  id: feedId,
  title: "Example Engineering",
  canonicalUrl: "https://example.com/rss.xml",
  siteUrl: "https://example.com/",
  iconUrl: null,
  lastFetchedAt: "2026-07-13T02:00:00.000Z",
  lastErrorCode: null,
  lastErrorMessage: null,
  categoryIds: [categoryId],
};

const article = {
  id: articleId,
  feedId,
  feedTitle: feed.title,
  title: "确定性的全文阅读测试",
  author: "Example Author",
  summary: "用于 Playwright 关键路径验证。",
  url: "https://example.com/posts/e2e",
  publishedAt: "2026-07-13T01:00:00.000Z",
  sortDate: "2026-07-13T01:00:00.000Z",
  isRead: false,
  isStarred: false,
};

async function mockReaderApi(page: Page) {
  let isRead = article.isRead;
  let isStarred = article.isStarred;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/feeds" && request.method() === "GET") {
      await route.fulfill({ json: { data: { feeds: [feed] } } });
      return;
    }

    if (url.pathname === "/api/feeds" && request.method() === "POST") {
      await route.fulfill({ status: 201, json: { data: { feed } } });
      return;
    }

    if (url.pathname === "/api/categories") {
      await route.fulfill({
        json: { data: { categories: [{ id: categoryId, name: "个人博客", feedCount: 1 }] } },
      });
      return;
    }

    if (url.pathname === "/api/articles") {
      await route.fulfill({ json: { data: { items: [{ ...article, isRead, isStarred }], nextCursor: null } } });
      return;
    }

    if (url.pathname === `/api/articles/${articleId}` && request.method() === "PATCH") {
      const patch = request.postDataJSON() as { isRead?: boolean; isStarred?: boolean };
      isRead = patch.isRead ?? isRead;
      isStarred = patch.isStarred ?? isStarred;
      await route.fulfill({
        json: { data: { state: { isRead, isStarred } } },
      });
      return;
    }

    if (url.pathname === `/api/articles/${articleId}`) {
      await route.fulfill({
        json: {
          data: {
            article: {
              ...article,
              isRead,
              isStarred,
              feedContentHtml: "<p>订阅源正文</p>",
              extractedContentHtml: "<p>经过清洗的确定性全文。</p>",
              extractionStatus: "complete",
              contentHtml: "<p>经过清洗的确定性全文。</p>",
              usedFallback: false,
            },
          },
        },
      });
      return;
    }

    if (url.pathname === `/api/feeds/${feedId}/refresh`) {
      await route.fulfill({ json: { data: { feedId, itemCount: 1 } } });
      return;
    }

    await route.fulfill({ status: 500, json: { error: { message: "Unexpected mocked request" } } });
  });
}

test("desktop reader supports add, filter, read and star flows", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only flow");
  await mockReaderApi(page);
  await page.goto("/e2e/reader");

  await expect(page.getByRole("heading", { name: "今天的阅读" })).toBeVisible();
  await page.getByLabel("添加订阅").last().click();
  await expect(page.getByLabel("订阅地址")).toHaveValue("https://example.com/rss.xml");
  await page.getByLabel("分类（可选）").fill("个人博客");
  await page.getByRole("button", { name: "添加订阅" }).last().click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByRole("button", { name: "未读", exact: true }).click();
  await expect(page).toHaveURL(/e2e\/reader/);
  await page.getByRole("button", { name: /确定性的全文阅读测试/ }).click();
  await expect(page.getByText("经过清洗的确定性全文。")).toBeVisible();
  await page.getByRole("button", { name: "收藏文章" }).click();
  await expect(page.getByRole("button", { name: "取消收藏" })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("mobile reader keeps navigation and back actions reachable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobile-only flow");
  await mockReaderApi(page);
  await page.goto("/e2e/reader");

  await page.getByLabel("打开导航").click();
  await expect(page.getByRole("navigation", { name: "主要导航" })).toBeVisible();
  await page.getByRole("button", { name: "个人博客 · 1" }).click();
  await page.getByRole("button", { name: /确定性的全文阅读测试/ }).click();
  await expect(page.getByRole("button", { name: "返回文章列表" })).toBeVisible();
  await expect(page.getByText("经过清洗的确定性全文。")).toBeVisible();
  await page.getByRole("button", { name: "返回文章列表" }).click();
  await expect(page.getByRole("heading", { name: "个人博客" })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
