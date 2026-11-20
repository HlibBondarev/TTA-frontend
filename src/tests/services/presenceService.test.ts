import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../../db/ttaDatabase";
import {
  initializePeriodPresenceTx,
  terminatePeriodPresenceTx,
  substitutePlayerTx,
  enterShorthandedPlayerTx,
  terminateSinglePlayerPresenceInTx,
  revertSinglePlayerAutoExitInTx,
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
      filter: vi.fn(),
      delete: vi.fn(),
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

  it("terminatePeriodPresenceTx should only enqueue open presences in Dexie and skip syncQueue if no presences are open", async () => {
    const mockEndTimestamp = "2026-07-22T10:08:00.000Z";

    // lineup-2 already closed mid-period via disciplinary exit; only lineup-1 is open
    const mockPresencesDataset = [
      { id: "pres-1", matchLineupId: "lineup-1", timeOut: null },
      {
        id: "pres-2-closed",
        matchLineupId: "lineup-2",
        timeOut: "2026-07-22T10:05:00.000Z",
      },
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
      ["lineup-1", "lineup-2"],
      mockEndTimestamp,
    );

    expect(db.playerpresences.update).toHaveBeenCalledTimes(1);
    expect(db.playerpresences.update).toHaveBeenCalledWith("pres-1", {
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
    });

    // When all presences are already closed, no syncQueue item is added
    vi.clearAllMocks();
    vi.mocked(db.playerpresences.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        filter: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    await terminatePeriodPresenceTx(
      mockMatchId,
      mockPeriodNumber,
      [],
      mockEndTimestamp,
    );
    expect(db.syncQueue.add).not.toHaveBeenCalled();
  });

  it("enterShorthandedPlayerTx should open a new presence and enqueue a single-item /presence/initialize payload", async () => {
    const filterMock = vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(db.playerpresences.where).mockReturnValue({
      filter: filterMock,
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    const entryTime = "2026-07-22T10:03:00.000Z";
    const newId = await enterShorthandedPlayerTx(
      mockMatchId,
      mockPeriodNumber,
      "lineup-in",
      entryTime,
    );

    expect(newId).toBeDefined();
    expect(db.playerpresences.add).toHaveBeenCalledWith({
      id: newId,
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
        presenceItems: [{ id: newId, matchLineupId: "lineup-in" }],
      }),
      createdAt: entryTime,
    });
  });

  it("enterShorthandedPlayerTx should throw if player already has an open presence in the period", async () => {
    const filterMock = vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue({
        id: "existing-open",
        matchLineupId: "lineup-in",
        timeOut: null,
      }),
    });
    vi.mocked(db.playerpresences.where).mockReturnValue({
      filter: filterMock,
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    await expect(
      enterShorthandedPlayerTx(mockMatchId, mockPeriodNumber, "lineup-in"),
    ).rejects.toThrow("Player already has an active presence in this period.");
  });

  it("terminateSinglePlayerPresenceInTx should close open presence and clamp timeOut >= timeIn", async () => {
    const filterMock = vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue({
        id: "pres-open",
        matchLineupId: "lineup-1",
        periodNumber: 1,
        timeIn: "2026-07-22T10:05:00.000Z",
        timeOut: null,
      }),
    });
    vi.mocked(db.playerpresences.where).mockReturnValue({
      filter: filterMock,
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    // Exit timestamp is earlier than timeIn (e.g. older event edited after substitution)
    const closed = await terminateSinglePlayerPresenceInTx(
      mockMatchId,
      "lineup-1",
      "2026-07-22T10:02:00.000Z",
      1,
    );

    expect(closed).toBe(true);
    expect(db.playerpresences.update).toHaveBeenCalledWith("pres-open", {
      timeOut: "2026-07-22T10:05:00.000Z",
      isSynced: 0,
    });
    expect(db.syncQueue.add).toHaveBeenCalledWith({
      actionType: "PUT",
      endpoint: `/Matches/${mockMatchId}/presence/terminate`,
      payload: JSON.stringify({
        periodNumber: 1,
        playerLineupIds: ["lineup-1"],
        timeOut: "2026-07-22T10:05:00.000Z",
      }),
      createdAt: "2026-07-22T10:05:00.000Z",
    });
  });

  describe("revertSinglePlayerAutoExitInTx", () => {
    it("should reopen unsynced closed presence and delete matching single-player terminate queue item", async () => {
      const exitTimestamp = "2026-07-22T10:04:00.000Z";
      const closedPresence = {
        id: "pres-auto-exit",
        matchLineupId: "lineup-11",
        periodNumber: 2,
        timeIn: "2026-07-22T10:00:00.000Z",
        timeOut: exitTimestamp,
        sequenceNumber: 4,
        isSynced: 0,
      };

      vi.mocked(db.playerpresences.where).mockReturnValue({
        toArray: vi.fn().mockResolvedValue([closedPresence]),
      } as unknown as ReturnType<typeof db.playerpresences.where>);

      vi.mocked(db.syncQueue.filter).mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: 42,
            actionType: "PUT",
            endpoint: `/Matches/${mockMatchId}/presence/terminate`,
            payload: JSON.stringify({
              periodNumber: 2,
              playerLineupIds: ["lineup-11"],
              timeOut: exitTimestamp,
            }),
            createdAt: exitTimestamp,
          },
        ]),
      } as unknown as ReturnType<typeof db.syncQueue.filter>);

      const reverted = await revertSinglePlayerAutoExitInTx(
        mockMatchId,
        "lineup-11",
        2,
        exitTimestamp,
      );

      expect(reverted).toBe(true);
      expect(db.syncQueue.delete).toHaveBeenCalledWith(42);
      expect(db.playerpresences.update).toHaveBeenCalledWith("pres-auto-exit", {
        timeOut: null,
        isSynced: 0,
      });
    });

    it("should not revert if the player already has an open presence in the period", async () => {
      vi.mocked(db.playerpresences.where).mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "pres-closed",
            matchLineupId: "lineup-11",
            periodNumber: 2,
            timeIn: "2026-07-22T10:00:00.000Z",
            timeOut: "2026-07-22T10:04:00.000Z",
            sequenceNumber: 2,
            isSynced: 0,
          },
          {
            id: "pres-reentered",
            matchLineupId: "lineup-11",
            periodNumber: 2,
            timeIn: "2026-07-22T10:04:25.000Z",
            timeOut: null,
            sequenceNumber: 5,
            isSynced: 0,
          },
        ]),
      } as unknown as ReturnType<typeof db.playerpresences.where>);

      const reverted = await revertSinglePlayerAutoExitInTx(
        mockMatchId,
        "lineup-11",
        2,
        "2026-07-22T10:04:00.000Z",
      );

      expect(reverted).toBe(false);
      expect(db.syncQueue.delete).not.toHaveBeenCalled();
      expect(db.playerpresences.update).not.toHaveBeenCalled();
    });

    it("should not revert when closed presence timestamp does not match event timestamp", async () => {
      vi.mocked(db.playerpresences.where).mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "pres-other-exit",
            matchLineupId: "lineup-11",
            periodNumber: 2,
            timeIn: "2026-07-22T10:00:00.000Z",
            timeOut: "2026-07-22T10:06:00.000Z",
            sequenceNumber: 4,
            isSynced: 0,
          },
        ]),
      } as unknown as ReturnType<typeof db.playerpresences.where>);

      const reverted = await revertSinglePlayerAutoExitInTx(
        mockMatchId,
        "lineup-11",
        2,
        "2026-07-22T10:04:00.000Z",
      );

      expect(reverted).toBe(false);
      expect(db.syncQueue.delete).not.toHaveBeenCalled();
      expect(db.playerpresences.update).not.toHaveBeenCalled();
    });

    it("should not revert synced presences or multi-player period-end terminate queue items", async () => {
      const exitTimestamp = "2026-07-22T10:08:00.000Z";
      vi.mocked(db.playerpresences.where).mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "pres-period-end",
            matchLineupId: "lineup-11",
            periodNumber: 2,
            timeIn: "2026-07-22T10:00:00.000Z",
            timeOut: exitTimestamp,
            sequenceNumber: 4,
            isSynced: 0,
          },
        ]),
      } as unknown as ReturnType<typeof db.playerpresences.where>);

      vi.mocked(db.syncQueue.filter).mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: 99,
            actionType: "PUT",
            endpoint: `/Matches/${mockMatchId}/presence/terminate`,
            payload: JSON.stringify({
              periodNumber: 2,
              playerLineupIds: ["lineup-11", "lineup-8"],
              timeOut: exitTimestamp,
            }),
            createdAt: exitTimestamp,
          },
        ]),
      } as unknown as ReturnType<typeof db.syncQueue.filter>);

      const revertedBatch = await revertSinglePlayerAutoExitInTx(
        mockMatchId,
        "lineup-11",
        2,
        exitTimestamp,
      );

      expect(revertedBatch).toBe(false);
      expect(db.syncQueue.delete).not.toHaveBeenCalled();
      expect(db.playerpresences.update).not.toHaveBeenCalled();

      // Already synced presence should also never be reverted
      vi.mocked(db.playerpresences.where).mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "pres-synced",
            matchLineupId: "lineup-11",
            periodNumber: 2,
            timeIn: "2026-07-22T10:00:00.000Z",
            timeOut: exitTimestamp,
            sequenceNumber: 4,
            isSynced: 1,
          },
        ]),
      } as unknown as ReturnType<typeof db.playerpresences.where>);

      const revertedSynced = await revertSinglePlayerAutoExitInTx(
        mockMatchId,
        "lineup-11",
        2,
        exitTimestamp,
      );

      expect(revertedSynced).toBe(false);
    });
  });
});
