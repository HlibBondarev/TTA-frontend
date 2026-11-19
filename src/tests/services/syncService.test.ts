import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  processSyncQueue,
  syncMatchBatch,
  markEntitiesSynced,
} from "../../services/syncService";
import { db } from "../../db/ttaDatabase";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({
  apiClient: {
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../../db/ttaDatabase", () => ({
  db: {
    transaction: vi.fn((...args: unknown[]) => {
      const cb = args[args.length - 1] as () => Promise<unknown>;
      return cb() as unknown as ReturnType<typeof db.transaction>;
    }),
    matches: {
      get: vi.fn().mockResolvedValue(undefined),
    },
    matchlineups: {
      get: vi.fn().mockResolvedValue(undefined),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    },
    playerrosters: {
      get: vi.fn().mockResolvedValue(undefined),
    },
    syncQueue: {
      orderBy: vi.fn(),
      delete: vi.fn(),
      toArray: vi.fn().mockResolvedValue([]),
    },
    playerpresences: {
      filter: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            modify: vi.fn(),
          }),
        }),
        anyOf: vi.fn().mockReturnValue({
          modify: vi.fn(),
        }),
      }),
    },
    gameevents: {
      filter: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            modify: vi.fn(),
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
        anyOf: vi.fn().mockReturnValue({
          modify: vi.fn(),
        }),
      }),
    },
    timeanchors: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            modify: vi.fn(),
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
        anyOf: vi.fn().mockReturnValue({
          modify: vi.fn(),
        }),
      }),
    },
  },
}));

