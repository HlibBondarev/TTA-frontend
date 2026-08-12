import { renderHook, act, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import {
  useMatchLifecycle,
  calculatePeriodState,
} from "../hooks/useMatchLifecycle";
import matchReducer, {
  type MatchState,
  setPeriodStatePayload,
} from "../store/matchSlice";
import { db, type TimeAnchor } from "../../../db/ttaDatabase";
import { vi, describe, beforeEach, test, expect } from "vitest";

let mockTimeAnchors: TimeAnchor[] = [];

const seedAnchorsFromState = (matchState: Partial<MatchState> = {}) => {
  const matchId = matchState.activeMatchId || "test-match-id";
  const periodNumber = matchState.periodNumber ?? 1;

  if (matchState.isPeriodActive || matchState.isPeriodEnded) {
    mockTimeAnchors.push({
      id: "seed-start-anchor",
      matchId,
      periodNumber,
      type: 0,
      timestamp: "2020-01-01T10:00:00Z",
      sequenceNumber: 1,
      isSynced: 0,
    });
  }

  if (matchState.isInsideStoppage) {
    mockTimeAnchors.push({
      id: "seed-stoppage-start-anchor",
      matchId,
      periodNumber,
      type: 2,
      timestamp: "2020-01-01T10:05:00Z",
      sequenceNumber: 2,
      isSynced: 0,
    });
  }

  if (matchState.isPeriodEnded) {
    mockTimeAnchors.push({
      id: "seed-end-anchor",
      matchId,
      periodNumber,
      type: 1,
      timestamp: "2020-01-01T10:10:00Z",
      sequenceNumber: 3,
      isSynced: 0,
    });
  }
};

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    timeanchors: {
      add: vi.fn((anchor: TimeAnchor) => {
        mockTimeAnchors.push(anchor);
        return Promise.resolve(anchor.id);
      }),
      delete: vi.fn((id: string) => {
        mockTimeAnchors = mockTimeAnchors.filter((a) => a.id !== id);
        return Promise.resolve();
      }),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockImplementation((matchIdVal: string) => ({
          filter: vi
            .fn()
            .mockImplementation((predicate: (a: TimeAnchor) => boolean) => ({
              toArray: vi.fn().mockImplementation(() => {
                const res = mockTimeAnchors.filter(
                  (a) => a.matchId === matchIdVal && predicate(a),
                );
                return Promise.resolve(res);
              }),
            })),
        })),
      }),
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
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      update: vi.fn().mockResolvedValue(1),
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    syncQueue: {
      add: vi.fn(),
      delete: vi.fn(),
      filter: vi.fn().mockReturnValue({
        toArray: vi.fn().mockImplementation(() =>
          Promise.resolve([
            {
              id: 101,
              payload: JSON.stringify([{ id: "seed-end-anchor" }]),
            },
          ]),
        ),
      }),
    },
    transaction: vi.fn((...args: unknown[]) => {
      const cb = args[args.length - 1];
      return typeof cb === "function" ? cb() : undefined;
    }),
  },
}));

const createTestStore = (preloadedMatchState: Partial<MatchState> = {}) => {
  mockTimeAnchors = [];
  seedAnchorsFromState(preloadedMatchState);

  return configureStore({
    reducer: {
      match: matchReducer,
    },
    preloadedState: {
      match: {
        activeMatchId: "test-match-id",
        activeTeamId: "test-team-id",
        periodNumber: 1,
        homeScore: 0,
        guestScore: 0,
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: false,
        globalSequenceNumber: 0,
        recentActions: [],
        ...preloadedMatchState,
      },
    },
  });
};

