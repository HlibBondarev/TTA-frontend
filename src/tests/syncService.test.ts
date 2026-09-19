import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { processSyncQueue } from "../services/syncService";
import { db } from "../db/ttaDatabase";
import { apiClient } from "../api/client";

vi.mock("../api/client", () => ({
  apiClient: {
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../db/ttaDatabase", () => ({
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
    },
    playerrosters: {
      get: vi.fn().mockResolvedValue(undefined),
    },
    syncQueue: {
      orderBy: vi.fn(),
      delete: vi.fn(),
    },
    playerpresences: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            modify: vi.fn(),
          }),
        }),
      }),
    },
    gameevents: {
      where: vi.fn().mockReturnValue({
        anyOf: vi.fn().mockReturnValue({
          modify: vi.fn(),
        }),
      }),
    },
    timeanchors: {
      where: vi.fn().mockReturnValue({
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

    // Attempt 1: Dexie finalization write fails inside transaction callback
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

    // Attempt 2: Re-run sync (Simulating retry)
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

    await processSyncQueue();

    expect(apiClient.post).toHaveBeenCalled();
    expect(filterPredicate).toBeDefined();
    if (filterPredicate) {
      expect(
        filterPredicate({
          matchLineupId: "lineup-1",
          timeIn: 10,
          timeOut: 20,
        }),
      ).toBe(true);
      expect(
        filterPredicate({
          matchLineupId: "lineup-2",
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
          matchLineupId: "lineup-out",
          timeIn: 10,
          timeOut: 20,
        }),
      ).toBe(true);
      expect(
        filterPredicate({
          matchLineupId: "lineup-in",
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
    // Verify that despite two separate fallback requests (id: 3 and id: 5), DB is queried only once thanks to matchRecordCache
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
    // Two separate requests (POST and PUT) - DB is queried only once for the first request, and the null result is cached
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
});
