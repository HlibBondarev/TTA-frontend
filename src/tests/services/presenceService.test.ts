import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../../db/ttaDatabase";
import {
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
      [db.playerpresences, db.gameevents, db.timeanchors, db.syncQueue],
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
});
