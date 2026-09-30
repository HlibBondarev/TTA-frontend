import { configureStore } from "@reduxjs/toolkit";
import matchReducer from "../features/matches/store/matchSlice";
import uiReducer from "./slices/uiSlice";
import presenceReducer from "../features/playerpresences/store/presenceSlice";
import navigationReducer from "./slices/navigationSlice";

export const store = configureStore({
  reducer: {
    match: matchReducer,
    ui: uiReducer,
    presence: presenceReducer,
    navigation: navigationReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
