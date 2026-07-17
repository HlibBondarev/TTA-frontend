import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

interface UIState {
  activeTab: string;
  isSettingsModalOpen: boolean;
}

const initialState: UIState = {
  activeTab: "dashboard",
  isSettingsModalOpen: false,
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setActiveTab(state, action: PayloadAction<string>) {
      state.activeTab = action.payload;
    },
    setSettingsModalOpen(state, action: PayloadAction<boolean>) {
      state.isSettingsModalOpen = action.payload;
    },
  },
});

export const { setActiveTab, setSettingsModalOpen } = uiSlice.actions;
export default uiSlice.reducer;
