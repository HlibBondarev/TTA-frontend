import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SyncStatusBadge } from "../components/SyncStatusBadge";
import { db } from "../../../db/ttaDatabase";
import { processSyncQueue } from "../../../services/syncService";

vi.mock("../../../services/syncService", () => ({
  processSyncQueue: vi.fn().mockResolvedValue(0),
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    syncQueue: {
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

vi.mock("dexie", () => ({
  liveQuery: (fn: () => Promise<number>) => ({
    subscribe: (observer: {
      next: (val: number) => void;
      error: (err: unknown) => void;
    }) => {
      fn()
        .then((count) => observer.next(count))
        .catch(observer.error);
      return { unsubscribe: vi.fn() };
    },
  }),
}));

describe("SyncStatusBadge Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    vi.mocked(db.syncQueue.count).mockResolvedValue(0);
  });

  it("renders Online status badge when browser is online and count is 0", async () => {
    render(<SyncStatusBadge />);

    expect(await screen.findByText("Online")).toBeInTheDocument();
    expect(screen.queryByText(/pending/i)).not.toBeInTheDocument();
  });

  it("renders pending count tag when syncQueue contains items", async () => {
    vi.mocked(db.syncQueue.count).mockResolvedValue(3);

    render(<SyncStatusBadge />);

    expect(await screen.findByText("3 pending")).toBeInTheDocument();
  });

  it("updates to Offline badge on offline window event", async () => {
    render(<SyncStatusBadge />);

    window.dispatchEvent(new Event("offline"));

    expect(await screen.findByText("Offline")).toBeInTheDocument();
  });

  it("triggers processSyncQueue on click when online", async () => {
    render(<SyncStatusBadge />);

    const badgeButton = await screen.findByRole("button");
    fireEvent.click(badgeButton);

    expect(processSyncQueue).toHaveBeenCalledTimes(1);
  });

  it("does not trigger processSyncQueue on click when offline", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });

    render(<SyncStatusBadge />);

    window.dispatchEvent(new Event("offline"));

    const badgeButton = await screen.findByRole("button");
    fireEvent.click(badgeButton);

    expect(processSyncQueue).not.toHaveBeenCalled();
  });
});
