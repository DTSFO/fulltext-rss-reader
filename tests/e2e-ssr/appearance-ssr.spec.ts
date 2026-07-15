import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { BUILTIN_THEMES } from "../../src/features/appearance/theme-contract";

const CUSTOM_FALLBACK = "#123456ff";
const CUSTOM_EXPRESSION = "rgb(18, 52, 86)";
const VISIBLE_BACKGROUND_FALLBACK = "#e7edf3ff";
const VISIBLE_BACKGROUND_EXPRESSION = "rgb(231, 237, 243)";
const DARK_VISIBLE_BACKGROUND_FALLBACK = "#101820ff";
const DARK_VISIBLE_BACKGROUND_EXPRESSION = "rgb(16, 24, 32)";

function requiredEnv(name: "SSR_E2E_BASE_URL" | "SSR_E2E_USERNAME" | "SSR_E2E_PASSWORD"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the authenticated SSR E2E runner.`);
  return value;
}

function inlineStyleText(html: string): string {
  return Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g), (match) => match[1] ?? "").join("\n");
}

test("production UI persists account themes while recovery and logout stay isolated", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "authenticated-ssr-desktop", "Desktop production SSR flow.");
  const username = requiredEnv("SSR_E2E_USERNAME");
  const password = requiredEnv("SSR_E2E_PASSWORD");
  const appearanceRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/appearance")) appearanceRequests.push(pathname);
  });

  const fixtureResponse = await page.request.get("/e2e/appearance", { maxRedirects: 0 });
  expect(fixtureResponse.status()).toBe(404);

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "进入阅读器" }).click();
  await expect(page).toHaveURL(/\/reader$/);
  await expect(page.getByRole("heading", { name: "从一条订阅开始" })).toBeVisible();
  const invalidThemeResponse = await page.request.get("/api/appearance/themes/not-a-uuid");
  expect(invalidThemeResponse.status()).toBe(400);
  await expect(invalidThemeResponse.json()).resolves.toMatchObject({
    error: { code: "VALIDATION_ERROR" },
  });

  let themeName = `SSR Theme ${crypto.randomUUID()}`;
  await page.goto("/settings/appearance");
  await expect(page.getByRole("heading", { name: "外观与主题" })).toBeVisible();
  await page.getByRole("button", { name: "新建主题" }).click();
  const createDialog = page.getByRole("dialog", { name: "新建自定义主题" });
  await expect(createDialog.getByLabel("名称")).toBeFocused();
  await createDialog.getByLabel("名称").fill(themeName);
  await createDialog.getByRole("button", { name: "创建并编辑" }).click();

  await expect(page.getByRole("heading", { name: themeName, exact: true })).toBeVisible();
  await page.getByLabel("页面背景表达式").fill(VISIBLE_BACKGROUND_EXPRESSION);
  await page.getByLabel("页面背景回退色").fill(VISIBLE_BACKGROUND_FALLBACK);
  await page.getByLabel("装饰网格表达式").fill(CUSTOM_EXPRESSION);
  await page.getByLabel("装饰网格回退色").fill(CUSTOM_FALLBACK);
  await expect(page.getByText("已保存正式主题")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "开启全页试用" }).click();
  await expect.poll(() => page.locator("#account-appearance-scope").evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--theme-decorative-grid-active").trim(),
  )).toBe(CUSTOM_EXPRESSION);
  await page.getByRole("button", { name: "退出全页试用" }).click();
  await page.getByRole("button", { name: "关闭编辑" }).click();

  const themeRowFor = (name: string) => page.getByRole("listitem").filter({
    has: page.getByText(name, { exact: true }),
  });
  let themeRow = themeRowFor(themeName);
  await expect(themeRow).toBeVisible();

  await themeRow.getByRole("button", { name: `重命名${themeName}` }).click();
  const renamedThemeName = `${themeName} Renamed`;
  const renameDialog = page.getByRole("dialog", { name: `重命名“${themeName}”` });
  await renameDialog.getByLabel("新名称").fill(renamedThemeName);
  await renameDialog.getByRole("button", { name: "确认重命名" }).click();
  themeName = renamedThemeName;
  themeRow = themeRowFor(themeName);
  await expect(themeRow).toBeVisible();

  await themeRow.getByRole("button", { name: `复制${themeName}` }).click();
  const copyName = `${themeName} 副本`;
  let copyRow = themeRowFor(copyName);
  await expect(copyRow).toBeVisible();
  await copyRow.getByRole("button", { name: `重置${copyName}` }).click();
  const resetDialog = page.getByRole("dialog", { name: `重置“${copyName}”` });
  await resetDialog.getByRole("button", { name: "确认重置" }).click();
  await expect(page.getByText("主题已重置")).toBeVisible();

  copyRow = themeRowFor(copyName);
  await copyRow.getByRole("button", { name: `切换${copyName}类型` }).click();
  const schemeDialog = page.getByRole("dialog", { name: `切换“${copyName}”为暗色主题` });
  await schemeDialog.getByRole("button", { name: "确认迁移" }).click();
  await expect(page.getByText("主题类型已迁移")).toBeVisible();

  copyRow = themeRowFor(copyName);
  await copyRow.getByRole("button", { name: `重置${copyName}` }).click();
  const darkResetDialog = page.getByRole("dialog", { name: `重置“${copyName}”` });
  await darkResetDialog.getByRole("button", { name: "确认重置" }).click();
  await expect(page.getByText("主题已重置")).toBeVisible();

  copyRow = themeRowFor(copyName);
  await copyRow.getByRole("button", { name: `编辑${copyName}` }).click();
  await page.getByLabel("页面背景表达式").fill(DARK_VISIBLE_BACKGROUND_EXPRESSION);
  await page.getByLabel("页面背景回退色").fill(DARK_VISIBLE_BACKGROUND_FALLBACK);
  await expect(page.getByText("已保存正式主题")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "关闭编辑" }).click();

  themeRow = themeRowFor(themeName);
  await themeRow.getByRole("button", { name: "应用" }).click();
  await expect(page.getByText("配置已保存")).toBeVisible();
  copyRow = themeRowFor(copyName);
  await copyRow.getByRole("button", { name: "应用" }).click();
  await expect(page.getByText("配置已保存")).toBeVisible();
  await page.getByRole("button", { name: "跟随系统", exact: true }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => page.locator("#account-appearance-scope").evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--theme-background-fallback").trim(),
  )).toBe(VISIBLE_BACKGROUND_FALLBACK);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => page.locator("#account-appearance-scope").evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--theme-background-fallback").trim(),
  )).toBe(DARK_VISIBLE_BACKGROUND_FALLBACK);
  await page.emulateMedia({ colorScheme: "light" });

  const systemReaderResponse = await page.request.get("/reader");
  expect(systemReaderResponse.status()).toBe(200);
  const systemReaderStyles = inlineStyleText(await systemReaderResponse.text());
  expect(systemReaderStyles).toContain(`--theme-background-fallback:${VISIBLE_BACKGROUND_FALLBACK}`);
  expect(systemReaderStyles).toContain(`--theme-background-fallback:${DARK_VISIBLE_BACKGROUND_FALLBACK}`);
  expect(systemReaderStyles).toContain("prefers-color-scheme:dark");

  for (const [colorScheme, expectedColor] of [
    ["light", "rgb(231, 237, 243)"],
    ["dark", "rgb(16, 24, 32)"],
  ] as const) {
    const systemNoScriptContext = await browser.newContext({ javaScriptEnabled: false, colorScheme });
    await systemNoScriptContext.addCookies(await page.context().cookies());
    const systemNoScriptPage = await systemNoScriptContext.newPage();
    const response = await systemNoScriptPage.goto("/reader");
    expect(response?.status()).toBe(200);
    await expect(systemNoScriptPage.locator("#account-appearance-scope")).toHaveCSS(
      "background-color",
      expectedColor,
    );
    await systemNoScriptContext.close();
  }

  copyRow = themeRowFor(copyName);
  await copyRow.getByRole("button", { name: `删除${copyName}` }).click();
  const deleteDialog = page.getByRole("dialog", { name: `删除“${copyName}”` });
  await deleteDialog.getByRole("button", { name: "确认删除" }).click();
  await expect(themeRowFor(copyName)).toHaveCount(0);

  themeRow = themeRowFor(themeName);
  const themeDownloadPromise = page.waitForEvent("download");
  await themeRow.getByRole("button", { name: `导出${themeName}` }).click();
  const themeDownload = await themeDownloadPromise;
  const themeDownloadPath = await themeDownload.path();
  expect(themeDownloadPath).not.toBeNull();
  if (!themeDownloadPath) throw new Error("Single-theme export did not produce a local download.");
  const themeChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入单主题" }).click();
  const themeChooser = await themeChooserPromise;
  await themeChooser.setFiles(themeDownloadPath);
  await expect(page.getByText("主题已导入")).toBeVisible();
  await expect(themeRowFor(`${themeName} (2)`)).toBeVisible();

  const packageDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出整包" }).click();
  const packageDownload = await packageDownloadPromise;
  const packageDownloadPath = await packageDownload.path();
  expect(packageDownloadPath).not.toBeNull();
  if (!packageDownloadPath) throw new Error("Appearance package export did not produce a local download.");
  const packageChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "预览并恢复整包" }).click();
  const packageChooser = await packageChooserPromise;
  await packageChooser.setFiles(packageDownloadPath);
  const restoreDialog = page.getByRole("dialog", { name: "确认整包恢复" });
  await expect(restoreDialog.getByText("2", { exact: true })).toHaveCount(2);
  await restoreDialog.getByRole("button", { name: "确认恢复" }).click();
  await expect(page.getByText("整包恢复完成")).toBeVisible();

  themeRow = themeRowFor(themeName);
  await themeRow.getByRole("button", { name: "应用" }).click();
  await expect(page.getByText("配置已保存")).toBeVisible();
  await expect.poll(() => page.locator("#account-appearance-scope").evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--theme-decorative-grid-active").trim(),
  )).toBe(CUSTOM_EXPRESSION);

  const readerResponse = await page.request.get("/reader");
  expect(readerResponse.status()).toBe(200);
  const readerHtml = await readerResponse.text();
  const readerStyles = inlineStyleText(readerHtml);
  expect(readerStyles).toContain(`--theme-background-fallback:${VISIBLE_BACKGROUND_FALLBACK}`);
  expect(readerStyles).toContain(`--theme-decorative-grid-fallback:${CUSTOM_FALLBACK}`);
  expect(readerStyles).not.toContain(VISIBLE_BACKGROUND_EXPRESSION);
  expect(readerStyles).not.toContain(CUSTOM_EXPRESSION);
  expect(readerStyles).not.toContain(themeName);

  const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
  await noScriptContext.addCookies(await page.context().cookies());
  const noScriptPage = await noScriptContext.newPage();
  const noScriptResponse = await noScriptPage.goto("/reader");
  expect(noScriptResponse?.status()).toBe(200);
  await expect.poll(() => noScriptPage.locator("#account-appearance-scope").evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--theme-decorative-grid-fallback").trim(),
  )).toBe(CUSTOM_FALLBACK);
  await expect(noScriptPage.locator("#account-appearance-scope")).toHaveCSS(
    "background-color",
    "rgb(231, 237, 243)",
  );
  const firstPaint = await noScriptPage.screenshot();
  expect(firstPaint.byteLength).toBeGreaterThan(1_000);
  await noScriptContext.close();

  await page.goto("/reader");
  await page.waitForLoadState("networkidle");
  await expect.poll(() => page.locator("#account-appearance-scope").evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--theme-decorative-grid-active").trim(),
  )).toBe(CUSTOM_EXPRESSION);

  appearanceRequests.length = 0;
  const recoveryResponse = await page.goto("/appearance/recovery");
  expect(recoveryResponse?.status()).toBe(200);
  const recoveryHtml = await recoveryResponse?.text() ?? "";
  expect(recoveryHtml).not.toContain(themeName);
  expect(recoveryHtml).not.toContain(CUSTOM_EXPRESSION);
  expect(recoveryHtml).not.toContain(CUSTOM_FALLBACK);
  expect(recoveryHtml).not.toContain(VISIBLE_BACKGROUND_EXPRESSION);
  expect(recoveryHtml).not.toContain(VISIBLE_BACKGROUND_FALLBACK);
  await page.waitForLoadState("networkidle");
  expect(appearanceRequests).toEqual([]);
  const recoveryAccessibility = await new AxeBuilder({ page }).analyze();
  expect(recoveryAccessibility.violations).toEqual([]);

  await page.getByRole("button", { name: "切回内置跟随系统" }).click();
  await expect(page.getByRole("button", { name: "已恢复" })).toBeVisible();
  const recoveredReaderResponse = await page.request.get("/reader");
  const recoveredStyles = inlineStyleText(await recoveredReaderResponse.text());
  expect(recoveredStyles).not.toContain(CUSTOM_FALLBACK);
  expect(recoveredStyles).toContain("@media (prefers-color-scheme:dark)");

  await page.goto("/settings/appearance");
  const recoveredThemeRow = themeRowFor(themeName);
  await recoveredThemeRow.getByRole("button", { name: "应用" }).click();
  await expect(page.getByText("配置已保存")).toBeVisible();
  await page.goto("/reader");
  await page.waitForLoadState("networkidle");
  await expect.poll(() => page.locator("#account-appearance-scope").evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--theme-decorative-grid-active").trim(),
  )).toBe(CUSTOM_EXPRESSION);

  appearanceRequests.length = 0;
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(appearanceRequests).toEqual([]);
  const loginHtml = await page.content();
  expect(loginHtml).not.toContain(themeName);
  expect(loginHtml).not.toContain(CUSTOM_EXPRESSION);
  expect(loginHtml).not.toContain(CUSTOM_FALLBACK);
  expect(loginHtml).not.toContain(VISIBLE_BACKGROUND_EXPRESSION);
  expect(loginHtml).not.toContain(VISIBLE_BACKGROUND_FALLBACK);
  await expect.poll(() => page.locator("#account-appearance-scope").evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--theme-background-fallback").trim(),
  )).toBe(BUILTIN_THEMES.light.tokens.background.fallback);

  const unauthorizedAppearance = await page.request.get("/api/appearance");
  expect(unauthorizedAppearance.status()).toBe(401);
});

test("authenticated mobile reader reaches appearance settings without horizontal overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "authenticated-ssr-mobile", "Mobile production SSR flow.");
  const username = requiredEnv("SSR_E2E_USERNAME");
  const password = requiredEnv("SSR_E2E_PASSWORD");
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "进入阅读器" }).click();
  await expect(page).toHaveURL(/\/reader$/);

  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("link", { name: "外观设置" }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  await expect(page.getByRole("heading", { name: "外观与主题" })).toBeVisible();
  await expect(page.getByRole("button", { name: "跟随系统" })).toBeVisible();
  await expect(page.getByRole("link", { name: "安全恢复" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByTitle("切换明暗类型").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
