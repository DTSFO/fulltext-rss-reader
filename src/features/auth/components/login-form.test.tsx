import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "./login-form";

const { replaceDocument } = vi.hoisted(() => ({ replaceDocument: vi.fn() }));

vi.mock("@/lib/navigation/full-document", () => ({ replaceDocument }));

describe("LoginForm", () => {
  beforeEach(() => {
    replaceDocument.mockReset();
    vi.restoreAllMocks();
  });

  it("shows a safe API error for invalid credentials", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "用户名或密码不正确。" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const user = userEvent.setup();

    render(<LoginForm defaultUsername="demo-user" />);
    await user.type(screen.getByLabelText("密码"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "进入阅读器" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("用户名或密码不正确。");
    expect(replaceDocument).not.toHaveBeenCalled();
  });

  it("navigates to the reader after a successful login", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { user: { id: "11111111-1111-4111-8111-111111111111", username: "demo-user" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const user = userEvent.setup();

    render(<LoginForm defaultUsername="demo-user" />);
    await user.type(screen.getByLabelText("密码"), "valid-password");
    await user.click(screen.getByRole("button", { name: "进入阅读器" }));

    expect(replaceDocument).toHaveBeenCalledWith("/reader");
  });
});
