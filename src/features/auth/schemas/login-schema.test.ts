import { describe, expect, it } from "vitest";

import { loginInputSchema } from "./login-schema";

describe("loginInputSchema", () => {
  it("trims the username and accepts a non-empty password", () => {
    expect(loginInputSchema.parse({ username: "  demo-user  ", password: "secret" })).toEqual({
      username: "demo-user",
      password: "secret",
    });
  });

  it("rejects blank credentials", () => {
    expect(() => loginInputSchema.parse({ username: " ", password: "" })).toThrow();
  });
});
