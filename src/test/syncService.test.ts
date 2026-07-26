import { describe, it, expect, vi, beforeEach } from "vitest";
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

  it("processes multi-item queue in FIFO order and deletes synced items", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/events",
        payload: JSON.stringify({ isLeadToGoal: true }),
        createdAt: "",
      },
      {
        id: 2,
        actionType: "PUT",
        endpoint: "/Matches/m1/presence",
        payload: JSON.stringify({
          periodNumber: 1,
          playerLineupIds: ["lineup-1"],
        }),
        createdAt: "",
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
    vi.mocked(apiClient.put).mockImplementation(async () => {
      callOrder.push("PUT");
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
    expect(callOrder).toEqual(["POST", "PUT"]);
    expect(processed).toBe(2);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/m1/events",
      expect.objectContaining({ isLeadToGoal: true }),
    );
    expect(apiClient.put).toHaveBeenCalledWith(
      "/Matches/m1/presence",
      expect.objectContaining({ periodNumber: 1 }),
    );
    expect(db.syncQueue.delete).toHaveBeenCalledWith(1);
    expect(db.syncQueue.delete).toHaveBeenCalledWith(2);
  });

  it("marks presences as synced only for affected lineup IDs in payload", async () => {
    const mockItems = [
      {
        id: 10,
        actionType: "POST",
        endpoint: "/Matches/m1/presence",
        payload: JSON.stringify({
          periodNumber: 2,
          playerLineupIds: ["lineup-100"],
        }),
        createdAt: "",
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
    const mockEquals = vi.fn().mockReturnValue({ filter: mockFilter });

    vi.mocked(db.playerpresences.where).mockReturnValue({
      equals: mockEquals,
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    await processSyncQueue();

    expect(mockEquals).toHaveBeenCalledWith(2);
    expect(filterPredicate).toBeDefined();

    if (filterPredicate) {
      expect(
        filterPredicate({
          matchLineupId: "lineup-100",
          timeIn: 100,
          timeOut: 200,
        }),
      ).toBe(true);

      expect(
        filterPredicate({
          matchLineupId: "lineup-999",
          timeIn: 100,
          timeOut: 200,
        }),
      ).toBe(false);

      expect(
        filterPredicate({
          matchLineupId: "lineup-100",
          timeIn: 100,
          timeOut: null,
        }),
      ).toBe(false);

      expect(
        filterPredicate({
          matchLineupId: "lineup-100",
          timeIn: null,
          timeOut: 200,
        }),
      ).toBe(false);
    }

    expect(mockModify).toHaveBeenCalledWith({ isSynced: 1 });
  });
});
