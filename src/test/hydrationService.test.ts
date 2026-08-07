import { describe, it, expect, vi, beforeEach } from "vitest";
import { hydrateMatchData } from "../services/hydrationService";
import { apiClient } from "../api/client";
import { db } from "../db/ttaDatabase";
import { seedTestData } from "../db/seed";

vi.mock("../api/client", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

vi.mock("../db/seed", () => ({
  seedTestData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/ttaDatabase", () => ({
  db: {
    transaction: vi.fn(),
    matches: { put: vi.fn() },
    matchlineups: { where: vi.fn(), bulkPut: vi.fn() },
    timeanchors: { where: vi.fn(), bulkPut: vi.fn() },
    playerpresences: { filter: vi.fn(), bulkPut: vi.fn(), bulkDelete: vi.fn() },
    gameevents: { filter: vi.fn(), bulkPut: vi.fn(), bulkDelete: vi.fn() },
    eventdefinitions: { bulkPut: vi.fn() },
  },
}));

describe("Hydration Service", () => {
  const matchId = "m-123";
  const teamId = "team-456";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test Case 1: Standard successful hydration
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

  // Test Case 2: Handling empty collections returned from server
  it("deletes synced match-owned rows when server returns empty collections while preserving pending unsynced records", async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ id: matchId })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const mockLineupsDelete = vi.fn().mockResolvedValue(1);
    const mockAnchorsDelete = vi.fn().mockResolvedValue(1);

    vi.mocked(db.transaction).mockImplementation((async (
      _mode: string,
      _tables: unknown,
      callback: () => Promise<void>,
    ) => {
      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          delete: mockLineupsDelete,
          toArray: vi.fn().mockResolvedValue([]),
        }),
      } as unknown as ReturnType<typeof db.matchlineups.where>);

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          and: vi.fn().mockReturnValue({ delete: mockAnchorsDelete }),
        }),
      } as unknown as ReturnType<typeof db.timeanchors.where>);

      vi.mocked(db.playerpresences.filter).mockImplementation(((
        predicate: (p: { matchLineupId: string; isSynced: number }) => boolean,
      ) => {
        const dummyPresences = [{ matchLineupId: "l1", isSynced: 1 }];
        const matched = dummyPresences.filter(predicate);
        return {
          primaryKeys: vi.fn().mockResolvedValue(matched.map(() => "id")),
        };
      }) as unknown as typeof db.playerpresences.filter);

      vi.mocked(db.gameevents.filter).mockImplementation(((
        predicate: (e: { matchLineupId: string; isSynced: number }) => boolean,
      ) => {
        const dummyEvents = [{ matchLineupId: "l1", isSynced: 1 }];
        const matched = dummyEvents.filter(predicate);
        return {
          primaryKeys: vi.fn().mockResolvedValue(matched.map(() => "id")),
        };
      }) as unknown as typeof db.gameevents.filter);

      await callback();
    }) as unknown as typeof db.transaction);

    const result = await hydrateMatchData(matchId, teamId);

    expect(result).toEqual({ success: true, isOfflineFallback: false });
    expect(mockLineupsDelete).toHaveBeenCalledTimes(1);
  });

  // Test Case 3: Early exit when server returns undefined collections
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

  // Test Case 4: Executes predicates against realistic mock DB objects to cover lines 41, 51 & 70
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

      // Real execution of predicate callbacks passed to playerpresences.filter
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

      // Real execution of predicate callbacks passed to gameevents.filter
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

  // Test Case 5: 401 Unauthorized handling
  it("re-throws 401 or 403 authentication errors to caller", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(
      new Error("API Request failed: 401 Unauthorized"),
    );

    await expect(hydrateMatchData(matchId, teamId)).rejects.toThrow("401");
    expect(seedTestData).not.toHaveBeenCalled();
  });

  // Test Case 6: 403 Forbidden handling
  it("re-throws 403 Forbidden error when message contains 403", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(
      new Error("API Request failed: 403 Forbidden"),
    );

    await expect(hydrateMatchData(matchId, teamId)).rejects.toThrow("403");
    expect(seedTestData).not.toHaveBeenCalled();
  });

  // Test Case 7: Non-Error throwables containing 401/403
  it("re-throws non-Error throwables if they contain 401 or 403", async () => {
    vi.mocked(apiClient.get).mockRejectedValue("401 Unauthorized string error");

    await expect(hydrateMatchData(matchId, teamId)).rejects.toThrow("401");
    expect(seedTestData).not.toHaveBeenCalled();
  });

  // Test Case 8: Non-Error general throwables fallback to seedTestData
  it("falls back to local seedTestData on non-Error throwable general failures", async () => {
    vi.mocked(apiClient.get).mockRejectedValue("Generic string exception");

    const result = await hydrateMatchData(matchId, teamId);

    expect(result).toEqual({ success: true, isOfflineFallback: true });
    expect(seedTestData).toHaveBeenCalledTimes(1);
  });

  // Test Case 9: General network failure fallback to seedTestData
  it("falls back to local seedTestData on general network/server errors", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error("Failed to fetch"));

    const result = await hydrateMatchData(matchId, teamId);

    expect(result).toEqual({ success: true, isOfflineFallback: true });
    expect(seedTestData).toHaveBeenCalledTimes(1);
  });
});
