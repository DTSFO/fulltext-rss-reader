import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

import {
  BUILTIN_THEMES,
  type AppearanceSnapshot,
} from "../../src/features/appearance/theme-contract";

const themeId = "44444444-4444-4444-8444-444444444444";
const baseStoredTheme = {
  id: themeId,
  name: "E2E Paper",
  declaredScheme: "light" as const,
  tokenContractVersion: 1 as const,
  tokens: structuredClone(BUILTIN_THEMES.light.tokens),
  validationCanvas: BUILTIN_THEMES.light.validationCanvas,
  browserValidation: null as unknown,
  themeRevision: "1",
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
};

function storedTheme(overrides: Partial<typeof baseStoredTheme> = {}) {
  return { ...baseStoredTheme, ...overrides };
}

function snapshot(mode: "light" | "dark" | "system" = "system"): AppearanceSnapshot {
  return {
    stateRevision: "1",
    publishedRevision: "1",
    config: {
      mode,
      lightTheme: { kind: "builtin" as const },
      darkTheme: { kind: "builtin" as const },
      recoveryShortcut: {
        code: "KeyY",
        ctrl: false,
        alt: true,
        meta: false,
        shift: true,
        conflictTableVersion: 1 as const,
      },
      escapeRecoveryEnabled: true,
    },
    lightTheme: BUILTIN_THEMES.light,
    darkTheme: BUILTIN_THEMES.dark,
  };
}

async function mockAppearanceApi(page: Page) {
  let currentSnapshot = snapshot();
  let currentTheme = storedTheme();
  let fence = 0;

  await page.route("**/api/appearance**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === "/api/appearance" && method === "GET") {
      await route.fulfill({ json: { data: { snapshot: currentSnapshot } } });
      return;
    }
    if (url.pathname === "/api/appearance" && method === "PATCH") {
      const input = request.postDataJSON() as {
        action: string;
        mode?: "light" | "dark" | "system";
        recoveryShortcut?: typeof currentSnapshot.config.recoveryShortcut;
        escapeRecoveryEnabled?: boolean;
      };
      if (input.action === "set-mode" && input.mode) {
        currentSnapshot = {
          ...currentSnapshot,
          publishedRevision: String(Number(currentSnapshot.publishedRevision) + 1),
          config: { ...currentSnapshot.config, mode: input.mode },
        };
      }
      if (input.action === "set-recovery" && typeof input.escapeRecoveryEnabled === "boolean") {
        currentSnapshot = {
          ...currentSnapshot,
          publishedRevision: String(Number(currentSnapshot.publishedRevision) + 1),
          config: {
            ...currentSnapshot.config,
            recoveryShortcut: input.recoveryShortcut ?? null,
            escapeRecoveryEnabled: input.escapeRecoveryEnabled,
          },
        };
      }
      await route.fulfill({ json: { data: { snapshot: currentSnapshot } } });
      return;
    }
    if (url.pathname === "/api/appearance/themes" && method === "GET") {
      await route.fulfill({
        json: {
          data: {
            items: [{
              id: themeId,
              name: currentTheme.name,
              declaredScheme: "light",
              themeRevision: currentTheme.themeRevision,
              updatedAt: currentTheme.updatedAt,
              hasDraft: false,
            }],
            nextCursor: null,
          },
        },
      });
      return;
    }
    if (url.pathname === `/api/appearance/themes/${themeId}` && method === "GET") {
      await route.fulfill({ json: { data: { theme: currentTheme, draft: null } } });
      return;
    }
    if (url.pathname === `/api/appearance/themes/${themeId}/impact` && method === "GET") {
      await route.fulfill({
        json: {
          data: {
            action: "change-scheme",
            themeId,
            stateRevision: currentSnapshot.stateRevision,
            affectedSlots: [],
            currentlyActive: false,
            displacedThemeId: null,
            impactDigest: "a".repeat(64),
          },
        },
      });
      return;
    }
    if (url.pathname === "/api/appearance/leases/acquire") {
      const input = request.postDataJSON() as {
        resources: Array<{ kind: "root" | "config" | "theme"; themeId?: string }>;
      };
      fence += 1;
      await route.fulfill({
        json: {
          data: {
            handles: input.resources.map((resource) => ({
              resource,
              leaseId: crypto.randomUUID(),
              lockEpoch: "0",
              fence: String(fence),
              expiresAt: "2099-01-01T00:00:00.000Z",
              serverNow: "2026-07-13T00:00:00.000Z",
              requiresDraftResolution: false,
            })),
          },
        },
      });
      return;
    }
    if (url.pathname === "/api/appearance/leases/renew") {
      const input = request.postDataJSON() as { handles: unknown[] };
      await route.fulfill({ json: { data: { handles: input.handles } } });
      return;
    }
    if (url.pathname === "/api/appearance/leases/release") {
      await route.fulfill({ json: { data: { released: true } } });
      return;
    }
    if (url.pathname === `/api/appearance/themes/${themeId}/autosave`) {
      const input = request.postDataJSON() as {
        snapshot: {
          tokens: typeof baseStoredTheme.tokens;
          validationCanvas: typeof baseStoredTheme.validationCanvas;
          browserValidation: unknown;
        };
      };
      currentTheme = storedTheme({
        tokens: input.snapshot.tokens,
        validationCanvas: input.snapshot.validationCanvas,
        browserValidation: input.snapshot.browserValidation,
        themeRevision: String(Number(currentTheme.themeRevision) + 1),
        updatedAt: "2026-07-13T00:01:00.000Z",
      });
      await route.fulfill({
        json: {
          data: {
            kind: "formal-saved",
            theme: currentTheme,
            snapshot: currentSnapshot,
            stateRevision: "2",
            publishedRevision: "2",
          },
        },
      });
      return;
    }
    if (url.pathname === `/api/appearance/export/theme/${themeId}`) {
      await route.fulfill({ json: { kind: "fulltext-rss-reader.theme", version: 1, theme: currentTheme } });
      return;
    }
    await route.fulfill({
      status: 500,
      json: { error: { code: "UNEXPECTED", message: `Unexpected ${method} ${url.pathname}` } },
    });
  });

  return {
    setSnapshot(nextSnapshot: AppearanceSnapshot) {
      currentSnapshot = nextSnapshot;
    },
    setThemeName(name: string) {
      currentTheme = storedTheme({ ...currentTheme, name });
    },
  };
}

