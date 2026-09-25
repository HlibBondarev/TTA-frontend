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

vi.mock("../db/eventService", () => ({
  getNextSequenceNumber: vi.fn().mockResolvedValue(10),
}));

const { mockDelete, mockBulkDelete } = vi.hoisted(() => ({
  mockDelete: vi.fn().mockResolvedValue(1),
  mockBulkDelete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/ttaDatabase", () => {
  return {
    db: {
      gameevents: {
        where: vi.fn().mockReturnValue({
          anyOf: vi.fn().mockReturnValue({
            delete: mockDelete,
          }),
        }),
      },
      playerpresences: {
        update: vi.fn().mockResolvedValue(1),
        where: vi.fn().mockImplementation((field: string) => {
          if (field === "periodNumber") {
            return {
              equals: vi.fn().mockReturnValue({
                filter: vi.fn().mockReturnValue({
                  toArray: vi.fn().mockResolvedValue([]),
                }),
              }),
            };
          }
          return {
            anyOf: vi.fn().mockReturnValue({
              delete: mockDelete,
            }),
          };
        }),
      },
      timeanchors: {
        add: vi.fn().mockResolvedValue("anchor-id"),
        where: vi.fn().mockReturnValue({
          equals: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
            delete: mockDelete,
          }),
        }),
      },
      matchlineups: {
        where: vi.fn().mockReturnValue({
          equals: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([{ id: "lineup-1" }]),
            delete: mockDelete,
          }),
        }),
      },
      syncQueue: {
        add: vi.fn().mockResolvedValue(1),
        count: vi.fn().mockResolvedValue(0),
        filter: vi.fn().mockReturnValue({
          primaryKeys: vi.fn().mockResolvedValue([101]),
          count: vi.fn().mockResolvedValue(0),
        }),
        bulkDelete: mockBulkDelete,
      },
      matches: {
        delete: mockDelete,
      },
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

    await expect(
      matchFinalizationService.finalizeMatch({
        matchId: "match-123",
        activeTeamId: "",
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

  it("should execute sync, record result, normalize events, and purge scoped IndexedDB entities on success", async () => {
    const matchId = "00000000-0000-4000-8000-000000000123";
    const otherMatchId = "00000000-0000-4000-8000-000000000124";
    const params = {
      matchId,
      activeTeamId: "team-456",
      homeScore: 12,
      guestScore: 9,
      temperature: 26.5,
    };

    await matchFinalizationService.finalizeMatch(params);

    expect(processSyncQueue).toHaveBeenCalledTimes(1);

    expect(apiClient.put).toHaveBeenNthCalledWith(
      1,
      `/Matches/${matchId}/result`,
      {
        homeScore: 12,
        guestScore: 9,
        temperature: 26.5,
      },
    );

    expect(apiClient.put).toHaveBeenNthCalledWith(
      2,
      `/Matches/${matchId}/teams/team-456/events/normalize`,
    );

    expect(db.matches.delete).toHaveBeenCalledWith(matchId);
    expect(mockBulkDelete).toHaveBeenCalledWith([101]);

    const matchlineupsWhere = vi.mocked(db.matchlineups.where);
    expect(matchlineupsWhere.mock.results[0].value.equals).toHaveBeenCalledWith(
      matchId,
    );
    expect(matchlineupsWhere.mock.results[1].value.equals).toHaveBeenCalledWith(
      matchId,
    );

    expect(db.gameevents.where).toHaveBeenCalledWith("matchLineupId");
    const eventsAnyOf = vi.mocked(db.gameevents.where).mock.results[0].value
      .anyOf;
    expect(eventsAnyOf).toHaveBeenCalledWith(["lineup-1"]);

    const presencesAnyOf = vi.mocked(db.playerpresences.where).mock.results[0]
      .value.anyOf;
    expect(presencesAnyOf).toHaveBeenCalledWith(["lineup-1"]);

    expect(db.timeanchors.where).toHaveBeenLastCalledWith("matchId");
    const anchorsEquals = vi.mocked(db.timeanchors.where).mock.results.at(-1)!
      .value.equals;
    expect(anchorsEquals).toHaveBeenLastCalledWith(matchId);

    const filterCalls = vi.mocked(db.syncQueue.filter).mock.calls;
    expect(filterCalls).toHaveLength(2);
    for (const [fn] of filterCalls) {
      const predicate = fn as (item: { endpoint?: unknown }) => boolean;
      expect(predicate({ endpoint: `/Matches/${matchId}` })).toBe(true);
      expect(predicate({ endpoint: `/Matches/${matchId}/anchors` })).toBe(true);
      expect(predicate({ endpoint: `/Matches/${matchId}0/anchors` })).toBe(
        false,
      );
      expect(predicate({ endpoint: `/Matches/${otherMatchId}/anchors` })).toBe(
        false,
      );
      expect(predicate({ endpoint: undefined })).toBe(false);
    }
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

  it("should auto-close open active period even when no active presences exist in IndexedDB", async () => {
    const matchId = "match-active-no-presences";
    vi.mocked(db.timeanchors.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValueOnce([
          {
            id: "start-anchor-1",
            matchId,
            periodNumber: 1,
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
          toArray: vi.fn().mockResolvedValueOnce([]),
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
        periodNumber: 1,
        type: 1, // PeriodEnd
      }),
    );
    expect(db.playerpresences.update).not.toHaveBeenCalled();
  });

  it("should auto-close stoppage anchor (type 3) before PeriodEnd anchor when last anchor is StoppageStart (type 2)", async () => {
    const matchId = "match-in-stoppage";
    vi.mocked(db.timeanchors.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValueOnce([
          {
            id: "start-anchor-1",
            matchId,
            periodNumber: 1,
            type: 0, // PeriodStart
            sequenceNumber: 1,
            timestamp: "2026-09-03T10:00:00.000Z",
          },
          {
            id: "stoppage-start-1",
            matchId,
            periodNumber: 1,
            type: 2, // StoppageStart
            sequenceNumber: 2,
            timestamp: "2026-09-03T10:05:00.000Z",
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

    expect(db.timeanchors.add).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        matchId,
        periodNumber: 1,
        type: 3, // StoppageEnd
      }),
    );

    expect(db.timeanchors.add).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        matchId,
        periodNumber: 1,
        type: 1, // PeriodEnd
      }),
    );
  });

  it("should auto-close active period when latest anchor is StoppageEnd (type 3)", async () => {
    const matchId = "match-resumed-stoppage";
    vi.mocked(db.timeanchors.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValueOnce([
          {
            id: "start-anchor-1",
            matchId,
            periodNumber: 1,
            type: 0, // PeriodStart
            sequenceNumber: 1,
            timestamp: "2026-09-03T10:00:00.000Z",
          },
          {
            id: "stoppage-start-1",
            matchId,
            periodNumber: 1,
            type: 2, // StoppageStart
            sequenceNumber: 2,
            timestamp: "2026-09-03T10:05:00.000Z",
          },
          {
            id: "stoppage-end-1",
            matchId,
            periodNumber: 1,
            type: 3, // StoppageEnd
            sequenceNumber: 3,
            timestamp: "2026-09-03T10:06:00.000Z",
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
        periodNumber: 1,
        type: 1, // PeriodEnd
      }),
    );
    expect(db.playerpresences.update).toHaveBeenCalledWith(
      "presence-1",
      expect.objectContaining({
        timeOut: expect.any(String),
      }),
    );
  });

  it("should skip line-item and syncQueue bulk deletes when no lineups or match sync keys exist in Step 4", async () => {
    vi.mocked(db.matchlineups.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValueOnce([]),
        delete: mockDelete,
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(db.syncQueue.filter).mockReturnValue({
      primaryKeys: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    } as unknown as ReturnType<typeof db.syncQueue.filter>);

    await matchFinalizationService.finalizeMatch({
      matchId: "match-empty-lineups",
      activeTeamId: "team-456",
      homeScore: 5,
      guestScore: 3,
      temperature: null,
    });

    expect(db.gameevents.where).not.toHaveBeenCalled();
    expect(mockBulkDelete).not.toHaveBeenCalled();
    expect(db.matches.delete).toHaveBeenCalledWith("match-empty-lineups");
  });

  it("should correctly sort time anchors by timestamp when sequence numbers are identical during auto-close", async () => {
    const matchId = "match-same-seq";
    vi.mocked(db.timeanchors.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValueOnce([
          {
            id: "anchor-1",
            matchId,
            periodNumber: 1,
            type: 0, // PeriodStart
            sequenceNumber: 1,
            timestamp: "2026-09-03T10:00:00.000Z",
          },
          {
            id: "anchor-2",
            matchId,
            periodNumber: 1,
            type: 1, // PeriodEnd
            sequenceNumber: 1,
            timestamp: "2026-09-03T10:15:00.000Z",
          },
        ]),
      }),
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    await matchFinalizationService.finalizeMatch({
      matchId,
      activeTeamId: "team-456",
      homeScore: 10,
      guestScore: 8,
      temperature: 25,
    });

    expect(db.timeanchors.add).not.toHaveBeenCalled();
  });

  it("should ABORT finalization if autoCloseOpenPeriodAndPresences transaction fails", async () => {
    vi.mocked(db.transaction).mockImplementationOnce((() =>
      Promise.reject(
        new Error("IndexedDB write failed inside transaction"),
      )) as unknown as typeof db.transaction);

    const params = {
      matchId: "match-123",
      activeTeamId: "team-456",
      homeScore: 10,
      guestScore: 8,
      temperature: 25,
    };

    await expect(
      matchFinalizationService.finalizeMatch(params),
    ).rejects.toThrow("IndexedDB write failed inside transaction");

    expect(processSyncQueue).not.toHaveBeenCalled();
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  it("should ABORT finalization if sync queue still contains pending items for the target match after processSyncQueue", async () => {
    vi.mocked(db.syncQueue.filter).mockReturnValueOnce({
      count: vi.fn().mockResolvedValueOnce(2),
    } as unknown as ReturnType<typeof db.syncQueue.filter>);

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
    expect(db.matches.delete).not.toHaveBeenCalled();
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
    expect(db.matches.delete).not.toHaveBeenCalled();
  });
});
