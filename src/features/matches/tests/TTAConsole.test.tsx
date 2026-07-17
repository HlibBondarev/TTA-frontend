import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore, combineReducers } from "@reduxjs/toolkit";
import { TTAConsole } from "../components/TTAConsole";
import matchReducer from "../store/matchSlice";
import presenceReducer from "../../playerpresences/store/presenceSlice";
import { type RootState } from "../../../store";

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[P] extends object
      ? DeepPartial<T[P]>
      : T[P];
};

const rootReducer = combineReducers({
  match: matchReducer,
  presence: presenceReducer,
});

describe("TTAConsole Component", () => {
  test("renders TTAConsole components correctly", () => {
    const store = configureStore({ reducer: rootReducer });
    render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );
    expect(screen.getByText(/TTA Match Recorder/i)).toBeDefined();
  });

  test("renders panels when activeMatchId is present", () => {
    const store = configureStore({
      reducer: rootReducer,
      preloadedState: {
        match: { activeMatchId: "test-id" },
      } as DeepPartial<RootState> as RootState,
    });
    render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    // Check for specific unique text elements
    expect(screen.getByText(/Sector 2: Active Players/i)).toBeInTheDocument();
    expect(screen.getByText(/Sector 5: Period Control/i)).toBeInTheDocument();
  });

  test("renders fallback message when activeMatchId is missing", () => {
    const store = configureStore({
      reducer: rootReducer,
      preloadedState: {
        match: { activeMatchId: null },
      } as DeepPartial<RootState> as RootState,
    });
    render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    expect(
      screen.queryByText(/Sector 5: Period Control/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/No active match/i)).toBeInTheDocument();
  });
});
