import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../../db/ttaDatabase";
import {
  findDisqualifiedLineupIds,
  initializePeriodPresenceTx,
  terminatePeriodPresenceTx,
  substitutePlayerTx,
  exitPlayerPresenceTx,
  enterPlayerPresenceTx,
} from "../../db/presenceService";

vi.mock("../../db/ttaDatabase", () => ({
  db: {
    playerpresences: {
      bulkAdd: vi.fn(),
      where: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    gameevents: {
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    timeanchors: {
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    syncQueue: {
      add: vi.fn(),
    },
    matches: {
      get: vi.fn(),
    },
    tournaments: {
      get: vi.fn(),
    },
    sportconfigurations: {
      get: vi.fn(),
    },
    eventdefinitions: {
      bulkGet: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
    },
    transaction: vi.fn((_mode, _tables, cb) => cb()),
  },
}));

describe("presenceService Database Transactions", () => {
  const mockMatchId = "match-123";
  const mockPeriodNumber = 1;
  const mockPlayerLineupIds = ["lineup-1", "lineup-2"];
  const mockStartTimestamp = "2026-07-22T10:00:00.000Z";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializePeriodPresenceTx should bulk-add presences and add a sync queue item matching InitializePresenceRequest DTO contract", async () => {
    await initializePeriodPresenceTx(
      mockMatchId,
      mockPeriodNumber,
      mockPlayerLineupIds,
      mockStartTimestamp,
    );

    expect(db.transaction).toHaveBeenCalledWith(
      "rw",
      [
        db.playerpresences,
        db.gameevents,
        db.timeanchors,
        db.syncQueue,
        db.matches,
        db.tournaments,
        db.sportconfigurations,
        db.eventdefinitions,
      ],
      expect.any(Function),
    );

    expect(db.playerpresences.bulkAdd).toHaveBeenCalledWith([
      {
        id: expect.any(String),
        matchLineupId: "lineup-1",
        periodNumber: mockPeriodNumber,
        timeIn: mockStartTimestamp,
        timeOut: null,
        sequenceNumber: expect.any(Number),
        isSynced: 0,
      },
      {
        id: expect.any(String),
        matchLineupId: "lineup-2",
        periodNumber: mockPeriodNumber,
        timeIn: mockStartTimestamp,
        timeOut: null,
        sequenceNumber: expect.any(Number),
        isSynced: 0,
      },
    ]);

    const bulkAddCall = vi.mocked(db.playerpresences.bulkAdd).mock.calls[0][0];
    const presences = bulkAddCall as unknown as Array<{
      id: string;
      matchLineupId: string;
    }>;

    expect(db.syncQueue.add).toHaveBeenCalledWith({
      actionType: "POST",
      endpoint: `/Matches/${mockMatchId}/presence/initialize`,
      payload: JSON.stringify({
        periodNumber: mockPeriodNumber,
        timeIn: mockStartTimestamp,
        presenceItems: [
          {
            id: presences[0].id,
            matchLineupId: "lineup-1",
          },
          {
            id: presences[1].id,
            matchLineupId: "lineup-2",
          },
        ],
      }),
      createdAt: mockStartTimestamp,
    });
  });

  it("terminatePeriodPresenceTx should find and close all active player presences evaluating filter predicates", async () => {
    const mockEndTimestamp = "2026-07-22T10:08:00.000Z";

    const mockPresencesDataset = [
      { id: "pres-1", matchLineupId: "lineup-1", timeOut: null },
      { id: "pres-2", matchLineupId: "lineup-2", timeOut: null },
      {
        id: "pres-closed",
        matchLineupId: "lineup-1",
        timeOut: "2026-07-22T10:04:00.000Z",
      },
      { id: "pres-other", matchLineupId: "lineup-3", timeOut: null },
    ];

    const filterMock = vi.fn(
      (predicate: (p: (typeof mockPresencesDataset)[0]) => boolean) => {
        const filtered = mockPresencesDataset.filter(predicate);
        return {
          toArray: vi.fn().mockResolvedValue(filtered),
        };
      },
    );

    vi.mocked(db.playerpresences.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        filter: filterMock,
      }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    await terminatePeriodPresenceTx(
      mockMatchId,
      mockPeriodNumber,
      mockPlayerLineupIds,
      mockEndTimestamp,
    );

    expect(db.playerpresences.update).toHaveBeenCalledWith("pres-1", {
      timeOut: mockEndTimestamp,
      isSynced: 0,
    });
    expect(db.playerpresences.update).toHaveBeenCalledWith("pres-2", {
      timeOut: mockEndTimestamp,
      isSynced: 0,
    });
    expect(db.playerpresences.update).not.toHaveBeenCalledWith(
      "pres-closed",
      expect.anything(),
    );
    expect(db.playerpresences.update).not.toHaveBeenCalledWith(
      "pres-other",
      expect.anything(),
    );

    expect(db.syncQueue.add).toHaveBeenCalledWith({
      actionType: "PUT",
      endpoint: `/Matches/${mockMatchId}/presence/terminate`,
      payload: JSON.stringify({
        periodNumber: mockPeriodNumber,
        playerLineupIds: mockPlayerLineupIds,
        timeOut: mockEndTimestamp,
      }),
      createdAt: mockEndTimestamp,
      periodEndMeta: {
        matchId: mockMatchId,
        periodNumber: mockPeriodNumber,
        timeOut: mockEndTimestamp,
        closedPresenceIds: ["pres-1", "pres-2"],
        closedLineupIds: mockPlayerLineupIds,
      },
    });
  });

  it("substitutePlayerTx should cleanly close active player and open a new presence with matching substitution payload contract", async () => {
    const mockPresencesDataset = [
      {
        id: "pres-closed",
        matchLineupId: "lineup-out",
        timeOut: "2026-07-22T10:01:00.000Z",
      },
      { id: "pres-out", matchLineupId: "lineup-out", timeOut: null },
    ];

    const filterMock = vi.fn(
      (predicate: (p: (typeof mockPresencesDataset)[0]) => boolean) => {
        const filtered = mockPresencesDataset.filter(predicate);
        return {
          first: vi.fn().mockResolvedValue(filtered[0]),
        };
      },
    );

    vi.mocked(db.playerpresences.where).mockReturnValue({
      filter: filterMock,
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    const newPresenceId = await substitutePlayerTx(
      mockMatchId,
      mockPeriodNumber,
      "lineup-out",
      "lineup-in",
    );

    expect(newPresenceId).toBeDefined();

    expect(db.playerpresences.update).toHaveBeenCalledWith("pres-out", {
      timeOut: expect.any(String),
      isSynced: 0,
    });

    expect(db.playerpresences.add).toHaveBeenCalledWith({
      id: newPresenceId,
      matchLineupId: "lineup-in",
      periodNumber: mockPeriodNumber,
      timeIn: expect.any(String),
      timeOut: null,
      sequenceNumber: expect.any(Number),
      isSynced: 0,
    });

    expect(db.syncQueue.add).toHaveBeenCalledTimes(1);
    const syncCall = vi.mocked(db.syncQueue.add).mock.calls[0][0];

    expect(syncCall).toMatchObject({
      actionType: "POST",
      endpoint: `/Matches/${mockMatchId}/substitutions`,
      createdAt: expect.any(String),
      closedPresenceIds: ["pres-out"],
    });

    const parsedPayload = JSON.parse(syncCall.payload);
    expect(parsedPayload).toEqual({
      periodNumber: mockPeriodNumber,
      playerOutLineupId: "lineup-out",
      playerInLineupId: "lineup-in",
      incomingPresenceId: newPresenceId,
      substitutionTime: syncCall.createdAt,
    });
  });

  it("substitutePlayerTx should throw an error if no active presence exists for outgoing player", async () => {
    const filterMock = vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue(undefined),
    });

    vi.mocked(db.playerpresences.where).mockReturnValue({
      filter: filterMock,
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    await expect(
      substitutePlayerTx(
        mockMatchId,
        mockPeriodNumber,
        "lineup-out",
        "lineup-in",
      ),
    ).rejects.toThrow("No active presence found for the outgoing player.");
  });

  it("exitPlayerPresenceTx should close a single open presence and enqueue PUT /presence/terminate", async () => {
    const exitTime = "2026-07-22T10:03:00.000Z";
    const filterMock = vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue({
        id: "pres-out",
        matchLineupId: "lineup-1",
        periodNumber: mockPeriodNumber,
        timeIn: "2026-07-22T10:00:00.000Z",
        timeOut: null,
      }),
    });

    vi.mocked(db.playerpresences.where).mockReturnValue({
      filter: filterMock,
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    const didExit = await exitPlayerPresenceTx(
      mockMatchId,
      mockPeriodNumber,
      "lineup-1",
      exitTime,
    );

    expect(didExit).toBe(true);
    expect(db.playerpresences.update).toHaveBeenCalledWith("pres-out", {
      timeOut: exitTime,
      isSynced: 0,
    });
    expect(db.syncQueue.add).toHaveBeenCalledWith({
      actionType: "PUT",
      endpoint: `/Matches/${mockMatchId}/presence/terminate`,
      payload: JSON.stringify({
        periodNumber: mockPeriodNumber,
        playerLineupIds: ["lineup-1"],
        timeOut: exitTime,
      }),
      createdAt: exitTime,
      closedPresenceIds: ["pres-out"],
    });
  });

  it("exitPlayerPresenceTx should return false cleanly when no open presence exists", async () => {
    vi.mocked(db.playerpresences.where).mockReturnValue({
      filter: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    const didExit = await exitPlayerPresenceTx(
      mockMatchId,
      mockPeriodNumber,
      "lineup-bench",
      "2026-07-22T10:03:00.000Z",
    );

    expect(didExit).toBe(false);
    expect(db.playerpresences.update).not.toHaveBeenCalled();
    expect(db.syncQueue.add).not.toHaveBeenCalled();
  });

  it("enterPlayerPresenceTx should open a standalone presence and enqueue POST /presence/initialize", async () => {
    const entryTime = "2026-07-22T10:04:00.000Z";
    vi.mocked(db.playerpresences.where).mockReturnValue({
      filter: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    const newPresenceId = await enterPlayerPresenceTx(
      mockMatchId,
      mockPeriodNumber,
      "lineup-in",
      entryTime,
    );

    expect(newPresenceId).toBeDefined();
    expect(db.playerpresences.add).toHaveBeenCalledWith({
      id: newPresenceId,
      matchLineupId: "lineup-in",
      periodNumber: mockPeriodNumber,
      timeIn: entryTime,
      timeOut: null,
      sequenceNumber: expect.any(Number),
      isSynced: 0,
    });
    expect(db.syncQueue.add).toHaveBeenCalledWith({
      actionType: "POST",
      endpoint: `/Matches/${mockMatchId}/presence/initialize`,
      payload: JSON.stringify({
        periodNumber: mockPeriodNumber,
        timeIn: entryTime,
        presenceItems: [
          {
            id: newPresenceId,
            matchLineupId: "lineup-in",
          },
        ],
      }),
      createdAt: entryTime,
    });
  });

  it("enterPlayerPresenceTx should default entryTimestamp to current ISO time when omitted", async () => {
    vi.useFakeTimers();
    try {
      const fixedNow = "2026-07-22T10:06:30.000Z";
      vi.setSystemTime(new Date(fixedNow));

      vi.mocked(db.playerpresences.where).mockReturnValue({
        filter: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(undefined),
        }),
      } as unknown as ReturnType<typeof db.playerpresences.where>);

      const newPresenceId = await enterPlayerPresenceTx(
        mockMatchId,
        mockPeriodNumber,
        "lineup-in",
      );

      expect(newPresenceId).toBeDefined();
      expect(db.playerpresences.add).toHaveBeenCalledWith({
        id: newPresenceId,
        matchLineupId: "lineup-in",
        periodNumber: mockPeriodNumber,
        timeIn: fixedNow,
        timeOut: null,
        sequenceNumber: expect.any(Number),
        isSynced: 0,
      });
      expect(db.syncQueue.add).toHaveBeenCalledWith({
        actionType: "POST",
        endpoint: `/Matches/${mockMatchId}/presence/initialize`,
        payload: JSON.stringify({
          periodNumber: mockPeriodNumber,
          timeIn: fixedNow,
          presenceItems: [
            {
              id: newPresenceId,
              matchLineupId: "lineup-in",
            },
          ],
        }),
        createdAt: fixedNow,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("enterPlayerPresenceTx should throw if player already has an active presence", async () => {
    vi.mocked(db.playerpresences.where).mockReturnValue({
      filter: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({
          id: "pres-existing",
          matchLineupId: "lineup-in",
          timeOut: null,
        }),
      }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    await expect(
      enterPlayerPresenceTx(mockMatchId, mockPeriodNumber, "lineup-in"),
    ).rejects.toThrow("Player already has an active presence in this period.");
  });

  it("terminatePeriodPresenceTx should persist periodEndMeta inside the same IndexedDB transaction and reject if queue persistence fails", async () => {
    const mockEndTimestamp = "2026-07-22T10:08:00.000Z";
    const mockPresencesDataset = [
      { id: "pres-1", matchLineupId: "lineup-1", timeOut: null },
    ];

    vi.mocked(db.playerpresences.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        filter: vi.fn(
          (predicate: (p: (typeof mockPresencesDataset)[0]) => boolean) => ({
            toArray: vi
              .fn()
              .mockResolvedValue(mockPresencesDataset.filter(predicate)),
          }),
        ),
      }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    vi.mocked(db.syncQueue.add).mockRejectedValueOnce(
      new Error("IndexedDB queue write interrupted"),
    );

    await expect(
      terminatePeriodPresenceTx(
        `  ${mockMatchId}  `,
        mockPeriodNumber,
        ["lineup-1"],
        mockEndTimestamp,
      ),
    ).rejects.toThrow("IndexedDB queue write interrupted");

    expect(db.transaction).toHaveBeenCalledWith(
      "rw",
      [db.playerpresences, db.syncQueue],
      expect.any(Function),
    );
  });

  it("exitPlayerPresenceTx should not attach periodEndMeta to its sync queue item", async () => {
    const exitTime = "2026-07-22T10:03:00.000Z";
    vi.mocked(db.playerpresences.where).mockReturnValue({
      filter: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({
          id: "pres-out",
          matchLineupId: "lineup-1",
          periodNumber: mockPeriodNumber,
          timeIn: "2026-07-22T10:00:00.000Z",
          timeOut: null,
        }),
      }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    await exitPlayerPresenceTx(
      mockMatchId,
      mockPeriodNumber,
      "lineup-1",
      exitTime,
    );

    const addedItem = vi.mocked(db.syncQueue.add).mock.calls[0][0];
    expect(addedItem).not.toHaveProperty("periodEndMeta");
  });

  it("initializePeriodPresenceTx should reject disqualified players before writing presences or enqueuing sync POST", async () => {
    const originalWhere = (db.gameevents as unknown as { where?: unknown })
      .where;
    (db.gameevents as unknown as { where: unknown }).where = vi
      .fn()
      .mockReturnValue({
        anyOf: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              id: "evt-dq",
              matchLineupId: "lineup-2",
              eventDefinitionId: "def-dq",
              periodNumber: 1,
              eventTimestamp: "2026-07-22T10:05:00.000Z",
              foulImpact: "DisqualificationWithSub",
              penaltyDurationSeconds: null,
              sequenceNumber: 10,
              isSynced: 0,
            },
          ]),
        }),
      });

    try {
      await expect(
        initializePeriodPresenceTx(
          mockMatchId,
          2,
          ["lineup-1", "lineup-2"],
          "2026-07-22T10:15:00.000Z",
        ),
      ).rejects.toThrow(
        "Cannot start period with disqualified players in the starting lineup.",
      );

      expect(db.playerpresences.bulkAdd).not.toHaveBeenCalled();
      expect(db.syncQueue.add).not.toHaveBeenCalled();
    } finally {
      (db.gameevents as unknown as { where?: unknown }).where = originalWhere;
    }
  });

  it("initializePeriodPresenceTx should reject when a disqualifying event commits concurrently before the write transaction starts", async () => {
    const persistedEvents: Array<Record<string, unknown>> = [];
    const originalWhere = (db.gameevents as unknown as { where?: unknown })
      .where;
    const whereSpy = vi.fn().mockReturnValue({
      anyOf: vi.fn().mockReturnValue({
        toArray: vi.fn().mockImplementation(async () => [...persistedEvents]),
      }),
    });
    (db.gameevents as unknown as { where: unknown }).where = whereSpy;

    // Simulate a concurrent disqualifying event committing right before the initialization transaction acquires its lock
    vi.mocked(db.transaction).mockImplementationOnce(((
      _mode: unknown,
      _tables: unknown,
      cb: () => Promise<void>,
    ) => {
      expect(whereSpy).not.toHaveBeenCalled();
      persistedEvents.push({
        id: "evt-concurrent-dq",
        matchLineupId: "lineup-2",
        eventDefinitionId: "def-dq",
        periodNumber: 1,
        eventTimestamp: "2026-07-22T10:14:59.000Z",
        foulImpact: "DisqualificationNoSub",
        penaltyDurationSeconds: null,
        sequenceNumber: 12,
        isSynced: 0,
      });
      return cb();
    }) as unknown as typeof db.transaction);

    try {
      await expect(
        initializePeriodPresenceTx(
          mockMatchId,
          2,
          ["lineup-1", "lineup-2"],
          "2026-07-22T10:15:00.000Z",
        ),
      ).rejects.toThrow(
        "Cannot start period with disqualified players in the starting lineup.",
      );

      expect(whereSpy).toHaveBeenCalledTimes(1);
      expect(db.playerpresences.bulkAdd).not.toHaveBeenCalled();
      expect(db.syncQueue.add).not.toHaveBeenCalled();
    } finally {
      (db.gameevents as unknown as { where?: unknown }).where = originalWhere;
    }
  });

  it("exitPlayerPresenceTx should fall back to the later of current time and timeIn when exitTimestamp precedes timeIn", async () => {
    vi.useFakeTimers();
    try {
      // Case 1: timeIn is in the future relative to current clock -> fallback uses timeIn
      vi.setSystemTime(new Date("2026-07-22T10:02:00.000Z"));
      const futureTimeIn = "2026-07-22T10:05:00.000Z";
      vi.mocked(db.playerpresences.where).mockReturnValue({
        filter: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "pres-skew",
            matchLineupId: "lineup-1",
            periodNumber: mockPeriodNumber,
            timeIn: futureTimeIn,
            timeOut: null,
          }),
        }),
      } as unknown as ReturnType<typeof db.playerpresences.where>);

      await exitPlayerPresenceTx(
        mockMatchId,
        mockPeriodNumber,
        "lineup-1",
        "2026-07-22T10:01:00.000Z",
      );

      expect(db.playerpresences.update).toHaveBeenLastCalledWith("pres-skew", {
        timeOut: futureTimeIn,
        isSynced: 0,
      });

      // Case 2: current clock is later than timeIn -> fallback uses current clock
      vi.setSystemTime(new Date("2026-07-22T10:08:00.000Z"));
      await exitPlayerPresenceTx(
        mockMatchId,
        mockPeriodNumber,
        "lineup-1",
        "2026-07-22T10:01:00.000Z",
      );

      expect(db.playerpresences.update).toHaveBeenLastCalledWith("pres-skew", {
        timeOut: "2026-07-22T10:08:00.000Z",
        isSynced: 0,
      });

      // Case 3: valid supplied exitTimestamp >= timeIn is preserved unchanged
      const validSuppliedExit = "2026-07-22T10:06:00.000Z";
      await exitPlayerPresenceTx(
        mockMatchId,
        mockPeriodNumber,
        "lineup-1",
        validSuppliedExit,
      );

      expect(db.playerpresences.update).toHaveBeenLastCalledWith("pres-skew", {
        timeOut: validSuppliedExit,
        isSynced: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("exitPlayerPresenceTx should handle empty, invalid, and non-ISO timestamps safely", async () => {
    vi.useFakeTimers();
    try {
      const fixedNow = "2026-07-22T10:08:00.000Z";
      vi.setSystemTime(new Date(fixedNow));

      // Case 1: valid timeIn, empty/invalid exitTimestamp -> falls back to current clock (>= timeIn)
      vi.mocked(db.playerpresences.where).mockReturnValue({
        filter: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "pres-invalid-exit",
            matchLineupId: "lineup-1",
            periodNumber: mockPeriodNumber,
            timeIn: "2026-07-22T10:00:00.000Z",
            timeOut: null,
          }),
        }),
      } as unknown as ReturnType<typeof db.playerpresences.where>);

      await exitPlayerPresenceTx(mockMatchId, mockPeriodNumber, "lineup-1", "");
      expect(db.playerpresences.update).toHaveBeenLastCalledWith(
        "pres-invalid-exit",
        {
          timeOut: fixedNow,
          isSynced: 0,
        },
      );

      // Case 2: valid timeIn in the future, invalid exitTimestamp -> falls back to timeIn
      const futureTimeIn = "2026-07-22T10:12:00.000Z";
      vi.mocked(db.playerpresences.where).mockReturnValue({
        filter: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "pres-future-invalid-exit",
            matchLineupId: "lineup-1",
            periodNumber: mockPeriodNumber,
            timeIn: futureTimeIn,
            timeOut: null,
          }),
        }),
      } as unknown as ReturnType<typeof db.playerpresences.where>);

      await exitPlayerPresenceTx(
        mockMatchId,
        mockPeriodNumber,
        "lineup-1",
        "not-a-timestamp",
      );
      expect(db.playerpresences.update).toHaveBeenLastCalledWith(
        "pres-future-invalid-exit",
        {
          timeOut: futureTimeIn,
          isSynced: 0,
        },
      );

      // Case 3: non-ISO timeIn with lexicographically smaller value than validExit -> preserves exitTimestamp
      vi.mocked(db.playerpresences.where).mockReturnValue({
        filter: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "pres-non-iso-in",
            matchLineupId: "lineup-1",
            periodNumber: mockPeriodNumber,
            timeIn: "2026-07-22T10:00:00.000Z-non-iso",
            timeOut: null,
          }),
        }),
      } as unknown as ReturnType<typeof db.playerpresences.where>);

      const validExit = "2026-07-22T10:06:00.000Z";
      await exitPlayerPresenceTx(
        mockMatchId,
        mockPeriodNumber,
        "lineup-1",
        validExit,
      );
      expect(db.playerpresences.update).toHaveBeenLastCalledWith(
        "pres-non-iso-in",
        {
          timeOut: validExit,
          isSynced: 0,
        },
      );

      // Case 4: both timeIn and exitTimestamp non-ISO -> falls back to max(nowIso, timeIn)
      vi.mocked(db.playerpresences.where).mockReturnValue({
        filter: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "pres-both-non-iso",
            matchLineupId: "lineup-1",
            periodNumber: mockPeriodNumber,
            timeIn: "zzzz-non-iso",
            timeOut: null,
          }),
        }),
      } as unknown as ReturnType<typeof db.playerpresences.where>);

      await exitPlayerPresenceTx(
        mockMatchId,
        mockPeriodNumber,
        "lineup-1",
        "aaaa-non-iso",
      );
      expect(db.playerpresences.update).toHaveBeenLastCalledWith(
        "pres-both-non-iso",
        {
          timeOut: "zzzz-non-iso",
          isSynced: 0,
        },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("enterPlayerPresenceTx should check disqualification inside the transaction with full table scope and reject disqualified players", async () => {
    const originalWhere = (db.gameevents as unknown as { where?: unknown })
      .where;
    (db.gameevents as unknown as { where: unknown }).where = vi
      .fn()
      .mockReturnValue({
        anyOf: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              id: "evt-dq-entry",
              matchLineupId: "lineup-dq",
              eventDefinitionId: "def-dq",
              periodNumber: 1,
              eventTimestamp: "2026-07-22T10:05:00.000Z",
              foulImpact: "DisqualificationWithSub",
              penaltyDurationSeconds: null,
              sequenceNumber: 10,
              isSynced: 0,
            },
          ]),
        }),
      });

    try {
      await expect(
        enterPlayerPresenceTx(mockMatchId, mockPeriodNumber, "lineup-dq"),
      ).rejects.toThrow(
        "Cannot enter a disqualified player into the active lineup.",
      );

      expect(db.transaction).toHaveBeenCalledWith(
        "rw",
        [
          db.playerpresences,
          db.gameevents,
          db.timeanchors,
          db.syncQueue,
          db.matches,
          db.tournaments,
          db.sportconfigurations,
          db.eventdefinitions,
        ],
        expect.any(Function),
      );
      expect(db.playerpresences.add).not.toHaveBeenCalled();
      expect(db.syncQueue.add).not.toHaveBeenCalled();
    } finally {
      (db.gameevents as unknown as { where?: unknown }).where = originalWhere;
    }
  });

  describe("findDisqualifiedLineupIds", () => {
    it("should return empty array when lineupIds is empty, gameevents.where is unavailable, or no events exist", async () => {
      // Empty lineupIds
      await expect(findDisqualifiedLineupIds(mockMatchId, [])).resolves.toEqual(
        [],
      );

      // gameevents.where missing
      await expect(
        findDisqualifiedLineupIds(mockMatchId, ["lineup-1"]),
      ).resolves.toEqual([]);

      // gameevents.where returns object without anyOf function
      const originalWhere = (db.gameevents as unknown as { where?: unknown })
        .where;
      (db.gameevents as unknown as { where: unknown }).where = vi
        .fn()
        .mockReturnValue({});
      await expect(
        findDisqualifiedLineupIds(mockMatchId, ["lineup-1"]),
      ).resolves.toEqual([]);

      // gameevents.where().anyOf().toArray() returns []
      (db.gameevents as unknown as { where: unknown }).where = vi
        .fn()
        .mockReturnValue({
          anyOf: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        });
      await expect(
        findDisqualifiedLineupIds(mockMatchId, ["lineup-1"]),
      ).resolves.toEqual([]);

      (db.gameevents as unknown as { where?: unknown }).where = originalWhere;
    });

    it("should detect disqualification via maxPersonalFouls loaded from match -> tournament -> sportconfiguration", async () => {
      const originalWhere = (db.gameevents as unknown as { where?: unknown })
        .where;
      (db.gameevents as unknown as { where: unknown }).where = vi
        .fn()
        .mockReturnValue({
          anyOf: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([
              {
                id: "f1",
                matchLineupId: "lineup-fouled-out",
                eventDefinitionId: "def-personal",
                periodNumber: 1,
                eventTimestamp: "2026-07-22T10:01:00.000Z",
                foulImpact: "PersonalFoul",
                penaltyDurationSeconds: null,
                sequenceNumber: 1,
                isSynced: 0,
              },
              {
                id: "f2",
                matchLineupId: "lineup-fouled-out",
                eventDefinitionId: "def-personal",
                periodNumber: 1,
                eventTimestamp: "2026-07-22T10:02:00.000Z",
                foulImpact: "PersonalFoul",
                penaltyDurationSeconds: null,
                sequenceNumber: 2,
                isSynced: 0,
              },
              {
                id: "f3",
                matchLineupId: "lineup-ok",
                eventDefinitionId: "def-personal",
                periodNumber: 1,
                eventTimestamp: "2026-07-22T10:03:00.000Z",
                foulImpact: "PersonalFoul",
                penaltyDurationSeconds: null,
                sequenceNumber: 3,
                isSynced: 0,
              },
            ]),
          }),
        });

      vi.mocked(db.matches.get).mockResolvedValueOnce({
        id: mockMatchId,
        tournamentId: "tourn-1",
      } as never);
      vi.mocked(db.tournaments.get).mockResolvedValueOnce({
        id: "tourn-1",
        configurationId: "cfg-1",
      } as never);
      vi.mocked(db.sportconfigurations.get).mockResolvedValueOnce({
        id: "cfg-1",
        maxPersonalFouls: 2,
      } as never);

      try {
        const result = await findDisqualifiedLineupIds(mockMatchId, [
          "lineup-fouled-out",
          "lineup-ok",
        ]);
        expect(result).toEqual(["lineup-fouled-out"]);
      } finally {
        (db.gameevents as unknown as { where?: unknown }).where = originalWhere;
      }
    });

    it("should resolve omitted event foulImpact from eventdefinitions via bulkGet and fallback to get", async () => {
      const originalWhere = (db.gameevents as unknown as { where?: unknown })
        .where;
      const originalBulkGet = db.eventdefinitions.bulkGet;

      (db.gameevents as unknown as { where: unknown }).where = vi
        .fn()
        .mockReturnValue({
          anyOf: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([
              {
                id: "evt-from-def",
                matchLineupId: "lineup-def-dq",
                eventDefinitionId: "def-brutality",
                periodNumber: 1,
                eventTimestamp: "2026-07-22T10:04:00.000Z",
                // foulImpact omitted on event; must be resolved from EventDefinitionLookup
                sequenceNumber: 4,
                isSynced: 0,
              },
            ]),
          }),
        });

      try {
        // 1. Resolve via bulkGet (including an undefined entry to verify filtering)
        vi.mocked(db.eventdefinitions.bulkGet).mockResolvedValueOnce([
          undefined,
          {
            id: "def-brutality",
            foulImpact: "DisqualificationNoSub",
          },
        ] as never);

        const viaBulkGet = await findDisqualifiedLineupIds(mockMatchId, [
          "lineup-def-dq",
        ]);
        expect(viaBulkGet).toEqual(["lineup-def-dq"]);

        // 2. Fallback to eventdefinitions.get when bulkGet is unavailable
        (db.eventdefinitions as unknown as { bulkGet?: unknown }).bulkGet =
          undefined;
        vi.mocked(db.eventdefinitions.get).mockResolvedValueOnce({
          id: "def-brutality",
          foulImpact: "DisqualificationWithSub",
        } as never);

        const viaGetFallback = await findDisqualifiedLineupIds(mockMatchId, [
          "lineup-def-dq",
        ]);
        expect(viaGetFallback).toEqual(["lineup-def-dq"]);
        expect(db.eventdefinitions.get).toHaveBeenCalledWith("def-brutality");
      } finally {
        (db.gameevents as unknown as { where?: unknown }).where = originalWhere;
        db.eventdefinitions.bulkGet = originalBulkGet;
      }
    });

    it("terminatePeriodPresenceTx queues only actually closed lineup IDs and aborts when periodEndAnchorId is missing", async () => {
      const mockEndTimestamp = "2026-07-22T10:08:00.000Z";
      const originalGet = (db.timeanchors as unknown as { get?: unknown }).get;

      try {
        // 1. Missing/cancelled periodEndAnchorId aborts before closing presences or queuing
        (db.timeanchors as unknown as { get: unknown }).get = vi
          .fn()
          .mockResolvedValueOnce(undefined);

        await expect(
          terminatePeriodPresenceTx(
            mockMatchId,
            mockPeriodNumber,
            ["lineup-1", "lineup-already-closed"],
            mockEndTimestamp,
            "cancelled-end-anchor",
          ),
        ).rejects.toThrow(/period end anchor was cancelled or missing/i);

        expect(db.playerpresences.update).not.toHaveBeenCalled();
        expect(db.syncQueue.add).not.toHaveBeenCalled();

        // 2. Valid periodEndAnchorId closes only active presences and queues only closed lineup IDs
        (db.timeanchors as unknown as { get: unknown }).get = vi
          .fn()
          .mockResolvedValueOnce({
            id: "valid-end-anchor",
            matchId: mockMatchId,
            periodNumber: mockPeriodNumber,
            type: 1,
            timestamp: mockEndTimestamp,
            sequenceNumber: 10,
            isSynced: 0,
          });

        const mockPresencesDataset = [
          { id: "pres-active", matchLineupId: "lineup-1", timeOut: null },
          {
            id: "pres-already-out",
            matchLineupId: "lineup-already-closed",
            timeOut: "2026-07-22T10:05:00.000Z",
          },
        ];

        vi.mocked(db.playerpresences.where).mockReturnValue({
          equals: vi.fn().mockReturnValue({
            filter: vi.fn((predicate: (p: (typeof mockPresencesDataset)[0]) => boolean) => ({
              toArray: vi.fn().mockResolvedValue(mockPresencesDataset.filter(predicate)),
            })),
          }),
        } as unknown as ReturnType<typeof db.playerpresences.where>);

        await terminatePeriodPresenceTx(
          mockMatchId,
          mockPeriodNumber,
          ["lineup-1", "lineup-already-closed"],
          mockEndTimestamp,
          "valid-end-anchor",
        );

        expect(db.playerpresences.update).toHaveBeenCalledTimes(1);
        expect(db.playerpresences.update).toHaveBeenCalledWith("pres-active", {
          timeOut: mockEndTimestamp,
          isSynced: 0,
        });
        expect(db.syncQueue.add).toHaveBeenCalledWith({
          actionType: "PUT",
          endpoint: `/Matches/${mockMatchId}/presence/terminate`,
          payload: JSON.stringify({
            periodNumber: mockPeriodNumber,
            playerLineupIds: ["lineup-1"],
            timeOut: mockEndTimestamp,
          }),
          createdAt: mockEndTimestamp,
          periodEndMeta: {
            matchId: mockMatchId,
            periodNumber: mockPeriodNumber,
            timeOut: mockEndTimestamp,
            closedPresenceIds: ["pres-active"],
            closedLineupIds: ["lineup-1"],
          },
        });
      } finally {
        (db.timeanchors as unknown as { get?: unknown }).get = originalGet;
      }
    });
  });
});
