import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

interface PresenceState {
  currentPeriod: number;
  activeLineupIds: string[];
  benchLineupIds: string[];
  selectedStartingIds: string[]; // Holds prepared players before "START PERIOD" is pressed
  clearedPenaltyEventIds?: string[]; // Holds pre-period manually cleared carried-over penalty event IDs
  activePlayersLimit: number;
  maxPersonalFouls: number | null | undefined;
  isLoading: boolean;
}

const initialState: PresenceState = {
  currentPeriod: 1,
  activeLineupIds: [],
  benchLineupIds: [],
  selectedStartingIds: [],
  clearedPenaltyEventIds: [],
  activePlayersLimit: 0,
  maxPersonalFouls: undefined,
  isLoading: false,
};

export const presenceSlice = createSlice({
  name: "presence",
  initialState,
  reducers: {
    setPresenceLimits: (
      state,
      action: PayloadAction<{
        limit: number;
        period: number;
        maxPersonalFouls?: number | null;
      }>,
    ) => {
      if (state.currentPeriod !== action.payload.period) {
        state.clearedPenaltyEventIds = [];
      }
      state.activePlayersLimit = action.payload.limit;
      state.currentPeriod = action.payload.period;
      state.maxPersonalFouls = action.payload.maxPersonalFouls;
    },
    setMaxPersonalFouls: (
      state,
      action: PayloadAction<number | null | undefined>,
    ) => {
      state.maxPersonalFouls = action.payload;
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
      state.clearedPenaltyEventIds = [];
      state.isLoading = false;
    },
    syncActiveAndBenchRoster: (
      state,
      action: PayloadAction<{ active: string[]; bench: string[] }>,
    ) => {
      const activeSet = new Set(action.payload.active);
      state.activeLineupIds = Array.from(activeSet);
      state.benchLineupIds = Array.from(
        new Set(action.payload.bench.filter((id) => !activeSet.has(id))),
      );
    },
    // Prepare starting lineup in UI only
    setSelectedStartingIds: (state, action: PayloadAction<string[]>) => {
      state.selectedStartingIds = Array.from(new Set(action.payload));
    },
    setClearedPenaltyEventIds: (state, action: PayloadAction<string[]>) => {
      state.clearedPenaltyEventIds = Array.from(new Set(action.payload));
    },
    // Triggers when "START PERIOD" is confirmed
    commitStartingLineup: (state, action: PayloadAction<string[]>) => {
      const activeSet = new Set(action.payload);
      state.activeLineupIds = Array.from(activeSet);
      state.benchLineupIds = state.benchLineupIds.filter(
        (id) => !activeSet.has(id),
      );
      state.selectedStartingIds = [];
      state.clearedPenaltyEventIds = [];
    },
    // Triggers when "END PERIOD" is pressed (moves everyone back to bench)
    clearActiveRosterToBench: (state) => {
      state.benchLineupIds = Array.from(
        new Set([...state.benchLineupIds, ...state.activeLineupIds]),
      );
      state.activeLineupIds = [];
      state.selectedStartingIds = [];
      state.clearedPenaltyEventIds = [];
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
    optimisticEnterActivePlayer: (state, action: PayloadAction<string>) => {
      const inId = action.payload;
      state.activeLineupIds = Array.from(
        new Set([...state.activeLineupIds, inId]),
      );
      state.benchLineupIds = state.benchLineupIds.filter((id) => id !== inId);
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    resetPresenceState: () => initialState,
  },
});

export const {
  setPresenceLimits,
  setMaxPersonalFouls,
  loadRosterState,
  syncActiveAndBenchRoster,
  setSelectedStartingIds,
  setClearedPenaltyEventIds,
  commitStartingLineup,
  clearActiveRosterToBench,
  optimisticSubstitute,
  optimisticEnterActivePlayer,
  setLoading,
  resetPresenceState,
} = presenceSlice.actions;

export default presenceSlice.reducer;
