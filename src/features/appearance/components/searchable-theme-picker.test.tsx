import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  ResetThemeDialog,
  SearchableThemePicker,
  type ThemePageLoader,
  type ThemePickerSelection,
} from "@/features/appearance/components/searchable-theme-picker";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

const first = {
  id: FIRST_ID,
  name: "第一页主题",
  declaredScheme: "light" as const,
  themeRevision: "1",
  updatedAt: "2026-07-14T00:00:00.000Z",
  hasDraft: false,
};
const second = {
  id: SECOND_ID,
  name: "第二页暗色来源",
  declaredScheme: "dark" as const,
  themeRevision: "1",
  updatedAt: "2026-07-14T00:01:00.000Z",
  hasDraft: false,
};

function pickerLoader(): ThemePageLoader {
  return vi.fn(async ({ cursor }) => cursor
    ? { items: [second], nextCursor: null }
    : { items: [first], nextCursor: "page-2" });
}

describe("SearchableThemePicker", () => {
  it("loads and selects a theme from the second page", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const loadPage = pickerLoader();
    render(
      <SearchableThemePicker
        label="复制来源"
        value={{ kind: "builtin", scheme: "light" }}
        onChange={onChange}
        loadPage={loadPage}
      />,
    );

    await user.click(screen.getByRole("button", { name: /内置明亮/ }));
    expect(await screen.findByRole("button", { name: /第一页主题/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "加载更多主题" }));
    await user.click(await screen.findByRole("button", { name: /第二页暗色来源/ }));

    expect(onChange).toHaveBeenCalledWith({
      kind: "custom",
      themeId: SECOND_ID,
      name: "第二页暗色来源",
      declaredScheme: "dark",
    });
  });

  it("keeps a selected theme label even when that theme is not in the loaded page", async () => {
    render(
      <SearchableThemePicker
        label="明亮槽"
        value={{ kind: "custom", themeId: SECOND_ID, name: "当前槽主题", declaredScheme: "light" }}
        onChange={() => undefined}
        allowedScheme="light"
        builtinSchemes={["light"]}
        loadPage={async () => ({ items: [first], nextCursor: null })}
      />,
    );
    expect(screen.getByRole("button", { name: /当前槽主题/ })).toBeVisible();
  });
});

describe("ResetThemeDialog", () => {
  it("allows a light target to select a dark custom source", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    function Harness() {
      const [source, setSource] = useState<ThemePickerSelection>({ kind: "builtin", scheme: "light" });
      return (
        <ResetThemeDialog
          target={first}
          source={source}
          busy={false}
          onSourceChange={setSource}
          onCancel={() => undefined}
          onConfirm={() => onConfirm(source)}
          loadPage={async () => ({ items: [second], nextCursor: null })}
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /内置明亮/ }));
    await user.click(await screen.findByRole("button", { name: /第二页暗色来源/ }));
    await user.click(screen.getByRole("button", { name: "确认重置" }));

    expect(onConfirm).toHaveBeenCalledWith({
      kind: "custom",
      themeId: SECOND_ID,
      name: "第二页暗色来源",
      declaredScheme: "dark",
    });
  });
});
