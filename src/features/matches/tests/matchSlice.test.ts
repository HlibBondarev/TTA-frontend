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
} from "../matchSlice";

describe("matchSlice Reducers", () => {
  const initialState = {
    activeMatchId: null,
    periodnumber: 1,
    homescore: 0,
    guestscore: 0,
    isPeriodActive: false,
    isInsideStoppage: false,
    globalSequenceNumber: 0,
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
    let state = matchReducer(initialState, startPeriodState());
    expect(state.isPeriodActive).toBe(true);
    expect(state.isInsideStoppage).toBe(false);

    state = matchReducer(state, endPeriodState());
    expect(state.isPeriodActive).toBe(false);
  });

  it("should handle period number navigation safely", () => {
    let state = matchReducer(initialState, incrementPeriodNumber());
    expect(state.periodnumber).toBe(2);

    state = matchReducer(state, decrementPeriodNumber());
    expect(state.periodnumber).toBe(1);

    state = matchReducer(state, decrementPeriodNumber());
    expect(state.periodnumber).toBe(1);
  });

  it("should handle stoppage state transitions", () => {
    let state = matchReducer(initialState, startStoppageState());
    expect(state.isInsideStoppage).toBe(true);

    state = matchReducer(state, endStoppageState());
    expect(state.isInsideStoppage).toBe(false);
  });

  it("should increment sequence number step-by-step", () => {
    let state = matchReducer(initialState, incrementSequence());
    expect(state.globalSequenceNumber).toBe(1);

    state = matchReducer(state, incrementSequence());
    expect(state.globalSequenceNumber).toBe(2);
  });

  it("should reset the match state back to its initial state", () => {
    const dirtyState = {
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
