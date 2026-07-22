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
  periodnumber: number;
  homescore?: number;
  guestscore?: number;
  isPeriodActive: boolean;
  isInsideStoppage: boolean;
  globalSequenceNumber: number;
  recentActions: ActionEntry[];
}

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

const matchSlice = createSlice({
  name: "match",
  initialState,
  reducers: {
    setActiveMatch(state, action: PayloadAction<string | null>) {
      state.activeMatchId = action.payload;
      state.periodnumber = 1;
      state.homescore = 0;
      state.guestscore = 0;
      state.isPeriodActive = false;
      state.isInsideStoppage = false;
      state.globalSequenceNumber = 0;
      state.recentActions = [];
    },
    updateScores(
      state,
      action: PayloadAction<{ homescore: number; guestscore: number }>,
    ) {
      state.homescore = action.payload.homescore;
      state.guestscore = action.payload.guestscore;
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
      state.periodnumber += 1;
    },
    decrementPeriodNumber(state) {
      if (state.periodnumber > 1) {
        state.periodnumber -= 1;
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
