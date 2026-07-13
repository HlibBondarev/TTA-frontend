import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

interface MatchState {
  activeMatchId: string | null;
  periodnumber: number; // Strictly matches periodnumber in IndexedDB/Postgres
  homescore: number; // Strictly matches homescore in IndexedDB/Postgres
  guestscore: number; // Strictly matches guestscore in IndexedDB/Postgres
  isPeriodActive: boolean; // Runtime UI controller
  isInsideStoppage: boolean; // Runtime UI controller
  globalSequenceNumber: number; // Tracks sequenceNumber across actions
}

const initialState: MatchState = {
  activeMatchId: null,
  periodnumber: 1,
  homescore: 0,
  guestscore: 0,
  isPeriodActive: false,
  isInsideStoppage: false,
  globalSequenceNumber: 0,
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
  resetMatchState,
} = matchSlice.actions;

export default matchSlice.reducer;
