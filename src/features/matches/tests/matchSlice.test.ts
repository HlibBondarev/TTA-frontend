import matchReducer, {
  setActiveMatch,
  startPeriodState,
  endPeriodState,
  incrementPeriodNumber,
  decrementPeriodNumber,
  startStoppageState,
  endStoppageState,
  incrementSequence,
  resetMatchState,
  addRecentAction,
  type ActionEntry,
  type MatchState,
} from "../store/matchSlice";

describe("matchSlice Reducers", () => {
  const initialState: MatchState = {
    activeMatchId: null,
    periodnumber: 1,
    homescore: 0,
    guestscore: 0,
    isPeriodActive: false,
    isInsideStoppage: false,
    globalSequenceNumber: 0,
    recentActions: [],
  };

  it("should return the initial state on first run", () => {
    expect(matchReducer(undefined, { type: "unknown" })).toEqual(initialState);
  });

  it("should set the active match and reset tracking counters", () => {
    const customState: MatchState = {
      ...initialState,
      periodnumber: 3,
      globalSequenceNumber: 15,
    };

    const nextState = matchReducer(
      customState,
      setActiveMatch("test-match-uuid"),
    );

    expect(nextState.activeMatchId).toBe("test-match-uuid");
    expect(nextState.periodnumber).toBe(1);
    expect(nextState.globalSequenceNumber).toBe(0);
  });

  it("should handle starting and ending a period", () => {
    const stateStarted = matchReducer(initialState, startPeriodState());
    expect(stateStarted.isPeriodActive).toBe(true);
    expect(stateStarted.isInsideStoppage).toBe(false);

    const stateEnded = matchReducer(stateStarted, endPeriodState());
    expect(stateEnded.isPeriodActive).toBe(false);
  });

  it("should handle period number navigation safely", () => {
    const stateInc = matchReducer(initialState, incrementPeriodNumber());
    expect(stateInc.periodnumber).toBe(2);

    const stateDec = matchReducer(stateInc, decrementPeriodNumber());
    expect(stateDec.periodnumber).toBe(1);

    const stateSafe = matchReducer(stateDec, decrementPeriodNumber());
    expect(stateSafe.periodnumber).toBe(1);
  });

  it("should handle stoppage state transitions", () => {
    const stateStart = matchReducer(initialState, startStoppageState());
    expect(stateStart.isInsideStoppage).toBe(true);

    const stateEnd = matchReducer(stateStart, endStoppageState());
    expect(stateEnd.isInsideStoppage).toBe(false);
  });

  it("should increment sequence number step-by-step", () => {
    const state1 = matchReducer(initialState, incrementSequence());
    expect(state1.globalSequenceNumber).toBe(1);

    const state2 = matchReducer(state1, incrementSequence());
    expect(state2.globalSequenceNumber).toBe(2);
  });

  it("should handle adding recent actions with a maximum limit of 10", () => {
    let currentState: MatchState = initialState;

    // Dispatch 11 uniquely identifiable actions
    for (let i = 1; i <= 11; i++) {
      const actionEntry: ActionEntry = {
        id: `action-${i}`,
        playerNumber: i,
        actionName: `Action ${i}`,
        isPositive: i % 2 === 0,
        timestamp: new Date().toISOString(),
      };
      currentState = matchReducer(currentState, addRecentAction(actionEntry));
    }

    // State recentActions should contain exactly 10 entries
    expect(currentState.recentActions).toHaveLength(10);
    // The most recent action (action-11) should be first
    expect(currentState.recentActions[0].id).toBe("action-11");
    // The earliest added action within the limit (action-2) should be present at the end, while action-1 is discarded
    expect(currentState.recentActions[9].id).toBe("action-2");
    expect(
      currentState.recentActions.some((act) => act.id === "action-1"),
    ).toBe(false);
  });

  it("should reset the match state back to its initial state", () => {
    const dirtyState: MatchState = {
      ...initialState,
      activeMatchId: "active-session-uuid",
      periodnumber: 4,
      homescore: 10,
      guestscore: 8,
      isPeriodActive: true,
      isInsideStoppage: true,
      globalSequenceNumber: 42,
    };

    const nextState = matchReducer(dirtyState, resetMatchState());
    expect(nextState).toEqual(initialState);
  });
});