describe("Sync Engine Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.matches.get).mockReset().mockResolvedValue(undefined);
    vi.mocked(db.matchlineups.get).mockReset().mockResolvedValue(undefined);
    vi.mocked(db.playerrosters.get).mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("processes multi-item queue in FIFO order (POST, PUT, DELETE) and deletes synced items", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/teams/t1/events",
        payload: JSON.stringify([{ id: "e1", isLeadToGoal: true }]),
      },
      {
        id: 2,
        actionType: "POST",
        endpoint: "/Matches/m1/presence/initialize",
        payload: JSON.stringify({
          periodNumber: 1,
          timeIn: "2026-08-07T10:00:00.000Z",
          presenceItems: [{ id: "p1", matchLineupId: "lineup-1" }],
        }),
      },
      {
        id: 3,
        actionType: "DELETE",
        endpoint: "/Matches/m1/events/e1",
        payload: JSON.stringify({}),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    const callOrder: string[] = [];
    vi.mocked(apiClient.post).mockImplementation(async () => {
      callOrder.push("POST");
      return { status: 201 };
    });
    vi.mocked(apiClient.delete).mockImplementation(async () => {
      callOrder.push("DELETE");
      return { status: 200 };
    });

    const mockModify = vi.fn();
    const mockFilter = vi.fn().mockReturnValue({ modify: mockModify });
    const mockEquals = vi.fn().mockReturnValue({ filter: mockFilter });
    vi.mocked(db.playerpresences.where).mockReturnValue({
      equals: mockEquals,
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    const processed = await processSyncQueue();

    expect(db.syncQueue.orderBy).toHaveBeenCalledWith("id");
    expect(callOrder).toEqual(["POST", "POST", "DELETE"]);
    expect(processed).toBe(3);
    expect(db.syncQueue.delete).toHaveBeenCalledTimes(3);
  });

  it("batches consecutive POST requests for the same batchable endpoint into a single HTTP request", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "anchor-1", periodNumber: 1, type: 0 }]),
      },
      {
        id: 2,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "anchor-2", periodNumber: 1, type: 1 }]),
      },
      {
        id: 3,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "anchor-3", periodNumber: 1, type: 2 }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    const mockModify = vi.fn();
    const mockAnyOf = vi.fn().mockReturnValue({ modify: mockModify });
    vi.mocked(db.timeanchors.where).mockReturnValue({
      anyOf: mockAnyOf,
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    const processed = await processSyncQueue();

    expect(processed).toBe(3);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/m1/anchors",
      [
        { id: "anchor-1", periodNumber: 1, type: 0 },
        { id: "anchor-2", periodNumber: 1, type: 1 },
        { id: "anchor-3", periodNumber: 1, type: 2 },
      ],
      { headers: { "X-Idempotency-Key": "sync-batch-1-2-3" } },
    );

    expect(db.timeanchors.where).toHaveBeenCalledWith("id");
    expect(mockAnyOf).toHaveBeenCalledWith([
      "anchor-1",
      "anchor-2",
      "anchor-3",
    ]);
    expect(mockModify).toHaveBeenCalledWith({ isSynced: 1 });

    expect(db.syncQueue.delete).toHaveBeenCalledTimes(3);
    expect(db.syncQueue.delete).toHaveBeenNthCalledWith(1, 1);
    expect(db.syncQueue.delete).toHaveBeenNthCalledWith(2, 2);
    expect(db.syncQueue.delete).toHaveBeenNthCalledWith(3, 3);
  });

  it("purges batch items from syncQueue and marks local entities as terminal (isSynced: -1) in a Dexie transaction when response status is unrecoverable 4xx (400, 403, 404, 409, 410)", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/teams/t1/events",
        payload: JSON.stringify([{ id: "orphan-event-1" }]),
      },
      {
        id: 2,
        actionType: "POST",
        endpoint: "/Matches/m1/teams/t1/events",
        payload: JSON.stringify([{ id: "orphan-event-2" }]),
      },
      {
        id: 3,
        actionType: "POST",
        endpoint: "/Matches/m2/teams/t1/events",
        payload: JSON.stringify([{ id: "valid-event-3" }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ status: 201 });

    const mockModify = vi.fn();
    const mockAnyOf = vi.fn().mockReturnValue({ modify: mockModify });
    vi.mocked(db.gameevents.where).mockReturnValue({
      anyOf: mockAnyOf,
    } as unknown as ReturnType<typeof db.gameevents.where>);

    const processed = await processSyncQueue();

    expect(processed).toBe(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Unrecoverable sync error (404) for endpoint /Matches/m1/teams/t1/events. Purging batch from syncQueue.",
    );
    expect(db.transaction).toHaveBeenCalledWith(
      "rw",
      expect.any(Array),
      expect.any(Function),
    );
    expect(db.gameevents.where).toHaveBeenCalledWith("id");
    expect(mockAnyOf).toHaveBeenCalledWith([
      "orphan-event-1",
      "orphan-event-2",
    ]);
    expect(mockModify).toHaveBeenCalledWith({ isSynced: -1 });

    expect(apiClient.post).toHaveBeenCalledTimes(2);
    expect(db.syncQueue.delete).toHaveBeenCalledWith(1);
    expect(db.syncQueue.delete).toHaveBeenCalledWith(2);
    expect(db.syncQueue.delete).toHaveBeenCalledWith(3);

    consoleWarnSpy.mockRestore();
  });

  it("purges batch items and marks entities terminal (isSynced: -1) when apiClient throws an error object with an unrecoverable 4xx status code", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "anchor-1" }]),
      },
      {
        id: 2,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "anchor-2" }]),
      },
      {
        id: 3,
        actionType: "POST",
        endpoint: "/Matches/m2/anchors",
        payload: JSON.stringify([{ id: "anchor-3" }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    vi.mocked(apiClient.post)
      .mockRejectedValueOnce({ status: 403 })
      .mockResolvedValueOnce({ status: 200 });

    const mockModify = vi.fn();
    const mockAnyOf = vi.fn().mockReturnValue({ modify: mockModify });
    vi.mocked(db.timeanchors.where).mockReturnValue({
      anyOf: mockAnyOf,
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    const processed = await processSyncQueue();

    expect(processed).toBe(1);
    expect(mockAnyOf).toHaveBeenCalledWith(["anchor-1", "anchor-2"]);
    expect(mockModify).toHaveBeenCalledWith({ isSynced: -1 });

    expect(apiClient.post).toHaveBeenCalledTimes(2);
    expect(db.syncQueue.delete).toHaveBeenCalledWith(1);
    expect(db.syncQueue.delete).toHaveBeenCalledWith(2);
    expect(db.syncQueue.delete).toHaveBeenCalledWith(3);

    consoleWarnSpy.mockRestore();
  });

  it("halts queue execution and retains items in syncQueue when response status is 401 or 500", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "anchor-1", type: 0 }]),
      },
      {
        id: 2,
        actionType: "POST",
        endpoint: "/Matches/m2/anchors",
        payload: JSON.stringify([{ id: "anchor-2", type: 0 }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 401 });

    const processed = await processSyncQueue();

    expect(processed).toBe(0);
    expect(db.syncQueue.delete).not.toHaveBeenCalled();
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it("does not batch items when endpoints differ", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "anchor-1", type: 0 }]),
      },
      {
        id: 2,
        actionType: "POST",
        endpoint: "/Matches/m1/teams/t1/events",
        payload: JSON.stringify([{ id: "event-1", isLeadToGoal: true }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    const processed = await processSyncQueue();

    expect(processed).toBe(2);
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    expect(apiClient.post).toHaveBeenNthCalledWith(
      1,
      "/Matches/m1/anchors",
      [{ id: "anchor-1", type: 0 }],
      { headers: { "X-Idempotency-Key": "sync-batch-1" } },
    );
    expect(apiClient.post).toHaveBeenNthCalledWith(
      2,
      "/Matches/m1/teams/t1/events",
      [{ id: "event-1", isLeadToGoal: true }],
      { headers: { "X-Idempotency-Key": "sync-batch-2" } },
    );
  });

  it("does not batch items when actionTypes differ for the same endpoint", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "anchor-1", type: 0 }]),
      },
      {
        id: 2,
        actionType: "PUT",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "anchor-1", type: 1 }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });
    vi.mocked(apiClient.put).mockResolvedValue({ status: 200 });

    const processed = await processSyncQueue();

    expect(processed).toBe(2);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/m1/anchors",
      [{ id: "anchor-1", type: 0 }],
      { headers: { "X-Idempotency-Key": "sync-batch-1" } },
    );
    expect(apiClient.put).toHaveBeenCalledTimes(1);
    expect(apiClient.put).toHaveBeenCalledWith(
      "/Matches/m1/anchors",
      [{ id: "anchor-1", type: 1 }],
      { headers: { "X-Idempotency-Key": "sync-batch-2" } },
    );
  });

  it("attaches X-Idempotency-Key header and supports safe retry when finalization fails", async () => {
    const mockItems = [
      {
        id: 101,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([
          { id: "anchor-retry-1", periodNumber: 1, type: 0 },
        ]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });
    vi.mocked(db.syncQueue.delete).mockRejectedValueOnce(
      new Error("IndexedDB Finalization Write Error"),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const processedRun1 = await processSyncQueue();

    expect(processedRun1).toBe(0);
    expect(db.transaction).toHaveBeenCalledWith(
      "rw",
      expect.any(Array),
      expect.any(Function),
    );
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/m1/anchors",
      [{ id: "anchor-retry-1", periodNumber: 1, type: 0 }],
      { headers: { "X-Idempotency-Key": "sync-batch-101" } },
    );

    vi.mocked(db.syncQueue.delete).mockResolvedValueOnce(undefined);
    const processedRun2 = await processSyncQueue();

    expect(processedRun2).toBe(1);
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    expect(apiClient.post).toHaveBeenNthCalledWith(
      2,
      "/Matches/m1/anchors",
      [{ id: "anchor-retry-1", periodNumber: 1, type: 0 }],
      { headers: { "X-Idempotency-Key": "sync-batch-101" } },
    );

    consoleSpy.mockRestore();
  });

  it("successfully processes and deletes sync items when server returns 204 No Content or unwrapped response", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "anchor-204", type: 0 }]),
      },
      {
        id: 2,
        actionType: "POST",
        endpoint: "/Matches/m1/teams/t1/events",
        payload: JSON.stringify([
          { id: "event-unwrapped", isLeadToGoal: false },
        ]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ status: 204 })
      .mockResolvedValueOnce(undefined as unknown as { status?: number });

    const processed = await processSyncQueue();

    expect(processed).toBe(2);
    expect(db.syncQueue.delete).toHaveBeenCalledTimes(2);
  });

  it("retains items in syncQueue and halts execution when batched HTTP request fails with 500 error", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "anchor-1", type: 0 }]),
      },
      {
        id: 2,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "anchor-2", type: 1 }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockRejectedValue(new Error("Network Error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const processed = await processSyncQueue();

    expect(processed).toBe(0);
    expect(db.syncQueue.delete).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("halts execution and retains queue items when local Dexie finalization transaction fails", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([
          { id: "anchor-retry-1", periodNumber: 1, type: 0 },
        ]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    const mockModify = vi.fn();
    const mockAnyOf = vi.fn().mockReturnValue({ modify: mockModify });
    vi.mocked(db.timeanchors.where).mockReturnValue({
      anyOf: mockAnyOf,
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    vi.mocked(db.syncQueue.delete).mockRejectedValueOnce(
      new Error("IndexedDB Finalization Write Error"),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const processed = await processSyncQueue();

    expect(processed).toBe(0);
    expect(db.transaction).toHaveBeenCalledWith(
      "rw",
      expect.any(Array),
      expect.any(Function),
    );
    expect(db.timeanchors.where).toHaveBeenCalledWith("id");
    expect(mockAnyOf).toHaveBeenCalledWith(["anchor-retry-1"]);
    expect(mockModify).toHaveBeenCalledWith({ isSynced: 1 });
    expect(db.syncQueue.delete).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
  });

  it("halts queue processing and logs error on unsupported actionType", async () => {
    const mockItems = [
      {
        id: 10,
        actionType: "PATCH",
        endpoint: "/Matches/m1/events",
        payload: JSON.stringify({}),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const processed = await processSyncQueue();

    expect(processed).toBe(0);
    expect(db.syncQueue.delete).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("handles initialization payload with presenceItems array", async () => {
    const mockItems = [
      {
        id: 4,
        actionType: "POST",
        endpoint: "/Matches/m1/presence/initialize",
        payload: JSON.stringify({
          periodNumber: 1,
          timeIn: "2026-08-07T10:00:00.000Z",
          presenceItems: [
            { id: "pres-1", matchLineupId: "lineup-1" },
            { id: "pres-2", matchLineupId: "lineup-2" },
          ],
        }),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    type PresenceFilterFn = (p: {
      id: string;
      matchLineupId: string;
      timeIn: string | null;
      timeOut: string | null;
    }) => boolean;

    let filterPredicate: PresenceFilterFn | undefined;
    const mockModify = vi.fn();
    const mockFilter = vi.fn().mockImplementation((fn: PresenceFilterFn) => {
      filterPredicate = fn;
      return { modify: mockModify };
    });

    vi.mocked(db.playerpresences.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({ filter: mockFilter }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    await processSyncQueue();

    expect(apiClient.post).toHaveBeenCalled();
    expect(filterPredicate).toBeDefined();
    if (filterPredicate) {
      expect(
        filterPredicate({
          id: "pres-1",
          matchLineupId: "lineup-1",
          timeIn: "2026-08-07T10:00:00.000Z",
          timeOut: null,
        }),
      ).toBe(true);
      expect(
        filterPredicate({
          id: "pres-2",
          matchLineupId: "lineup-2",
          timeIn: "2026-08-07T10:00:00.000Z",
          timeOut: null,
        }),
      ).toBe(true);
      // Already closed presence must not be marked synced by an initialize POST
      expect(
        filterPredicate({
          id: "pres-1",
          matchLineupId: "lineup-1",
          timeIn: "2026-08-07T10:00:00.000Z",
          timeOut: "2026-08-07T10:05:00.000Z",
        }),
      ).toBe(false);
      expect(
        filterPredicate({
          id: "pres-other",
          matchLineupId: "other-lineup",
          timeIn: "2026-08-07T10:00:00.000Z",
          timeOut: null,
        }),
      ).toBe(false);
    }
  });

  it("handles substitution payload matching SubstitutePlayerRequest DTO with incomingPresenceId and substitutionTime", async () => {
    const mockItems = [
      {
        id: 5,
        actionType: "POST",
        endpoint: "/Matches/m1/substitutions",
        payload: JSON.stringify({
          periodNumber: 1,
          playerOutLineupId: "lineup-out",
          playerInLineupId: "lineup-in",
          incomingPresenceId: "pres-new-123",
          substitutionTime: "2026-08-07T11:36:30.493Z",
        }),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    type PresenceFilterFn = (p: {
      id: string;
      matchLineupId: string;
      timeIn: string | null;
      timeOut: string | null;
    }) => boolean;

    let filterPredicate: PresenceFilterFn | undefined;
    const mockModify = vi.fn();
    const mockFilter = vi.fn().mockImplementation((fn: PresenceFilterFn) => {
      filterPredicate = fn;
      return { modify: mockModify };
    });

    vi.mocked(db.playerpresences.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({ filter: mockFilter }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    await processSyncQueue();

    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/m1/substitutions",
      {
        periodNumber: 1,
        playerOutLineupId: "lineup-out",
        playerInLineupId: "lineup-in",
        incomingPresenceId: "pres-new-123",
        substitutionTime: "2026-08-07T11:36:30.493Z",
      },
      { headers: { "X-Idempotency-Key": "sync-batch-5" } },
    );

    expect(filterPredicate).toBeDefined();
    if (filterPredicate) {
      expect(
        filterPredicate({
          id: "pres-out-1",
          matchLineupId: "lineup-out",
          timeIn: "2026-08-07T11:30:00.000Z",
          timeOut: "2026-08-07T11:36:30.493Z",
        }),
      ).toBe(true);
      expect(
        filterPredicate({
          id: "pres-new-123",
          matchLineupId: "lineup-in",
          timeIn: "2026-08-07T11:36:30.493Z",
          timeOut: null,
        }),
      ).toBe(true);
      // Outgoing player's later presence closed at a different timestamp must not match
      expect(
        filterPredicate({
          id: "pres-out-later",
          matchLineupId: "lineup-out",
          timeIn: "2026-08-07T11:38:00.000Z",
          timeOut: "2026-08-07T11:45:00.000Z",
        }),
      ).toBe(false);
      // Incoming player already closed later must not be marked synced by substitution POST
      expect(
        filterPredicate({
          id: "pres-new-123",
          matchLineupId: "lineup-in",
          timeIn: "2026-08-07T11:36:30.493Z",
          timeOut: "2026-08-07T11:45:00.000Z",
        }),
      ).toBe(false);
      expect(
        filterPredicate({
          id: "pres-other",
          matchLineupId: "other-lineup",
          timeIn: "2026-08-07T11:30:00.000Z",
          timeOut: "2026-08-07T11:36:30.493Z",
        }),
      ).toBe(false);
    }
  });

  it("updates gameevents to isSynced = 1 when event sync item is processed", async () => {
    const mockItems = [
      {
        id: 6,
        actionType: "POST",
        endpoint: "/Matches/m1/teams/t1/events",
        payload: JSON.stringify([{ id: "event-1", isLeadToGoal: true }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    const mockModify = vi.fn();
    const mockAnyOf = vi.fn().mockReturnValue({ modify: mockModify });
    vi.mocked(db.gameevents.where).mockReturnValue({
      anyOf: mockAnyOf,
    } as unknown as ReturnType<typeof db.gameevents.where>);

    await processSyncQueue();

    expect(db.gameevents.where).toHaveBeenCalledWith("id");
    expect(mockAnyOf).toHaveBeenCalledWith(["event-1"]);
    expect(mockModify).toHaveBeenCalledWith({ isSynced: 1 });
  });

  it("updates timeanchors to isSynced = 1 when anchor sync item is processed", async () => {
    const mockItems = [
      {
        id: 7,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "anchor-1", type: 0 }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    const mockModify = vi.fn();
    const mockAnyOf = vi.fn().mockReturnValue({ modify: mockModify });
    vi.mocked(db.timeanchors.where).mockReturnValue({
      anyOf: mockAnyOf,
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    await processSyncQueue();

    expect(db.timeanchors.where).toHaveBeenCalledWith("id");
    expect(mockAnyOf).toHaveBeenCalledWith(["anchor-1"]);
    expect(mockModify).toHaveBeenCalledWith({ isSynced: 1 });
  });

  it("does not trigger processSyncQueue automatically when window online event fires", () => {
    const orderBySpy = vi.spyOn(db.syncQueue, "orderBy");
    window.dispatchEvent(new Event("online"));
    expect(orderBySpy).not.toHaveBeenCalled();
  });

  it("should normalize outdated teamId in sync endpoint using active match record", async () => {
    vi.mocked(db.matches.get).mockResolvedValue({
      id: "m-123",
      trackedTeamId: "correct-team-456",
    } as never);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 1,
          actionType: "POST",
          endpoint: "/Matches/m-123/teams/wrong-default-team/events",
          payload: JSON.stringify([{ id: "e-1" }]),
        },
      ]),
    } as never);

    await processSyncQueue();

    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/m-123/teams/correct-team-456/events",
      [{ id: "e-1" }],
      { headers: { "X-Idempotency-Key": "sync-batch-1" } },
    );
  });

  it("does not batch events belonging to different teams and sends separate requests to resolved endpoints", async () => {
    vi.mocked(db.matchlineups.get).mockImplementation((async (id: string) => {
      if (id === "lineup-home") return { playerRosterId: "roster-home" };
      if (id === "lineup-guest") return { playerRosterId: "roster-guest" };
      return undefined;
    }) as never);

    vi.mocked(db.playerrosters.get).mockImplementation((async (id: string) => {
      if (id === "roster-home") return { teamId: "team-home" };
      if (id === "roster-guest") return { teamId: "team-guest" };
      return undefined;
    }) as never);

    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/teams/placeholder/events",
        payload: JSON.stringify([{ id: "e1", matchLineupId: "lineup-home" }]),
      },
      {
        id: 2,
        actionType: "POST",
        endpoint: "/Matches/m1/teams/placeholder/events",
        payload: JSON.stringify([{ id: "e2", matchLineupId: "lineup-guest" }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    const processed = await processSyncQueue();

    expect(processed).toBe(2);
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    expect(apiClient.post).toHaveBeenNthCalledWith(
      1,
      "/Matches/m1/teams/team-home/events",
      [{ id: "e1", matchLineupId: "lineup-home" }],
      { headers: { "X-Idempotency-Key": "sync-batch-1" } },
    );
    expect(apiClient.post).toHaveBeenNthCalledWith(
      2,
      "/Matches/m1/teams/team-guest/events",
      [{ id: "e2", matchLineupId: "lineup-guest" }],
      { headers: { "X-Idempotency-Key": "sync-batch-2" } },
    );
  });

  it("should preserve queued homeTeamId endpoint when explicit trackedTeamId/selectedTeamId are absent and queued team matches homeTeamId", async () => {
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "m-123",
      homeTeamId: "team-home-111",
      guestTeamId: "team-guest-222",
    } as never);

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 1,
          actionType: "POST",
          endpoint: "/Matches/m-123/teams/team-home-111/events",
          payload: JSON.stringify([{ id: "e-1" }]),
        },
      ]),
    } as never);

    vi.mocked(apiClient.post).mockResolvedValueOnce({ status: 201 });

    await processSyncQueue();

    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/m-123/teams/team-home-111/events",
      [{ id: "e-1" }],
      { headers: { "X-Idempotency-Key": "sync-batch-1" } },
    );
  });

  it("halts queue processing and logs error when syncQueue item contains invalid JSON payload", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: "INVALID_JSON_PAYLOAD",
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const processed = await processSyncQueue();

    expect(processed).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Invalid JSON payload in syncQueue item 1",
    );
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(db.syncQueue.delete).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("handles presence payload containing playerLineupIds array in markEntitiesSynced", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/presence/bulk",
        payload: JSON.stringify({
          periodNumber: 1,
          playerLineupIds: ["lineup-p1", "lineup-p2"],
        }),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    type PresenceFilterFn = (p: {
      matchLineupId: string;
      timeIn: number | null;
      timeOut: number | null;
    }) => boolean;

    let filterPredicate: PresenceFilterFn | undefined;
    const mockModify = vi.fn();
    const mockFilter = vi.fn().mockImplementation((fn: PresenceFilterFn) => {
      filterPredicate = fn;
      return { modify: mockModify };
    });

    vi.mocked(db.playerpresences.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({ filter: mockFilter }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    const processed = await processSyncQueue();

    expect(processed).toBe(1);
    expect(filterPredicate).toBeDefined();
    if (filterPredicate) {
      expect(
        filterPredicate({
          matchLineupId: "lineup-p1",
          timeIn: 10,
          timeOut: 20,
        }),
      ).toBe(true);
      expect(
        filterPredicate({
          matchLineupId: "other-lineup",
          timeIn: 10,
          timeOut: 20,
        }),
      ).toBe(false);
    }
  });

  it("returns 0 immediately and skips sync processing when navigator is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });

    const processed = await processSyncQueue();

    expect(processed).toBe(0);
    expect(db.syncQueue.orderBy).not.toHaveBeenCalled();
  });

  it("falls back to original endpoint, logs warning, and processes queue when normalizeTeamEndpoint encounters database error", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    vi.mocked(db.matches.get).mockResolvedValue(undefined);
    vi.mocked(db.matchlineups.get).mockRejectedValue(
      new Error("IndexedDB read failure"),
    );

    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/teams/fallback-team/events",
        payload: JSON.stringify([{ id: "e1", matchLineupId: "lineup-err" }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    const processed = await processSyncQueue();

    expect(processed).toBe(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Failed to normalize teamId in sync endpoint, falling back to match trackedTeamId or original endpoint:",
      expect.any(Error),
    );
    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/m1/teams/fallback-team/events",
      [{ id: "e1", matchLineupId: "lineup-err" }],
      expect.any(Object),
    );

    consoleWarnSpy.mockRestore();
  });

  it("halts queue execution and logs error when purgeBatchFromSyncQueue rejects during unrecoverable error handling", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/teams/t1/events",
        payload: JSON.stringify([{ id: "orphan-1" }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    vi.mocked(apiClient.post).mockResolvedValueOnce({ status: 404 });
    vi.mocked(db.transaction).mockImplementationOnce(() => {
      throw new Error("Dexie purge write failure");
    });

    const processed = await processSyncQueue();

    expect(processed).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to purge unrecoverable batch for endpoint /Matches/m1/teams/t1/events:",
      expect.any(Error),
    );

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("preserves exact teamId in DELETE /catch endpoint and skips trackedTeamId fallback", async () => {
    vi.mocked(db.matches.get).mockResolvedValue({
      id: "m-123",
      trackedTeamId: "different-tracked-team-789",
    } as never);

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 1,
          actionType: "DELETE",
          endpoint: "/Matches/m-123/teams/original-caught-team-456/catch",
          payload: "{}",
        },
      ]),
    } as never);

    vi.mocked(apiClient.delete).mockResolvedValueOnce({ status: 200 });

    await processSyncQueue();

    expect(apiClient.delete).toHaveBeenCalledWith(
      "/Matches/m-123/teams/original-caught-team-456/catch",
      expect.any(Object),
    );
  });

  it("extracts entity ID from single-entity endpoint path when payload does not contain id", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "DELETE",
        endpoint: "/Matches/m1/events/e-999",
        payload: "{}",
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.delete).mockResolvedValue({ status: 200 });

    const mockModify = vi.fn();
    const mockAnyOf = vi.fn().mockReturnValue({ modify: mockModify });
    vi.mocked(db.gameevents.where).mockReturnValue({
      anyOf: mockAnyOf,
    } as unknown as ReturnType<typeof db.gameevents.where>);

    const processed = await processSyncQueue();

    expect(processed).toBe(1);
    expect(db.gameevents.where).toHaveBeenCalledWith("id");
    expect(mockAnyOf).toHaveBeenCalledWith(["e-999"]);
    expect(mockModify).toHaveBeenCalledWith({ isSynced: 1 });
  });

  it("falls back to original endpoint and continues queue processing when team-scoped event has unresolvable matchLineupId", async () => {
    vi.mocked(db.matchlineups.get).mockResolvedValue(undefined);

    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/teams/placeholder/events",
        payload: JSON.stringify([
          { id: "e1", matchLineupId: "unresolvable-lineup-1" },
        ]),
      },
      {
        id: 2,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "a1" }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    const processed = await processSyncQueue();

    expect(processed).toBe(2);
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    expect(db.syncQueue.delete).toHaveBeenCalledWith(1);
    expect(db.syncQueue.delete).toHaveBeenCalledWith(2);
  });

  it("correctly extracts entity IDs using shared extractEntityIds logic for events and anchors", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors/batch",
        payload: JSON.stringify([{ id: "anchor-batch-item" }]),
      },
      {
        id: 2,
        actionType: "DELETE",
        endpoint: "/Matches/m1/events/e-path-id",
        payload: "{}",
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });
    vi.mocked(apiClient.delete).mockResolvedValue({ status: 200 });

    const mockModify = vi.fn();
    const mockAnyOf = vi.fn().mockReturnValue({ modify: mockModify });
    vi.mocked(db.timeanchors.where).mockReturnValue({
      anyOf: mockAnyOf,
    } as unknown as ReturnType<typeof db.timeanchors.where>);
    vi.mocked(db.gameevents.where).mockReturnValue({
      anyOf: mockAnyOf,
    } as unknown as ReturnType<typeof db.gameevents.where>);

    const processed = await processSyncQueue();

    expect(processed).toBe(2);
    expect(mockAnyOf).toHaveBeenCalledWith(["anchor-batch-item"]);
    expect(mockAnyOf).toHaveBeenCalledWith(["e-path-id"]);
  });

  it("uses selectedTeamId as fallback when trackedTeamId is missing on match record", async () => {
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "m-fallback-1",
      selectedTeamId: "team-selected-777",
    } as never);

    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m-fallback-1/teams/placeholder-team/anchors",
        payload: JSON.stringify([{ id: "a1" }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as never);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    const processed = await processSyncQueue();

    expect(processed).toBe(1);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/m-fallback-1/teams/team-selected-777/anchors",
      [{ id: "a1" }],
      expect.any(Object),
    );
  });

  it("caches matchlineup and match record lookups during a processSyncQueue run", async () => {
    vi.mocked(db.matchlineups.get).mockResolvedValue({
      playerRosterId: "roster-1",
    } as never);
    vi.mocked(db.playerrosters.get).mockResolvedValue({
      teamId: "team-tracked",
    } as never);

    const matchGetSpy = vi.spyOn(db.matches, "get").mockResolvedValue({
      id: "m-100",
      trackedTeamId: "team-tracked",
    } as never);

    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m-100/teams/wrong-team/events",
        payload: JSON.stringify([{ id: "e1", matchLineupId: "lineup-1" }]),
      },
      {
        id: 2,
        actionType: "POST",
        endpoint: "/Matches/m-100/teams/wrong-team/events",
        payload: JSON.stringify([{ id: "e2", matchLineupId: "lineup-1" }]),
      },
      {
        id: 3,
        actionType: "PUT",
        endpoint: "/Matches/m-100/teams/wrong-team/anchors",
        payload: JSON.stringify([{ id: "a1" }]),
      },
      {
        id: 4,
        actionType: "DELETE",
        endpoint: "/Matches/m-100/teams/wrong-team/catch",
        payload: "{}",
      },
      {
        id: 5,
        actionType: "POST",
        endpoint: "/Matches/m-100/teams/wrong-team/anchors",
        payload: JSON.stringify([{ id: "a2" }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as never);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });
    vi.mocked(apiClient.put).mockResolvedValue({ status: 200 });
    vi.mocked(apiClient.delete).mockResolvedValue({ status: 200 });

    const processed = await processSyncQueue();

    expect(processed).toBe(5);
    expect(db.matchlineups.get).toHaveBeenCalledTimes(1);
    expect(db.matchlineups.get).toHaveBeenCalledWith("lineup-1");
    expect(matchGetSpy).toHaveBeenCalledTimes(1);
    expect(matchGetSpy).toHaveBeenCalledWith("m-100");

    matchGetSpy.mockRestore();
  });

  it("caches null match records in matchRecordCache and avoids repeated DB lookups for non-existent matches during fallback resolution", async () => {
    const matchGetSpy = vi
      .spyOn(db.matches, "get")
      .mockResolvedValue(undefined);

    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m-missing/teams/original-team/anchors",
        payload: JSON.stringify([{ id: "a1" }]),
      },
      {
        id: 2,
        actionType: "PUT",
        endpoint: "/Matches/m-missing/teams/original-team/anchors",
        payload: JSON.stringify([{ id: "a2" }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as never);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });
    vi.mocked(apiClient.put).mockResolvedValue({ status: 200 });

    const processed = await processSyncQueue();

    expect(processed).toBe(2);
    expect(matchGetSpy).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/m-missing/teams/original-team/anchors",
      [{ id: "a1" }],
      expect.any(Object),
    );
    expect(apiClient.put).toHaveBeenCalledWith(
      "/Matches/m-missing/teams/original-team/anchors",
      [{ id: "a2" }],
      expect.any(Object),
    );

    matchGetSpy.mockRestore();
  });

  it("caches unresolvable lineup lookups in lineupTeamCache and avoids re-querying IndexedDB for the same lineup", async () => {
    const lineupGetSpy = vi
      .spyOn(db.matchlineups, "get")
      .mockResolvedValue(undefined);

    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/teams/placeholder/events",
        payload: JSON.stringify([
          { id: "e1", matchLineupId: "missing-lineup" },
        ]),
      },
      {
        id: 2,
        actionType: "PUT",
        endpoint: "/Matches/m1/teams/placeholder/events",
        payload: JSON.stringify([
          { id: "e2", matchLineupId: "missing-lineup" },
        ]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as never);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });
    vi.mocked(apiClient.put).mockResolvedValue({ status: 200 });

    await processSyncQueue();

    expect(lineupGetSpy).toHaveBeenCalledTimes(1);
    expect(lineupGetSpy).toHaveBeenCalledWith("missing-lineup");

    lineupGetSpy.mockRestore();
  });

  it("preserves original endpoint unchanged when match record exists but contains neither trackedTeamId nor selectedTeamId", async () => {
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "m-no-teams",
      homeTeamId: "home-1",
      guestTeamId: "guest-2",
    } as never);

    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m-no-teams/teams/original-team/anchors",
        payload: JSON.stringify([{ id: "a1" }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as never);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    const processed = await processSyncQueue();

    expect(processed).toBe(1);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/m-no-teams/teams/original-team/anchors",
      [{ id: "a1" }],
      expect.any(Object),
    );
  });

  it("handles team resolution when lineup exists but playerroster is missing or lacks teamId", async () => {
    vi.mocked(db.matchlineups.get).mockResolvedValue({
      playerRosterId: "roster-missing",
    } as never);
    vi.mocked(db.playerrosters.get).mockResolvedValue(undefined);

    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/teams/placeholder/events",
        payload: JSON.stringify([{ id: "e1", matchLineupId: "l1" }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as never);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    const processed = await processSyncQueue();

    expect(processed).toBe(1);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/m1/teams/placeholder/events",
      [{ id: "e1", matchLineupId: "l1" }],
      expect.any(Object),
    );
  });

  it("handles event payload without matchLineupId property gracefully", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/teams/placeholder/events",
        payload: JSON.stringify([{ id: "e1" }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as never);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    const processed = await processSyncQueue();

    expect(processed).toBe(1);
  });

  it("executes non-transactional fallback in purgeBatchFromSyncQueue and finalizeBatchSync when db.transaction is undefined", async () => {
    const originalTx = db.transaction;
    (db as unknown as { transaction?: unknown }).transaction = undefined;

    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "a1" }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as never);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    const processed = await processSyncQueue();

    expect(processed).toBe(1);
    expect(db.syncQueue.delete).toHaveBeenCalledWith(1);

    db.transaction = originalTx;
  });

  it("handles malformed team endpoints in resolveFallbackTeamEndpoint", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/malformed-endpoint",
        payload: JSON.stringify([{ id: "a1" }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as never);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

    const processed = await processSyncQueue();

    expect(processed).toBe(1);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/malformed-endpoint",
      [{ id: "a1" }],
      expect.any(Object),
    );
  });
});

