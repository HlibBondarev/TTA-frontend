import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

interface MatchState {
  activeMatchId: string | null;
  currentPeriod: number;
  homeScore: number;
  guestScore: number;
  isTimerRunning: boolean;
}

const initialState: MatchState = {
  activeMatchId: null,
  currentPeriod: 1,
  homeScore: 0,
  guestScore: 0,
  isTimerRunning: false,
};

const matchSlice = createSlice({
  name: "match",
  initialState,
  reducers: {
    setActiveMatch(state, action: PayloadAction<string | null>) {
      state.activeMatchId = action.payload;
    },
    setPeriod(state, action: PayloadAction<number>) {
      state.currentPeriod = action.payload;
    },
    updateScores(
      state,
      action: PayloadAction<{ home: number; guest: number }>,
    ) {
      state.homeScore = action.payload.home;
      state.guestScore = action.payload.guest;
    },
    toggleTimer(state) {
      state.isTimerRunning = !state.isTimerRunning;
    },
    // State parameter removed to satisfy compiler/linter strict rules
    resetMatchState() {
      return initialState;
    },
  },
});

export const {
  setActiveMatch,
  setPeriod,
  updateScores,
  toggleTimer,
  resetMatchState,
} = matchSlice.actions;
export default matchSlice.reducer;
