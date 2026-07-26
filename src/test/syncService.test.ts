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

  it("processes queue items in FIFO order and deletes synced items", async () => {
    const mockItems = [
      {
        id: 1,
        actionType: "POST",
        endpoint: "/Matches/m1/events",
        payload: JSON.stringify({ isLeadToGoal: true }),
        createdAt: "",
      },
    ];

    vi.mocked(db.syncQueue.orderBy).mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockItems),
    } as unknown as ReturnType<typeof db.syncQueue.orderBy>);

    vi.mocked(apiClient.post).mockResolvedValue({});

    const processed = await processSyncQueue();

    expect(processed).toBe(1);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/m1/events",
      expect.objectContaining({ isLeadToGoal: true }),
    );
    expect(db.syncQueue.delete).toHaveBeenCalledWith(1);
  });
});
