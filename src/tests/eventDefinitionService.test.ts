import { describe, it, expect, vi, beforeEach } from "vitest";
import { eventDefinitionService } from "../services/eventDefinitionService";
import { apiClient } from "../api/client";

vi.mock("../api/client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
  },
}));

describe("eventDefinitionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getAvailableForSport should call apiClient.get with URI encoded sportId", async () => {
    const mockData = [{ id: "def-1", name: "Goal" }];
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockData);

    const result = await eventDefinitionService.getAvailableForSport("sport/1");

    expect(apiClient.get).toHaveBeenCalledWith(
      "/Sports/sport%2F1/event-definitions",
    );
    expect(result).toEqual(mockData);
  });

  it("createCustom should call apiClient.post with URI encoded sportId and payload", async () => {
    const request = { name: "Counter Goal", shortName: "CG", isPositive: true };
    const mockResponse = { id: "def-custom-1", ...request };
    vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

    const result = await eventDefinitionService.createCustom(
      "sport/1",
      request,
    );

    expect(apiClient.post).toHaveBeenCalledWith(
      "/Sports/sport%2F1/event-definitions/custom",
      request,
    );
    expect(result).toEqual(mockResponse);
  });

  it("softDeleteCustom should call apiClient.delete with URI encoded id", async () => {
    vi.mocked(apiClient.delete).mockResolvedValueOnce(undefined);

    await eventDefinitionService.softDeleteCustom("def/123");

    expect(apiClient.delete).toHaveBeenCalledWith(
      "/event-definitions/custom/def%2F123",
    );
  });

  it("savePreset should call apiClient.put with URI encoded sportId and request", async () => {
    const request = { eventDefinitionIds: ["def-1", "def-2"] };
    vi.mocked(apiClient.put).mockResolvedValueOnce(undefined);

    await eventDefinitionService.savePreset("sport/1", request);

    expect(apiClient.put).toHaveBeenCalledWith(
      "/Sports/sport%2F1/event-definitions/preset",
      request,
    );
  });
});
