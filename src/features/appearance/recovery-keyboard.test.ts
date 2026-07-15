import { describe, expect, it } from "vitest";

import {
  RecoveryKeyboardController,
  type RecoveryKeyEvent,
} from "@/features/appearance/recovery-keyboard";
import { APPEARANCE_CLIENT_TIMING } from "@/features/appearance/theme-contract";

function key(overrides: Partial<RecoveryKeyEvent> = {}): RecoveryKeyEvent {
  return {
    key: "Escape",
    code: "Escape",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    keyCode: 27,
    ...overrides,
  };
}

const baseOptions = {
  shortcut: null,
  escapeEnabled: true,
  escapeWindowMs: APPEARANCE_CLIENT_TIMING.escapeRecoveryWindowMs,
};

describe("RecoveryKeyboardController", () => {
  it("navigates only on the third Escape and leaves the first two untouched", () => {
    const controller = new RecoveryKeyboardController();
    expect(controller.handle(key(), { ...baseOptions, now: 0 })).toEqual({ navigate: false, preventDefault: false });
    expect(controller.handle(key(), { ...baseOptions, now: 500 })).toEqual({ navigate: false, preventDefault: false });
    expect(controller.handle(key(), { ...baseOptions, now: 1_000 })).toEqual({ navigate: true, preventDefault: true });
  });

  it("ignores repeat and IME events without advancing the sequence", () => {
    const controller = new RecoveryKeyboardController();
    controller.handle(key(), { ...baseOptions, now: 0 });
    controller.handle(key({ repeat: true }), { ...baseOptions, now: 100 });
    controller.handle(key({ isComposing: true }), { ...baseOptions, now: 200 });
    controller.handle(key({ keyCode: 229 }), { ...baseOptions, now: 300 });
    expect(controller.handle(key(), { ...baseOptions, now: 400 }).navigate).toBe(false);
    expect(controller.handle(key(), { ...baseOptions, now: 500 }).navigate).toBe(true);
  });

  it("expires old presses and resets on a non-modifier key", () => {
    const controller = new RecoveryKeyboardController();
    controller.handle(key(), { ...baseOptions, now: 0 });
    controller.handle(key(), { ...baseOptions, now: 500 });
    expect(controller.handle(key(), { ...baseOptions, now: 2_501 }).navigate).toBe(false);
    controller.handle(key({ key: "a", code: "KeyA", keyCode: 65 }), { ...baseOptions, now: 2_600 });
    expect(controller.handle(key(), { ...baseOptions, now: 2_700 }).navigate).toBe(false);
    expect(controller.handle(key(), { ...baseOptions, now: 2_800 }).navigate).toBe(false);
    expect(controller.handle(key(), { ...baseOptions, now: 2_900 }).navigate).toBe(true);
  });

  it("does not reset the Escape sequence for modifier-only events", () => {
    const controller = new RecoveryKeyboardController();
    controller.handle(key(), { ...baseOptions, now: 0 });
    controller.handle(key({ key: "Shift", code: "ShiftLeft", shiftKey: true, keyCode: 16 }), { ...baseOptions, now: 100 });
    controller.handle(key(), { ...baseOptions, now: 200 });
    expect(controller.handle(key(), { ...baseOptions, now: 300 }).navigate).toBe(true);
  });

  it("honors the disabled fallback and a configured modifier shortcut", () => {
    const disabled = new RecoveryKeyboardController();
    for (const now of [0, 100, 200]) {
      expect(disabled.handle(key(), { ...baseOptions, escapeEnabled: false, now }).navigate).toBe(false);
    }

    const shortcut = {
      code: "KeyY",
      ctrl: false,
      alt: true,
      meta: false,
      shift: true,
      conflictTableVersion: 1 as const,
    };
    const configured = new RecoveryKeyboardController();
    expect(configured.handle(
      key({ key: "Y", code: "KeyY", altKey: true, shiftKey: true, keyCode: 89 }),
      { ...baseOptions, shortcut, now: 0 },
    )).toEqual({ navigate: true, preventDefault: true });
  });
});
