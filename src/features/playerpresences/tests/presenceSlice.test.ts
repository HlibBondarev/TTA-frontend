import { describe, it, expect } from "vitest";
import presenceReducer, {
  setPresenceLimits,
  loadRosterState,
  setSelectedStartingIds,
  commitStartingLineup,
  clearActiveRosterToBench,
  optimisticSubstitute,
  setLoading,
} from "../store/presenceSlice";

describe("presenceSlice reducers", () => {
  const initialState = {
    currentPeriod: 1,
    activeLineupIds: [],
    benchLineupIds: [],
    selectedStartingIds: [], // Added to satisfy TS2345 (PresenceState compliance)
    activePlayersLimit: 7,
    isLoading: false,
  };

  it("should return the initial state when passed an empty action", () => {
    expect(presenceReducer(undefined, { type: "" })).toEqual(initialState);
  });

  it("should handle setPresenceLimits", () => {
    const action = setPresenceLimits({ limit: 5, period: 2 });
    const state = presenceReducer(initialState, action);
    expect(state.activePlayersLimit).toBe(5);
    expect(state.currentPeriod).toBe(2);
  });

  it("should handle loadRosterState", () => {
    const action = loadRosterState({
      active: ["player1", "player2"],
      bench: ["player3"],
    });
    const state = presenceReducer(initialState, action);
    expect(state.activeLineupIds).toEqual(["player1", "player2"]);
    expect(state.benchLineupIds).toEqual(["player3"]);
    expect(state.isLoading).toBe(false);
  });

  it("should handle setSelectedStartingIds", () => {
    const action = setSelectedStartingIds(["p1", "p2"]);
    const state = presenceReducer(initialState, action);
    expect(state.selectedStartingIds).toEqual(["p1", "p2"]);
  });

  it("should handle commitStartingLineup", () => {
    const startingState = {
      ...initialState,
      benchLineupIds: ["p1", "p2", "p3"],
      selectedStartingIds: ["p1", "p2"],
    };
    const action = commitStartingLineup(["p1", "p2"]);
    const state = presenceReducer(startingState, action);
    expect(state.activeLineupIds).toEqual(["p1", "p2"]);
    expect(state.benchLineupIds).toEqual(["p3"]); // Removed from bench
    expect(state.selectedStartingIds).toEqual([]); // Cleared prepared list
  });

  it("should handle clearActiveRosterToBench", () => {
    const startingState = {
      ...initialState,
      activeLineupIds: ["p1", "p2"],
      benchLineupIds: ["p3"],
      selectedStartingIds: ["p4"],
    };
    const action = clearActiveRosterToBench();
    const state = presenceReducer(startingState, action);
    expect(state.activeLineupIds).toEqual([]);
    expect(state.benchLineupIds).toEqual(["p3", "p1", "p2"]); // Everyone returned to bench
    expect(state.selectedStartingIds).toEqual([]); // Prepared list cleared
  });

  it("should handle optimisticSubstitute", () => {
    const startingState = {
      ...initialState,
      activeLineupIds: ["p1", "p2"],
      benchLineupIds: ["p3", "p4"],
    };
    const action = optimisticSubstitute({ outId: "p2", inId: "p3" });
    const state = presenceReducer(startingState, action);

    expect(state.activeLineupIds).toEqual(["p1", "p3"]);
    expect(state.benchLineupIds).toEqual(["p2", "p4"]);
  });

  it("should handle setLoading", () => {
    const action = setLoading(true);
    const state = presenceReducer(initialState, action);
    expect(state.isLoading).toBe(true);
  });
});
