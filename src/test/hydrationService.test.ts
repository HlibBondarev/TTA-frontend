import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hydrateMatchData,
  checkUnfinishedMatch,
  discardUnfinishedMatch,
  getMatchRecoveryState,
} from "../services/hydrationService";
import { apiClient } from "../api/client";
import { sportService } from "../services/sportService";
import { db, type MatchLookup } from "../db/ttaDatabase";
import { seedTestData } from "../db/seed";

vi.mock("../api/client", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

vi.mock("../services/sportService", () => ({
  sportService: {
    getSportConfigurations: vi.fn(),
  },
}));

vi.mock("../db/seed", () => ({
  seedTestData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/ttaDatabase", () => ({
  db: {
    transaction: vi.fn(),
    matches: {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      toArray: vi.fn().mockResolvedValue([]),
    },
    tournaments: { put: vi.fn(), get: vi.fn() },
    sportconfigurations: { put: vi.fn(), get: vi.fn() },
    matchlineups: { where: vi.fn(), bulkPut: vi.fn() },
    timeanchors: { where: vi.fn(), bulkPut: vi.fn() },
    playerpresences: {
      filter: vi.fn(),
      where: vi.fn(),
      bulkPut: vi.fn(),
      bulkDelete: vi.fn(),
    },
    gameevents: {
      filter: vi.fn(),
      where: vi.fn(),
      bulkPut: vi.fn(),
      bulkDelete: vi.fn(),
    },
    eventdefinitions: { bulkPut: vi.fn() },
  },
}));

describe("Hydration Service", () => {
  const matchId = "m-123";
  const teamId = "team-456";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return null for checkUnfinishedMatch when IndexedDB matches table is empty", async () => {
    vi.mocked(db.matches.toArray).mockResolvedValueOnce([]);
    const unfinished = await checkUnfinishedMatch();
    expect(unfinished).toBeNull();
  });

  it("should return the first match for checkUnfinishedMatch when IndexedDB contains multiple match drafts", async () => {
    const firstDraft: MatchLookup = {
      id: "m-active-1",
      tournamentId: "t-1",
      homeTeamId: "team-1",
      guestTeamId: "team-2",
      scheduledAt: "2026-09-01T10:00:00Z",
      matchNumber: "1",
      venue: "Arena 1",
      temperature: 22,
      homeScore: null,
      guestScore: null,
      createdAt: "2026-09-01T10:00:00Z",
    };

    const secondDraft: MatchLookup = {
      id: "m-active-2",
      tournamentId: "t-1",
      homeTeamId: "team-3",
      guestTeamId: "team-4",
      scheduledAt: "2026-09-01T12:00:00Z",
      matchNumber: "2",
      venue: "Arena 2",
      temperature: 24,
      homeScore: null,
      guestScore: null,
      createdAt: "2026-09-01T10:30:00Z",
    };

    vi.mocked(db.matches.toArray).mockResolvedValueOnce([
      firstDraft,
      secondDraft,
    ]);

    const unfinished = await checkUnfinishedMatch();
    expect(unfinished).toEqual(firstDraft);
  });

  it("should calculate match recovery state from timeanchors and sportconfigurations", async () => {
    vi.mocked(db.timeanchors.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValueOnce({
        toArray: vi
          .fn()
          .mockResolvedValueOnce([{ periodNumber: 1 }, { periodNumber: 2 }]),
      }),
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: matchId,
      tournamentId: "t-1",
    } as never);
    vi.mocked(db.tournaments.get).mockResolvedValueOnce({
      id: "t-1",
      configurationId: "cfg-1",
    } as never);
    vi.mocked(db.sportconfigurations.get).mockResolvedValueOnce({
      id: "cfg-1",
      activePlayersLimit: 5,
    } as never);

    const recoveryState = await getMatchRecoveryState(matchId);
    expect(recoveryState).toEqual({
      recoveredPeriod: 2,
      activePlayersLimit: 5,
    });
  });

  it("should fallback to default period 1 and limit 7 when recovery state tables are empty", async () => {
    vi.mocked(db.timeanchors.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValueOnce([]),
      }),
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    vi.mocked(db.matches.get).mockResolvedValueOnce(undefined as never);

    const recoveryState = await getMatchRecoveryState(matchId);
    expect(recoveryState).toEqual({
      recoveredPeriod: 1,
      activePlayersLimit: 7,
    });
  });

  it("should purge all records associated with a match when discardUnfinishedMatch is called", async () => {
    const mockDelete = vi.fn().mockResolvedValue(1);

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({ delete: mockDelete }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(db.playerpresences.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({ delete: mockDelete }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    vi.mocked(db.gameevents.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({ delete: mockDelete }),
    } as unknown as ReturnType<typeof db.gameevents.where>);

    vi.mocked(db.timeanchors.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({ delete: mockDelete }),
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    vi.mocked(db.transaction).mockImplementation((async (
      _mode: string,
      _tables: unknown,
      callback: () => Promise<void>,
    ) => {
      await callback();
    }) as unknown as typeof db.transaction);

    await discardUnfinishedMatch(matchId);

    expect(db.matches.delete).toHaveBeenCalledWith(matchId);
    expect(mockDelete).toHaveBeenCalledTimes(4);
  });

  it("successfully fetches server data with team-specific lineup endpoint and writes to IndexedDB", async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ id: matchId, title: "Match 1" })
      .mockResolvedValueOnce([{ id: "l1", matchId }])
      .mockResolvedValueOnce([{ id: "a1", matchId }])
      .mockResolvedValueOnce([{ id: "p1", matchId }])
      .mockResolvedValueOnce([{ id: "e1", matchId }])
      .mockResolvedValueOnce([{ id: "d1" }]);

    vi.mocked(db.transaction).mockImplementation((async (
      _mode: string,
      _tables: unknown,
      callback: () => Promise<void>,
    ) => {
      const mockLineupsDelete = vi.fn().mockResolvedValue(1);
      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          delete: mockLineupsDelete,
          toArray: vi.fn().mockResolvedValue([{ id: "l1", matchId }]),
        }),
      } as unknown as ReturnType<typeof db.matchlineups.where>);

      const mockAnchorsDelete = vi.fn().mockResolvedValue(1);
      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          and: vi.fn().mockReturnValue({ delete: mockAnchorsDelete }),
        }),
      } as unknown as ReturnType<typeof db.timeanchors.where>);

      vi.mocked(db.playerpresences.filter).mockImplementation(((
        predicate: (p: { matchLineupId: string; isSynced: number }) => boolean,
      ) => {
        const dummyPresences = [
          { matchLineupId: "l1", isSynced: 1 },
          { matchLineupId: "other", isSynced: 0 },
        ];
        const matched = dummyPresences.filter(predicate);
        return {
          primaryKeys: vi.fn().mockResolvedValue(matched.map(() => "dummy-id")),
        };
      }) as unknown as typeof db.playerpresences.filter);

      vi.mocked(db.gameevents.filter).mockImplementation(((
        predicate: (e: { matchLineupId: string; isSynced: number }) => boolean,
      ) => {
        const dummyEvents = [
          { matchLineupId: "l1", isSynced: 1 },
          { matchLineupId: "other", isSynced: 0 },
        ];
        const matched = dummyEvents.filter(predicate);
        return {
          primaryKeys: vi.fn().mockResolvedValue(matched.map(() => "dummy-id")),
        };
      }) as unknown as typeof db.gameevents.filter);

      await callback();
    }) as unknown as typeof db.transaction);

    const result = await hydrateMatchData(matchId, teamId);

    expect(result).toEqual({ success: true, isOfflineFallback: false });
    expect(apiClient.get).toHaveBeenCalledWith(
      `/Matches/${matchId}/teams/${teamId}/lineup`,
    );
    expect(db.matches.put).toHaveBeenCalledWith({
      id: matchId,
      title: "Match 1",
    });
    expect(db.matchlineups.bulkPut).toHaveBeenCalledWith([
      { id: "l1", matchId },
    ]);
  });

  it("fetches and stores tournament and sport configuration when match contains tournamentId", async () => {
    const tournamentId = "tourn-789";
    const sportId = "sport-111";
    const configId = "config-999";

    const mockConfig = {
      id: configId,
      sportId,
      periodsCount: 4,
    };

    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ id: matchId, tournamentId })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        id: tournamentId,
        sportId,
        configurationId: configId,
      });

    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce([
      mockConfig as unknown as Awaited<
        ReturnType<typeof sportService.getSportConfigurations>
      >[0],
    ]);

    vi.mocked(db.transaction).mockImplementation((async (
      _mode: string,
      _tables: unknown,
      callback: () => Promise<void>,
    ) => {
      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          delete: vi.fn().mockResolvedValue(0),
          toArray: vi.fn().mockResolvedValue([]),
        }),
      } as unknown as ReturnType<typeof db.matchlineups.where>);

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          and: vi
            .fn()
            .mockReturnValue({ delete: vi.fn().mockResolvedValue(0) }),
        }),
      } as unknown as ReturnType<typeof db.timeanchors.where>);

      vi.mocked(db.playerpresences.filter).mockImplementation((() => ({
        primaryKeys: vi.fn().mockResolvedValue([]),
      })) as unknown as typeof db.playerpresences.filter);

      vi.mocked(db.gameevents.filter).mockImplementation((() => ({
        primaryKeys: vi.fn().mockResolvedValue([]),
      })) as unknown as typeof db.gameevents.filter);

      await callback();
    }) as unknown as typeof db.transaction);

    const result = await hydrateMatchData(matchId, teamId);

    expect(result).toEqual({ success: true, isOfflineFallback: false });
    expect(apiClient.get).toHaveBeenCalledWith(`/Tournaments/${tournamentId}`);
    expect(sportService.getSportConfigurations).toHaveBeenCalledWith(sportId);
    expect(db.tournaments.put).toHaveBeenCalledWith({
      id: tournamentId,
      sportId,
      configurationId: configId,
    });
    expect(db.sportconfigurations.put).toHaveBeenCalledWith(mockConfig);
  });

  it("re-throws Hydration Metadata Error when tournament fetch fails", async () => {
    const tournamentId = "tourn-failed";

    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ id: matchId, tournamentId })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Tournament fetch failed 500"));

    await expect(hydrateMatchData(matchId, teamId)).rejects.toThrow(
      "Hydration Metadata Error: Failed to fetch tournament 'tourn-failed' during hydration: Tournament fetch failed 500",
    );
    expect(seedTestData).not.toHaveBeenCalled();
  });

  it("re-throws Hydration Metadata Error when tournament response is null", async () => {
    const tournamentId = "tourn-null";

    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ id: matchId, tournamentId })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(null);

    await expect(hydrateMatchData(matchId, teamId)).rejects.toThrow(
      `Hydration Metadata Error: Tournament '${tournamentId}' returned null during hydration.`,
    );
    expect(seedTestData).not.toHaveBeenCalled();
  });

  it("re-throws Hydration Metadata Error when sportService.getSportConfigurations request is rejected", async () => {
    const tournamentId = "tourn-789";
    const sportId = "sport-111";
    const configId = "config-999";

    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ id: matchId, tournamentId })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        id: tournamentId,
        sportId,
        configurationId: configId,
      });

    vi.mocked(sportService.getSportConfigurations).mockRejectedValueOnce(
      new Error("Network error loading sport configurations"),
    );

    await expect(hydrateMatchData(matchId, teamId)).rejects.toThrow(
      `Hydration Metadata Error: Failed to fetch sport configurations for sport '${sportId}': Network error loading sport configurations`,
    );
    expect(seedTestData).not.toHaveBeenCalled();
  });

  it("re-throws Hydration Metadata Error when tournament is missing required IDs", async () => {
    const tournamentId = "tourn-incomplete";

    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ id: matchId, tournamentId })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ id: tournamentId });

    await expect(hydrateMatchData(matchId, teamId)).rejects.toThrow(
      "Hydration Metadata Error: Tournament 'tourn-incomplete' is missing sportId or configurationId.",
    );
    expect(seedTestData).not.toHaveBeenCalled();
  });

  it("re-throws Hydration Metadata Error when sport configuration fetch fails or matching config is not found", async () => {
    const tournamentId = "tourn-789";
    const sportId = "sport-111";
    const configId = "config-missing";

    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ id: matchId, tournamentId })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        id: tournamentId,
        sportId,
        configurationId: configId,
      });

    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce([]);

    await expect(hydrateMatchData(matchId, teamId)).rejects.toThrow(
      "Hydration Metadata Error: SportConfiguration 'config-missing' not found for sport 'sport-111'.",
    );
    expect(seedTestData).not.toHaveBeenCalled();
  });

  it("deletes synced presence and event rows for removed lineup IDs when server returns empty lineups", async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ id: matchId })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const mockLineupsDelete = vi.fn().mockResolvedValue(1);
    const mockAnchorsDelete = vi.fn().mockResolvedValue(1);

    const oldLineupId = "old-lineup-id";
    const mockDbPresences = [
      { id: "synced-old-p1", matchLineupId: oldLineupId, isSynced: 1 },
    ];
    const mockDbEvents = [
      { id: "synced-old-e1", matchLineupId: oldLineupId, isSynced: 1 },
    ];

    vi.mocked(db.transaction).mockImplementation((async (
      _mode: string,
      _tables: unknown,
      callback: () => Promise<void>,
    ) => {
      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          delete: mockLineupsDelete,
          toArray: vi.fn().mockResolvedValue([{ id: oldLineupId, matchId }]),
        }),
      } as unknown as ReturnType<typeof db.matchlineups.where>);

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          and: vi.fn().mockReturnValue({ delete: mockAnchorsDelete }),
        }),
      } as unknown as ReturnType<typeof db.timeanchors.where>);

      vi.mocked(db.playerpresences.filter).mockImplementation(((
        predicate: (p: (typeof mockDbPresences)[0]) => boolean,
      ) => {
        const matched = mockDbPresences.filter(predicate);
        return {
          primaryKeys: vi
            .fn()
            .mockResolvedValue(matched.map((item) => item.id)),
        };
      }) as unknown as typeof db.playerpresences.filter);

      vi.mocked(db.gameevents.filter).mockImplementation(((
        predicate: (e: (typeof mockDbEvents)[0]) => boolean,
      ) => {
        const matched = mockDbEvents.filter(predicate);
        return {
          primaryKeys: vi
            .fn()
            .mockResolvedValue(matched.map((item) => item.id)),
        };
      }) as unknown as typeof db.gameevents.filter);

      await callback();
    }) as unknown as typeof db.transaction);

    const result = await hydrateMatchData(matchId, teamId);

    expect(result).toEqual({ success: true, isOfflineFallback: false });
    expect(mockLineupsDelete).toHaveBeenCalledTimes(1);
    expect(db.playerpresences.bulkDelete).toHaveBeenCalledWith([
      "synced-old-p1",
    ]);
    expect(db.gameevents.bulkDelete).toHaveBeenCalledWith(["synced-old-e1"]);
  });

  it("handles undefined server collections and empty definitions gracefully", async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);

    vi.mocked(db.transaction).mockImplementation((async (
      _mode: string,
      _tables: unknown,
      callback: () => Promise<void>,
    ) => {
      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      } as unknown as ReturnType<typeof db.matchlineups.where>);

      await callback();
    }) as unknown as typeof db.transaction);

    const result = await hydrateMatchData(matchId, teamId);

    expect(result).toEqual({ success: true, isOfflineFallback: false });
    expect(db.matches.put).not.toHaveBeenCalled();
    expect(db.eventdefinitions.bulkPut).not.toHaveBeenCalled();
  });

  it("executes Dexie filter predicates and handles presence/event bulk operations", async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ id: matchId })
      .mockResolvedValueOnce([{ id: "l1", matchId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "p1", matchLineupId: "l1" }])
      .mockResolvedValueOnce([{ id: "e1", matchLineupId: "l1" }])
      .mockResolvedValueOnce([]);

    const mockDbPresences = [
      { id: "synced-p1", matchLineupId: "l1", isSynced: 1 },
      { id: "pending-p1", matchLineupId: "l1", isSynced: 0 },
      { id: "other-p", matchLineupId: "other-l", isSynced: 1 },
    ];

    const mockDbEvents = [
      { id: "synced-e1", matchLineupId: "l1", isSynced: 1 },
      { id: "pending-e1", matchLineupId: "l1", isSynced: 0 },
      { id: "other-e", matchLineupId: "other-l", isSynced: 1 },
    ];

    vi.mocked(db.transaction).mockImplementation((async (
      _mode: string,
      _tables: unknown,
      callback: () => Promise<void>,
    ) => {
      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          delete: vi.fn().mockResolvedValue(1),
          toArray: vi.fn().mockResolvedValue([{ id: "l1", matchId }]),
        }),
      } as unknown as ReturnType<typeof db.matchlineups.where>);

      vi.mocked(db.playerpresences.filter).mockImplementation(((
        predicate: (p: (typeof mockDbPresences)[0]) => boolean,
      ) => {
        const filtered = mockDbPresences.filter(predicate);
        return {
          primaryKeys: vi
            .fn()
            .mockResolvedValue(filtered.map((item) => item.id)),
        };
      }) as unknown as typeof db.playerpresences.filter);

      vi.mocked(db.gameevents.filter).mockImplementation(((
        predicate: (e: (typeof mockDbEvents)[0]) => boolean,
      ) => {
        const filtered = mockDbEvents.filter(predicate);
        return {
          primaryKeys: vi
            .fn()
            .mockResolvedValue(filtered.map((item) => item.id)),
        };
      }) as unknown as typeof db.gameevents.filter);

      await callback();
    }) as unknown as typeof db.transaction);

    const result = await hydrateMatchData(matchId, teamId);

    expect(result).toEqual({ success: true, isOfflineFallback: false });
    expect(db.playerpresences.bulkDelete).toHaveBeenCalledWith(["synced-p1"]);
    expect(db.gameevents.bulkDelete).toHaveBeenCalledWith(["synced-e1"]);
  });

  it("re-throws 401 or 403 authentication errors to caller", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(
      new Error("API Request failed: 401 Unauthorized"),
    );

    await expect(hydrateMatchData(matchId, teamId)).rejects.toThrow("401");
    expect(seedTestData).not.toHaveBeenCalled();
  });

  it("re-throws 403 Forbidden error when message contains 403", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(
      new Error("API Request failed: 403 Forbidden"),
    );

    await expect(hydrateMatchData(matchId, teamId)).rejects.toThrow("403");
    expect(seedTestData).not.toHaveBeenCalled();
  });

  it("re-throws non-Error throwables if they contain 401 or 403", async () => {
    vi.mocked(apiClient.get).mockRejectedValue("401 Unauthorized string error");

    await expect(hydrateMatchData(matchId, teamId)).rejects.toThrow("401");
    expect(seedTestData).not.toHaveBeenCalled();
  });

  it("falls back to local seedTestData on non-Error throwable general failures", async () => {
    vi.mocked(apiClient.get).mockRejectedValue("Generic string exception");

    const result = await hydrateMatchData(matchId, teamId);

    expect(result).toEqual({ success: true, isOfflineFallback: true });
    expect(seedTestData).toHaveBeenCalledTimes(1);
  });

  it("falls back to local seedTestData on general network/server errors", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error("Failed to fetch"));

    const result = await hydrateMatchData(matchId, teamId);

    expect(result).toEqual({ success: true, isOfflineFallback: true });
    expect(seedTestData).toHaveBeenCalledTimes(1);
  });

  it("should skip finished matches and return the first unfinished match when IndexedDB contains multiple match rows", async () => {
    const completedMatch = { id: "m-completed", homeScore: 10, guestScore: 8 };
    const activeMatch = { id: "m-active", homeScore: null, guestScore: null };
    vi.mocked(db.matches.toArray).mockResolvedValueOnce([
      completedMatch as never,
      activeMatch as never,
    ]);

    const unfinished = await checkUnfinishedMatch();
    expect(unfinished).toEqual(activeMatch);
  });

  it("should return null when all matches in IndexedDB are marked as finished", async () => {
    const completedMatch1 = {
      id: "m-completed-1",
      homeScore: 10,
      guestScore: 8,
    };
    const completedMatch2 = {
      id: "m-completed-2",
      homeScore: 5,
      guestScore: 3,
    };
    vi.mocked(db.matches.toArray).mockResolvedValueOnce([
      completedMatch1 as never,
      completedMatch2 as never,
    ]);

    const unfinished = await checkUnfinishedMatch();
    expect(unfinished).toBeNull();
  });
});
