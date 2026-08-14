import { vi, describe, it, expect, beforeEach } from "vitest";
import { matchFinalizationService } from "../services/matchFinalizationService";
import { apiClient } from "../api/client";
import { db } from "../db/ttaDatabase";
import { processSyncQueue } from "../services/syncService";

vi.mock("../api/client", () => ({
  apiClient: {
    put: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../services/syncService", () => ({
  processSyncQueue: vi.fn().mockResolvedValue(1),
}));

vi.mock("../db/ttaDatabase", () => {
  const clearMocks = {
    gameevents: { clear: vi.fn().mockResolvedValue(undefined) },
    timeanchors: { clear: vi.fn().mockResolvedValue(undefined) },
    playerpresences: { clear: vi.fn().mockResolvedValue(undefined) },
    matchlineups: { clear: vi.fn().mockResolvedValue(undefined) },
    syncQueue: { clear: vi.fn().mockResolvedValue(undefined) },
    matches: { clear: vi.fn().mockResolvedValue(undefined) },
    teams: { clear: vi.fn().mockResolvedValue(undefined) },
    players: { clear: vi.fn().mockResolvedValue(undefined) },
    playerrosters: { clear: vi.fn().mockResolvedValue(undefined) },
    tournaments: { clear: vi.fn().mockResolvedValue(undefined) },
    sportconfigurations: { clear: vi.fn().mockResolvedValue(undefined) },
    eventdefinitions: { clear: vi.fn().mockResolvedValue(undefined) },
    sports: { clear: vi.fn().mockResolvedValue(undefined) },
  };

  return {
    db: {
      ...clearMocks,
      transaction: vi.fn((_mode, _tables, cb) => cb()),
    },
  };
});

describe("matchFinalizationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should throw an error if matchId or activeTeamId is missing", async () => {
    await expect(
      matchFinalizationService.finalizeMatch({
        matchId: "",
        activeTeamId: "team-123",
        homeScore: 10,
        guestScore: 8,
        temperature: 24,
      }),
    ).rejects.toThrow(
      "Missing required matchId or activeTeamId for match finalization.",
    );

    expect(processSyncQueue).not.toHaveBeenCalled();
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  it("should execute sync, record result, normalize events, and purge IndexedDB in sequence on success", async () => {
    const params = {
      matchId: "match-123",
      activeTeamId: "team-456",
      homeScore: 12,
      guestScore: 9,
      temperature: 26.5,
    };

    await matchFinalizationService.finalizeMatch(params);

    expect(processSyncQueue).toHaveBeenCalledTimes(1);

    expect(apiClient.put).toHaveBeenNthCalledWith(
      1,
      "/Matches/match-123/result",
      {
        homeScore: 12,
        guestScore: 9,
        temperature: 26.5,
      },
    );

    expect(apiClient.put).toHaveBeenNthCalledWith(
      2,
      "/Matches/match-123/teams/team-456/events/normalize",
    );

    expect(db.gameevents.clear).toHaveBeenCalled();
    expect(db.timeanchors.clear).toHaveBeenCalled();
    expect(db.syncQueue.clear).toHaveBeenCalled();
  });

  it("should ABORT IndexedDB purge if record result API fails", async () => {
    vi.mocked(apiClient.put).mockRejectedValueOnce(
      new Error("API Error 500: Server error"),
    );

    const params = {
      matchId: "match-123",
      activeTeamId: "team-456",
      homeScore: 5,
      guestScore: 5,
      temperature: null,
    };

    await expect(
      matchFinalizationService.finalizeMatch(params),
    ).rejects.toThrow("API Error 500: Server error");

    expect(processSyncQueue).toHaveBeenCalledTimes(1);
    expect(apiClient.put).toHaveBeenCalledTimes(1);
    expect(db.gameevents.clear).not.toHaveBeenCalled();
  });
});
