import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface ActionEntry {
  id: string;
  playerNumber: number;
  actionName: string;
  isPositive: boolean;
  timestamp: string;
}

export interface MatchState {
  activeMatchId: string | null;
  activeTeamId: string | null;
  periodNumber: number;
  homeScore?: number;
  guestScore?: number;
  isPeriodActive: boolean;
  isInsideStoppage: boolean;
  globalSequenceNumber: number;
  recentActions: ActionEntry[];
}

export interface SetActiveMatchPayload {
  matchId: string;
  teamId: string;
}

const initialState: MatchState = {
  activeMatchId: null,
  activeTeamId: null,
  periodNumber: 1,
  homeScore: 0,
  guestScore: 0,
  isPeriodActive: false,
  isInsideStoppage: false,
  globalSequenceNumber: 0,
  recentActions: [],
};

const matchSlice = createSlice({
  name: "match",
  initialState,
  reducers: {
    setActiveMatch(state, action: PayloadAction<SetActiveMatchPayload | null>) {
      if (!action.payload) {
        state.activeMatchId = null;
        state.activeTeamId = null;
      } else {
        state.activeMatchId = action.payload.matchId;
        state.activeTeamId = action.payload.teamId;
      }
      state.periodNumber = 1;
      state.homeScore = 0;
      state.guestScore = 0;
      state.isPeriodActive = false;
      state.isInsideStoppage = false;
      state.globalSequenceNumber = 0;
      state.recentActions = [];
    },
    updateScores(
      state,
      action: PayloadAction<{ homeScore: number; guestScore: number }>,
    ) {
      state.homeScore = action.payload.homeScore;
      state.guestScore = action.payload.guestScore;
    },
    startPeriodState(state) {
      state.isPeriodActive = true;
      state.isInsideStoppage = false;
    },
    endPeriodState(state) {
      state.isPeriodActive = false;
      state.isInsideStoppage = false;
    },
    incrementPeriodNumber(state) {
      state.periodNumber += 1;
    },
    decrementPeriodNumber(state) {
      if (state.periodNumber > 1) {
        state.periodNumber -= 1;
      }
    },
    startStoppageState(state) {
      state.isInsideStoppage = true;
    },
    endStoppageState(state) {
      state.isInsideStoppage = false;
    },
    incrementSequence(state) {
      state.globalSequenceNumber += 1;
    },
    setGlobalSequenceNumber(state, action: PayloadAction<number>) {
      state.globalSequenceNumber = action.payload;
    },
    addRecentAction(state, action: PayloadAction<ActionEntry>) {
      state.recentActions = [action.payload, ...state.recentActions].slice(
        0,
        10,
      );
    },
    resetMatchState() {
      return initialState;
    },
  },
});

export const {
  setActiveMatch,
  updateScores,
  startPeriodState,
  endPeriodState,
  incrementPeriodNumber,
  decrementPeriodNumber,
  startStoppageState,
  endStoppageState,
  incrementSequence,
  setGlobalSequenceNumber,
  addRecentAction,
  resetMatchState,
} = matchSlice.actions;

export default matchSlice.reducer;