describe("useMatchLifecycle Hook & State Machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimeAnchors = [];
    vi.mocked(db.transaction).mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1];
      return typeof cb === "function"
        ? (cb() as ReturnType<typeof db.transaction>)
        : (Promise.resolve() as ReturnType<typeof db.transaction>);
    });
  });

  describe("calculatePeriodState Helper", () => {
    test("should calculate inactive initial state when no anchors exist", () => {
      const state = calculatePeriodState([]);
      expect(state).toEqual({
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: false,
      });
    });

    test("should calculate active period state after PeriodStart anchor", () => {
      const anchors: TimeAnchor[] = [
        {
          id: "a1",
          matchId: "m1",
          periodNumber: 1,
          type: 0,
          timestamp: "2020-01-01T10:00:00Z",
          sequenceNumber: 1,
          isSynced: 0,
        },
      ];
      const state = calculatePeriodState(anchors);
      expect(state).toEqual({
        isPeriodActive: true,
        isInsideStoppage: false,
        isPeriodEnded: false,
      });
    });

    test("should calculate stoppage state when StoppageStart occurs after PeriodStart", () => {
      const anchors: TimeAnchor[] = [
        {
          id: "a1",
          matchId: "m1",
          periodNumber: 1,
          type: 0,
          timestamp: "2020-01-01T10:00:00Z",
          sequenceNumber: 1,
          isSynced: 0,
        },
        {
          id: "a2",
          matchId: "m1",
          periodNumber: 1,
          type: 2,
          timestamp: "2020-01-01T10:05:00Z",
          sequenceNumber: 2,
          isSynced: 0,
        },
      ];
      const state = calculatePeriodState(anchors);
      expect(state).toEqual({
        isPeriodActive: true,
        isInsideStoppage: true,
        isPeriodEnded: false,
      });
    });

    test("should calculate ended period state after PeriodEnd anchor", () => {
      const anchors: TimeAnchor[] = [
        {
          id: "a1",
          matchId: "m1",
          periodNumber: 1,
          type: 0,
          timestamp: "2020-01-01T10:00:00Z",
          sequenceNumber: 1,
          isSynced: 0,
        },
        {
          id: "a2",
          matchId: "m1",
          periodNumber: 1,
          type: 1,
          timestamp: "2020-01-01T10:10:00Z",
          sequenceNumber: 2,
          isSynced: 0,
        },
      ];
      const state = calculatePeriodState(anchors);
      expect(state).toEqual({
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: true,
      });
    });
  });

  test("should initialize with values matched from the Redux store", () => {
    const store = createTestStore({ periodNumber: 3, isPeriodActive: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    expect(result.current.periodNumber).toBe(3);
    expect(result.current.isPeriodActive).toBe(true);
  });

  test("should evaluate canUndoEndPeriod to true when unsynced PeriodEnd anchor exists", async () => {
    const store = createTestStore({
      periodNumber: 1,
      isPeriodEnded: true,
    });

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => {
      expect(result.current.canUndoEndPeriod).toBe(true);
    });
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

  test("should start a specific target period when passed to startPeriod", async () => {
    const store = createTestStore({ periodNumber: 1, isPeriodEnded: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let anchorId: string | undefined;
    await act(async () => {
      anchorId = await result.current.startPeriod(2);
    });

    expect(anchorId).toBeDefined();
    expect(store.getState().match.periodNumber).toBe(2);
    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should block starting a period if it is already active or ended", async () => {
    const storeActive = createTestStore({ isPeriodActive: true });
    const { result: resActive } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={storeActive}>{children}</Provider>
      ),
    });

    await act(async () => {
      await resActive.current.startPeriod();
    });
    expect(db.timeanchors.add).not.toHaveBeenCalled();

    const storeEnded = createTestStore({ isPeriodEnded: true });
    const { result: resEnded } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={storeEnded}>{children}</Provider>
      ),
    });

    await act(async () => {
      await resEnded.current.startPeriod();
    });
    expect(db.timeanchors.add).not.toHaveBeenCalled();
  });

  test("should reject startPeriod atomically inside IndexedDB transaction when an existing end anchor is present before initial sync completes", async () => {
    let resolveSyncQuery: (value: TimeAnchor[]) => void = () => {};
    const syncQueryPromise = new Promise<TimeAnchor[]>((resolve) => {
      resolveSyncQuery = resolve;
    });

    let callCount = 0;
    const filterMock = vi
      .fn()
      .mockImplementation((predicate: (a: TimeAnchor) => boolean) => ({
        toArray: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return syncQueryPromise;
          }
          return Promise.resolve(
            mockTimeAnchors.filter(
              (a) => a.matchId === "test-match-id" && predicate(a),
            ),
          );
        }),
      }));

    vi.mocked(db.timeanchors.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({ filter: filterMock }),
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: false,
      isPeriodEnded: false,
    });

    mockTimeAnchors = [
      {
        id: "existing-start-anchor",
        matchId: "test-match-id",
        periodNumber: 1,
        type: 0,
        timestamp: "2020-01-01T10:00:00Z",
        sequenceNumber: 1,
        isSynced: 1,
      },
      {
        id: "existing-end-anchor",
        matchId: "test-match-id",
        periodNumber: 1,
        type: 1,
        timestamp: "2020-01-01T10:10:00Z",
        sequenceNumber: 2,
        isSynced: 1,
      },
    ];

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.startPeriod();
      }),
    ).rejects.toThrow(
      "Cannot start period: period is already active or ended.",
    );

    expect(mockTimeAnchors.filter((a) => a.type === 0)).toHaveLength(1);
    expect(store.getState().match.isPeriodActive).toBe(false);

    await act(async () => {
      resolveSyncQuery(mockTimeAnchors);
    });
  });

  test("should end a period, set isPeriodEnded=true and push item to syncQueue", async () => {
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
    expect(store.getState().match.isPeriodEnded).toBe(true);
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

  test("should block ending a period if currently inside a stoppage", async () => {
    const store = createTestStore({
      isPeriodActive: true,
      isInsideStoppage: true,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.endPeriod();
    });

    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should remove both time anchor and associated sync queue item atomically in removeTimeAnchor", async () => {
    const mockSyncItemWithId = {
      id: 101,
      actionType: "POST",
      endpoint: "/Matches/test-match-id/anchors",
      payload: JSON.stringify([{ id: "target-anchor-id", type: 0 }]),
      createdAt: new Date().toISOString(),
    };
    const mockSyncItemWithoutId = {
      id: undefined,
      actionType: "POST",
      endpoint: "/Matches/test-match-id/anchors",
      payload: JSON.stringify([{ id: "target-anchor-id", type: 0 }]),
      createdAt: new Date().toISOString(),
    };

    vi.mocked(db.syncQueue.filter).mockReturnValueOnce({
      toArray: vi
        .fn()
        .mockResolvedValue([mockSyncItemWithId, mockSyncItemWithoutId]),
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
    expect(db.syncQueue.delete).toHaveBeenCalledTimes(1);
    expect(db.syncQueue.delete).toHaveBeenCalledWith(101);
  });

  test("should remove time anchor and queue item when revertStartPeriod and revertEndPeriod are called with anchorId", async () => {
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
    mockTimeAnchors = [
      {
        id: "revert-anchor-id",
        matchId: "test-match-id",
        periodNumber: 1,
        type: 0,
        timestamp: "2020-01-01T10:00:00Z",
        sequenceNumber: 1,
        isSynced: 0,
      },
    ];

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.revertStartPeriod("revert-anchor-id");
    });

    expect(db.timeanchors.delete).toHaveBeenCalledWith("revert-anchor-id");
    expect(db.syncQueue.delete).toHaveBeenCalledWith(202);
    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(store.getState().match.isPeriodEnded).toBe(false);

    mockTimeAnchors.push({
      id: "start-anchor-for-revert",
      matchId: "test-match-id",
      periodNumber: 1,
      type: 0,
      timestamp: "2020-01-01T10:00:00Z",
      sequenceNumber: 1,
      isSynced: 0,
    });

    await act(async () => {
      await result.current.revertEndPeriod("revert-anchor-id");
    });

    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should revert end period when revertEndPeriod is called without explicit anchorId", async () => {
    const store = createTestStore({
      periodNumber: 1,
      isPeriodEnded: true,
    });

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.revertEndPeriod();
    });

    expect(db.timeanchors.delete).toHaveBeenCalledWith("seed-end-anchor");
    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should handle revertStartPeriod and revertEndPeriod safely when anchorId is null or undefined", async () => {
    const store = createTestStore({ isPeriodActive: true });
    mockTimeAnchors = [];

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.revertStartPeriod(null);
    });

    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(store.getState().match.isPeriodEnded).toBe(false);

    mockTimeAnchors.push({
      id: "start-anchor-safe",
      matchId: "test-match-id",
      periodNumber: 1,
      type: 0,
      timestamp: "2020-01-01T10:00:00Z",
      sequenceNumber: 1,
      isSynced: 0,
    });

    await act(async () => {
      await result.current.revertEndPeriod(undefined);
    });

    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should roll back Redux state and rethrow error when logTimeAnchor fails inside startPeriod, endPeriod, stopTime, or startTime", async () => {
    vi.mocked(db.transaction).mockRejectedValue(
      new Error("IndexedDB transaction failure"),
    );

    const initialSeq = 5;
    const store = createTestStore({
      isPeriodActive: false,
      isInsideStoppage: false,
      globalSequenceNumber: initialSeq,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    // 1. startPeriod failure
    await expect(
      act(async () => {
        await result.current.startPeriod();
      }),
    ).rejects.toThrow("IndexedDB transaction failure");
    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(store.getState().match.isPeriodEnded).toBe(false);
    expect(store.getState().match.globalSequenceNumber).toBe(initialSeq);

    // Set state & anchor for endPeriod and stopTime tests
    act(() => {
      store.dispatch({ type: "match/startPeriodState" });
    });
    mockTimeAnchors = [
      {
        id: "start-fail-test",
        matchId: "test-match-id",
        periodNumber: 1,
        type: 0,
        timestamp: "2020-01-01T10:00:00Z",
        sequenceNumber: 1,
        isSynced: 0,
      },
    ];

    // 2. endPeriod failure
    await expect(
      act(async () => {
        await result.current.endPeriod();
      }),
    ).rejects.toThrow("IndexedDB transaction failure");
    expect(store.getState().match.isPeriodActive).toBe(true);
    expect(store.getState().match.globalSequenceNumber).toBe(initialSeq);

    // 3. stopTime failure
    await expect(
      act(async () => {
        await result.current.stopTime();
      }),
    ).rejects.toThrow("IndexedDB transaction failure");
    expect(store.getState().match.isInsideStoppage).toBe(false);
    expect(store.getState().match.globalSequenceNumber).toBe(initialSeq);

    // Set stoppage state and anchors for startTime test
    act(() => {
      store.dispatch({ type: "match/startStoppageState" });
    });
    mockTimeAnchors.push({
      id: "stoppage-start-fail-test",
      matchId: "test-match-id",
      periodNumber: 1,
      type: 2,
      timestamp: "2020-01-01T10:05:00Z",
      sequenceNumber: 2,
      isSynced: 0,
    });

    // 4. startTime failure
    await expect(
      act(async () => {
        await result.current.startTime();
      }),
    ).rejects.toThrow("IndexedDB transaction failure");
    expect(store.getState().match.isInsideStoppage).toBe(true);
    expect(store.getState().match.globalSequenceNumber).toBe(initialSeq);
  });

  test("should skip stale Redux rollback and sync in revertStartPeriod if period changes before removeTimeAnchor resolves", async () => {
    let resolveDelete: () => void = () => {};
    const deletePromise = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });

    vi.mocked(db.transaction).mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        return deletePromise.then(() => cb()) as ReturnType<
          typeof db.transaction
        >;
      }
      return Promise.resolve() as ReturnType<typeof db.transaction>;
    });

    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: true,
    });

    const { result, rerender } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let revertPromise!: Promise<void>;
    act(() => {
      revertPromise = result.current.revertStartPeriod("test-anchor-id");
    });

    mockTimeAnchors.push({
      id: "p2-start-anchor",
      matchId: "test-match-id",
      periodNumber: 2,
      type: 0,
      timestamp: "2020-01-01T10:20:00Z",
      sequenceNumber: 10,
      isSynced: 0,
    });

    act(() => {
      store.dispatch(
        setPeriodStatePayload({
          isPeriodActive: false,
          isInsideStoppage: false,
          isPeriodEnded: false,
        }),
      );
      result.current.nextPeriod();
    });
    rerender();

    expect(store.getState().match.periodNumber).toBe(2);

    await act(async () => {
      resolveDelete();
      await revertPromise;
    });

    expect(store.getState().match.periodNumber).toBe(2);
    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should skip stale Redux rollback on logTimeAnchor failure if context changes before error is handled", async () => {
    let rejectTransaction: (err: Error) => void = () => {};
    const transactionPromise = new Promise<void>((_, reject) => {
      rejectTransaction = reject;
    });

    vi.mocked(db.transaction).mockReturnValue(
      transactionPromise as unknown as ReturnType<typeof db.transaction>,
    );

    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: false,
    });

    const { result, rerender } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let startPromise!: Promise<string | undefined>;
    act(() => {
      startPromise = result.current.startPeriod();
    });

    mockTimeAnchors.push({
      id: "p2-start-anchor-fail-test",
      matchId: "test-match-id",
      periodNumber: 2,
      type: 0,
      timestamp: "2020-01-01T10:20:00Z",
      sequenceNumber: 10,
      isSynced: 0,
    });

    act(() => {
      store.dispatch(
        setPeriodStatePayload({
          isPeriodActive: false,
          isInsideStoppage: false,
          isPeriodEnded: false,
        }),
      );
      result.current.nextPeriod();
    });
    rerender();

    expect(store.getState().match.periodNumber).toBe(2);

    await act(async () => {
      rejectTransaction(new Error("DB write failure"));
      await expect(startPromise).rejects.toThrow("DB write failure");
    });

    expect(store.getState().match.periodNumber).toBe(2);
    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should ignore syncPeriodStateWithDB when period transitions from 1 to 2 during an async operation", async () => {
    let resolveAddAnchor: () => void = () => {};
    const addAnchorPromise = new Promise<void>((resolve) => {
      resolveAddAnchor = resolve;
    });

    vi.mocked(db.transaction).mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        return addAnchorPromise.then(() => cb()) as ReturnType<
          typeof db.transaction
        >;
      }
      return Promise.resolve() as ReturnType<typeof db.transaction>;
    });

    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: true,
      isPeriodEnded: false,
    });

    const { result, rerender } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let endPromise!: Promise<string | undefined>;
    act(() => {
      endPromise = result.current.endPeriod();
    });

    act(() => {
      result.current.nextPeriod();
    });
    rerender();

    expect(store.getState().match.periodNumber).toBe(2);

    await act(async () => {
      resolveAddAnchor();
      await endPromise;
    });

    expect(store.getState().match.periodNumber).toBe(2);
    expect(store.getState().match.isPeriodActive).toBe(false);
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

    expect(store.getState().match.isPeriodActive).toBe(false);
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

    await expect(
      act(async () => {
        await result.current.startTime();
      }),
    ).rejects.toThrow("No active match ID found for logging time anchor.");

    expect(store.getState().match.isInsideStoppage).toBe(false);
    expect(store.getState().match.globalSequenceNumber).toBe(0);
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

    expect(store.getState().match.isInsideStoppage).toBe(false);
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

  test("should throw and validate if activeMatchId is whitespace-only when starting a period", async () => {
    const store = createTestStore({
      activeMatchId: "   ",
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
  });

  test("should normalize padded activeMatchId when logging time anchor", async () => {
    const store = createTestStore({
      activeMatchId: "  match-padded-id  ",
      isPeriodActive: false,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let anchorId: string | undefined;
    await act(async () => {
      anchorId = await result.current.startPeriod();
    });

    expect(anchorId).toBeDefined();
    expect(db.timeanchors.add).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: "match-padded-id",
      }),
    );
    expect(db.syncQueue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/Matches/match-padded-id/anchors",
      }),
    );
  });

  test("should ignore stale syncPeriodStateWithDB results when period changes before query completes", async () => {
    let resolveFirstQuery: (value: TimeAnchor[]) => void = () => {};
    const firstQueryPromise = new Promise<TimeAnchor[]>((resolve) => {
      resolveFirstQuery = resolve;
    });

    const filterMock = vi
      .fn()
      .mockImplementation((predicate: (a: TimeAnchor) => boolean) => {
        const isPeriod1Query = mockTimeAnchors.some(
          (a) => a.periodNumber === 1 && predicate(a),
        );
        if (isPeriod1Query) {
          return { toArray: () => firstQueryPromise };
        }
        return {
          toArray: () =>
            Promise.resolve(
              mockTimeAnchors.filter(
                (a) => a.matchId === "test-match-id" && predicate(a),
              ),
            ),
        };
      });

    vi.mocked(db.timeanchors.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({ filter: filterMock }),
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    const store = createTestStore({ periodNumber: 1, isPeriodActive: false });
    const { result, rerender } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    act(() => {
      result.current.nextPeriod();
    });
    rerender();

    expect(store.getState().match.periodNumber).toBe(2);

    await act(async () => {
      resolveFirstQuery([
        {
          id: "stale-p1-anchor",
          matchId: "test-match-id",
          periodNumber: 1,
          type: 0,
          timestamp: "2020-01-01T10:00:00Z",
          sequenceNumber: 1,
          isSynced: 0,
        },
      ]);
    });

    expect(store.getState().match.isPeriodActive).toBe(false);
  });

  test("should preserve new period state when delayed endPeriod transaction completes after period switch", async () => {
    let resolveAddAnchor: () => void = () => {};
    const addAnchorPromise = new Promise<void>((resolve) => {
      resolveAddAnchor = resolve;
    });

    vi.mocked(db.transaction).mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        return addAnchorPromise.then(() => cb()) as ReturnType<
          typeof db.transaction
        >;
      }
      return Promise.resolve() as ReturnType<typeof db.transaction>;
    });

    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: true,
      isPeriodEnded: false,
    });

    const { result, rerender } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let endPromise!: Promise<string | undefined>;
    act(() => {
      endPromise = result.current.endPeriod();
    });

    act(() => {
      result.current.nextPeriod();
    });
    rerender();

    expect(store.getState().match.periodNumber).toBe(2);

    await act(async () => {
      resolveAddAnchor();
      await endPromise;
    });

    expect(store.getState().match.periodNumber).toBe(2);
    expect(store.getState().match.isPeriodActive).toBe(false);
  });
});
