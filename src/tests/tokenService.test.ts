import { describe, it, expect, vi, beforeEach } from "vitest";
import { setTokenGetter, getAuthToken } from "../services/tokenService";

describe("Token Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null before setTokenGetter is called (unset getter state)", async () => {
    vi.resetModules();
    const freshTokenService = await import("../services/tokenService");
    const token = await freshTokenService.getAuthToken();
    expect(token).toBeNull();
  });

  it("returns null when token getter is set to return null", async () => {
    setTokenGetter(async () => null);
    const token = await getAuthToken();
    expect(token).toBeNull();
  });

  it("returns token string when token getter resolves successfully", async () => {
    setTokenGetter(async () => "mock-jwt-token");
    const token = await getAuthToken();
    expect(token).toBe("mock-jwt-token");
  });

  it("handles errors thrown by token getter gracefully and returns null", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setTokenGetter(async () => {
      throw new Error("Auth0 error");
    });
    const token = await getAuthToken();
    expect(token).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to retrieve Auth0 access token:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
