import { renderHook, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { useMatchLifecycle } from "../hooks/useMatchLifecycle";
import matchReducer from "../store/matchSlice";
import { db } from "../../../db/ttaDatabase";
import { vi, describe, beforeEach, test, expect } from "vitest";

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    timeanchors: {
      add: vi.fn(),
      delete: vi.fn(),
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    gameevents: {
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    playerpresences: {
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    syncQueue: {
      add: vi.fn(),
      delete: vi.fn(),
      filter: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    },
    transaction: vi.fn((_mode, _tables, cb) => cb()),
  },
}));

const createTestStore = (preloadedState = {}) => {
  return configureStore({
    reducer: {
      match: matchReducer,
    },
    preloadedState: {
      match: {
        activeMatchId: "test-match-id",
        periodNumber: 1,
        homeScore: 0,
        guestScore: 0,
        isPeriodActive: false,
        isInsideStoppage: false,
        globalSequenceNumber: 0,
        recentActions: [],
        ...preloadedState,
      },
    },
  });
};

describe("useMatchLifecycle Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("should initialize with values matched from the Redux store", () => {
    const store = createTestStore({ periodNumber: 3, isPeriodActive: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    expect(result.current.periodNumber).toBe(3);
    expect(result.current.isPeriodActive).toBe(true);
  });

  test("should start a period, add a TimeAnchor and push item to syncQueue in IndexedDB", async () => {
    const store = createTestStore({ isPeriodActive: false });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let anchorId: string | undefined;
    await act(async () => {
      anchorId = await result.current.startPeriod();
    });

    expect(anchorId).toBeDefined();
    expect(store.getState().match.isPeriodActive).toBe(true);
    expect(store.getState().match.globalSequenceNumber).toBe(1);
    expect(db.timeanchors.add).toHaveBeenCalledWith(
      expect.objectContaining({
        id: anchorId,
        matchId: "test-match-id",
        periodNumber: 1,
        type: 0,
        sequenceNumber: 1,
      }),
    );
    expect(db.syncQueue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "POST",
        endpoint: "/Matches/test-match-id/anchors",
        payload: expect.stringContaining(anchorId!),
      }),
    );
  });

  test("should not start a period if it is already active", async () => {
    const store = createTestStore({ isPeriodActive: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.startPeriod();
    });

    expect(db.timeanchors.add).not.toHaveBeenCalled();
  });

  test("should end a period, add a TimeAnchor and push item to syncQueue in IndexedDB", async () => {
    const store = createTestStore({ isPeriodActive: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let anchorId: string | undefined;
    await act(async () => {
      anchorId = await result.current.endPeriod();
    });

    expect(anchorId).toBeDefined();
    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(store.getState().match.globalSequenceNumber).toBe(1);
    expect(db.timeanchors.add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 1,
        sequenceNumber: 1,
      }),
    );
    expect(db.syncQueue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "POST",
        endpoint: "/Matches/test-match-id/anchors",
      }),
    );
  });

  test("should remove both time anchor and associated sync queue item atomically in removeTimeAnchor", async () => {
    const mockSyncItem = {
      id: 101,
      actionType: "POST",
      endpoint: "/Matches/test-match-id/anchors",
      payload: JSON.stringify([{ id: "target-anchor-id", type: 0 }]),
      createdAt: new Date().toISOString(),
    };

    vi.mocked(db.syncQueue.filter).mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([mockSyncItem]),
    } as unknown as ReturnType<typeof db.syncQueue.filter>);

    const store = createTestStore();
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.removeTimeAnchor("target-anchor-id");
    });

    expect(db.timeanchors.delete).toHaveBeenCalledWith("target-anchor-id");
    expect(db.syncQueue.filter).toHaveBeenCalled();
    expect(db.syncQueue.delete).toHaveBeenCalledWith(101);
  });

  test("should remove time anchor and queue item when revertStartPeriod and revertEndPeriod are called", async () => {
    const mockSyncItem = {
      id: 202,
      actionType: "POST",
      endpoint: "/Matches/test-match-id/anchors",
      payload: JSON.stringify([{ id: "revert-anchor-id", type: 0 }]),
      createdAt: new Date().toISOString(),
    };

    vi.mocked(db.syncQueue.filter).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([mockSyncItem]),
    } as unknown as ReturnType<typeof db.syncQueue.filter>);

    const store = createTestStore({ isPeriodActive: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.revertStartPeriod("revert-anchor-id");
    });

    expect(db.timeanchors.delete).toHaveBeenCalledWith("revert-anchor-id");
    expect(db.syncQueue.delete).toHaveBeenCalledWith(202);
    expect(store.getState().match.isPeriodActive).toBe(false);

    await act(async () => {
      await result.current.revertEndPeriod("revert-anchor-id");
    });

    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should stop the timer (stoppage start) and start the timer (stoppage end) properly", async () => {
    const store = createTestStore({
      isPeriodActive: true,
      isInsideStoppage: false,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.stopTime();
    });

    expect(store.getState().match.isInsideStoppage).toBe(true);
    expect(db.timeanchors.add).toHaveBeenCalledWith(
      expect.objectContaining({ type: 2 }),
    );

    await act(async () => {
      await result.current.startTime();
    });

    expect(store.getState().match.isInsideStoppage).toBe(false);
    expect(db.timeanchors.add).toHaveBeenCalledWith(
      expect.objectContaining({ type: 3 }),
    );
  });

  test("should block stoppage state triggers if current period is inactive", async () => {
    const store = createTestStore({ isPeriodActive: false });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.stopTime();
    });

    expect(db.timeanchors.add).not.toHaveBeenCalled();
  });

  test("should navigate period numbers up and down safely when period is inactive", () => {
    const store = createTestStore({ periodNumber: 1, isPeriodActive: false });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    act(() => {
      result.current.nextPeriod();
    });
    expect(store.getState().match.periodNumber).toBe(2);

    act(() => {
      result.current.prevPeriod();
    });
    expect(store.getState().match.periodNumber).toBe(1);
  });

  test("should block period navigation when a period is active", () => {
    const store = createTestStore({ periodNumber: 1, isPeriodActive: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    act(() => {
      result.current.nextPeriod();
    });
    expect(store.getState().match.periodNumber).toBe(1);
  });

  test("should throw and leave state unchanged if starting period without active match ID", async () => {
    const store = createTestStore({
      activeMatchId: null,
      globalSequenceNumber: 0,
      isPeriodActive: false,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.startPeriod();
      }),
    ).rejects.toThrow("No active match ID found for logging time anchor.");

    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(store.getState().match.globalSequenceNumber).toBe(0);
    expect(db.timeanchors.add).not.toHaveBeenCalled();
  });

  test("should throw and leave state unchanged if ending period without active match ID", async () => {
    const store = createTestStore({
      activeMatchId: null,
      globalSequenceNumber: 0,
      isPeriodActive: true,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.endPeriod();
      }),
    ).rejects.toThrow("No active match ID found for logging time anchor.");

    expect(store.getState().match.isPeriodActive).toBe(true);
    expect(store.getState().match.globalSequenceNumber).toBe(0);
    expect(db.timeanchors.add).not.toHaveBeenCalled();
  });

  test("should throw and leave state unchanged if stopping/resuming time without active match ID", async () => {
    const store = createTestStore({
      activeMatchId: null,
      globalSequenceNumber: 0,
      isPeriodActive: true,
      isInsideStoppage: false,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.stopTime();
      }),
    ).rejects.toThrow("No active match ID found for logging time anchor.");

    expect(store.getState().match.isInsideStoppage).toBe(false);
    expect(store.getState().match.globalSequenceNumber).toBe(0);
    expect(db.timeanchors.add).not.toHaveBeenCalled();

    await expect(
      act(async () => {
        await result.current.startTime();
      }),
    ).rejects.toThrow("No active match ID found for logging time anchor.");

    expect(store.getState().match.isInsideStoppage).toBe(false);
    expect(store.getState().match.globalSequenceNumber).toBe(0);
    expect(db.timeanchors.add).not.toHaveBeenCalled();
  });

  test("should block timer start (resume) if not inside stoppage or period is inactive", async () => {
    const store = createTestStore({
      isPeriodActive: true,
      isInsideStoppage: false,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.startTime();
    });

    expect(db.timeanchors.add).not.toHaveBeenCalled();
  });

  test("should safely decrement period number down when period is inactive and greater than 1", () => {
    const store = createTestStore({ periodNumber: 2, isPeriodActive: false });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    act(() => {
      result.current.prevPeriod();
    });
    expect(store.getState().match.periodNumber).toBe(1);

    act(() => {
      result.current.prevPeriod();
    });
    expect(store.getState().match.periodNumber).toBe(1);
  });
});
