import { describe, it, expect, vi, beforeEach } from "vitest";
import { processSyncQueue, initSyncEngine } from "../services/syncService";
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
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
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
    vi.mocked(db.transaction).mockImplementationOnce(
      () =>
        Promise.reject(
          new Error("IndexedDB Transaction Aborted"),
        ) as unknown as ReturnType<typeof db.transaction>,
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Attempt 1: Dexie finalization fails, queue item retained
    const processedRun1 = await processSyncQueue();

    expect(processedRun1).toBe(0);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/m1/anchors",
      [{ id: "anchor-retry-1", periodNumber: 1, type: 0 }],
      { headers: { "X-Idempotency-Key": "sync-batch-101" } },
    );

    // Attempt 2: Re-run sync (Simulating retry)
    vi.mocked(db.transaction).mockImplementationOnce((...args: unknown[]) => {
      const cb = args[args.length - 1] as () => Promise<unknown>;
      return cb() as unknown as ReturnType<typeof db.transaction>;
    });
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

  it("retains items in syncQueue when response status is not in 2xx range", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/anchors",
        payload: JSON.stringify([{ id: "anchor-1", type: 0 }]),
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({ status: 400 });

    const processed = await processSyncQueue();

    expect(processed).toBe(0);
    expect(db.syncQueue.delete).not.toHaveBeenCalled();
  });

  it("retains items in syncQueue and halts execution when batched HTTP request fails", async () => {
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
    vi.mocked(db.transaction).mockImplementationOnce(
      () =>
        Promise.reject(
          new Error("IndexedDB Transaction Aborted"),
        ) as unknown as ReturnType<typeof db.transaction>,
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const processed = await processSyncQueue();

    expect(processed).toBe(0);
    expect(db.syncQueue.delete).not.toHaveBeenCalled();

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

  it("attaches online event listener in initSyncEngine", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    initSyncEngine();
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "online",
      expect.any(Function),
    );
  });
});
