import { renderHook, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMatchLifecycle } from "../hooks/useMatchLifecycle";
import matchReducer from "../store/matchSlice";
import { db } from "../../../db/ttaDatabase";

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    timeanchors: {
      add: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
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

  it("should initialize with values matched from the Redux store", () => {
    const store = createTestStore();
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    expect(result.current.periodnumber).toBe(1);
    expect(result.current.isPeriodActive).toBe(false);
    expect(result.current.isInsideStoppage).toBe(false);
    expect(result.current.globalSequenceNumber).toBe(0);
  });

  it("should start a period and add a TimeAnchor to IndexedDB", async () => {
    const store = createTestStore();
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.startPeriod();
    });

    expect(result.current.isPeriodActive).toBe(true);
    expect(result.current.globalSequenceNumber).toBe(1);
    expect(db.timeanchors.add).toHaveBeenCalledTimes(1);
  });

  it("should not start a period if it is already active", async () => {
    const store = createTestStore({ isPeriodActive: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.startPeriod();
    });

    expect(db.timeanchors.add).not.toHaveBeenCalled();
  });

  it("should end a period and add a TimeAnchor to IndexedDB", async () => {
    const store = createTestStore({
      isPeriodActive: true,
      globalSequenceNumber: 1,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.endPeriod();
    });

    expect(result.current.isPeriodActive).toBe(false);
    expect(result.current.globalSequenceNumber).toBe(2);
    expect(db.timeanchors.add).toHaveBeenCalledTimes(1);
  });

  it("should stop the timer (stoppage start) and start the timer (stoppage end) properly", async () => {
    const store = createTestStore({ isPeriodActive: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    // Stop time (Stoppage Start)
    await act(async () => {
      await result.current.stopTime();
    });

    expect(result.current.isInsideStoppage).toBe(true);
    expect(db.timeanchors.add).toHaveBeenCalledTimes(1);

    // Start time (Stoppage End)
    await act(async () => {
      await result.current.startTime();
    });

    expect(result.current.isInsideStoppage).toBe(false);
    expect(db.timeanchors.add).toHaveBeenCalledTimes(2);
  });

  it("should block stoppage state triggers if current period is inactive", async () => {
    const store = createTestStore({ isPeriodActive: false });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.stopTime();
    });

    expect(result.current.isInsideStoppage).toBe(false);
    expect(db.timeanchors.add).not.toHaveBeenCalled();
  });

  it("should navigate period numbers up and down safely when period is inactive", () => {
    const store = createTestStore({ periodnumber: 2, isPeriodActive: false });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    act(() => {
      result.current.nextPeriod();
    });
    expect(result.current.periodnumber).toBe(3);

    act(() => {
      result.current.prevPeriod();
    });
    expect(result.current.periodnumber).toBe(2);
  });

  it("should block period navigation when a period is active", () => {
    const store = createTestStore({ periodnumber: 1, isPeriodActive: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    act(() => {
      result.current.nextPeriod();
    });
    expect(result.current.periodnumber).toBe(1);
  });
});
