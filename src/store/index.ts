import { configureStore } from "@reduxjs/toolkit";
import matchReducer from "../features/matches/matchSlice";
import uiReducer from "./uiSlice";

export const store = configureStore({
  reducer: {
    match: matchReducer,
    ui: uiReducer,
  },
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
