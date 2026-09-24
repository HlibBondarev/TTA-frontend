import { renderHook, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTTAConsole } from "../hooks/useTTAConsole";
import matchReducer from "../store/matchSlice";
import presenceReducer from "../../playerpresences/store/presenceSlice";
import uiReducer from "../../../store/slices/uiSlice";
import navigationReducer from "../../../store/slices/navigationSlice";
import type { RootState } from "../../../store";

const mockRecordGameEvent = vi.fn();
const mockUseMatchLifecycle = vi.fn().mockReturnValue({
  periodNumber: 1,
  isPeriodActive: true,
  isInsideStoppage: false,
});

vi.mock("../hooks/useMatchLifecycle", () => ({
  useMatchLifecycle: () => mockUseMatchLifecycle(),
}));

vi.mock("../hooks/useGameEvents", () => ({
  useGameEvents: () => ({
    recordGameEvent: mockRecordGameEvent,
  }),
}));

type TestState = {
  match?: Partial<RootState["match"]>;
  presence?: Partial<RootState["presence"]>;
  ui?: Partial<RootState["ui"]>;
  navigation?: Partial<RootState["navigation"]>;
};

const createTestStore = (preloadedState?: TestState) => {
  return configureStore({
    reducer: {
      match: matchReducer,
      presence: presenceReducer,
      ui: uiReducer,
      navigation: navigationReducer,
    },
    preloadedState: preloadedState as unknown as RootState,
  });
};

const createWrapper = (store: ReturnType<typeof createTestStore>) => {
  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
};

describe("useTTAConsole Custom Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordGameEvent.mockResolvedValue(undefined);
    mockUseMatchLifecycle.mockReturnValue({
      periodNumber: 1,
      isPeriodActive: true,
      isInsideStoppage: false,
    });
  });

  it("should initialize console state based on active match and lifecycle", () => {
    const store = createTestStore({
      match: { activeMatchId: "m-123" },
    });

    const { result } = renderHook(() => useTTAConsole(), {
      wrapper: createWrapper(store),
    });

    expect(result.current.activeMatchId).toBe("m-123");
    expect(result.current.periodNumber).toBe(1);
    expect(result.current.isRecordingEnabled).toBe(true);
    expect(result.current.pendingAction).toBeNull();
    expect(result.current.selectedPlayerId).toBeNull();
  });

  it("should disable recording when inside stoppage time or period is inactive", () => {
    mockUseMatchLifecycle.mockReturnValue({
      periodNumber: 1,
      isPeriodActive: true,
      isInsideStoppage: true,
    });

    const store = createTestStore({
      match: { activeMatchId: "m-123" },
    });

    const { result } = renderHook(() => useTTAConsole(), {
      wrapper: createWrapper(store),
    });

    expect(result.current.isRecordingEnabled).toBe(false);
  });

  it("should update action selection when handleActionSelect is called", () => {
    const store = createTestStore({
      match: { activeMatchId: "m-123" },
    });

    const { result } = renderHook(() => useTTAConsole(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      result.current.handleActionSelect("Shot", true);
    });

    expect(result.current.pendingAction).toEqual({
      name: "Shot",
      isPositive: true,
    });
  });

  it("should record game event and reset selections on handleEnter", async () => {
    const store = createTestStore({
      match: { activeMatchId: "m-123" },
    });

    const { result } = renderHook(() => useTTAConsole(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      result.current.handleActionSelect("Goal", true);
      result.current.setSelectedPlayerId("player-7");
    });

    await act(async () => {
      await result.current.handleEnter();
    });

    expect(mockRecordGameEvent).toHaveBeenCalledWith({
      selectedPlayerId: "player-7",
      actionName: "Goal",
      isPositive: true,
      isLeadToGoal: false,
    });

    expect(result.current.pendingAction).toBeNull();
    expect(result.current.selectedPlayerId).toBeNull();
  });

  it("should catch errors during handleEnter and set consoleError state", async () => {
    mockRecordGameEvent.mockRejectedValueOnce(
      new Error("Database write error"),
    );

    const store = createTestStore({
      match: { activeMatchId: "m-123" },
    });

    const { result } = renderHook(() => useTTAConsole(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      result.current.handleActionSelect("Foul", false);
      result.current.setSelectedPlayerId("player-4");
    });

    await act(async () => {
      await result.current.handleEnter();
    });

    expect(result.current.consoleError).toBe("Database write error");
  });

  it("should reset selection state when periodNumber changes", () => {
    const store = createTestStore({
      match: { activeMatchId: "m-123" },
    });

    const { result, rerender } = renderHook(() => useTTAConsole(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      result.current.handleActionSelect("Goal", true);
      result.current.setSelectedPlayerId("player-7");
    });

    expect(result.current.pendingAction).not.toBeNull();

    // Simulate period transition
    mockUseMatchLifecycle.mockReturnValue({
      periodNumber: 2,
      isPeriodActive: true,
      isInsideStoppage: false,
    });

    rerender();

    expect(result.current.periodNumber).toBe(2);
    expect(result.current.pendingAction).toBeNull();
    expect(result.current.selectedPlayerId).toBeNull();
  });

  it("should reset match and presence state in Redux on handleFinalizeSuccess", () => {
    const onCompleteMatch = vi.fn();
    const store = createTestStore({
      match: { activeMatchId: "m-123" },
    });

    const { result } = renderHook(() => useTTAConsole({ onCompleteMatch }), {
      wrapper: createWrapper(store),
    });

    act(() => {
      result.current.handleFinalizeSuccess();
    });

    expect(store.getState().match.activeMatchId).toBeNull();
    expect(onCompleteMatch).toHaveBeenCalled();
  });
});
