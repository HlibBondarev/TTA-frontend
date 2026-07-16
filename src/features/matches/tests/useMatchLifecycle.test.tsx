import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import React from "react";
import { useMatchLifecycle } from "../hooks/useMatchLifecycle";
import matchReducer, { setActiveMatch } from "../store/matchSlice";
import { db } from "../../../db/ttaDatabase";

// Mock the Dexie local database to prevent actual database connections
vi.mock("../../../db/ttaDatabase", () => {
  return {
    db: {
      timeanchors: {
        add: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
});

const createTestStore = () => {
  const store = configureStore({
    reducer: {
      match: matchReducer,
    },
  });
  // Pre-set an active match ID to pass validation guard inside the hook
  store.dispatch(setActiveMatch("test-match-uuid"));
  return store;
};

describe("useMatchLifecycle Hook", () => {
  let store: ReturnType<typeof createTestStore>;
  let wrapper: React.FC<{ children: React.ReactNode }>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createTestStore();
    wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
  });

  it("should initialize with values matched from the Redux store", () => {
    const { result } = renderHook(() => useMatchLifecycle(), { wrapper });

    expect(result.current.periodnumber).toBe(1);
    expect(result.current.isPeriodActive).toBe(false);
    expect(result.current.isInsideStoppage).toBe(false);
    expect(result.current.globalSequenceNumber).toBe(0);
  });

  it("should start a period and add a TimeAnchor to IndexedDB", async () => {
    const { result } = renderHook(() => useMatchLifecycle(), { wrapper });

    await act(async () => {
      await result.current.startPeriod();
    });

    expect(result.current.isPeriodActive).toBe(true);
    expect(result.current.globalSequenceNumber).toBe(1);
    expect(db.timeanchors.add).toHaveBeenCalledTimes(1);
    expect(db.timeanchors.add).toHaveBeenCalledWith(
      expect.objectContaining({
        matchid: "test-match-uuid",
        periodnumber: 1,
        type: 0, // PeriodStart
        sequenceNumber: 1,
      }),
    );
  });

  it("should not start a period if it is already active", async () => {
    const { result } = renderHook(() => useMatchLifecycle(), { wrapper });

    await act(async () => {
      await result.current.startPeriod();
    });
    expect(result.current.isPeriodActive).toBe(true);

    // Call startPeriod again
    await act(async () => {
      await result.current.startPeriod();
    });

    // DB and sequence should only have been triggered once
    expect(result.current.globalSequenceNumber).toBe(1);
    expect(db.timeanchors.add).toHaveBeenCalledTimes(1);
  });

  it("should end a period and add a TimeAnchor to IndexedDB", async () => {
    const { result } = renderHook(() => useMatchLifecycle(), { wrapper });

    // Start first
    await act(async () => {
      await result.current.startPeriod();
    });

    // End now
    await act(async () => {
      await result.current.endPeriod();
    });

    expect(result.current.isPeriodActive).toBe(false);
    expect(result.current.globalSequenceNumber).toBe(2);
    expect(db.timeanchors.add).toHaveBeenCalledTimes(2);
    expect(db.timeanchors.add).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 1, // PeriodEnd
        sequenceNumber: 2,
      }),
    );
  });

  it("should stop the timer (stoppage start) and start the timer (stoppage end) properly", async () => {
    const { result } = renderHook(() => useMatchLifecycle(), { wrapper });

    // Activate the period
    await act(async () => {
      await result.current.startPeriod();
    });

    // Stop time
    await act(async () => {
      await result.current.stopTime();
    });

    expect(result.current.isInsideStoppage).toBe(true);
    expect(db.timeanchors.add).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 2, // StoppageStart
        sequenceNumber: 2,
      }),
    );

    // Start time again
    await act(async () => {
      await result.current.startTime();
    });

    expect(result.current.isInsideStoppage).toBe(false);
    expect(db.timeanchors.add).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 3, // StoppageEnd
        sequenceNumber: 3,
      }),
    );
  });

  it("should block stoppage state triggers if current period is inactive", async () => {
    const { result } = renderHook(() => useMatchLifecycle(), { wrapper });

    // Try to trigger stoppage with period inactive
    await act(async () => {
      await result.current.stopTime();
    });

    expect(result.current.isInsideStoppage).toBe(false);
    expect(db.timeanchors.add).not.toHaveBeenCalled();
  });

  it("should navigate period numbers up and down safely when period is inactive", () => {
    const { result } = renderHook(() => useMatchLifecycle(), { wrapper });

    act(() => {
      result.current.nextPeriod();
    });
    expect(result.current.periodnumber).toBe(2);

    act(() => {
      result.current.prevPeriod();
    });
    expect(result.current.periodnumber).toBe(1);
  });

  it("should block period navigation when a period is active", async () => {
    const { result } = renderHook(() => useMatchLifecycle(), { wrapper });

    await act(async () => {
      await result.current.startPeriod();
    });

    act(() => {
      result.current.nextPeriod();
    });
    expect(result.current.periodnumber).toBe(1); // Blocked
  });
});
