import { vi, describe, it, expect, beforeEach } from "vitest";
import { matchFinalizationService } from "../services/matchFinalizationService";
import { apiClient } from "../api/client";
import { db } from "../db/ttaDatabase";
import { processSyncQueue } from "../services/syncService";
import { userMatchService } from "../services/userMatchService";

vi.mock("../api/client", () => ({
  apiClient: {
    put: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../services/syncService", () => ({
  processSyncQueue: vi.fn().mockResolvedValue(1),
}));

vi.mock("../services/userMatchService", () => ({
  userMatchService: {
    catchMatch: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../db/eventService", () => ({
  getNextSequenceNumber: vi.fn().mockResolvedValue(10),
}));

vi.mock("../db/ttaDatabase", () => {
  const clearMocks = {
    gameevents: { clear: vi.fn().mockResolvedValue(undefined) },
    timeanchors: {
      clear: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue("anchor-id"),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    },
    playerpresences: {
      clear: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(1),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    },
    matchlineups: {
      clear: vi.fn().mockResolvedValue(undefined),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    },
    syncQueue: {
      add: vi.fn().mockResolvedValue(1),
      clear: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(0),
    },
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

  it("should execute sync, record result, catch match, normalize events, and purge IndexedDB in sequence on success", async () => {
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

    expect(userMatchService.catchMatch).toHaveBeenCalledWith(
      "match-123",
      "team-456",
    );

    expect(apiClient.put).toHaveBeenNthCalledWith(
      2,
      "/Matches/match-123/teams/team-456/events/normalize",
    );

    expect(db.gameevents.clear).toHaveBeenCalled();
    expect(db.timeanchors.clear).toHaveBeenCalled();
    expect(db.syncQueue.clear).toHaveBeenCalled();
  });

  it("should auto-close open active period and active presences in IndexedDB prior to syncQueue flush", async () => {
    const matchId = "match-active-period";
    vi.mocked(db.timeanchors.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValueOnce([
          {
            id: "start-anchor-1",
            matchId,
            periodNumber: 2,
            type: 0, // PeriodStart
            sequenceNumber: 1,
            timestamp: "2026-09-03T10:00:00.000Z",
          },
        ]),
      }),
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    vi.mocked(db.matchlineups.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValueOnce([{ id: "lineup-1" }]),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(db.playerpresences.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValueOnce({
        filter: vi.fn().mockReturnValueOnce({
          toArray: vi
            .fn()
            .mockResolvedValueOnce([
              { id: "presence-1", matchLineupId: "lineup-1", timeOut: null },
            ]),
        }),
      }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    await matchFinalizationService.finalizeMatch({
      matchId,
      activeTeamId: "team-456",
      homeScore: 10,
      guestScore: 8,
      temperature: 25,
    });

    expect(db.timeanchors.add).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId,
        periodNumber: 2,
        type: 1, // PeriodEnd
      }),
    );
    expect(db.playerpresences.update).toHaveBeenCalledWith(
      "presence-1",
      expect.objectContaining({
        timeOut: expect.any(String),
      }),
    );
    expect(processSyncQueue).toHaveBeenCalledTimes(1);
  });

  it("should continue finalization sequence if userMatchService.catchMatch throws an idempotent conflict error (409)", async () => {
    vi.mocked(userMatchService.catchMatch).mockRejectedValueOnce(
      new Error("409 Conflict: Catch link already exists"),
    );

    const params = {
      matchId: "match-123",
      activeTeamId: "team-456",
      homeScore: 12,
      guestScore: 9,
      temperature: 26.5,
    };

    await matchFinalizationService.finalizeMatch(params);

    expect(apiClient.put).toHaveBeenNthCalledWith(
      2,
      "/Matches/match-123/teams/team-456/events/normalize",
    );
    expect(db.gameevents.clear).toHaveBeenCalled();
  });

  it("should ABORT finalization and throw if userMatchService.catchMatch fails due to server or network error", async () => {
    vi.mocked(userMatchService.catchMatch).mockRejectedValueOnce(
      new Error("500 Internal Server Error"),
    );

    const params = {
      matchId: "match-123",
      activeTeamId: "team-456",
      homeScore: 12,
      guestScore: 9,
      temperature: 26.5,
    };

    await expect(
      matchFinalizationService.finalizeMatch(params),
    ).rejects.toThrow("500 Internal Server Error");

    expect(apiClient.put).toHaveBeenCalledTimes(1);
    expect(db.gameevents.clear).not.toHaveBeenCalled();
  });

  it("should ABORT finalization if sync queue still contains pending items after processSyncQueue", async () => {
    vi.mocked(db.syncQueue.count).mockResolvedValueOnce(2);

    const params = {
      matchId: "match-123",
      activeTeamId: "team-456",
      homeScore: 12,
      guestScore: 9,
      temperature: 26.5,
    };

    await expect(
      matchFinalizationService.finalizeMatch(params),
    ).rejects.toThrow(
      "Cannot finalize match: offline sync queue is not empty. Please ensure all pending actions are synchronized.",
    );

    expect(processSyncQueue).toHaveBeenCalledTimes(1);
    expect(apiClient.put).not.toHaveBeenCalled();
    expect(userMatchService.catchMatch).not.toHaveBeenCalled();
    expect(db.gameevents.clear).not.toHaveBeenCalled();
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
    expect(userMatchService.catchMatch).not.toHaveBeenCalled();
    expect(db.gameevents.clear).not.toHaveBeenCalled();
  });
});
