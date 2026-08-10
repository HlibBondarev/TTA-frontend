import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
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
  const originalOnLineDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "onLine",
  );

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

  afterAll(() => {
    if (originalOnLineDescriptor) {
      Object.defineProperty(navigator, "onLine", originalOnLineDescriptor);
    } else {
      // @ts-expect-error - Remove mocked instance property if descriptor didn't exist
      delete navigator.onLine;
    }
  });

  it("renders Online status badge when browser is online and count is 0", async () => {
    render(<SyncStatusBadge />);

    const badgeButton = await screen.findByRole("button");
    expect(badgeButton).not.toBeDisabled();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.queryByText(/pending/i)).not.toBeInTheDocument();
  });

  it("renders pending count tag when syncQueue contains items", async () => {
    vi.mocked(db.syncQueue.count).mockResolvedValue(3);

    render(<SyncStatusBadge />);

    expect(await screen.findByText("3 pending")).toBeInTheDocument();
  });

  it("updates to Offline badge on offline window event and disables button", async () => {
    render(<SyncStatusBadge />);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    const badgeButton = await screen.findByRole("button");
    expect(badgeButton).toBeDisabled();
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("triggers processSyncQueue on click when online", async () => {
    render(<SyncStatusBadge />);

    const badgeButton = await screen.findByRole("button");
    fireEvent.click(badgeButton);

    expect(processSyncQueue).toHaveBeenCalledTimes(1);
  });

  it("handles processSyncQueue rejection gracefully on manual sync click", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(processSyncQueue).mockRejectedValueOnce(
      new Error("Network fail"),
    );

    render(<SyncStatusBadge />);

    const badgeButton = await screen.findByRole("button");
    fireEvent.click(badgeButton);

    await waitFor(() => {
      expect(processSyncQueue).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Manual background sync failed:",
        expect.any(Error),
      );
    });

    consoleSpy.mockRestore();
  });

  it("does not trigger processSyncQueue on click when offline and button is disabled", async () => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "onLine",
    );

    try {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: false,
      });

      render(<SyncStatusBadge />);

      act(() => {
        window.dispatchEvent(new Event("offline"));
      });

      const badgeButton = await screen.findByRole("button");
      expect(badgeButton).toBeDisabled();

      fireEvent.click(badgeButton);

      expect(processSyncQueue).not.toHaveBeenCalled();
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(navigator, "onLine", previousDescriptor);
      }
    }
  });
});
