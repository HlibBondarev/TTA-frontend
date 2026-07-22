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
        matchlineupid: "lineup-1",
        periodnumber: mockPeriodNumber,
        timein: mockStartTimestamp,
        timeout: null,
        sequenceNumber: expect.any(Number),
        isSynced: 0,
      },
      {
        id: expect.any(String),
        matchlineupid: "lineup-2",
        periodnumber: mockPeriodNumber,
        timein: mockStartTimestamp,
        timeout: null,
        sequenceNumber: expect.any(Number),
        isSynced: 0,
      },
    ]);

    expect(db.syncQueue.add).toHaveBeenCalledWith({
      actionType: "POST",
      endpoint: `matches/${mockMatchId}/presence/initialize`,
      payload: JSON.stringify({
        periodNumber: mockPeriodNumber,
        playerLineupIds: mockPlayerLineupIds,
      }),
      createdAt: mockStartTimestamp,
    });
  });

  it("terminatePeriodPresenceTx should find and close all active player presences", async () => {
    const mockEndTimestamp = "2026-07-22T10:08:00.000Z";
    const mockActivePresences = [
      { id: "pres-1", matchlineupid: "lineup-1", timeout: null },
      { id: "pres-2", matchlineupid: "lineup-2", timeout: null },
    ];

    const filterMock = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockActivePresences),
    });

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
      timeout: mockEndTimestamp,
      isSynced: 0,
    });
    expect(db.playerpresences.update).toHaveBeenCalledWith("pres-2", {
      timeout: mockEndTimestamp,
      isSynced: 0,
    });

    expect(db.syncQueue.add).toHaveBeenCalledWith({
      actionType: "PUT",
      endpoint: `matches/${mockMatchId}/presence/terminate`,
      payload: JSON.stringify({
        periodNumber: mockPeriodNumber,
        playerLineupIds: mockPlayerLineupIds,
      }),
      createdAt: mockEndTimestamp,
    });
  });

  it("substitutePlayerTx should cleanly close active player and open a new presence for replacement", async () => {
    const mockActivePresence = {
      id: "pres-out",
      matchlineupid: "lineup-out",
      timeout: null,
    };

    const filterMock = vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue(mockActivePresence),
    });

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
      timeout: expect.any(String),
      isSynced: 0,
    });

    expect(db.playerpresences.add).toHaveBeenCalledWith({
      id: newPresenceId,
      matchlineupid: "lineup-in",
      periodnumber: mockPeriodNumber,
      timein: expect.any(String),
      timeout: null,
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
