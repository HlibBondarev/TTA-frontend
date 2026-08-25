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
  },
});

export const { setCurrentView, navigateToHub } = navigationSlice.actions;
export default navigationSlice.reducer;