test("desktop appearance settings switch modes, edit, autosave and trial", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only appearance flow");
  await mockAppearanceApi(page);
  await page.goto("/e2e/appearance");

  await expect(page.getByRole("heading", { name: "外观与主题" })).toBeVisible();
  await page.getByRole("button", { name: "暗色", exact: true }).click();
  await expect(page.getByRole("button", { name: "暗色", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("编辑E2E Paper").click();
  await page.getByLabel("页面背景回退色").fill("#f5f2e9ff");
  await expect(page.getByText("已保存正式主题")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "开启全页试用" }).click();
  await expect(page.getByRole("button", { name: "退出全页试用" })).toBeVisible();
  await page.getByRole("button", { name: "退出全页试用" }).click();

  await expect(page.getByRole("button", { name: "主要操作" })).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.getByTestId("theme-preview-danger-action")).toHaveCSS("color", "rgb(255, 255, 255)");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("rapid config choices are committed in user-action order", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only config ordering flow");
  await mockAppearanceApi(page);
  let firstPending = false;
  let overlapped = false;
  let revision = 1;
  await page.route("**/api/appearance", async (route) => {
    const request = route.request();
    if (request.method() !== "PATCH") {
      await route.fallback();
      return;
    }
    const input = request.postDataJSON() as { action: string; mode?: "light" | "dark" | "system" };
    if (input.action !== "set-mode" || !input.mode) {
      await route.fallback();
      return;
    }
    revision += 1;
    const responseRevision = String(revision);
    if (input.mode === "dark") {
      firstPending = true;
      await new Promise((resolve) => setTimeout(resolve, 250));
      firstPending = false;
    } else if (firstPending) {
      overlapped = true;
    }
    await route.fulfill({
      json: {
        data: {
          snapshot: {
            ...snapshot(input.mode),
            stateRevision: responseRevision,
            publishedRevision: responseRevision,
          },
        },
      },
    });
  });
  await page.goto("/e2e/appearance");
  await page.getByRole("button", { name: "暗色", exact: true }).click();
  await page.getByRole("button", { name: "明亮", exact: true }).click();

  await expect(page.getByRole("button", { name: "明亮", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(overlapped).toBe(false);
});

test("draft-only autosave exits full-page trial and restores the formal theme", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only trial failure flow");
  await mockAppearanceApi(page);
  await page.route(`**/api/appearance/themes/${themeId}/autosave`, async (route) => {
    await route.fulfill({
      json: {
        data: {
          kind: "draft-saved",
          draftRevision: "1",
          stateRevision: "2",
          diagnostics: [{ path: "tokens.background", code: "CONTRAST_FAILED", message: "对比度不足。" }],
        },
      },
    });
  });
  await page.goto("/e2e/appearance");
  await page.getByLabel("编辑E2E Paper").click();
  await page.getByRole("button", { name: "开启全页试用" }).click();
  await page.getByLabel("页面背景回退色").fill("#111111ff");

  await expect(page.getByText("已保存为草稿")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: "开启全页试用" })).toBeVisible();
  await expect(page.locator("#account-appearance-scope")).toHaveCSS("background-color", "rgb(244, 241, 232)");
});

test("network-failed autosave exits full-page trial and restores the formal theme", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only trial network failure flow");
  await mockAppearanceApi(page);
  const requestBodies: Array<string | null> = [];
  await page.route(`**/api/appearance/themes/${themeId}/autosave`, async (route) => {
    requestBodies.push(route.request().postData());
    await route.fulfill({
      status: 503,
      json: { error: { code: "INTERNAL_ERROR", message: "自动保存暂时不可用。" } },
    });
  });
  await page.goto("/e2e/appearance");
  await page.getByLabel("编辑E2E Paper").click();
  await page.getByRole("button", { name: "开启全页试用" }).click();
  await page.getByLabel("页面背景回退色").fill("#111111ff");

  await expect(page.getByText("网络保存失败")).toBeVisible({ timeout: 5_000 });
  expect(requestBodies).toHaveLength(2);
  expect(requestBodies[1]).toBe(requestBodies[0]);
  await expect(page.getByRole("button", { name: "开启全页试用" })).toBeVisible();
  await expect(page.locator("#account-appearance-scope")).toHaveCSS("background-color", "rgb(244, 241, 232)");
});

