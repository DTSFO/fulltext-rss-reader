import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ModalDialog } from "@/features/appearance/components/modal-dialog";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开</button>
      {open ? (
        <ModalDialog labelledBy="dialog-title" onClose={() => setOpen(false)} className="bg-surface p-4">
          <h2 id="dialog-title">确认操作</h2>
          <input aria-label="名称" data-dialog-initial-focus />
          <button type="button">确认</button>
          <button type="button" onClick={() => setOpen(false)}>取消</button>
        </ModalDialog>
      ) : null}
    </>
  );
}

describe("ModalDialog", () => {
  it("moves focus inside, traps Tab, closes on Escape and restores focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开" });
    await user.click(trigger);

    const input = screen.getByRole("textbox", { name: "名称" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(trigger.inert).toBe(true);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(input).toHaveFocus();
    outside.remove();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.documentElement.style.overflow).toBe("");
    expect(trigger.inert).toBe(false);
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
