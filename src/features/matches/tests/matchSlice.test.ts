import matchReducer, {
  setActiveMatch,
  updateScores,
  startPeriodState,
  endPeriodState,
  setPeriodStatePayload,
  incrementPeriodNumber,
  decrementPeriodNumber,
  startStoppageState,
  endStoppageState,
  incrementSequence,
  setGlobalSequenceNumber,
  resetMatchState,
  addRecentAction,
  type ActionEntry,
  type MatchState,
} from "../store/matchSlice";

describe("matchSlice Reducers", () => {
  const initialState: MatchState = {
    activeMatchId: null,
    activeTeamId: null,
    periodNumber: 1,
    homeScore: 0,
    guestScore: 0,
    isPeriodActive: false,
    isInsideStoppage: false,
    isPeriodEnded: false,
    globalSequenceNumber: 0,
    recentActions: [],
  };

  it("should return the initial state on first run", () => {
    expect(matchReducer(undefined, { type: "unknown" })).toEqual(initialState);
  });

  it("should set the active match and active team, and reset tracking counters", () => {
    const customState: MatchState = {
      ...initialState,
      periodNumber: 3,
      isPeriodEnded: true,
      globalSequenceNumber: 15,
    };

    const nextState = matchReducer(
      customState,
      setActiveMatch({
        matchId: "test-match-uuid",
        teamId: "test-team-uuid",
      }),
    );

    expect(nextState.activeMatchId).toBe("test-match-uuid");
    expect(nextState.activeTeamId).toBe("test-team-uuid");
    expect(nextState.periodNumber).toBe(1);
    expect(nextState.isPeriodEnded).toBe(false);
    expect(nextState.globalSequenceNumber).toBe(0);
  });

  it("should reset active match and active team when passing null payload", () => {
    const populatedState: MatchState = {
      ...initialState,
      activeMatchId: "active-match-123",
      activeTeamId: "active-team-456",
    };

    const nextState = matchReducer(populatedState, setActiveMatch(null));

    expect(nextState.activeMatchId).toBeNull();
    expect(nextState.activeTeamId).toBeNull();
  });

  it("should handle updating match scores", () => {
    const nextState = matchReducer(
      initialState,
      updateScores({ homeScore: 5, guestScore: 3 }),
    );

    expect(nextState.homeScore).toBe(5);
    expect(nextState.guestScore).toBe(3);
  });

  it("should handle starting and ending a period", () => {
    const stateStarted = matchReducer(initialState, startPeriodState());
    expect(stateStarted.isPeriodActive).toBe(true);
    expect(stateStarted.isInsideStoppage).toBe(false);
    expect(stateStarted.isPeriodEnded).toBe(false);

    const stateEnded = matchReducer(stateStarted, endPeriodState());
    expect(stateEnded.isPeriodActive).toBe(false);
    expect(stateEnded.isInsideStoppage).toBe(false);
    expect(stateEnded.isPeriodEnded).toBe(true);
  });

  it("should handle setPeriodStatePayload to explicitly sync period flags", () => {
    const nextState = matchReducer(
      initialState,
      setPeriodStatePayload({
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: true,
      }),
    );

    expect(nextState.isPeriodActive).toBe(false);
    expect(nextState.isInsideStoppage).toBe(false);
    expect(nextState.isPeriodEnded).toBe(true);
  });

  it("should handle period number navigation safely", () => {
    const stateInc = matchReducer(initialState, incrementPeriodNumber());
    expect(stateInc.periodNumber).toBe(2);

    const stateDec = matchReducer(stateInc, decrementPeriodNumber());
    expect(stateDec.periodNumber).toBe(1);

    const stateSafe = matchReducer(stateDec, decrementPeriodNumber());
    expect(stateSafe.periodNumber).toBe(1);
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

  it("should explicitly set global sequence number", () => {
    const nextState = matchReducer(initialState, setGlobalSequenceNumber(42));
    expect(nextState.globalSequenceNumber).toBe(42);
  });

  it("should handle adding recent actions with a maximum limit of 10", () => {
    let currentState: MatchState = initialState;

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

    expect(currentState.recentActions).toHaveLength(10);
    expect(currentState.recentActions[0].id).toBe("action-11");
    expect(currentState.recentActions[9].id).toBe("action-2");
    expect(
      currentState.recentActions.some((act) => act.id === "action-1"),
    ).toBe(false);
  });

  it("should reset the match state back to its initial state", () => {
    const dirtyState: MatchState = {
      ...initialState,
      activeMatchId: "active-session-uuid",
      activeTeamId: "active-team-uuid",
      periodNumber: 4,
      homeScore: 10,
      guestScore: 8,
      isPeriodActive: true,
      isInsideStoppage: true,
      isPeriodEnded: true,
      globalSequenceNumber: 42,
    };

    const nextState = matchReducer(dirtyState, resetMatchState());
    expect(nextState).toEqual(initialState);
  });
});