test("lease conflicts show expiry context and can be retried", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only lease conflict flow");
  await mockAppearanceApi(page);
  let attempts = 0;
  let allowSuccess = false;
  await page.route("**/api/appearance/leases/acquire", async (route) => {
    attempts += 1;
    if (!allowSuccess) {
      await route.fulfill({
        status: 423,
        json: {
          error: {
            code: "APPEARANCE_LEASE_CONFLICT",
            message: "该主题正在其他编辑会话中使用。",
            details: {
              resourceKind: "theme",
              themeId,
              expiresAt: "2099-01-01T00:00:00.000Z",
              serverNow: "2026-07-14T00:00:00.000Z",
              retryable: true,
            },
          },
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        data: {
          handles: [{
            resource: { kind: "theme", themeId },
            leaseId: crypto.randomUUID(),
            lockEpoch: "0",
            fence: "2",
            expiresAt: "2099-01-01T00:00:00.000Z",
            serverNow: "2026-07-14T00:00:00.000Z",
            requiresDraftResolution: false,
          }],
        },
      },
    });
  });
  await page.goto("/e2e/appearance");
  await page.getByLabel("编辑E2E Paper").click();

  await expect(page.getByText("其他会话正在编辑，当前只读")).toBeVisible();
  await expect(page.getByText(/当前租约最早于/)).toBeVisible();
  allowSuccess = true;
  await page.getByRole("button", { name: "重试获取编辑权" }).click();
  await expect(page.getByText(/编辑权：可编辑/)).toBeVisible();
  await expect(page.getByLabel("页面背景表达式")).toBeEnabled();
  expect(attempts).toBeGreaterThanOrEqual(2);

  await page.getByRole("button", { name: "关闭编辑" }).click();
  allowSuccess = false;
  await page.getByRole("button", { name: "重命名E2E Paper" }).click();
  const renameDialog = page.getByRole("dialog", { name: "重命名“E2E Paper”" });
  await renameDialog.getByLabel("新名称").fill("Blocked rename");
  await renameDialog.getByRole("button", { name: "确认重命名" }).click();
  await expect(renameDialog.getByText(/当前租约最早于.*可再次确认重试/)).toBeVisible();
  await expect(renameDialog.getByRole("button", { name: "确认重命名" })).toBeEnabled();
});

