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
} from "../store/matchSlice";

describe("matchSlice Reducers", () => {
  const initialState = {
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
    const customState = {
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

  it("should handle adding a recent action", () => {
    const newAction = {
      id: "test-1",
      playerNumber: 1,
      actionName: "Goal",
      isPositive: true,
      timestamp: new Date().toISOString(),
    };
    const state = matchReducer(initialState, addRecentAction(newAction));
    expect(state.recentActions).toHaveLength(1);
    expect(state.recentActions[0].id).toBe("test-1");
  });

  it("should reset the match state back to its initial state", () => {
    const dirtyState = {
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
