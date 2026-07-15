import type { AppearanceSnapshot } from "@/features/appearance/schemas/appearance-schema";

export type RecoveryKeyEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "isComposing" | "key" | "keyCode" | "metaKey" | "repeat" | "shiftKey"
>;

export type RecoveryKeyResult = {
  navigate: boolean;
  preventDefault: boolean;
};

const ignoredResult: RecoveryKeyResult = { navigate: false, preventDefault: false };

function matchesShortcut(
  event: RecoveryKeyEvent,
  shortcut: AppearanceSnapshot["config"]["recoveryShortcut"],
): boolean {
  return Boolean(
    shortcut &&
      event.code === shortcut.code &&
      event.ctrlKey === shortcut.ctrl &&
      event.altKey === shortcut.alt &&
      event.metaKey === shortcut.meta &&
      event.shiftKey === shortcut.shift,
  );
}

export class RecoveryKeyboardController {
  private escapeTimes: number[] = [];

  handle(
    event: RecoveryKeyEvent,
    options: {
      shortcut: AppearanceSnapshot["config"]["recoveryShortcut"];
      escapeEnabled: boolean;
      now: number;
      escapeWindowMs: number;
    },
  ): RecoveryKeyResult {
    if (event.repeat || event.isComposing || event.keyCode === 229) return ignoredResult;

    if (matchesShortcut(event, options.shortcut)) {
      this.escapeTimes = [];
      return { navigate: true, preventDefault: true };
    }

    const modifier = event.key === "Control" || event.key === "Alt" || event.key === "Meta" || event.key === "Shift";
    if (event.key !== "Escape") {
      if (!modifier) this.escapeTimes = [];
      return ignoredResult;
    }

    if (!options.escapeEnabled) {
      this.escapeTimes = [];
      return ignoredResult;
    }

    this.escapeTimes = [
      ...this.escapeTimes.filter((time) => options.now - time <= options.escapeWindowMs),
      options.now,
    ];
    if (this.escapeTimes.length < 3) return ignoredResult;

    this.escapeTimes = [];
    return { navigate: true, preventDefault: true };
  }
}