test("non-editor actions route a draft discovered during lease acquisition to resolution", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only draft acquisition race");
  await mockAppearanceApi(page);
  let renameRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && new URL(request.url()).pathname === `/api/appearance/themes/${themeId}`) {
      renameRequests += 1;
    }
  });
  await page.route("**/api/appearance/leases/acquire", async (route) => {
    const input = route.request().postDataJSON() as {
      resources: Array<{ kind: "root" | "config" | "theme"; themeId?: string }>;
    };
    await route.fulfill({
      json: {
        data: {
          handles: input.resources.map((resource) => ({
            resource,
            leaseId: crypto.randomUUID(),
            lockEpoch: "0",
            fence: "9",
            expiresAt: "2099-01-01T00:00:00.000Z",
            serverNow: "2026-07-14T00:00:00.000Z",
            requiresDraftResolution: resource.kind === "theme",
          })),
        },
      },
    });
  });
  await page.route(`**/api/appearance/themes/${themeId}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: {
        data: {
          theme: storedTheme(),
          draft: {
            contractVersion: 1,
            payload: {
              contractVersion: 1,
              tokens: {},
              validationCanvas: BUILTIN_THEMES.light.validationCanvas,
              browserValidation: null,
            },
            baseThemeRevision: "1",
            draftRevision: "1",
            updatedAt: "2026-07-14T00:00:00.000Z",
          },
        },
      },
    });
  });

  await page.goto("/e2e/appearance");
  await page.getByRole("button", { name: "重命名E2E Paper" }).click();
  const renameDialog = page.getByRole("dialog", { name: "重命名“E2E Paper”" });
  await renameDialog.getByLabel("新名称").fill("Must resolve draft");
  await renameDialog.getByRole("button", { name: "确认重命名" }).click();

  await expect(page.getByText("该主题保留有上一编辑会话的草稿。")).toBeVisible();
  await expect(page.getByRole("button", { name: "继续草稿" })).toBeVisible();
  expect(renameRequests).toBe(0);
  await page.getByRole("button", { name: "关闭编辑" }).click();
  await expect(page.getByRole("dialog", { name: "重命名“E2E Paper”" })).toHaveCount(0);
});

test("system mode follows runtime color-scheme changes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only system scheme flow");
  await page.emulateMedia({ colorScheme: "light" });
  await mockAppearanceApi(page);
  await page.goto("/e2e/appearance");

  const scope = page.locator("#account-appearance-scope");
  await expect.poll(() => scope.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(244, 241, 232)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => scope.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(23, 24, 21)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => scope.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(244, 241, 232)");
});

test("focus and reconnect refresh only monotonically newer appearance snapshots", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only cross-device refresh flow");
  await page.emulateMedia({ colorScheme: "light" });
  const remote = await mockAppearanceApi(page);
  await page.goto("/e2e/appearance");
  const scope = page.locator("#account-appearance-scope");
  const hydratedRefresh = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/appearance/themes");
  await page.getByRole("button", { name: "搜索" }).click();
  await hydratedRefresh;

  remote.setSnapshot({ ...snapshot("dark"), stateRevision: "2", publishedRevision: "2" });
  remote.setThemeName("Remote Paper");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => scope.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(23, 24, 21)");
  await expect(page.getByText("Remote Paper")).toBeVisible();

  await page.getByRole("button", { name: "明亮", exact: true }).click();
  await expect.poll(() => scope.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(244, 241, 232)");
  remote.setSnapshot({ ...snapshot("dark"), stateRevision: "2", publishedRevision: "2" });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => scope.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(244, 241, 232)");
  remote.setSnapshot({ ...snapshot("dark"), stateRevision: "3", publishedRevision: "3" });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => scope.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(244, 241, 232)");

  remote.setSnapshot({ ...snapshot("dark"), stateRevision: "4", publishedRevision: "4" });
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => scope.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(23, 24, 21)");
});

test("late theme-list refreshes cannot overwrite a newer reconnect response", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only list refresh ordering flow");
  await mockAppearanceApi(page);
  let requestNumber = 0;
  let completedRequests = 0;
  await page.route(/\/api\/appearance\/themes(?:\?.*)?$/, async (route) => {
    requestNumber += 1;
    const currentRequest = requestNumber;
    if (currentRequest === 1) await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      json: {
        data: {
          items: [{
            id: themeId,
            name: currentRequest === 1 ? "Stale remote" : "Newest remote",
            declaredScheme: "light",
            themeRevision: String(currentRequest),
            updatedAt: `2026-07-13T00:00:0${currentRequest}.000Z`,
            hasDraft: false,
          }],
          nextCursor: null,
        },
      },
    });
    completedRequests += 1;
  });
  await page.goto("/e2e/appearance");
  await page.getByRole("button", { name: "搜索" }).click();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });

  await expect(page.getByText("Newest remote")).toBeVisible();
  await expect.poll(() => completedRequests).toBe(2);
  await expect(page.getByText("Stale remote")).toHaveCount(0);
});

test("system scheme changes invalidate an open type-migration summary", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only migration confirmation flow");
  await page.emulateMedia({ colorScheme: "light" });
  await mockAppearanceApi(page);
  await page.goto("/e2e/appearance");

  await page.getByRole("button", { name: "切换E2E Paper类型" }).click();
  await expect(page.getByRole("heading", { name: "切换“E2E Paper”为暗色主题" })).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.getByRole("heading", { name: "切换“E2E Paper”为暗色主题" })).toHaveCount(0);
  await expect(page.getByText("确认期间系统颜色方案已变化，请重新查看迁移影响。")).toBeVisible();
});

test("configured recovery shortcut works when the Escape fallback is disabled", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only recovery shortcut flow");
  await mockAppearanceApi(page);
  await page.goto("/e2e/appearance");
  await page.route("**/appearance/recovery", async (route) => {
    await route.fulfill({
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<!doctype html><html lang=\"zh-CN\"><body><h1>安全恢复外观</h1></body></html>",
    });
  });

  const escapeFallback = page.getByRole("checkbox", { name: "启用 2 秒内三次 Escape 后备手势" });
  await escapeFallback.click();
  await expect(escapeFallback).not.toBeChecked();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "外观与主题" })).toBeVisible();
  await page.getByRole("button", { name: "Alt+Shift+KeyY" }).click();
  await page.keyboard.press("Alt+Shift+Y");
  await expect(page.getByRole("heading", { name: "外观与主题" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Alt+Shift+KeyY" })).toBeVisible();
  await page.keyboard.press("Alt+Shift+Y");
  await expect(page.getByRole("heading", { name: "安全恢复外观" })).toBeVisible();
});

test("queued recovery settings preserve the latest sibling intent", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only recovery settings queue");
  await mockAppearanceApi(page);
  await page.route("**/appearance/recovery", async (route) => {
    await route.fulfill({
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<!doctype html><html lang=\"zh-CN\"><body><h1>安全恢复外观</h1></body></html>",
    });
  });
  const bodies: Array<{
    recoveryShortcut: AppearanceSnapshot["config"]["recoveryShortcut"];
    escapeRecoveryEnabled: boolean;
  }> = [];
  let resolveFirst: (() => void) | undefined;
  const firstPending = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });
  let current = snapshot();
  await page.route("**/api/appearance", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }
    const input = route.request().postDataJSON() as {
      recoveryShortcut: AppearanceSnapshot["config"]["recoveryShortcut"];
      escapeRecoveryEnabled: boolean;
    };
    bodies.push(input);
    if (bodies.length === 1) await firstPending;
    current = {
      ...current,
      stateRevision: String(Number(current.stateRevision) + 1),
      publishedRevision: String(Number(current.publishedRevision) + 1),
      config: {
        ...current.config,
        recoveryShortcut: input.recoveryShortcut,
        escapeRecoveryEnabled: input.escapeRecoveryEnabled,
      },
    };
    await route.fulfill({ json: { data: { snapshot: current } } });
  });

  await page.goto("/e2e/appearance");
  const escapeFallback = page.getByRole("checkbox", { name: "启用 2 秒内三次 Escape 后备手势" });
  await escapeFallback.click();
  await expect(page.getByRole("button", { name: "Alt+Shift+KeyY" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "外观与主题" })).toBeVisible();
  resolveFirst?.();
  await expect(escapeFallback).not.toBeChecked();

  await page.getByRole("button", { name: "清除主快捷键" }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ recoveryShortcut: null, escapeRecoveryEnabled: false });
});

test("browser probes resolve var fallbacks and role-aware currentColor without promoting invalid values", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only browser color probes");
  await mockAppearanceApi(page);
  await page.goto("/e2e/appearance");
  await page.getByLabel("编辑E2E Paper").click();

  const preview = page.getByTestId("theme-preview");
  const backgroundExpression = page.getByLabel("页面背景表达式");
  await backgroundExpression.fill("var(--missing, rgb(10, 20, 30))");
  await expect(page.getByLabel("页面背景回退色")).toHaveValue("#0a141eff");
  await expect.poll(() => preview.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(10, 20, 30)");

  await preview.evaluate((element) => {
    element.closest<HTMLElement>("#account-appearance-scope")?.style.setProperty("--自定义颜色", "rgb(12, 34, 56)");
  });
  await backgroundExpression.fill("var(--自定义颜色)");
  await expect(page.getByLabel("页面背景回退色")).toHaveValue("#0c2238ff");
  await expect.poll(() => preview.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(12, 34, 56)");

  await backgroundExpression.fill("var(--missing)");
  await expect.poll(() => preview.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(244, 241, 232)");

  await page.getByLabel("表面表达式", { exact: true }).fill("var(--missing)");
  await page.getByLabel("正文文字表达式").fill("var(--surface)");
  await expect(page.getByLabel("正文文字回退色")).toHaveValue("#fbfaf5ff");

  await page.getByLabel("危险操作背景表达式").fill("currentColor");
  const dangerAction = page.getByTestId("theme-preview-danger-action");
  await expect.poll(async () => dangerAction.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      matchesRoleCurrentColor: style.backgroundColor === style.color,
      didNotUseSavedDangerFallback: style.backgroundColor !== "rgb(150, 56, 46)",
    };
  })).toEqual({ matchesRoleCurrentColor: true, didNotUseSavedDangerFallback: true });
});

test("forced-colors mode skips custom runtime contrast warnings", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only forced colors probe");
  await page.emulateMedia({ forcedColors: "active" });
  await mockAppearanceApi(page);
  await page.goto("/e2e/appearance");
  await page.getByLabel("编辑E2E Paper").click();
  await page.getByLabel("正文文字表达式").fill("#f4f1e8");
  await page.getByRole("button", { name: "开启全页试用" }).click();
  await expect(page.locator(".appearance-risk-notice")).toHaveCount(0);
});

test("mobile appearance settings keep modes, themes and recovery reachable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobile-only appearance flow");
  await mockAppearanceApi(page);
  await page.goto("/e2e/appearance");

  await expect(page.getByRole("button", { name: "跟随系统" })).toBeVisible();
  await expect(page.getByRole("listitem").getByText("E2E Paper")).toBeVisible();
  await expect(page.getByRole("link", { name: "安全恢复" })).toHaveAttribute("href", "/appearance/recovery");

  await page.route("**/appearance/recovery", async (route) => {
    await route.fulfill({
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<!doctype html><html lang=\"zh-CN\"><body><h1>安全恢复外观</h1></body></html>",
    });
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "安全恢复外观" })).toBeVisible();
});
