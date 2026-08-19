import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface ActionEntry {
  id: string;
  playerNumber: number;
  actionName: string;
  isPositive: boolean;
  timestamp: string;
  matchLineupId: string;
  eventDefinitionId: string;
  isLeadToGoal: boolean;
  isSynced: number; // 0 = Pending, 1 = Synced
}

export interface MatchState {
  activeMatchId: string | null;
  activeTeamId: string | null;
  periodNumber: number;
  homeScore?: number;
  guestScore?: number;
  isPeriodActive: boolean;
  isInsideStoppage: boolean;
  isPeriodEnded: boolean;
  globalSequenceNumber: number;
  recentActions: ActionEntry[];
}

export interface SetActiveMatchPayload {
  matchId: string;
  teamId: string;
}

export interface SetPeriodStatePayload {
  isPeriodActive: boolean;
  isInsideStoppage: boolean;
  isPeriodEnded: boolean;
}

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
      state.isPeriodEnded = false;
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
      state.isPeriodEnded = false;
    },
    endPeriodState(state) {
      state.isPeriodActive = false;
      state.isInsideStoppage = false;
      state.isPeriodEnded = true;
    },
    setPeriodStatePayload(state, action: PayloadAction<SetPeriodStatePayload>) {
      state.isPeriodActive = action.payload.isPeriodActive;
      state.isInsideStoppage = action.payload.isInsideStoppage;
      state.isPeriodEnded = action.payload.isPeriodEnded;
    },
    incrementPeriodNumber(state) {
      if (!state.isPeriodActive) {
        state.periodNumber += 1;
      }
    },
    decrementPeriodNumber(state) {
      if (!state.isPeriodActive && state.periodNumber > 1) {
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
    updateRecentAction(
      state,
      action: PayloadAction<Partial<ActionEntry> & { id: string }>,
    ) {
      const index = state.recentActions.findIndex(
        (a) => a.id === action.payload.id,
      );
      if (index !== -1) {
        state.recentActions[index] = {
          ...state.recentActions[index],
          ...action.payload,
        };
      }
    },
    deleteRecentAction(state, action: PayloadAction<string>) {
      state.recentActions = state.recentActions.filter(
        (a) => a.id !== action.payload,
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
  setPeriodStatePayload,
  incrementPeriodNumber,
  decrementPeriodNumber,
  startStoppageState,
  endStoppageState,
  incrementSequence,
  setGlobalSequenceNumber,
  addRecentAction,
  updateRecentAction,
  deleteRecentAction,
  resetMatchState,
} = matchSlice.actions;

export default matchSlice.reducer;
