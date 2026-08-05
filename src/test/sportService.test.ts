import { describe, it, expect, beforeEach, vi } from "vitest";
import { sportService } from "../services/sportService";
import { apiClient } from "../api/client";

// Mock the centralized API client to isolate service tests
vi.mock("../api/client", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

describe("Sport Service (sportService)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch the list of available sports successfully", async () => {
    const mockSports = [
      {
        id: "sport-1",
        name: "Water Polo",
        shortName: "WP",
        defaultConfigId: "config-1",
      },
    ];

    vi.mocked(apiClient.get).mockResolvedValueOnce(mockSports);

    const result = await sportService.getSports();

    expect(apiClient.get).toHaveBeenCalledWith("/Sports");
    expect(result).toEqual(mockSports);
  });

  it("should fetch sport configurations for a specific sport ID successfully", async () => {
    const sportId = "sport-1";
    const mockConfigurations = [
      {
        id: "config-1",
        sportId: "sport-1",
        usesCleanTime: true,
        periodsCount: 4,
        periodDurationMinutes: 8,
        fieldSize: "30x20",
        rosterLimit: 13,
        lineupLimit: 7,
        activePlayersLimit: 7,
      },
    ];

    vi.mocked(apiClient.get).mockResolvedValueOnce(mockConfigurations);

    const result = await sportService.getSportConfigurations(sportId);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/Sports/${sportId}/configurations`,
    );
    expect(result).toEqual(mockConfigurations);
  });
});
