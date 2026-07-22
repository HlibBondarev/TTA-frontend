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
        periodnumber: 1,
        homescore: 0,
        guestscore: 0,
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
    const store = createTestStore({ periodnumber: 3, isPeriodActive: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    expect(result.current.periodnumber).toBe(3);
    expect(result.current.isPeriodActive).toBe(true);
  });

  test("should start a period and add a TimeAnchor to IndexedDB", async () => {
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
        matchid: "test-match-id",
        periodnumber: 1,
        type: 0,
        sequenceNumber: 1,
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

  test("should end a period and add a TimeAnchor to IndexedDB", async () => {
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
    const store = createTestStore({ periodnumber: 1, isPeriodActive: false });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    act(() => {
      result.current.nextPeriod();
    });
    expect(store.getState().match.periodnumber).toBe(2);

    act(() => {
      result.current.prevPeriod();
    });
    expect(store.getState().match.periodnumber).toBe(1);
  });

  test("should block period navigation when a period is active", () => {
    const store = createTestStore({ periodnumber: 1, isPeriodActive: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    act(() => {
      result.current.nextPeriod();
    });
    expect(store.getState().match.periodnumber).toBe(1);
  });
});
