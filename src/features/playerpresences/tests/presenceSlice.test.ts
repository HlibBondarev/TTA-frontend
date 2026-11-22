import { describe, it, expect } from "vitest";
import presenceReducer, {
  setPresenceLimits,
  setMaxPersonalFouls,
  loadRosterState,
  syncActiveAndBenchRoster,
  setSelectedStartingIds,
  setClearedPenaltyEventIds,
  commitStartingLineup,
  clearActiveRosterToBench,
  optimisticSubstitute,
  optimisticEnterActivePlayer,
  setLoading,
  resetPresenceState,
} from "../store/presenceSlice";

describe("presenceSlice reducers", () => {
  const initialState = {
    currentPeriod: 1,
    activeLineupIds: [],
    benchLineupIds: [],
    selectedStartingIds: [],
    clearedPenaltyEventIds: [],
    activePlayersLimit: 0,
    maxPersonalFouls: undefined,
    isLoading: false,
  };

  it("should return the initial state when passed an empty action", () => {
    expect(presenceReducer(undefined, { type: "" })).toEqual(initialState);
  });

  it("should handle setPresenceLimits, clear clearedPenaltyEventIds on period change, and handle setMaxPersonalFouls", () => {
    const withCleared = {
      ...initialState,
      currentPeriod: 1,
      clearedPenaltyEventIds: ["evt-1"],
    };
    const samePeriod = presenceReducer(
      withCleared,
      setPresenceLimits({ limit: 5, period: 1, maxPersonalFouls: 3 }),
    );
    expect(samePeriod.clearedPenaltyEventIds).toEqual(["evt-1"]);

    const action = setPresenceLimits({
      limit: 5,
      period: 2,
      maxPersonalFouls: 3,
    });
    const state = presenceReducer(samePeriod, action);
    expect(state.activePlayersLimit).toBe(5);
    expect(state.currentPeriod).toBe(2);
    expect(state.maxPersonalFouls).toBe(3);
    expect(state.clearedPenaltyEventIds).toEqual([]);

    const stateOnlyFouls = presenceReducer(state, setMaxPersonalFouls(4));
    expect(stateOnlyFouls.maxPersonalFouls).toBe(4);
    expect(stateOnlyFouls.currentPeriod).toBe(2);

    const stateMissingFouls = presenceReducer(
      stateOnlyFouls,
      setPresenceLimits({ limit: 6, period: 1 }),
    );
    expect(stateMissingFouls.maxPersonalFouls).toBeUndefined();
  });

  it("should handle loadRosterState, deduplicate ids, and reset selectedStartingIds and clearedPenaltyEventIds", () => {
    const startingState = {
      ...initialState,
      selectedStartingIds: ["p1", "p2"],
      clearedPenaltyEventIds: ["evt-1"],
    };
    const action = loadRosterState({
      active: ["player1", "player2", "player1"], // duplicate in active
      bench: ["player3", "player1"], // active player included in bench by mistake
    });
    const state = presenceReducer(startingState, action);
    expect(state.activeLineupIds).toEqual(["player1", "player2"]);
    expect(state.benchLineupIds).toEqual(["player3"]); // player1 filtered out from bench
    expect(state.selectedStartingIds).toEqual([]); // Prepared players list cleared
    expect(state.clearedPenaltyEventIds).toEqual([]);
    expect(state.isLoading).toBe(false);
  });

  it("should handle syncActiveAndBenchRoster without resetting selectedStartingIds or clearedPenaltyEventIds", () => {
    const startingState = {
      ...initialState,
      selectedStartingIds: ["p1"],
      clearedPenaltyEventIds: ["evt-1"],
    };
    const state = presenceReducer(
      startingState,
      syncActiveAndBenchRoster({
        active: ["p2"],
        bench: ["p1", "p3", "p2"],
      }),
    );
    expect(state.activeLineupIds).toEqual(["p2"]);
    expect(state.benchLineupIds).toEqual(["p1", "p3"]);
    expect(state.selectedStartingIds).toEqual(["p1"]);
    expect(state.clearedPenaltyEventIds).toEqual(["evt-1"]);
  });

  it("should handle setSelectedStartingIds and setClearedPenaltyEventIds and deduplicate ids", () => {
    const action = setSelectedStartingIds(["p1", "p2", "p1"]);
    const state = presenceReducer(initialState, action);
    expect(state.selectedStartingIds).toEqual(["p1", "p2"]);

    const clearedState = presenceReducer(
      state,
      setClearedPenaltyEventIds(["e1", "e2", "e1"]),
    );
    expect(clearedState.clearedPenaltyEventIds).toEqual(["e1", "e2"]);
  });

  it("should handle commitStartingLineup and prevent duplicates on bench", () => {
    const startingState = {
      ...initialState,
      benchLineupIds: ["p1", "p2", "p3"],
      selectedStartingIds: ["p1", "p2"],
      clearedPenaltyEventIds: ["e1"],
    };
    const action = commitStartingLineup(["p1", "p2", "p1"]);
    const state = presenceReducer(startingState, action);
    expect(state.activeLineupIds).toEqual(["p1", "p2"]);
    expect(state.benchLineupIds).toEqual(["p3"]); // Removed p1 & p2 from bench
    expect(state.selectedStartingIds).toEqual([]); // Cleared prepared list
    expect(state.clearedPenaltyEventIds).toEqual([]);
  });

  it("should handle clearActiveRosterToBench and deduplicate merged array", () => {
    const startingState = {
      ...initialState,
      activeLineupIds: ["p1", "p2"],
      benchLineupIds: ["p3", "p1"], // p1 already on bench
      selectedStartingIds: ["p4"],
      clearedPenaltyEventIds: ["e1"],
    };
    const action = clearActiveRosterToBench();
    const state = presenceReducer(startingState, action);
    expect(state.activeLineupIds).toEqual([]);
    expect(state.benchLineupIds).toEqual(["p3", "p1", "p2"]); // No duplicate p1
    expect(state.selectedStartingIds).toEqual([]);
    expect(state.clearedPenaltyEventIds).toEqual([]);
  });

  it("should handle optimisticSubstitute and optimisticEnterActivePlayer and avoid duplicate ids", () => {
    const startingState = {
      ...initialState,
      activeLineupIds: ["p1", "p2"],
      benchLineupIds: ["p3", "p4"],
    };
    const state = presenceReducer(
      startingState,
      optimisticSubstitute({ outId: "p2", inId: "p3" }),
    );

    expect(state.activeLineupIds).toEqual(["p1", "p3"]);
    expect(state.benchLineupIds).toEqual(["p2", "p4"]);

    const enteredState = presenceReducer(
      state,
      optimisticEnterActivePlayer("p4"),
    );
    expect(enteredState.activeLineupIds).toEqual(["p1", "p3", "p4"]);
    expect(enteredState.benchLineupIds).toEqual(["p2"]);
  });

  it("should handle setLoading", () => {
    const action = setLoading(true);
    const state = presenceReducer(initialState, action);
    expect(state.isLoading).toBe(true);
  });

  it("should handle resetPresenceState", () => {
    const modifiedState = {
      currentPeriod: 3,
      activeLineupIds: ["p1"],
      benchLineupIds: ["p2"],
      selectedStartingIds: ["p3"],
      clearedPenaltyEventIds: ["e1"],
      activePlayersLimit: 5,
      maxPersonalFouls: 4,
      isLoading: true,
    };
    const state = presenceReducer(modifiedState, resetPresenceState());
    expect(state).toEqual(initialState);
  });
});
