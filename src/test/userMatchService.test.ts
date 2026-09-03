import { describe, it, expect, vi, beforeEach } from "vitest";
import { userMatchService } from "../services/userMatchService";
import { apiClient } from "../api/client";

vi.mock("../api/client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("userMatchService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getCatchedMatches should invoke GET /api/Matches/catch and include trackedTeamId", async () => {
    const mockMatches = [
      {
        id: "match-1",
        tournamentId: "tourn-1",
        tournamentName: "Friendly Cup",
        homeTeamId: "team-1",
        homeTeamName: "Home Squad",
        guestTeamId: "team-2",
        guestTeamName: "Guest Squad",
        scheduledAt: "2026-08-25T10:00:00.000Z",
        matchNumber: "1",
        venue: "Arena 1",
        temperature: 22,
        homeScore: 10,
        guestScore: 8,
        createdAt: "2026-08-25T09:00:00.000Z",
        trackedTeamId: "team-2",
      },
    ];

    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatches);

    const result = await userMatchService.getCatchedMatches();

    expect(apiClient.get).toHaveBeenCalledWith("/Matches/catch");
    expect(result).toEqual(mockMatches);
    expect(result[0].trackedTeamId).toBe("team-2");
  });

  it("catchMatch should invoke POST /api/Matches/{matchId}/teams/{teamId}/catch", async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce(undefined);

    await userMatchService.catchMatch("match-123", "team-456");

    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/match-123/teams/team-456/catch",
    );
  });

  it("uncatchMatch should invoke DELETE /api/Matches/{matchId}/teams/{teamId}/catch", async () => {
    vi.mocked(apiClient.delete).mockResolvedValueOnce(undefined);

    await userMatchService.uncatchMatch("match-123", "team-456");

    expect(apiClient.delete).toHaveBeenCalledWith(
      "/Matches/match-123/teams/team-456/catch",
    );
  });

  it("addUserToTrackedMatch should invoke POST /api/Matches/{matchId}/teams/{teamId}/catch/add-user with email payload", async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce(undefined);

    await userMatchService.addUserToTrackedMatch(
      "match-123",
      "team-456",
      "target@test.com",
    );

    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/match-123/teams/team-456/catch/add-user",
      { email: "target@test.com" },
    );
  });
});
