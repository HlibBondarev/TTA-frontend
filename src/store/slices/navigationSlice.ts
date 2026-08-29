import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type AppCurrentView =
  | "AUTH_GATE"
  | "HUB"
  | "QUICK_START"
  | "MY_MATCHES"
  | "TOURNAMENT_STUB"
  | "CONSOLE";

export interface NavigationState {
  currentView: AppCurrentView;
}

const initialState: NavigationState = {
  currentView: "HUB",
};

const navigationSlice = createSlice({
  name: "navigation",
  initialState,
  reducers: {
    setCurrentView(state, action: PayloadAction<AppCurrentView>) {
      state.currentView = action.payload;
    },
    navigateToHub(state) {
      state.currentView = "HUB";
    },
    navigateToMyMatches(state) {
      state.currentView = "MY_MATCHES";
    },
  },
});

export const { setCurrentView, navigateToHub, navigateToMyMatches } =
  navigationSlice.actions;
export default navigationSlice.reducer;
