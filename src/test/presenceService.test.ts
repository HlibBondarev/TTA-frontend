import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../db/ttaDatabase";
import {
  initializePeriodPresenceTx,
  terminatePeriodPresenceTx,
  substitutePlayerTx,
} from "../db/presenceService";

vi.mock("../db/ttaDatabase", () => ({
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

  it("initializePeriodPresenceTx should bulk-add presences and add a sync queue item", async () => {
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

    expect(db.syncQueue.add).toHaveBeenCalledWith({
      actionType: "POST",
      endpoint: `/Matches/${mockMatchId}/presence/initialize`,
      payload: JSON.stringify({
        periodNumber: mockPeriodNumber,
        playerLineupIds: mockPlayerLineupIds,
      }),
      createdAt: mockStartTimestamp,
    });
  });

  it("terminatePeriodPresenceTx should find and close all active player presences evaluating filter predicates", async () => {
    const mockEndTimestamp = "2026-07-22T10:08:00.000Z";

    // Dataset covering true/false branches for both timeOut and matchLineupId conditions
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
      }),
      createdAt: mockEndTimestamp,
    });
  });

  it("substitutePlayerTx should cleanly close active player and open a new presence for replacement evaluating filter predicates", async () => {
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
});
