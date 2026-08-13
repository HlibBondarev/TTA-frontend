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
    selectedStartingIds: [],
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

  it("should handle loadRosterState, deduplicate ids, and reset selectedStartingIds", () => {
    const startingState = {
      ...initialState,
      selectedStartingIds: ["p1", "p2"],
    };
    const action = loadRosterState({
      active: ["player1", "player2", "player1"], // duplicate in active
      bench: ["player3", "player1"], // active player included in bench by mistake
    });
    const state = presenceReducer(startingState, action);
    expect(state.activeLineupIds).toEqual(["player1", "player2"]);
    expect(state.benchLineupIds).toEqual(["player3"]); // player1 filtered out from bench
    expect(state.selectedStartingIds).toEqual([]); // Prepared players list cleared
    expect(state.isLoading).toBe(false);
  });

  it("should handle setSelectedStartingIds and deduplicate ids", () => {
    const action = setSelectedStartingIds(["p1", "p2", "p1"]);
    const state = presenceReducer(initialState, action);
    expect(state.selectedStartingIds).toEqual(["p1", "p2"]);
  });

  it("should handle commitStartingLineup and prevent duplicates on bench", () => {
    const startingState = {
      ...initialState,
      benchLineupIds: ["p1", "p2", "p3"],
      selectedStartingIds: ["p1", "p2"],
    };
    const action = commitStartingLineup(["p1", "p2", "p1"]);
    const state = presenceReducer(startingState, action);
    expect(state.activeLineupIds).toEqual(["p1", "p2"]);
    expect(state.benchLineupIds).toEqual(["p3"]); // Removed p1 & p2 from bench
    expect(state.selectedStartingIds).toEqual([]); // Cleared prepared list
  });

  it("should handle clearActiveRosterToBench and deduplicate merged array", () => {
    const startingState = {
      ...initialState,
      activeLineupIds: ["p1", "p2"],
      benchLineupIds: ["p3", "p1"], // p1 already on bench
      selectedStartingIds: ["p4"],
    };
    const action = clearActiveRosterToBench();
    const state = presenceReducer(startingState, action);
    expect(state.activeLineupIds).toEqual([]);
    expect(state.benchLineupIds).toEqual(["p3", "p1", "p2"]); // No duplicate p1
    expect(state.selectedStartingIds).toEqual([]);
  });

  it("should handle optimisticSubstitute and avoid duplicate ids", () => {
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
