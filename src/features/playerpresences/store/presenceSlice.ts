import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

interface PresenceState {
  currentPeriod: number;
  activeLineupIds: string[];
  benchLineupIds: string[];
  selectedStartingIds: string[]; // Holds prepared players before "START PERIOD" is pressed
  activePlayersLimit: number;
  isLoading: boolean;
}

const initialState: PresenceState = {
  currentPeriod: 1,
  activeLineupIds: [],
  benchLineupIds: [],
  selectedStartingIds: [],
  activePlayersLimit: 7,
  isLoading: false,
};

export const presenceSlice = createSlice({
  name: "presence",
  initialState,
  reducers: {
    setPresenceLimits: (
      state,
      action: PayloadAction<{ limit: number; period: number }>,
    ) => {
      state.activePlayersLimit = action.payload.limit;
      state.currentPeriod = action.payload.period;
    },
    loadRosterState: (
      state,
      action: PayloadAction<{ active: string[]; bench: string[] }>,
    ) => {
      const activeSet = new Set(action.payload.active);
      state.activeLineupIds = Array.from(activeSet);
      state.benchLineupIds = Array.from(
        new Set(action.payload.bench.filter((id) => !activeSet.has(id))),
      );
      state.selectedStartingIds = []; // Reset prepared starting lineup on DB state sync
      state.isLoading = false;
    },
    // Prepare starting lineup in UI only
    setSelectedStartingIds: (state, action: PayloadAction<string[]>) => {
      state.selectedStartingIds = Array.from(new Set(action.payload));
    },
    // Triggers when "START PERIOD" is confirmed
    commitStartingLineup: (state, action: PayloadAction<string[]>) => {
      const activeSet = new Set(action.payload);
      state.activeLineupIds = Array.from(activeSet);
      state.benchLineupIds = state.benchLineupIds.filter(
        (id) => !activeSet.has(id),
      );
      state.selectedStartingIds = [];
    },
    // Triggers when "END PERIOD" is pressed (moves everyone back to bench)
    clearActiveRosterToBench: (state) => {
      state.benchLineupIds = Array.from(
        new Set([...state.benchLineupIds, ...state.activeLineupIds]),
      );
      state.activeLineupIds = [];
      state.selectedStartingIds = [];
    },
    optimisticSubstitute: (
      state,
      action: PayloadAction<{ outId: string; inId: string }>,
    ) => {
      const { outId, inId } = action.payload;
      state.activeLineupIds = Array.from(
        new Set(state.activeLineupIds.map((id) => (id === outId ? inId : id))),
      );
      state.benchLineupIds = Array.from(
        new Set(state.benchLineupIds.map((id) => (id === inId ? outId : id))),
      );
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
  },
});

export const {
  setPresenceLimits,
  loadRosterState,
  setSelectedStartingIds,
  commitStartingLineup,
  clearActiveRosterToBench,
  optimisticSubstitute,
  setLoading,
} = presenceSlice.actions;

export default presenceSlice.reducer;