describe("Direct Helper Unit Tests (markEntitiesSynced)", () => {
  it("returns early when endpoint is missing, or payload is null/undefined", async () => {
    await expect(markEntitiesSynced("", {})).resolves.toBeUndefined();
    await expect(
      markEntitiesSynced("/Matches/m1/events", null),
    ).resolves.toBeUndefined();
    await expect(
      markEntitiesSynced("/Matches/m1/events", undefined),
    ).resolves.toBeUndefined();
  });

  it("does nothing when endpoint matches no known sync entity routes", async () => {
    await expect(
      markEntitiesSynced("/Matches/m1/unsupported-route", { id: "1" }),
    ).resolves.toBeUndefined();
  });

  it("handles substitution payload with playerOutLineupId and playerInLineupId strings", async () => {
    const mockModify = vi.fn();
    const mockFilter = vi.fn().mockReturnValue({ modify: mockModify });
    vi.mocked(db.playerpresences.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({ filter: mockFilter }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    await markEntitiesSynced("/Matches/m1/substitutions", {
      periodNumber: 1,
      playerOutLineupId: "l-out",
      playerInLineupId: "l-in",
    });

    expect(db.playerpresences.where).toHaveBeenCalledWith("periodNumber");
    expect(mockModify).toHaveBeenCalledWith({ isSynced: 1 });
  });
});

describe("Batch Sync Service (syncMatchBatch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws an error if matchId is empty or whitespace", async () => {
    await expect(syncMatchBatch("")).rejects.toThrow(
      "Match ID is required for batch synchronization.",
    );
    await expect(syncMatchBatch("   ")).rejects.toThrow(
      "Match ID is required for batch synchronization.",
    );
  });

  it("collects un-synced events, anchors, and presences, formats UTC ISO timestamps, and posts batch request without local metadata including shotLocationX and shotLocationY", async () => {
    const mockLineups = [{ id: "l1", matchId: "m123" }];
    const mockEvents = [
      {
        id: "e1",
        matchLineupId: "l1",
        eventDefinitionId: "def-1",
        periodNumber: 1,
        isLeadToGoal: false,
        isSynced: 0,
        eventTimestamp: "2026-10-05T12:00:00Z",
        shotLocationX: null,
        shotLocationY: null,
      },
    ];
    const mockAnchors = [
      {
        id: "a1",
        matchId: "m123",
        periodNumber: 1,
        type: 0,
        isSynced: 0,
        timestamp: "2026-10-05T12:00:00Z",
      },
    ];
    const mockPresences = [
      {
        id: "p1",
        matchLineupId: "l1",
        periodNumber: 1,
        timeIn: "2026-10-05T12:00:00Z",
        timeOut: "2026-10-05T12:10:00Z",
        isSynced: 0,
      },
    ];

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockLineups),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    const mockFilterEvents = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockEvents),
    });
    vi.mocked(db.gameevents.filter).mockImplementation(
      mockFilterEvents as never,
    );

    const mockFilterAnchors = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockAnchors),
    });

    const mockModify = vi.fn();
    const mockAnyOf = vi.fn().mockReturnValue({ modify: mockModify });

    vi.mocked(db.timeanchors.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        filter: mockFilterAnchors,
      }),
      anyOf: mockAnyOf,
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    vi.mocked(db.playerpresences.filter).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockPresences),
    } as unknown as ReturnType<typeof db.playerpresences.filter>);

    vi.mocked(apiClient.post).mockResolvedValue({
      syncedEventIds: ["e1"],
      syncedAnchorIds: ["a1"],
      syncedPresenceIds: ["p1"],
    });

    vi.mocked(db.gameevents.where).mockReturnValue({
      anyOf: mockAnyOf,
    } as unknown as ReturnType<typeof db.gameevents.where>);

    vi.mocked(db.playerpresences.where).mockReturnValue({
      anyOf: mockAnyOf,
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    vi.mocked(db.syncQueue.toArray).mockResolvedValue([
      {
        id: 10,
        actionType: "POST",
        endpoint: "/Matches/m123/events",
        payload: JSON.stringify([{ id: "e1" }]),
      },
    ] as never);

    const result = await syncMatchBatch("m123");

    expect(apiClient.post).toHaveBeenCalledWith("/Matches/m123/sync-batch", {
      events: [
        {
          id: "e1",
          matchLineupId: "l1",
          eventDefinitionId: "def-1",
          periodNumber: 1,
          eventTimestamp: "2026-10-05T12:00:00.000Z",
          isLeadToGoal: false,
          locationX: null,
          locationY: null,
          shotLocationX: null,
          shotLocationY: null,
        },
      ],
      anchors: [
        {
          id: "a1",
          periodNumber: 1,
          type: 0,
          timestamp: "2026-10-05T12:00:00.000Z",
        },
      ],
      presences: [
        {
          id: "p1",
          matchLineupId: "l1",
          periodNumber: 1,
          timeIn: "2026-10-05T12:00:00.000Z",
          timeOut: "2026-10-05T12:10:00.000Z",
        },
      ],
    });

    expect(result).toEqual({
      syncedEventIds: ["e1"],
      syncedAnchorIds: ["a1"],
      syncedPresenceIds: ["p1"],
    });
    expect(db.syncQueue.delete).toHaveBeenCalledWith(10);
  });

  it("includes spatial locationX, locationY, shotLocationX, and shotLocationY coordinates in batch request payload when present on events", async () => {
    const mockLineups = [{ id: "l1", matchId: "m123" }];
    const mockEvents = [
      {
        id: "e-spatial",
        matchLineupId: "l1",
        eventDefinitionId: "def-1",
        periodNumber: 1,
        isLeadToGoal: true,
        isSynced: 0,
        eventTimestamp: "2026-10-05T12:00:00Z",
        locationX: 45.5,
        locationY: 80.2,
        shotLocationX: 30.5,
        shotLocationY: 70.0,
      },
    ];

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockLineups),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(db.gameevents.filter).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockEvents),
    } as unknown as ReturnType<typeof db.gameevents.filter>);

    vi.mocked(db.timeanchors.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        filter: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    vi.mocked(db.playerpresences.filter).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.playerpresences.filter>);

    vi.mocked(apiClient.post).mockResolvedValue({
      syncedEventIds: ["e-spatial"],
    });

    await syncMatchBatch("m123");

    expect(apiClient.post).toHaveBeenCalledWith("/Matches/m123/sync-batch", {
      events: [
        {
          id: "e-spatial",
          matchLineupId: "l1",
          eventDefinitionId: "def-1",
          periodNumber: 1,
          eventTimestamp: "2026-10-05T12:00:00.000Z",
          isLeadToGoal: true,
          locationX: 45.5,
          locationY: 80.2,
          shotLocationX: 30.5,
          shotLocationY: 70.0,
        },
      ],
      anchors: [],
      presences: [],
    });
  });

  it("handles wrapped API response { data: MatchSyncBatchResponse }", async () => {
    const mockLineups = [{ id: "l1", matchId: "m123" }];
    const mockEvents = [{ id: "e1", matchLineupId: "l1", isSynced: 0 }];
    const mockAnchors = [{ id: "a1", matchId: "m123", isSynced: 0 }];

    const mockModify = vi.fn();
    const mockAnyOf = vi.fn().mockReturnValue({ modify: mockModify });

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockLineups),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(db.gameevents.filter).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockEvents),
    } as unknown as ReturnType<typeof db.gameevents.filter>);

    vi.mocked(db.gameevents.where).mockReturnValue({
      anyOf: mockAnyOf,
    } as unknown as ReturnType<typeof db.gameevents.where>);

    vi.mocked(db.timeanchors.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        filter: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(mockAnchors),
        }),
      }),
      anyOf: mockAnyOf,
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    vi.mocked(db.playerpresences.filter).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.playerpresences.filter>);

    vi.mocked(apiClient.post).mockResolvedValue({
      data: {
        syncedEventIds: ["e1"],
        syncedAnchorIds: ["a1"],
        syncedPresenceIds: [],
      },
    });

    const result = await syncMatchBatch("m123");

    expect(result).toEqual({
      syncedEventIds: ["e1"],
      syncedAnchorIds: ["a1"],
      syncedPresenceIds: [],
    });
  });

  it("unpacks ValidationProblemDetails.errors and throws formatted validation error on 400 Bad Request during batch sync", async () => {
    const mockLineups = [{ id: "l1", matchId: "m123" }];

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockLineups),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    const error400 = {
      status: 400,
      problemDetails: {
        errors: {
          Events: ["Event timestamp is invalid."],
          Anchors: ["Anchor period does not match."],
        },
      },
    };

    vi.mocked(apiClient.post).mockRejectedValueOnce(error400);

    await expect(syncMatchBatch("m123")).rejects.toThrow(
      "Event timestamp is invalid.; Anchor period does not match.",
    );
  });

  it("re-throws generic non-400 errors or malformed 400 errors directly in postSyncBatch", async () => {
    const mockLineups = [{ id: "l1", matchId: "m123" }];

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockLineups),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(apiClient.post).mockRejectedValueOnce({
      status: 500,
      message: "Internal Error",
    });

    await expect(syncMatchBatch("m123")).rejects.toEqual({
      status: 500,
      message: "Internal Error",
    });

    vi.mocked(apiClient.post).mockRejectedValueOnce({ status: 400, data: {} });

    await expect(syncMatchBatch("m123")).rejects.toEqual({
      status: 400,
      data: {},
    });
  });

  it("preserves non-POST and unsynced POST queue items during syncMatchBatch cleanup", async () => {
    const mockLineups = [{ id: "l1", matchId: "m123" }];

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockLineups),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(apiClient.post).mockResolvedValue({
      syncedEventIds: ["e1"],
      syncedAnchorIds: [],
      syncedPresenceIds: [],
    });

    const mockQueueItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m123/teams/t1/events",
        payload: JSON.stringify([{ id: "e1" }]),
      },
      {
        id: 2,
        actionType: "POST",
        endpoint: "/Matches/m123/teams/t1/events",
        payload: JSON.stringify([{ id: "e2-unsynced" }]),
      },
      {
        id: 3,
        actionType: "PUT",
        endpoint: "/Matches/m123/presence/terminate",
        payload: JSON.stringify({ periodNumber: 1 }),
      },
      {
        id: 4,
        actionType: "PUT",
        endpoint: "/Matches/m123/events/e1",
        payload: JSON.stringify({ id: "e1" }),
      },
    ];

    vi.mocked(db.syncQueue.toArray).mockResolvedValue(mockQueueItems as never);

    await syncMatchBatch("m123");

    expect(db.syncQueue.delete).toHaveBeenCalledTimes(1);
    expect(db.syncQueue.delete).toHaveBeenCalledWith(1);
    expect(db.syncQueue.delete).not.toHaveBeenCalledWith(2);
    expect(db.syncQueue.delete).not.toHaveBeenCalledWith(3);
    expect(db.syncQueue.delete).not.toHaveBeenCalledWith(4);
  });

  it("omits timeIn and timeOut from presence payload when stored presence missing time values", async () => {
    const mockLineups = [{ id: "l1", matchId: "m123" }];
    const mockPresences = [
      {
        id: "p1",
        matchLineupId: "l1",
        periodNumber: 1,
        timeIn: null,
        timeOut: null,
        isSynced: 0,
      },
    ];

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockLineups),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(db.gameevents.filter).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.gameevents.filter>);

    vi.mocked(db.timeanchors.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        filter: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    vi.mocked(db.playerpresences.filter).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockPresences),
    } as unknown as ReturnType<typeof db.playerpresences.filter>);

    vi.mocked(apiClient.post).mockResolvedValue({
      syncedPresenceIds: ["p1"],
    });

    await syncMatchBatch("m123");

    expect(apiClient.post).toHaveBeenCalledWith("/Matches/m123/sync-batch", {
      events: [],
      anchors: [],
      presences: [
        {
          id: "p1",
          matchLineupId: "l1",
          periodNumber: 1,
        },
      ],
    });
  });

  describe("Additional Sync Engine Coverage Tests", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(db.matches.get).mockReset().mockResolvedValue(undefined);
      vi.mocked(db.matchlineups.get).mockReset().mockResolvedValue(undefined);
      vi.mocked(db.playerrosters.get).mockReset().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: true,
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("prevents re-entrant sync queue processing when isSyncing is true", async () => {
      const mockItems = [
        {
          id: 1,
          actionType: "POST",
          endpoint: "/Matches/m1/anchors",
          payload: JSON.stringify([{ id: "a1" }]),
        },
      ];

      const mockModify = vi.fn();
      const mockAnyOf = vi.fn().mockReturnValue({ modify: mockModify });
      vi.mocked(db.timeanchors.where).mockReturnValue({
        anyOf: mockAnyOf,
      } as unknown as ReturnType<typeof db.timeanchors.where>);

      vi.mocked(db.syncQueue.orderBy).mockReturnValue({
        toArray: vi.fn().mockImplementation(async () => {
          const reentrantPromise = processSyncQueue();
          await expect(reentrantPromise).resolves.toBe(0);
          return mockItems;
        }),
      } as never);

      vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

      const processed = await processSyncQueue();
      expect(processed).toBe(1);
    });

    it("preserves original event and anchor timestamps without defaulting to current execution time", async () => {
      const mockLineups = [{ id: "l1", matchId: "m1" }];
      const mockEvents = [
        {
          id: "e1",
          matchLineupId: "l1",
          isSynced: 0,
          eventTimestamp: "2026-10-05T10:15:30.000Z",
        },
      ];
      const mockAnchors = [
        {
          id: "a1",
          matchId: "m1",
          isSynced: 0,
          timestamp: "2026-10-05T10:00:00.000Z",
        },
      ];

      const mockModify = vi.fn();
      const mockAnyOf = vi.fn().mockReturnValue({ modify: mockModify });

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(mockLineups),
        }),
      } as never);

      vi.mocked(db.gameevents.filter).mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockEvents),
      } as never);

      vi.mocked(db.gameevents.where).mockReturnValue({
        anyOf: mockAnyOf,
      } as unknown as ReturnType<typeof db.gameevents.where>);

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(mockAnchors),
          }),
        }),
        anyOf: mockAnyOf,
      } as unknown as ReturnType<typeof db.timeanchors.where>);

      vi.mocked(db.playerpresences.filter).mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      } as never);

      vi.mocked(apiClient.post).mockResolvedValue({
        syncedEventIds: ["e1"],
        syncedAnchorIds: ["a1"],
      });

      await syncMatchBatch("m1");

      expect(apiClient.post).toHaveBeenCalledWith(
        "/Matches/m1/sync-batch",
        expect.objectContaining({
          events: [
            expect.objectContaining({
              id: "e1",
              eventTimestamp: "2026-10-05T10:15:30.000Z",
            }),
          ],
          anchors: [
            expect.objectContaining({
              id: "a1",
              timestamp: "2026-10-05T10:00:00.000Z",
            }),
          ],
        }),
      );
    });

    it("cleanupBatchQueue ignores items without id, wrong actionType, or mismatched endpoint prefix", async () => {
      const mockLineups = [{ id: "l1", matchId: "m1" }];

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(mockLineups),
        }),
      } as never);

      vi.mocked(apiClient.post).mockResolvedValue({
        syncedEventIds: ["e1"],
      });

      const mockQueueItems = [
        {
          id: undefined,
          actionType: "POST",
          endpoint: "/Matches/m1/events",
          payload: JSON.stringify([{ id: "e1" }]),
        },
        {
          id: 2,
          actionType: "DELETE",
          endpoint: "/Matches/m1/events",
          payload: JSON.stringify([{ id: "e1" }]),
        },
        {
          id: 3,
          actionType: "POST",
          endpoint: "/Matches/other-match/events",
          payload: JSON.stringify([{ id: "e1" }]),
        },
        {
          id: 4,
          actionType: "POST",
          endpoint: "/Matches/m1/events",
          payload: "invalid-json",
        },
        {
          id: 5,
          actionType: "POST",
          endpoint: "/Matches/m1/other",
          payload: JSON.stringify({ id: "e1" }),
        },
      ];

      vi.mocked(db.syncQueue.toArray).mockResolvedValue(
        mockQueueItems as never,
      );

      await syncMatchBatch("m1");

      expect(db.syncQueue.delete).not.toHaveBeenCalled();
    });

    it("handles non-string or primitive values in extractPresenceIds and extractPresenceLineupIds", async () => {
      const mockModify = vi.fn();
      const mockFilter = vi.fn().mockReturnValue({ modify: mockModify });
      const mockEquals = vi.fn().mockReturnValue({ filter: mockFilter });

      vi.mocked(db.playerpresences.where).mockReturnValue({
        equals: mockEquals,
      } as unknown as ReturnType<typeof db.playerpresences.where>);

      await markEntitiesSynced("/Matches/m1/presence", {
        periodNumber: 1,
        presenceItems: [
          { id: 123, matchLineupId: "456" },
          { id: "789", matchLineupId: "101" },
        ],
      });

      await markEntitiesSynced("/Matches/m1/substitutions", {
        periodNumber: 1,
        playerOutLineupId: 123,
        playerInLineupId: 456,
      });

      expect(db.playerpresences.where).toHaveBeenCalledWith("periodNumber");
    });

    it("handles extractEntityIds logic when endpoint path contains 'batch' or query string", async () => {
      const mockItems = [
        {
          id: 1,
          actionType: "POST",
          endpoint: "/Matches/m1/events/batch",
          payload: JSON.stringify([{ id: "e1" }]),
        },
        {
          id: 2,
          actionType: "POST",
          endpoint: "/Matches/m1/events/?filter=active",
          payload: JSON.stringify([{ id: "e2" }]),
        },
      ];

      vi.mocked(db.syncQueue.orderBy).mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockItems),
      } as never);

      vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

      const processed = await processSyncQueue();
      expect(processed).toBe(2);
    });

    it("handles non-string matchLineupId in resolveEventTeamId and cached null team lookups", async () => {
      const lineupCache = new Map<string, string | null>();
      lineupCache.set("cached-null-lineup", null);

      vi.mocked(db.matchlineups.get).mockResolvedValue({
        playerRosterId: "r1",
      } as never);
      vi.mocked(db.playerrosters.get).mockResolvedValue({
        teamId: undefined,
      } as never);

      const mockItems = [
        {
          id: 1,
          actionType: "POST",
          endpoint: "/Matches/m1/teams/placeholder/events",
          payload: JSON.stringify([{ id: "e1", matchLineupId: 12345 }]),
        },
        {
          id: 2,
          actionType: "POST",
          endpoint: "/Matches/m1/teams/placeholder/events",
          payload: JSON.stringify([
            { id: "e2", matchLineupId: "cached-null-lineup" },
          ]),
        },
        {
          id: 3,
          actionType: "POST",
          endpoint: "/Matches/m1/teams/placeholder/events",
          payload: JSON.stringify([
            { id: "e3", matchLineupId: "lineup-no-team" },
          ]),
        },
      ];

      vi.mocked(db.syncQueue.orderBy).mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockItems),
      } as never);

      vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

      const processed = await processSyncQueue();
      expect(processed).toBe(3);
    });

    it("handles resolveBatchTeamId with empty array or mixed teamIds in payload", async () => {
      vi.mocked(db.matchlineups.get).mockImplementation((async (id: string) => {
        if (id === "l-team1") return { playerRosterId: "r1" };
        if (id === "l-team2") return { playerRosterId: "r2" };
        return undefined;
      }) as never);

      vi.mocked(db.playerrosters.get).mockImplementation((async (
        id: string,
      ) => {
        if (id === "r1") return { teamId: "team-1" };
        if (id === "r2") return { teamId: "team-2" };
        return undefined;
      }) as never);

      const mockItems = [
        {
          id: 1,
          actionType: "POST",
          endpoint: "/Matches/m1/teams/placeholder/events",
          payload: JSON.stringify([]),
        },
        {
          id: 2,
          actionType: "POST",
          endpoint: "/Matches/m1/teams/placeholder/events",
          payload: JSON.stringify([
            { id: "e1", matchLineupId: "l-team1" },
            { id: "e2", matchLineupId: "l-team2" },
          ]),
        },
      ];

      vi.mocked(db.syncQueue.orderBy).mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockItems),
      } as never);

      vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

      const processed = await processSyncQueue();
      expect(processed).toBe(2);
    });

    it("extracts 400 validation error with non-array error messages in extractBatchError", async () => {
      const mockLineups = [{ id: "l1", matchId: "m123" }];

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(mockLineups),
        }),
      } as never);

      const error400SingleMsg = {
        status: 400,
        data: {
          errors: {
            General: "String error message rather than array",
          },
        },
      };

      vi.mocked(apiClient.post).mockRejectedValueOnce(error400SingleMsg);

      await expect(syncMatchBatch("m123")).rejects.toThrow(
        "String error message rather than array",
      );
    });

    it("cleans up PUT /presence/terminate queue items during syncMatchBatch when presences are synced", async () => {
      const mockLineups = [{ id: "l1", matchId: "m123" }];

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(mockLineups),
        }),
      } as never);

      const mockModify = vi.fn();
      const mockAnyOf = vi.fn().mockReturnValue({ modify: mockModify });
      vi.mocked(db.playerpresences.where).mockReturnValue({
        anyOf: mockAnyOf,
        equals: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({ modify: mockModify }),
        }),
      } as never);

      vi.mocked(apiClient.post).mockResolvedValue({
        syncedEventIds: [],
        syncedAnchorIds: [],
        syncedPresenceIds: ["p1"],
      });

      const mockQueueItems = [
        {
          id: 1,
          actionType: "PUT",
          endpoint: "/Matches/m123/presence/terminate",
          payload: JSON.stringify({ periodNumber: 1 }),
        },
      ];

      vi.mocked(db.syncQueue.toArray).mockResolvedValue(
        mockQueueItems as never,
      );

      await syncMatchBatch("m123");

      expect(db.syncQueue.delete).toHaveBeenCalledWith(1);
    });

    it("cleans up POST /substitutions queue items with incomingPresenceId during syncMatchBatch when matching presence is synced", async () => {
      const mockLineups = [{ id: "l1", matchId: "m123" }];

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(mockLineups),
        }),
      } as never);

      const mockModify = vi.fn();
      const mockAnyOf = vi.fn().mockReturnValue({ modify: mockModify });
      vi.mocked(db.playerpresences.where).mockReturnValue({
        anyOf: mockAnyOf,
        equals: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({ modify: mockModify }),
        }),
      } as never);

      vi.mocked(apiClient.post).mockResolvedValue({
        syncedEventIds: [],
        syncedAnchorIds: [],
        syncedPresenceIds: ["pres-new-123"],
      });

      const mockQueueItems = [
        {
          id: 1,
          actionType: "POST",
          endpoint: "/Matches/m123/substitutions",
          payload: JSON.stringify({
            periodNumber: 1,
            playerOutLineupId: "l-out",
            playerInLineupId: "l-in",
            incomingPresenceId: "pres-new-123",
          }),
        },
      ];

      vi.mocked(db.syncQueue.toArray).mockResolvedValue(
        mockQueueItems as never,
      );

      await syncMatchBatch("m123");

      expect(db.syncQueue.delete).toHaveBeenCalledWith(1);
    });

    it("filters sync queue processing by targetMatchId when provided, leaving other matches queued", async () => {
      const mockItems = [
        {
          id: 1,
          actionType: "POST",
          endpoint: "/Matches/m-user1/anchors",
          payload: JSON.stringify([{ id: "a1" }]),
        },
        {
          id: 2,
          actionType: "POST",
          endpoint: "/Matches/m-user2/anchors",
          payload: JSON.stringify([{ id: "a2" }]),
        },
      ];

      vi.mocked(db.syncQueue.orderBy).mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockItems),
      } as never);

      vi.mocked(apiClient.post).mockResolvedValue({ status: 201 });

      const processed = await processSyncQueue("m-user1");

      expect(processed).toBe(1);
      expect(apiClient.post).toHaveBeenCalledTimes(1);
      expect(apiClient.post).toHaveBeenCalledWith(
        "/Matches/m-user1/anchors",
        [{ id: "a1" }],
        expect.any(Object),
      );
      expect(db.syncQueue.delete).toHaveBeenCalledWith(1);
      expect(db.syncQueue.delete).not.toHaveBeenCalledWith(2);
    });

    it("cleanupBatchQueue removes only synced PUT /presence/terminate items when multiple terminate entries exist", async () => {
      const matchId = "m-multi-term";
      const exitTime1 = "2026-11-18T10:02:00.000Z";
      const exitTime2 = "2026-11-18T10:08:00.000Z";

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { id: "lineup-1", matchId },
            { id: "lineup-2", matchId },
          ]),
        }),
      } as never);

      vi.mocked(db.playerpresences.filter).mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "pres-1",
            matchLineupId: "lineup-1",
            periodNumber: 1,
            timeIn: "2026-11-18T10:00:00.000Z",
            timeOut: exitTime1,
            sequenceNumber: 1,
            isSynced: 0,
          },
          {
            id: "pres-2",
            matchLineupId: "lineup-2",
            periodNumber: 1,
            timeIn: "2026-11-18T10:00:00.000Z",
            timeOut: exitTime2,
            sequenceNumber: 2,
            isSynced: 0,
          },
        ]),
      } as never);

      vi.mocked(db.syncQueue.toArray).mockResolvedValue([
        {
          id: 101,
          actionType: "PUT",
          endpoint: `/Matches/${matchId}/presence/terminate`,
          payload: JSON.stringify({
            periodNumber: 1,
            playerLineupIds: ["lineup-1"],
            timeOut: exitTime1,
          }),
          createdAt: exitTime1,
        },
        {
          id: 102,
          actionType: "PUT",
          endpoint: `/Matches/${matchId}/presence/terminate`,
          payload: JSON.stringify({
            periodNumber: 1,
            playerLineupIds: ["lineup-2"],
            timeOut: exitTime2,
          }),
          createdAt: exitTime2,
        },
      ]);

      // Only pres-1 returned as synced
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: {
          syncedEventIds: [],
          syncedAnchorIds: [],
          syncedPresenceIds: ["pres-1"],
        },
      });

      await syncMatchBatch(matchId);

      expect(db.syncQueue.delete).toHaveBeenCalledWith(101);
      expect(db.syncQueue.delete).not.toHaveBeenCalledWith(102);
    });

    it("cleanupBatchQueue preserves newly queued empty-lineup period-end termination when batch started before period end", async () => {
      const matchId = "m-concurrent-end";
      const equalTimestamp = "2026-11-18T10:10:00.000Z";

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi
            .fn()
            .mockResolvedValue([{ id: "lineup-disciplinary", matchId }]),
        }),
      } as never);

      // Batch started before period end: no PeriodEnd anchor yet during request preparation
      const localAnchors: Array<{
        id: string;
        matchId: string;
        periodNumber: number;
        type: number;
        timestamp: string;
        sequenceNumber: number;
        isSynced: number;
      }> = [];

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockImplementation((targetMatchId: string) => ({
          filter: vi
            .fn()
            .mockImplementation(
              (predicate: (a: (typeof localAnchors)[number]) => boolean) => ({
                toArray: vi
                  .fn()
                  .mockImplementation(() =>
                    Promise.resolve(
                      localAnchors
                        .filter((a) => a.matchId === targetMatchId)
                        .filter(predicate)
                        .map((a) => ({ ...a })),
                    ),
                  ),
              }),
            ),
        })),
        anyOf: vi.fn().mockReturnValue({ modify: vi.fn() }),
      } as never);

      vi.mocked(db.playerpresences.filter).mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "pres-disciplinary",
            matchLineupId: "lineup-disciplinary",
            periodNumber: 1,
            timeIn: "2026-11-18T10:00:00.000Z",
            timeOut: equalTimestamp,
            sequenceNumber: 1,
            isSynced: 0,
          },
        ]),
      } as never);

      const queueItems: Record<string, unknown>[] = [
        {
          id: 201,
          actionType: "PUT",
          endpoint: `/Matches/${matchId}/presence/terminate`,
          payload: JSON.stringify({
            periodNumber: 1,
            playerLineupIds: ["lineup-disciplinary"],
            timeOut: equalTimestamp,
          }),
          createdAt: equalTimestamp,
        },
      ];

      vi.mocked(db.syncQueue.toArray).mockImplementation(
        () => Promise.resolve([...queueItems]) as never,
      );

      let submittedAnchors: unknown[] = [];

      // While the batch request is in-flight, the period ends locally:
      // a new unsynced PeriodEnd anchor and an empty-lineup period-end termination appear.
      vi.mocked(apiClient.post).mockImplementationOnce(
        async (_url, payload) => {
          submittedAnchors = (payload as { anchors: unknown[] }).anchors;
          localAnchors.push({
            id: "anchor-period-end-empty",
            matchId,
            periodNumber: 1,
            type: 1,
            timestamp: equalTimestamp,
            sequenceNumber: 5,
            isSynced: 0,
          });
          queueItems.push({
            id: 202,
            actionType: "PUT",
            endpoint: `/Matches/${matchId}/presence/terminate`,
            payload: JSON.stringify({
              periodNumber: 1,
              playerLineupIds: [],
              timeOut: equalTimestamp,
            }),
            createdAt: equalTimestamp,
            periodEndMeta: {
              matchId,
              periodNumber: 1,
              timeOut: equalTimestamp,
              closedPresenceIds: [],
              closedLineupIds: [],
            },
          });

          return {
            data: {
              syncedEventIds: [],
              syncedAnchorIds: [],
              syncedPresenceIds: ["pres-disciplinary"],
            },
          };
        },
      );

      await syncMatchBatch(matchId);

      // The new PeriodEnd anchor was not part of the submitted batch snapshot
      expect(submittedAnchors).toEqual([]);
      // Disciplinary exit queue item is cleaned up, while the new empty-lineup period-end item is preserved
      expect(db.syncQueue.delete).toHaveBeenCalledWith(201);
      expect(db.syncQueue.delete).not.toHaveBeenCalledWith(202);
    });

    it("preserves nonempty period-end termination metadata and keeps mutated presence unsynced when period ends during an in-flight batch", async () => {
      const matchId = "m-concurrent-nonempty-end";
      const equalTimestamp = "2026-11-18T10:10:00.000Z";

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { id: "lineup-active", matchId },
            { id: "lineup-disciplinary", matchId },
          ]),
        }),
      } as never);

      // Batch started before period end: no PeriodEnd anchor yet during request preparation
      const localAnchors: Array<{
        id: string;
        matchId: string;
        periodNumber: number;
        type: number;
        timestamp: string;
        sequenceNumber: number;
        isSynced: number;
      }> = [];

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockImplementation((targetMatchId: string) => ({
          filter: vi
            .fn()
            .mockImplementation(
              (predicate: (a: (typeof localAnchors)[number]) => boolean) => ({
                toArray: vi
                  .fn()
                  .mockImplementation(() =>
                    Promise.resolve(
                      localAnchors
                        .filter((a) => a.matchId === targetMatchId)
                        .filter(predicate)
                        .map((a) => ({ ...a })),
                    ),
                  ),
              }),
            ),
        })),
        anyOf: vi.fn().mockReturnValue({ modify: vi.fn() }),
      } as never);

      // Local IndexedDB state for playerpresences (mutated while batch is in-flight)
      const localPresences = [
        {
          id: "pres-active",
          matchLineupId: "lineup-active",
          periodNumber: 1,
          timeIn: "2026-11-18T10:00:00.000Z",
          timeOut: null as string | null,
          sequenceNumber: 1,
          isSynced: 0,
        },
        {
          id: "pres-disciplinary",
          matchLineupId: "lineup-disciplinary",
          periodNumber: 1,
          timeIn: "2026-11-18T10:00:00.000Z",
          timeOut: equalTimestamp,
          sequenceNumber: 2,
          isSynced: 0,
        },
      ];

      // Return shallow copies for the batch snapshot so subsequent local mutations diverge from the submitted snapshot
      vi.mocked(db.playerpresences.filter).mockReturnValue({
        toArray: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(localPresences.map((p) => ({ ...p }))),
          ),
      } as never);

      vi.mocked(db.playerpresences.where).mockReturnValue({
        anyOf: vi.fn().mockImplementation((ids: string[]) => ({
          modify: vi
            .fn()
            .mockImplementation(
              (
                updater:
                  | Record<string, unknown>
                  | ((record: (typeof localPresences)[number]) => void),
              ) => {
                for (const record of localPresences) {
                  if (!ids.includes(record.id)) continue;
                  if (typeof updater === "function") {
                    updater(record);
                  } else {
                    Object.assign(record, updater);
                  }
                }
                return Promise.resolve(ids.length);
              },
            ),
        })),
      } as never);

      const queueItems: Record<string, unknown>[] = [
        {
          id: 301,
          actionType: "PUT",
          endpoint: `/Matches/${matchId}/presence/terminate`,
          payload: JSON.stringify({
            periodNumber: 1,
            playerLineupIds: ["lineup-disciplinary"],
            timeOut: equalTimestamp,
          }),
          createdAt: equalTimestamp,
        },
      ];

      vi.mocked(db.syncQueue.toArray).mockImplementation(
        () => Promise.resolve([...queueItems]) as never,
      );

      let submittedAnchors: unknown[] = [];

      // While the batch request is in-flight, the period ends locally:
      // a new unsynced PeriodEnd anchor is persisted, pres-active is closed, and
      // a nonempty period-end termination with periodEndMeta is queued.
      vi.mocked(apiClient.post).mockImplementationOnce(
        async (_url, payload) => {
          submittedAnchors = (payload as { anchors: unknown[] }).anchors;
          localAnchors.push({
            id: "anchor-period-end-nonempty",
            matchId,
            periodNumber: 1,
            type: 1,
            timestamp: equalTimestamp,
            sequenceNumber: 5,
            isSynced: 0,
          });
          localPresences[0].timeOut = equalTimestamp;
          localPresences[0].isSynced = 0;
          queueItems.push({
            id: 302,
            actionType: "PUT",
            endpoint: `/Matches/${matchId}/presence/terminate`,
            payload: JSON.stringify({
              periodNumber: 1,
              playerLineupIds: ["lineup-active"],
              timeOut: equalTimestamp,
            }),
            createdAt: equalTimestamp,
            periodEndMeta: {
              matchId,
              periodNumber: 1,
              timeOut: equalTimestamp,
              closedPresenceIds: ["pres-active"],
              closedLineupIds: ["lineup-active"],
            },
          });

          return {
            data: {
              syncedEventIds: [],
              syncedAnchorIds: [],
              syncedPresenceIds: ["pres-active", "pres-disciplinary"],
            },
          };
        },
      );

      await syncMatchBatch(matchId);

      // The new PeriodEnd anchor was not part of the submitted batch snapshot
      expect(submittedAnchors).toEqual([]);

      // The presence mutated after the batch snapshot must remain unsynced; the unchanged one is marked synced.
      expect(localPresences[0].isSynced).toBe(0);
      expect(localPresences[1].isSynced).toBe(1);

      // Disciplinary exit item is cleaned up, while the nonempty period-end item and its metadata are preserved.
      expect(db.syncQueue.delete).toHaveBeenCalledWith(301);
      expect(db.syncQueue.delete).not.toHaveBeenCalledWith(302);
    });

    it("retains nonempty period-end termination metadata while the PeriodEnd anchor is still unsynced and deletes it when anchor acknowledges in a later batch", async () => {
      const matchId = "m-period-end-anchor-guard";
      const endTimestamp = "2026-11-18T10:15:00.000Z";

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi
            .fn()
            .mockResolvedValue([{ id: "lineup-active", matchId }]),
        }),
      } as never);

      const localAnchors = [
        {
          id: "anchor-period-end-1",
          matchId,
          periodNumber: 1,
          type: 1,
          timestamp: endTimestamp,
          sequenceNumber: 5,
          isSynced: 0,
        },
      ];

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockImplementation((targetMatchId: string) => ({
          filter: vi
            .fn()
            .mockImplementation(
              (predicate: (a: (typeof localAnchors)[number]) => boolean) => ({
                toArray: vi
                  .fn()
                  .mockImplementation(() =>
                    Promise.resolve(
                      localAnchors
                        .filter(
                          (a) => a.matchId === targetMatchId && predicate(a),
                        )
                        .map((a) => ({ ...a })),
                    ),
                  ),
              }),
            ),
        })),
        anyOf: vi.fn().mockImplementation((ids: string[]) => ({
          modify: vi
            .fn()
            .mockImplementation(
              (
                updater:
                  | Record<string, unknown>
                  | ((record: (typeof localAnchors)[number]) => void),
              ) => {
                for (const record of localAnchors) {
                  if (!ids.includes(record.id)) continue;
                  if (typeof updater === "function") {
                    updater(record);
                  } else {
                    Object.assign(record, updater);
                  }
                }
                return Promise.resolve(ids.length);
              },
            ),
        })),
      } as never);

      const localPresences = [
        {
          id: "pres-active",
          matchLineupId: "lineup-active",
          periodNumber: 1,
          timeIn: "2026-11-18T10:00:00.000Z",
          timeOut: endTimestamp,
          sequenceNumber: 1,
          isSynced: 0,
        },
      ];

      vi.mocked(db.playerpresences.filter).mockImplementation(((
        predicate: (p: (typeof localPresences)[number]) => boolean,
      ) => ({
        toArray: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(
              localPresences.filter(predicate).map((p) => ({ ...p })),
            ),
          ),
      })) as never);

      vi.mocked(db.playerpresences.where).mockReturnValue({
        anyOf: vi.fn().mockImplementation((ids: string[]) => ({
          toArray: vi
            .fn()
            .mockImplementation(() =>
              Promise.resolve(
                localPresences
                  .filter((p) => ids.includes(p.id))
                  .map((p) => ({ ...p })),
              ),
            ),
          modify: vi
            .fn()
            .mockImplementation(
              (
                updater:
                  | Record<string, unknown>
                  | ((record: (typeof localPresences)[number]) => void),
              ) => {
                for (const record of localPresences) {
                  if (!ids.includes(record.id)) continue;
                  if (typeof updater === "function") {
                    updater(record);
                  } else {
                    Object.assign(record, updater);
                  }
                }
                return Promise.resolve(ids.length);
              },
            ),
        })),
      } as never);

      vi.mocked(db.syncQueue.toArray).mockResolvedValue([
        {
          id: 401,
          actionType: "PUT",
          endpoint: `/Matches/${matchId}/presence/terminate`,
          payload: JSON.stringify({
            periodNumber: 1,
            playerLineupIds: ["lineup-active"],
            timeOut: endTimestamp,
          }),
          createdAt: endTimestamp,
          periodEndMeta: {
            matchId,
            periodNumber: 1,
            timeOut: endTimestamp,
            closedPresenceIds: ["pres-active"],
            closedLineupIds: ["lineup-active"],
          },
        },
      ] as never);

      // 1. Partial sync: closed presence synced, but PeriodEnd anchor still unsynced (undoable)
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: {
          syncedEventIds: [],
          syncedAnchorIds: [],
          syncedPresenceIds: ["pres-active"],
        },
      });

      await syncMatchBatch(matchId);

      expect(localPresences[0].isSynced).toBe(1);
      expect(localAnchors[0].isSynced).toBe(0);
      expect(db.syncQueue.delete).not.toHaveBeenCalledWith(401);

      // 2. Follow-up sync: presence is already synced (not resent), only PeriodEnd anchor is acknowledged
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: {
          syncedEventIds: [],
          syncedAnchorIds: ["anchor-period-end-1"],
          syncedPresenceIds: [],
        },
      });

      await syncMatchBatch(matchId);

      expect(localPresences[0].isSynced).toBe(1);
      expect(localAnchors[0].isSynced).toBe(1);
      expect(db.syncQueue.delete).toHaveBeenCalledWith(401);
    });

    it("deletes period-end termination metadata when both PeriodEnd anchor and closed presence acknowledge in a single batch", async () => {
      const matchId = "m-period-end-single-batch";
      const endTimestamp = "2026-11-18T10:15:00.000Z";

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi
            .fn()
            .mockResolvedValue([{ id: "lineup-active", matchId }]),
        }),
      } as never);

      const localAnchors = [
        {
          id: "anchor-period-end-single",
          matchId,
          periodNumber: 1,
          type: 1,
          timestamp: endTimestamp,
          sequenceNumber: 5,
          isSynced: 0,
        },
      ];

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockImplementation((targetMatchId: string) => ({
          filter: vi
            .fn()
            .mockImplementation(
              (predicate: (a: (typeof localAnchors)[number]) => boolean) => ({
                toArray: vi
                  .fn()
                  .mockImplementation(() =>
                    Promise.resolve(
                      localAnchors
                        .filter(
                          (a) => a.matchId === targetMatchId && predicate(a),
                        )
                        .map((a) => ({ ...a })),
                    ),
                  ),
              }),
            ),
        })),
        anyOf: vi.fn().mockImplementation((ids: string[]) => ({
          modify: vi
            .fn()
            .mockImplementation((updater: Record<string, unknown>) => {
              for (const record of localAnchors) {
                if (ids.includes(record.id)) {
                  Object.assign(record, updater);
                }
              }
              return Promise.resolve(ids.length);
            }),
        })),
      } as never);

      const localPresences = [
        {
          id: "pres-active",
          matchLineupId: "lineup-active",
          periodNumber: 1,
          timeIn: "2026-11-18T10:00:00.000Z",
          timeOut: endTimestamp,
          sequenceNumber: 1,
          isSynced: 0,
        },
      ];

      vi.mocked(db.playerpresences.filter).mockImplementation(((
        predicate: (p: (typeof localPresences)[number]) => boolean,
      ) => ({
        toArray: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(
              localPresences.filter(predicate).map((p) => ({ ...p })),
            ),
          ),
      })) as never);

      vi.mocked(db.playerpresences.where).mockReturnValue({
        anyOf: vi.fn().mockImplementation((ids: string[]) => ({
          toArray: vi
            .fn()
            .mockImplementation(() =>
              Promise.resolve(
                localPresences
                  .filter((p) => ids.includes(p.id))
                  .map((p) => ({ ...p })),
              ),
            ),
          modify: vi
            .fn()
            .mockImplementation(
              (
                updater:
                  | Record<string, unknown>
                  | ((record: (typeof localPresences)[number]) => void),
              ) => {
                for (const record of localPresences) {
                  if (!ids.includes(record.id)) continue;
                  if (typeof updater === "function") {
                    updater(record);
                  } else {
                    Object.assign(record, updater);
                  }
                }
                return Promise.resolve(ids.length);
              },
            ),
        })),
      } as never);

      vi.mocked(db.syncQueue.toArray).mockResolvedValue([
        {
          id: 402,
          actionType: "PUT",
          endpoint: `/Matches/${matchId}/presence/terminate`,
          payload: JSON.stringify({
            periodNumber: 1,
            playerLineupIds: ["lineup-active"],
            timeOut: endTimestamp,
          }),
          createdAt: endTimestamp,
          periodEndMeta: {
            matchId,
            periodNumber: 1,
            timeOut: endTimestamp,
            closedPresenceIds: ["pres-active"],
            closedLineupIds: ["lineup-active"],
          },
        },
      ] as never);

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: {
          syncedEventIds: [],
          syncedAnchorIds: ["anchor-period-end-single"],
          syncedPresenceIds: ["pres-active"],
        },
      });

      await syncMatchBatch(matchId);

      expect(localPresences[0].isSynced).toBe(1);
      expect(localAnchors[0].isSynced).toBe(1);
      expect(db.syncQueue.delete).toHaveBeenCalledWith(402);
    });

    it("retains period-end termination metadata when a newer unsynced PeriodEnd anchor exists locally during batch cleanup", async () => {
      const matchId = "m-period-end-concurrent-reend";
      const firstEndTimestamp = "2026-11-18T10:15:00.000Z";
      const secondEndTimestamp = "2026-11-18T10:16:00.000Z";

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi
            .fn()
            .mockResolvedValue([{ id: "lineup-active", matchId }]),
        }),
      } as never);

      const localAnchors = [
        {
          id: "anchor-period-end-old",
          matchId,
          periodNumber: 1,
          type: 1,
          timestamp: firstEndTimestamp,
          sequenceNumber: 5,
          isSynced: 0,
        },
      ];

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockImplementation((targetMatchId: string) => ({
          filter: vi
            .fn()
            .mockImplementation(
              (predicate: (a: (typeof localAnchors)[number]) => boolean) => ({
                toArray: vi
                  .fn()
                  .mockImplementation(() =>
                    Promise.resolve(
                      localAnchors
                        .filter(
                          (a) => a.matchId === targetMatchId && predicate(a),
                        )
                        .map((a) => ({ ...a })),
                    ),
                  ),
              }),
            ),
        })),
        anyOf: vi.fn().mockImplementation((ids: string[]) => ({
          modify: vi
            .fn()
            .mockImplementation((updater: Record<string, unknown>) => {
              for (const record of localAnchors) {
                if (ids.includes(record.id)) {
                  Object.assign(record, updater);
                }
              }
              return Promise.resolve(ids.length);
            }),
        })),
      } as never);

      const localPresences = [
        {
          id: "pres-active",
          matchLineupId: "lineup-active",
          periodNumber: 1,
          timeIn: "2026-11-18T10:00:00.000Z",
          timeOut: firstEndTimestamp,
          sequenceNumber: 1,
          isSynced: 0,
        },
      ];

      vi.mocked(db.playerpresences.filter).mockImplementation(((
        predicate: (p: (typeof localPresences)[number]) => boolean,
      ) => ({
        toArray: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(
              localPresences.filter(predicate).map((p) => ({ ...p })),
            ),
          ),
      })) as never);

      vi.mocked(db.playerpresences.where).mockReturnValue({
        anyOf: vi.fn().mockImplementation((ids: string[]) => ({
          toArray: vi
            .fn()
            .mockImplementation(() =>
              Promise.resolve(
                localPresences
                  .filter((p) => ids.includes(p.id))
                  .map((p) => ({ ...p })),
              ),
            ),
          modify: vi
            .fn()
            .mockImplementation(
              (
                updater:
                  | Record<string, unknown>
                  | ((record: (typeof localPresences)[number]) => void),
              ) => {
                for (const record of localPresences) {
                  if (!ids.includes(record.id)) continue;
                  if (typeof updater === "function") {
                    updater(record);
                  } else {
                    Object.assign(record, updater);
                  }
                }
                return Promise.resolve(ids.length);
              },
            ),
        })),
      } as never);

      vi.mocked(db.syncQueue.toArray).mockResolvedValue([
        {
          id: 403,
          actionType: "PUT",
          endpoint: `/Matches/${matchId}/presence/terminate`,
          payload: JSON.stringify({
            periodNumber: 1,
            playerLineupIds: ["lineup-active"],
            timeOut: secondEndTimestamp,
          }),
          createdAt: secondEndTimestamp,
          periodEndMeta: {
            matchId,
            periodNumber: 1,
            timeOut: secondEndTimestamp,
            closedPresenceIds: ["pres-active"],
            closedLineupIds: ["lineup-active"],
          },
        },
      ] as never);

      // While batch is in-flight, user undid old PeriodEnd and ended period again with a new unsynced anchor
      vi.mocked(apiClient.post).mockImplementationOnce(async () => {
        localAnchors.splice(0, localAnchors.length, {
          id: "anchor-period-end-new",
          matchId,
          periodNumber: 1,
          type: 1,
          timestamp: secondEndTimestamp,
          sequenceNumber: 6,
          isSynced: 0,
        });
        localPresences[0].timeOut = secondEndTimestamp;
        localPresences[0].isSynced = 0;

        return {
          data: {
            syncedEventIds: [],
            syncedAnchorIds: ["anchor-period-end-old"],
            syncedPresenceIds: ["pres-active"],
          },
        };
      });

      await syncMatchBatch(matchId);

      expect(localPresences[0].isSynced).toBe(0);
      expect(localAnchors[0].isSynced).toBe(0);
      expect(db.syncQueue.delete).not.toHaveBeenCalledWith(403);
    });

    it("keeps non-period-end PUT /presence/terminate queue item for retry when no submitted presence matches its timeOut", async () => {
      const matchId = "m-concurrent-disciplinary-exit";
      const exitTimestamp = "2026-11-18T10:12:00.000Z";

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi
            .fn()
            .mockResolvedValue([{ id: "lineup-active", matchId }]),
        }),
      } as never);

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
        anyOf: vi.fn().mockReturnValue({ modify: vi.fn() }),
      } as never);

      const localPresences = [
        {
          id: "pres-active",
          matchLineupId: "lineup-active",
          periodNumber: 1,
          timeIn: "2026-11-18T10:00:00.000Z",
          timeOut: null as string | null,
          sequenceNumber: 1,
          isSynced: 0,
        },
      ];

      vi.mocked(db.playerpresences.filter).mockReturnValue({
        toArray: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(localPresences.map((p) => ({ ...p }))),
          ),
      } as never);

      vi.mocked(db.playerpresences.where).mockReturnValue({
        anyOf: vi.fn().mockImplementation((ids: string[]) => ({
          modify: vi
            .fn()
            .mockImplementation(
              (
                updater:
                  | Record<string, unknown>
                  | ((record: (typeof localPresences)[number]) => void),
              ) => {
                for (const record of localPresences) {
                  if (!ids.includes(record.id)) continue;
                  if (typeof updater === "function") {
                    updater(record);
                  } else {
                    Object.assign(record, updater);
                  }
                }
                return Promise.resolve(ids.length);
              },
            ),
        })),
      } as never);

      const queueItems: Record<string, unknown>[] = [];
      vi.mocked(db.syncQueue.toArray).mockImplementation(
        () => Promise.resolve([...queueItems]) as never,
      );

      // While batch is in-flight, player is exited via disciplinary removal (no periodEndMeta)
      vi.mocked(apiClient.post).mockImplementationOnce(async () => {
        localPresences[0].timeOut = exitTimestamp;
        localPresences[0].isSynced = 0;
        queueItems.push({
          id: 501,
          actionType: "PUT",
          endpoint: `/Matches/${matchId}/presence/terminate`,
          payload: JSON.stringify({
            periodNumber: 1,
            playerLineupIds: ["lineup-active"],
            timeOut: exitTimestamp,
          }),
          createdAt: exitTimestamp,
        });

        return {
          data: {
            syncedEventIds: [],
            syncedAnchorIds: [],
            syncedPresenceIds: ["pres-active"],
          },
        };
      });

      await syncMatchBatch(matchId);

      // Mutated presence must stay unsynced, and termination item without matching close time must stay queued
      expect(localPresences[0].isSynced).toBe(0);
      expect(db.syncQueue.delete).not.toHaveBeenCalledWith(501);
    });

    it("keeps re-entered presence unsynced and retains period-end queue item after earlier exit syncs and period-end PUT fails", async () => {
      const matchId = "m-reentry-failed-period-end";
      const earlierExitTime = "2026-11-18T10:03:00.000Z";
      const reEntryTime = "2026-11-18T10:05:00.000Z";
      const periodEndTime = "2026-11-18T10:10:00.000Z";

      const localPresences = [
        {
          id: "pres-earlier-exit",
          matchLineupId: "lineup-1",
          periodNumber: 1,
          timeIn: "2026-11-18T10:00:00.000Z",
          timeOut: earlierExitTime,
          sequenceNumber: 1,
          isSynced: 0,
        },
        {
          id: "pres-reentered",
          matchLineupId: "lineup-1",
          periodNumber: 1,
          timeIn: reEntryTime,
          timeOut: periodEndTime,
          sequenceNumber: 2,
          isSynced: 0,
        },
      ];

      const localAnchors = [
        {
          id: "anchor-period-end-1",
          matchId,
          periodNumber: 1,
          type: 1,
          timestamp: periodEndTime,
          sequenceNumber: 3,
          isSynced: 1,
        },
      ];

      const queueItems = [
        {
          id: 601,
          actionType: "PUT",
          endpoint: `/Matches/${matchId}/presence/terminate`,
          payload: JSON.stringify({
            periodNumber: 1,
            playerLineupIds: ["lineup-1"],
            timeOut: earlierExitTime,
          }),
          createdAt: earlierExitTime,
        },
        {
          id: 602,
          actionType: "POST",
          endpoint: `/Matches/${matchId}/presence/initialize`,
          payload: JSON.stringify({
            periodNumber: 1,
            timeIn: reEntryTime,
            presenceItems: [
              { id: "pres-reentered", matchLineupId: "lineup-1" },
            ],
          }),
          createdAt: reEntryTime,
        },
        {
          id: 603,
          actionType: "PUT",
          endpoint: `/Matches/${matchId}/presence/terminate`,
          payload: JSON.stringify({
            periodNumber: 1,
            playerLineupIds: ["lineup-1"],
            timeOut: periodEndTime,
          }),
          createdAt: periodEndTime,
          periodEndMeta: {
            matchId,
            periodNumber: 1,
            timeOut: periodEndTime,
            closedPresenceIds: ["pres-reentered"],
            closedLineupIds: ["lineup-1"],
          },
        },
      ];

      vi.mocked(db.syncQueue.orderBy).mockReturnValue({
        toArray: vi.fn().mockImplementation(() => Promise.resolve([...queueItems])),
      } as never);
      vi.mocked(db.syncQueue.toArray).mockImplementation(
        () => Promise.resolve([...queueItems]) as never,
      );
      vi.mocked(db.syncQueue.delete).mockImplementation((async (id: number) => {
        const idx = queueItems.findIndex((item) => item.id === id);
        if (idx !== -1) queueItems.splice(idx, 1);
      }) as never);

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([{ id: "lineup-1", matchId }]),
        }),
      } as never);

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi.fn().mockImplementation((predicate: (a: (typeof localAnchors)[number]) => boolean) => ({
            toArray: vi.fn().mockResolvedValue(localAnchors.filter(predicate)),
          })),
        }),
        anyOf: vi.fn().mockReturnValue({ modify: vi.fn() }),
      } as never);

      vi.mocked(db.playerpresences.filter).mockImplementation(((
        predicate: (p: (typeof localPresences)[number]) => boolean,
      ) => ({
        toArray: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(
              localPresences.filter(predicate).map((p) => ({ ...p })),
            ),
          ),
      })) as never);

      vi.mocked(db.playerpresences.where).mockImplementation(((field: string) => {
        if (field === "periodNumber") {
          return {
            equals: vi.fn().mockImplementation((period: number) => ({
              filter: vi.fn().mockImplementation(
                (predicate: (p: (typeof localPresences)[number]) => boolean) => ({
                  modify: vi
                    .fn()
                    .mockImplementation((changes: Record<string, unknown>) => {
                      for (const record of localPresences) {
                        if (record.periodNumber === period && predicate(record)) {
                          Object.assign(record, changes);
                        }
                      }
                      return Promise.resolve(1);
                    }),
                }),
              ),
            })),
          };
        }

        return {
          anyOf: vi.fn().mockImplementation((ids: string[]) => ({
            toArray: vi
              .fn()
              .mockImplementation(() =>
                Promise.resolve(
                  localPresences
                    .filter((p) => ids.includes(p.id))
                    .map((p) => ({ ...p })),
                ),
              ),
            modify: vi
              .fn()
              .mockImplementation(
                (
                  updater:
                    | Record<string, unknown>
                    | ((record: (typeof localPresences)[number]) => void),
                ) => {
                  for (const record of localPresences) {
                    if (!ids.includes(record.id)) continue;
                    if (typeof updater === "function") {
                      updater(record);
                    } else {
                      Object.assign(record, updater);
                    }
                  }
                  return Promise.resolve(ids.length);
                },
              ),
          })),
        };
      }) as never);

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      // Manual sync: earlier exit PUT succeeds, re-entry POST succeeds, period-end PUT fails transiently
      vi.mocked(apiClient.put)
        .mockResolvedValueOnce({ status: 200 })
        .mockRejectedValueOnce(new Error("Network timeout on period-end PUT"));
      vi.mocked(apiClient.post).mockResolvedValueOnce({ status: 201 });

      const processed = await processSyncQueue();
      expect(processed).toBe(2);

      // Earlier exit is synced, but re-entered presence closed at period end MUST remain unsynced
      expect(localPresences[0].isSynced).toBe(1);
      expect(localPresences[1].isSynced).toBe(0);
      expect(queueItems.map((q) => q.id)).toEqual([603]);

      // Subsequent syncMatchBatch must still include pres-reentered and keep item 603 if not acknowledged
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: {
          syncedEventIds: [],
          syncedAnchorIds: [],
          syncedPresenceIds: [],
        },
      });

      await syncMatchBatch(matchId);

      expect(apiClient.post).toHaveBeenLastCalledWith(
        `/Matches/${matchId}/sync-batch`,
        expect.objectContaining({
          presences: [
            expect.objectContaining({
              id: "pres-reentered",
              timeIn: reEntryTime,
              timeOut: periodEndTime,
            }),
          ],
        }),
      );
      expect(localPresences[1].isSynced).toBe(0);
      expect(queueItems.map((q) => q.id)).toEqual([603]);

      // Once syncMatchBatch acknowledges pres-reentered, item 603 is safely deleted
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: {
          syncedEventIds: [],
          syncedAnchorIds: [],
          syncedPresenceIds: ["pres-reentered"],
        },
      });

      await syncMatchBatch(matchId);

      expect(localPresences[1].isSynced).toBe(1);
      expect(queueItems).toEqual([]);

      consoleWarnSpy.mockRestore();
    });

    it("keeps re-entered presence unsynced and retains period-end queue item even when earlier exit and period-end share the exact same timeOut", async () => {
      const matchId = "m-equal-timeout-reentry";
      const equalExitTime = "2026-11-18T10:10:00.000Z";

      const localPresences = [
        {
          id: "pres-earlier-exit",
          matchLineupId: "lineup-1",
          periodNumber: 1,
          timeIn: "2026-11-18T10:00:00.000Z",
          timeOut: equalExitTime,
          sequenceNumber: 1,
          isSynced: 0,
        },
        {
          id: "pres-reentered",
          matchLineupId: "lineup-1",
          periodNumber: 1,
          timeIn: equalExitTime,
          timeOut: equalExitTime,
          sequenceNumber: 2,
          isSynced: 0,
        },
      ];

      const localAnchors = [
        {
          id: "anchor-period-end-1",
          matchId,
          periodNumber: 1,
          type: 1,
          timestamp: equalExitTime,
          sequenceNumber: 3,
          isSynced: 1,
        },
      ];

      const queueItems = [
        {
          id: 701,
          actionType: "PUT",
          endpoint: `/Matches/${matchId}/presence/terminate`,
          payload: JSON.stringify({
            periodNumber: 1,
            playerLineupIds: ["lineup-1"],
            timeOut: equalExitTime,
          }),
          createdAt: equalExitTime,
          closedPresenceIds: ["pres-earlier-exit"],
        },
        {
          id: 702,
          actionType: "POST",
          endpoint: `/Matches/${matchId}/presence/initialize`,
          payload: JSON.stringify({
            periodNumber: 1,
            timeIn: equalExitTime,
            presenceItems: [
              { id: "pres-reentered", matchLineupId: "lineup-1" },
            ],
          }),
          createdAt: equalExitTime,
        },
        {
          id: 703,
          actionType: "PUT",
          endpoint: `/Matches/${matchId}/presence/terminate`,
          payload: JSON.stringify({
            periodNumber: 1,
            playerLineupIds: ["lineup-1"],
            timeOut: equalExitTime,
          }),
          createdAt: equalExitTime,
          periodEndMeta: {
            matchId,
            periodNumber: 1,
            timeOut: equalExitTime,
            closedPresenceIds: ["pres-reentered"],
            closedLineupIds: ["lineup-1"],
          },
        },
      ];

      vi.mocked(db.syncQueue.orderBy).mockReturnValue({
        toArray: vi
          .fn()
          .mockImplementation(() => Promise.resolve([...queueItems])),
      } as never);
      vi.mocked(db.syncQueue.toArray).mockImplementation(
        () => Promise.resolve([...queueItems]) as never,
      );
      vi.mocked(db.syncQueue.delete).mockImplementation((async (id: number) => {
        const idx = queueItems.findIndex((item) => item.id === id);
        if (idx !== -1) queueItems.splice(idx, 1);
      }) as never);

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([{ id: "lineup-1", matchId }]),
        }),
      } as never);

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi
            .fn()
            .mockImplementation(
              (predicate: (a: (typeof localAnchors)[number]) => boolean) => ({
                toArray: vi
                  .fn()
                  .mockResolvedValue(localAnchors.filter(predicate)),
              }),
            ),
        }),
        anyOf: vi.fn().mockReturnValue({ modify: vi.fn() }),
      } as never);

      vi.mocked(db.playerpresences.filter).mockImplementation(((
        predicate: (p: (typeof localPresences)[number]) => boolean,
      ) => ({
        toArray: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(
              localPresences.filter(predicate).map((p) => ({ ...p })),
            ),
          ),
      })) as never);

      vi.mocked(db.playerpresences.where).mockImplementation(((
        field: string,
      ) => {
        if (field === "periodNumber") {
          return {
            equals: vi.fn().mockImplementation((period: number) => ({
              filter: vi
                .fn()
                .mockImplementation(
                  (
                    predicate: (p: (typeof localPresences)[number]) => boolean,
                  ) => ({
                    modify: vi
                      .fn()
                      .mockImplementation(
                        (changes: Record<string, unknown>) => {
                          for (const record of localPresences) {
                            if (
                              record.periodNumber === period &&
                              predicate(record)
                            ) {
                              Object.assign(record, changes);
                            }
                          }
                          return Promise.resolve(1);
                        },
                      ),
                  }),
                ),
            })),
          };
        }

        return {
          anyOf: vi.fn().mockImplementation((ids: string[]) => ({
            toArray: vi
              .fn()
              .mockImplementation(() =>
                Promise.resolve(
                  localPresences
                    .filter((p) => ids.includes(p.id))
                    .map((p) => ({ ...p })),
                ),
              ),
            modify: vi
              .fn()
              .mockImplementation(
                (
                  updater:
                    | Record<string, unknown>
                    | ((record: (typeof localPresences)[number]) => void),
                ) => {
                  for (const record of localPresences) {
                    if (!ids.includes(record.id)) continue;
                    if (typeof updater === "function") {
                      updater(record);
                    } else {
                      Object.assign(record, updater);
                    }
                  }
                  return Promise.resolve(ids.length);
                },
              ),
          })),
        };
      }) as never);

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      // Earlier exit PUT and re-entry POST succeed, period-end PUT fails transiently
      vi.mocked(apiClient.put)
        .mockResolvedValueOnce({ status: 200 })
        .mockRejectedValueOnce(new Error("Network timeout on period-end PUT"));
      vi.mocked(apiClient.post).mockResolvedValueOnce({ status: 201 });

      const processed = await processSyncQueue();
      expect(processed).toBe(2);

      // Even with identical timeOut, closedPresenceIds isolates pres-earlier-exit from pres-reentered
      expect(localPresences[0].isSynced).toBe(1);
      expect(localPresences[1].isSynced).toBe(0);
      expect(queueItems.map((q) => q.id)).toEqual([703]);

      // Subsequent syncMatchBatch still submits pres-reentered and retains item 703 until acknowledged
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: {
          syncedEventIds: [],
          syncedAnchorIds: [],
          syncedPresenceIds: [],
        },
      });

      await syncMatchBatch(matchId);

      expect(apiClient.post).toHaveBeenLastCalledWith(
        `/Matches/${matchId}/sync-batch`,
        expect.objectContaining({
          presences: [
            expect.objectContaining({
              id: "pres-reentered",
              timeIn: equalExitTime,
              timeOut: equalExitTime,
            }),
          ],
        }),
      );
      expect(localPresences[1].isSynced).toBe(0);
      expect(queueItems.map((q) => q.id)).toEqual([703]);

      consoleWarnSpy.mockRestore();
    });

    it("keeps re-entered presence unsynced and retains period-end queue item when earlier substitution and period-end share the exact same timestamp", async () => {
      const matchId = "m-equal-timestamp-sub-reentry";
      const equalTimestamp = "2026-11-18T10:10:00.000Z";

      const localPresences = [
        {
          id: "pres-sub-out",
          matchLineupId: "lineup-1",
          periodNumber: 1,
          timeIn: "2026-11-18T10:00:00.000Z",
          timeOut: equalTimestamp,
          sequenceNumber: 1,
          isSynced: 0,
        },
        {
          id: "pres-sub-in",
          matchLineupId: "lineup-2",
          periodNumber: 1,
          timeIn: equalTimestamp,
          timeOut: null as string | null,
          sequenceNumber: 2,
          isSynced: 0,
        },
        {
          id: "pres-reentered",
          matchLineupId: "lineup-1",
          periodNumber: 1,
          timeIn: equalTimestamp,
          timeOut: equalTimestamp,
          sequenceNumber: 3,
          isSynced: 0,
        },
      ];

      const localAnchors = [
        {
          id: "anchor-period-end-1",
          matchId,
          periodNumber: 1,
          type: 1,
          timestamp: equalTimestamp,
          sequenceNumber: 4,
          isSynced: 1,
        },
      ];

      const queueItems = [
        {
          id: 801,
          actionType: "POST",
          endpoint: `/Matches/${matchId}/substitutions`,
          payload: JSON.stringify({
            periodNumber: 1,
            playerOutLineupId: "lineup-1",
            playerInLineupId: "lineup-2",
            incomingPresenceId: "pres-sub-in",
            substitutionTime: equalTimestamp,
          }),
          createdAt: equalTimestamp,
          closedPresenceIds: ["pres-sub-out"],
        },
        {
          id: 802,
          actionType: "POST",
          endpoint: `/Matches/${matchId}/presence/initialize`,
          payload: JSON.stringify({
            periodNumber: 1,
            timeIn: equalTimestamp,
            presenceItems: [
              { id: "pres-reentered", matchLineupId: "lineup-1" },
            ],
          }),
          createdAt: equalTimestamp,
        },
        {
          id: 803,
          actionType: "PUT",
          endpoint: `/Matches/${matchId}/presence/terminate`,
          payload: JSON.stringify({
            periodNumber: 1,
            playerLineupIds: ["lineup-1"],
            timeOut: equalTimestamp,
          }),
          createdAt: equalTimestamp,
          periodEndMeta: {
            matchId,
            periodNumber: 1,
            timeOut: equalTimestamp,
            closedPresenceIds: ["pres-reentered"],
            closedLineupIds: ["lineup-1"],
          },
        },
      ];

      vi.mocked(db.syncQueue.orderBy).mockReturnValue({
        toArray: vi
          .fn()
          .mockImplementation(() => Promise.resolve([...queueItems])),
      } as never);
      vi.mocked(db.syncQueue.toArray).mockImplementation(
        () => Promise.resolve([...queueItems]) as never,
      );
      vi.mocked(db.syncQueue.delete).mockImplementation((async (id: number) => {
        const idx = queueItems.findIndex((item) => item.id === id);
        if (idx !== -1) queueItems.splice(idx, 1);
      }) as never);

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { id: "lineup-1", matchId },
            { id: "lineup-2", matchId },
          ]),
        }),
      } as never);

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi
            .fn()
            .mockImplementation(
              (predicate: (a: (typeof localAnchors)[number]) => boolean) => ({
                toArray: vi
                  .fn()
                  .mockResolvedValue(localAnchors.filter(predicate)),
              }),
            ),
        }),
        anyOf: vi.fn().mockReturnValue({ modify: vi.fn() }),
      } as never);

      vi.mocked(db.playerpresences.filter).mockImplementation(((
        predicate: (p: (typeof localPresences)[number]) => boolean,
      ) => ({
        toArray: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(
              localPresences.filter(predicate).map((p) => ({ ...p })),
            ),
          ),
      })) as never);

      vi.mocked(db.playerpresences.where).mockImplementation(((
        field: string,
      ) => {
        if (field === "periodNumber") {
          return {
            equals: vi.fn().mockImplementation((period: number) => ({
              filter: vi
                .fn()
                .mockImplementation(
                  (
                    predicate: (p: (typeof localPresences)[number]) => boolean,
                  ) => ({
                    modify: vi
                      .fn()
                      .mockImplementation(
                        (changes: Record<string, unknown>) => {
                          for (const record of localPresences) {
                            if (
                              record.periodNumber === period &&
                              predicate(record)
                            ) {
                              Object.assign(record, changes);
                            }
                          }
                          return Promise.resolve(1);
                        },
                      ),
                  }),
                ),
            })),
          };
        }

        return {
          anyOf: vi.fn().mockImplementation((ids: string[]) => ({
            toArray: vi
              .fn()
              .mockImplementation(() =>
                Promise.resolve(
                  localPresences
                    .filter((p) => ids.includes(p.id))
                    .map((p) => ({ ...p })),
                ),
              ),
            modify: vi
              .fn()
              .mockImplementation(
                (
                  updater:
                    | Record<string, unknown>
                    | ((record: (typeof localPresences)[number]) => void),
                ) => {
                  for (const record of localPresences) {
                    if (!ids.includes(record.id)) continue;
                    if (typeof updater === "function") {
                      updater(record);
                    } else {
                      Object.assign(record, updater);
                    }
                  }
                  return Promise.resolve(ids.length);
                },
              ),
          })),
        };
      }) as never);

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      // Substitution POST and re-entry POST succeed, period-end PUT fails transiently
      vi.mocked(apiClient.post)
        .mockResolvedValueOnce({ status: 201 })
        .mockResolvedValueOnce({ status: 201 });
      vi.mocked(apiClient.put).mockRejectedValueOnce(
        new Error("Network timeout on period-end PUT"),
      );

      const processed = await processSyncQueue();
      expect(processed).toBe(2);

      // Substitution marks pres-sub-out and pres-sub-in synced, while pres-reentered MUST stay unsynced
      expect(localPresences[0].isSynced).toBe(1);
      expect(localPresences[1].isSynced).toBe(1);
      expect(localPresences[2].isSynced).toBe(0);
      expect(queueItems.map((q) => q.id)).toEqual([803]);

      // Subsequent syncMatchBatch still submits pres-reentered and retains item 803 until acknowledged
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: {
          syncedEventIds: [],
          syncedAnchorIds: [],
          syncedPresenceIds: [],
        },
      });

      await syncMatchBatch(matchId);

      expect(apiClient.post).toHaveBeenLastCalledWith(
        `/Matches/${matchId}/sync-batch`,
        expect.objectContaining({
          presences: [
            expect.objectContaining({
              id: "pres-reentered",
              timeIn: equalTimestamp,
              timeOut: equalTimestamp,
            }),
          ],
        }),
      );
      expect(localPresences[2].isSynced).toBe(0);
      expect(queueItems.map((q) => q.id)).toEqual([803]);

      consoleWarnSpy.mockRestore();
    });

    it("processSyncQueue claims PeriodEnd anchor during in-flight POST and skips sending when anchor is claimed by undo", async () => {
      const { anchorClaimService } = await import(
        "../../services/anchorClaimService"
      );
      const anchorId = "anchor-claim-race-1";
      const anchorQueueItem = {
        id: 901,
        actionType: "POST" as const,
        endpoint: "/Matches/m-claim-race/anchors",
        payload: JSON.stringify([
          {
            id: anchorId,
            periodNumber: 1,
            type: 1,
            timestamp: "2026-11-19T10:10:00.000Z",
          },
        ]),
        createdAt: "2026-11-19T10:10:00.000Z",
      };

      vi.mocked(db.syncQueue.orderBy).mockReturnValue({
        toArray: vi.fn().mockResolvedValue([anchorQueueItem]),
      } as never);

      // 1. When Undo holds the claim, processSyncQueue must NOT send the POST
      anchorClaimService.claim(anchorId, "undo");
      try {
        const syncedWhileUndoClaimed = await processSyncQueue("m-claim-race");
        expect(syncedWhileUndoClaimed).toBe(0);
        expect(apiClient.post).not.toHaveBeenCalled();
      } finally {
        anchorClaimService.release(anchorId, "undo");
      }

      // 2. When unclaimed, processSyncQueue claims the anchor while POST is in-flight and releases after
      let wasClaimedDuringPost = false;
      vi.mocked(apiClient.post).mockImplementationOnce(async () => {
        wasClaimedDuringPost = anchorClaimService.isClaimed(anchorId);
        return { status: 200 };
      });

      const syncedCount = await processSyncQueue("m-claim-race");
      expect(syncedCount).toBe(1);
      expect(wasClaimedDuringPost).toBe(true);
      expect(anchorClaimService.isClaimed(anchorId)).toBe(false);
    });
  });
});
