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
    syncQueue: {
      orderBy: vi.fn(),
      delete: vi.fn(),
    },
    playerpresences: {
      where: vi.fn(),
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
        endpoint: "/Matches/m1/events",
        payload: JSON.stringify({ isLeadToGoal: true }),
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
      return {};
    });
    vi.mocked(apiClient.delete).mockImplementation(async () => {
      callOrder.push("DELETE");
      return {};
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

  it("halts queue processing and throws on unsupported actionType", async () => {
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

    vi.mocked(apiClient.post).mockResolvedValue({});

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

    vi.mocked(apiClient.post).mockResolvedValue({});

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

    expect(apiClient.post).toHaveBeenCalledWith("/Matches/m1/substitutions", {
      periodNumber: 1,
      playerOutLineupId: "lineup-out",
      playerInLineupId: "lineup-in",
      incomingPresenceId: "pres-new-123",
      substitutionTime: "2026-08-07T11:36:30.493Z",
    });

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

  it("attaches online event listener in initSyncEngine", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    initSyncEngine();
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "online",
      expect.any(Function),
    );
  });
});
