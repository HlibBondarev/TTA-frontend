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
    expect(result.current.pendingLocation).toBeNull();
    expect(result.current.pendingShotLocation).toBeNull();
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
      result.current.handleActionSelect("Shot", true, "def-shot-1", true);
    });

    expect(result.current.pendingAction).toEqual({
      name: "Shot",
      isPositive: true,
      eventDefinitionId: "def-shot-1",
    });
  });

  it("should clear pendingShotLocation when a non-shot action is selected", () => {
    const store = createTestStore({
      match: { activeMatchId: "m-123" },
    });

    const { result } = renderHook(() => useTTAConsole(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      result.current.handleActionSelect("Goal", true, "def-goal-1", true);
      result.current.handleShotLocationSelect(30.0, 40.0);
    });

    expect(result.current.pendingShotLocation).toEqual({
      shotLocationX: 30.0,
      shotLocationY: 40.0,
    });

    act(() => {
      result.current.handleActionSelect("Pass", true, "def-pass-1", false);
    });

    expect(result.current.pendingShotLocation).toBeNull();
  });

  it("should ignore action selection if eventDefinitionId is missing", () => {
    const store = createTestStore({
      match: { activeMatchId: "m-123" },
    });

    const { result } = renderHook(() => useTTAConsole(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      result.current.handleActionSelect("Shot", true, undefined);
    });

    expect(result.current.pendingAction).toBeNull();
  });

  it("should update location state when handleLocationSelect is called", () => {
    const store = createTestStore({
      match: { activeMatchId: "m-123" },
    });

    const { result } = renderHook(() => useTTAConsole(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      result.current.handleLocationSelect(25.5, 75.0);
    });

    expect(result.current.pendingLocation).toEqual({
      locationX: 25.5,
      locationY: 75.0,
    });

    act(() => {
      result.current.handleLocationSelect(null, null);
    });

    expect(result.current.pendingLocation).toBeNull();
  });

  it("should update goal shot location state when handleShotLocationSelect is called", () => {
    const store = createTestStore({
      match: { activeMatchId: "m-123" },
    });

    const { result } = renderHook(() => useTTAConsole(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      result.current.handleShotLocationSelect(35.0, 85.0);
    });

    expect(result.current.pendingShotLocation).toEqual({
      shotLocationX: 35.0,
      shotLocationY: 85.0,
    });

    act(() => {
      result.current.handleShotLocationSelect(null, null);
    });

    expect(result.current.pendingShotLocation).toBeNull();
  });

  it("should clear pendingAction, pendingLocation, pendingShotLocation, and consoleError when clearPendingAction is called", async () => {
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
      result.current.handleActionSelect("Shot", true, "def-shot-1", true);
      result.current.handleLocationSelect(10.0, 20.0);
      result.current.handleShotLocationSelect(30.0, 40.0);
      result.current.setSelectedPlayerId("player-7");
    });

    expect(result.current.pendingAction).not.toBeNull();
    expect(result.current.pendingShotLocation).not.toBeNull();

    await act(async () => {
      await result.current.handleEnter();
    });

    expect(result.current.consoleError).toBe("Database write error");

    act(() => {
      result.current.clearPendingAction();
    });

    expect(result.current.pendingAction).toBeNull();
    expect(result.current.pendingLocation).toBeNull();
    expect(result.current.pendingShotLocation).toBeNull();
    expect(result.current.consoleError).toBeNull();
  });

  it("should record game event and reset all selections on handleEnter", async () => {
    const store = createTestStore({
      match: { activeMatchId: "m-123" },
    });

    const { result } = renderHook(() => useTTAConsole(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      result.current.handleActionSelect("Goal", true, "def-goal-1", true);
      result.current.setSelectedPlayerId("player-7");
    });

    await act(async () => {
      await result.current.handleEnter();
    });

    expect(mockRecordGameEvent).toHaveBeenCalledWith({
      selectedPlayerId: "player-7",
      actionName: "Goal",
      isPositive: true,
      eventDefinitionId: "def-goal-1",
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
    });

    expect(result.current.pendingAction).toBeNull();
    expect(result.current.pendingLocation).toBeNull();
    expect(result.current.pendingShotLocation).toBeNull();
    expect(result.current.selectedPlayerId).toBeNull();
  });

  it("should record game event with spatial coordinates and shot target location on handleEnter", async () => {
    const store = createTestStore({
      match: { activeMatchId: "m-123" },
    });

    const { result } = renderHook(() => useTTAConsole(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      result.current.handleActionSelect("Goal", true, "def-goal-1", true);
      result.current.handleLocationSelect(50.0, 50.0);
      result.current.handleShotLocationSelect(25.0, 75.0);
      result.current.setSelectedPlayerId("player-7");
    });

    await act(async () => {
      await result.current.handleEnter();
    });

    expect(mockRecordGameEvent).toHaveBeenCalledWith({
      selectedPlayerId: "player-7",
      actionName: "Goal",
      isPositive: true,
      eventDefinitionId: "def-goal-1",
      isLeadToGoal: false,
      locationX: 50.0,
      locationY: 50.0,
      shotLocationX: 25.0,
      shotLocationY: 75.0,
    });

    expect(result.current.pendingAction).toBeNull();
    expect(result.current.pendingLocation).toBeNull();
    expect(result.current.pendingShotLocation).toBeNull();
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
      result.current.handleActionSelect("Foul", false, "def-foul-1", false);
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
      result.current.handleActionSelect("Goal", true, "def-goal-1", true);
      result.current.handleLocationSelect(30.0, 40.0);
      result.current.handleShotLocationSelect(15.0, 85.0);
      result.current.setSelectedPlayerId("player-7");
    });

    expect(result.current.pendingAction).not.toBeNull();
    expect(result.current.pendingShotLocation).not.toBeNull();

    mockUseMatchLifecycle.mockReturnValue({
      periodNumber: 2,
      isPeriodActive: true,
      isInsideStoppage: false,
    });

    rerender();

    expect(result.current.periodNumber).toBe(2);
    expect(result.current.pendingAction).toBeNull();
    expect(result.current.pendingLocation).toBeNull();
    expect(result.current.pendingShotLocation).toBeNull();
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

  it("should preserve pendingShotLocation when re-selecting a shot action with isShot=true", () => {
    const store = createTestStore({
      match: { activeMatchId: "m-123" },
    });

    const { result } = renderHook(() => useTTAConsole(), {
      wrapper: createWrapper(store),
    });

    // Select shot action and set shot target coordinates
    act(() => {
      result.current.handleActionSelect("Shot", true, "def-shot-1", true);
      result.current.handleShotLocationSelect(40.0, 80.0);
    });

    expect(result.current.pendingShotLocation).toEqual({
      shotLocationX: 40.0,
      shotLocationY: 80.0,
    });

    // Re-select the shot action (e.g. from TTAPanel) with isShot=true
    act(() => {
      result.current.handleActionSelect("Shot", true, "def-shot-1", true);
    });

    // Pending shot target location must be preserved intact
    expect(result.current.pendingShotLocation).toEqual({
      shotLocationX: 40.0,
      shotLocationY: 80.0,
    });
  });
});
