import { configureStore } from "@reduxjs/toolkit";
import matchReducer from "../features/matches/store/matchSlice";
import uiReducer from "./slices/uiSlice";
import presenceReducer from "../features/playerpresences/store/presenceSlice";

export const store = configureStore({
  reducer: {
    match: matchReducer,
    ui: uiReducer,
    presence: presenceReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
