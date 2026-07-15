import { describe, expect, it } from "vitest";

import { deriveThemeSchemeTransition } from "@/features/appearance/theme-scheme-transition";

const TARGET = "11111111-1111-4111-8111-111111111111";
const LIGHT_OTHER = "22222222-2222-4222-8222-222222222222";
const DARK_OTHER = "33333333-3333-4333-8333-333333333333";

function transition(overrides: Partial<Parameters<typeof deriveThemeSchemeTransition>[0]> = {}) {
  return deriveThemeSchemeTransition({
    themeId: TARGET,
    stateRevision: "7",
    oldScheme: "light",
    newScheme: "dark",
    config: { mode: "light", lightThemeId: TARGET, darkThemeId: DARK_OTHER },
    resolvedSystemSchemeAtConfirmation: "light",
    validationCanvasColor: "#101010",
    ...overrides,
  });
}

describe("deriveThemeSchemeTransition", () => {
  it("moves an active manual theme, falls back only its referencing old slot, and displaces the target slot", () => {
    expect(transition()).toMatchObject({
      affectedSlots: ["light"],
      currentlyActive: true,
      displacedThemeId: DARK_OTHER,
      nextConfig: { mode: "dark", lightThemeId: null, darkThemeId: TARGET },
    });
  });

  it("preserves an unrelated old-scheme slot when it does not reference the target", () => {
    expect(transition({
      config: { mode: "light", lightThemeId: LIGHT_OTHER, darkThemeId: DARK_OTHER },
    })).toMatchObject({
      affectedSlots: [],
      currentlyActive: false,
      displacedThemeId: DARK_OTHER,
      nextConfig: { mode: "light", lightThemeId: LIGHT_OTHER, darkThemeId: TARGET },
    });
  });

  it("preserves a manual mode when the target was not active", () => {
    expect(transition({
      config: { mode: "dark", lightThemeId: TARGET, darkThemeId: DARK_OTHER },
    }).nextConfig).toEqual({ mode: "dark", lightThemeId: null, darkThemeId: TARGET });
  });

  it("treats a system theme as active only for the confirmed resolved old scheme", () => {
    expect(transition({
      config: { mode: "system", lightThemeId: TARGET, darkThemeId: DARK_OTHER },
      resolvedSystemSchemeAtConfirmation: "light",
    })).toMatchObject({ currentlyActive: true, nextConfig: { mode: "dark" } });

    expect(transition({
      config: { mode: "system", lightThemeId: TARGET, darkThemeId: DARK_OTHER },
      resolvedSystemSchemeAtConfirmation: "dark",
    })).toMatchObject({
      currentlyActive: false,
      nextConfig: { mode: "system", lightThemeId: null, darkThemeId: TARGET },
    });
  });

  it("binds mode, both slots, schemes, canvas, resolved system scheme, and state revision into impact data", () => {
    expect(transition().impactPayload).toEqual({
      action: "change-scheme",
      themeId: TARGET,
      stateRevision: "7",
      oldScheme: "light",
      newScheme: "dark",
      mode: "light",
      lightThemeId: TARGET,
      darkThemeId: DARK_OTHER,
      resolvedSystemSchemeAtConfirmation: "light",
      validationCanvasColor: "#101010",
    });
  });

  it("rejects a no-op declared-scheme request", () => {
    expect(() => transition({ newScheme: "light" })).toThrow(RangeError);
  });
});
