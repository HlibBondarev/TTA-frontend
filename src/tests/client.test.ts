import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiClient } from "../api/client";
import * as tokenService from "../services/tokenService";

describe("API Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds Authorization header when token is resolved via tokenService", async () => {
    vi.spyOn(tokenService, "getAuthToken").mockResolvedValue("service-token");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    } as Response);

    await apiClient.get("test-endpoint");

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/test-endpoint",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer service-token",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("uses custom explicit token if provided in options", async () => {
    const getAuthTokenSpy = vi
      .spyOn(tokenService, "getAuthToken")
      .mockResolvedValue("service-token");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    } as Response);

    await apiClient.get("/test-endpoint", { token: "explicit-token" });

    expect(getAuthTokenSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/test-endpoint",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer explicit-token",
        }),
      }),
    );
  });

  it("returns empty object on 204 No Content response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 204,
    } as Response);

    const res = await apiClient.delete("/resource/1");
    expect(res).toEqual({});
  });

  it("returns empty object on 200 OK response with empty body text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    } as Response);

    const res = await apiClient.get("/empty-200");
    expect(res).toEqual({});
  });

  it("throws error with status property on non-ok HTTP response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as Response);

    await expect(apiClient.get("/not-found")).rejects.toMatchObject({
      message: "API Request failed: 404 Not Found",
      status: 404,
    });
  });

  it("executes post, put, and delete convenience methods with correct HTTP methods and bodies", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    } as Response);

    await apiClient.post("events", { name: "goal" });
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/events",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "goal" }),
      }),
    );

    await apiClient.put("events/1", { name: "foul" });
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/events/1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "foul" }),
      }),
    );

    await apiClient.delete("events/1");
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/events/1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("combines external AbortSignal with timeout signal properly", async () => {
    const externalController = new AbortController();
    const abortError = new Error("Caller cancelled request");
    abortError.name = "AbortError";

    vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) => {
      const signal = options?.signal as AbortSignal;
      expect(signal).toBeDefined();

      // If signal is already aborted prior to fetch execution, reject immediately
      if (signal?.aborted) {
        return Promise.reject(signal.reason);
      }

      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    });

    const request = apiClient.get("test-signal", {
      signal: externalController.signal,
    });

    externalController.abort(abortError);

    await expect(request).rejects.toBe(abortError);
  });

  it("handles aborted request errors gracefully and throws AbortError", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";

    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

    await expect(apiClient.get("aborted-endpoint")).rejects.toThrow(
      "The operation was aborted",
    );
  });
});
