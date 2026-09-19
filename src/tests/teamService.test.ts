import { describe, it, expect, vi, beforeEach } from "vitest";
import { teamService } from "../services/teamService";
import { apiClient } from "../api/client";

vi.mock("../api/client", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

describe("Team Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should retrieve team details by team ID with proper URL encoding", async () => {
    const mockTeam = {
      id: "team-123",
      clubId: "club-1",
      sportId: "sport-1",
      name: "Home Squad",
      minBirthYear: 2010,
      gender: 0,
      createdAt: "2026-01-01T00:00:00Z",
    };

    vi.mocked(apiClient.get).mockResolvedValueOnce(mockTeam);

    const result = await teamService.getTeamById("team-123");

    expect(apiClient.get).toHaveBeenCalledWith("/Teams/team-123");
    expect(result).toEqual(mockTeam);
  });
});
