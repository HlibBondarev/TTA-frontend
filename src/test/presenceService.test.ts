import { vi, describe, it, expect, beforeEach } from "vitest";
import type { PlayerPresence } from "../db/ttaDatabase";
import {
  initializePeriodPresenceTx,
  terminatePeriodPresenceTx,
  substitutePlayerTx,
} from "../db/presenceService";

// Clean and safe crypto polyfill for test environments without using Node's 'global' object
if (typeof globalThis.crypto === "undefined") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID: () => "mocked-uuid-1234-5678-9012",
    },
  });
} else {
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
    "mocked-uuid-1234-5678-9012",
  );
}

// Safely declare hoisted mock functions using vi.hoisted to prevent ReferenceErrors
const {
  mockBulkAdd,
  mockAdd,
  mockUpdate,
  mockWhere,
  mockEquals,
  mockFilter,
  mockToArray,
  mockFirst,
  mockSyncQueueAdd,
} = vi.hoisted(() => {
  return {
    mockBulkAdd: vi.fn(),
    mockAdd: vi.fn(),
    mockUpdate: vi.fn(),
    mockWhere: vi.fn(),
    mockEquals: vi.fn(),
    mockFilter: vi.fn(),
    mockToArray: vi.fn(),
    mockFirst: vi.fn(),
    mockSyncQueueAdd: vi.fn(),
  };
});

vi.mock("../db/ttaDatabase", () => {
  return {
    db: {
      transaction: vi.fn((_mode, _tables, callback) => {
        if (typeof callback === "function") {
          return callback();
        }
        return Promise.resolve();
      }),
      playerpresences: {
        bulkAdd: mockBulkAdd,
        add: mockAdd,
        update: mockUpdate,
        where: mockWhere,
      },
      syncQueue: {
        add: mockSyncQueueAdd,
      },
    },
  };
});

describe("presenceService Database Transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-establish Dexie method chaining behavior dynamically
    mockWhere.mockReturnValue({
      equals: mockEquals,
      filter: mockFilter,
      toArray: mockToArray,
      first: mockFirst,
    });

    mockEquals.mockReturnValue({
      filter: mockFilter,
      toArray: mockToArray,
      first: mockFirst,
    });

    mockFilter.mockReturnValue({
      toArray: mockToArray,
      first: mockFirst,
    });
  });

  it("initializePeriodPresenceTx should bulk-add presences and add a sync queue item", async () => {
    mockBulkAdd.mockResolvedValue("last-mocked-id");
    mockSyncQueueAdd.mockResolvedValue(1);

    await initializePeriodPresenceTx(
      "match-1",
      1,
      ["lineup-1", "lineup-2"],
      "2026-07-16T00:00:00.000Z",
    );

    expect(mockBulkAdd).toHaveBeenCalledTimes(1);
    expect(mockSyncQueueAdd).toHaveBeenCalledTimes(1);

    const addedPresences = mockBulkAdd.mock.calls[0][0] as PlayerPresence[];
    expect(addedPresences).toHaveLength(2);
    expect(addedPresences[0].matchlineupid).toBe("lineup-1");
    expect(addedPresences[1].matchlineupid).toBe("lineup-2");
  });

  it("terminatePeriodPresenceTx should find and close all active player presences", async () => {
    const mockActivePresences: PlayerPresence[] = [
      {
        id: "presence-1",
        matchlineupid: "lineup-1",
        periodnumber: 1,
        timein: "2026-07-16T00:00:00.000Z",
        timeout: null,
        sequenceNumber: 12345,
        isSynced: 0,
      },
      {
        id: "presence-2",
        matchlineupid: "lineup-2",
        periodnumber: 1,
        timein: "2026-07-16T00:00:00.000Z",
        timeout: null,
        sequenceNumber: 12346,
        isSynced: 0,
      },
    ];

    mockToArray.mockResolvedValue(mockActivePresences);
    mockUpdate.mockResolvedValue(1);
    mockSyncQueueAdd.mockResolvedValue(1);

    await terminatePeriodPresenceTx(
      "match-1",
      1,
      ["lineup-1", "lineup-2"],
      "2026-07-16T00:05:00.000Z",
    );

    expect(mockToArray).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenNthCalledWith(1, "presence-1", {
      timeout: "2026-07-16T00:05:00.000Z",
      isSynced: 0,
    });
    expect(mockSyncQueueAdd).toHaveBeenCalledTimes(1);
  });

  it("substitutePlayerTx should cleanly close active player and open a new presence for replacement", async () => {
    const activePresence: PlayerPresence = {
      id: "presence-out",
      matchlineupid: "lineup-out",
      periodnumber: 1,
      timein: "2026-07-16T00:00:00.000Z",
      timeout: null,
      sequenceNumber: 12345,
      isSynced: 0,
    };

    mockFirst.mockResolvedValue(activePresence);
    mockUpdate.mockResolvedValue(1);
    mockAdd.mockResolvedValue("new-id");
    mockSyncQueueAdd.mockResolvedValue(1);

    const newId = await substitutePlayerTx(
      "match-1",
      1,
      "lineup-out",
      "lineup-in",
    );

    expect(mockFirst).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith("presence-out", {
      timeout: expect.any(String),
      isSynced: 0,
    });
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockSyncQueueAdd).toHaveBeenCalledTimes(1);
    expect(newId).toBe("mocked-uuid-1234-5678-9012");
  });

  it("substitutePlayerTx should throw an error if no active presence exists for outgoing player", async () => {
    mockFirst.mockResolvedValue(null);

    await expect(
      substitutePlayerTx("match-1", 1, "lineup-out", "lineup-in"),
    ).rejects.toThrow("No active presence found for the outgoing player.");

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
