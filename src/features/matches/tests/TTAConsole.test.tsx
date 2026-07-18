import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore, combineReducers } from "@reduxjs/toolkit";
import { TTAConsole } from "../components/TTAConsole";
import matchReducer from "../store/matchSlice";
import presenceReducer from "../../playerpresences/store/presenceSlice";

const rootReducer = combineReducers({
  match: matchReducer,
  presence: presenceReducer,
});

// Define the partial state type explicitly to avoid 'any'
type RootState = ReturnType<typeof rootReducer>;

describe("TTAConsole Component", () => {
  test("renders TTAConsole components correctly with active match", () => {
    const store = configureStore({
      reducer: rootReducer,
      preloadedState: {
        match: { activeMatchId: "test-id" },
      } as RootState,
    });

    render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    expect(screen.getByText(/TTA Match Recorder/i)).toBeDefined();
    expect(screen.getByText(/Active Players/i)).toBeInTheDocument();
  });

  test("renders fallback message when activeMatchId is missing", () => {
    const store = configureStore({
      reducer: rootReducer,
      preloadedState: {
        match: { activeMatchId: null },
      } as RootState,
    });

    render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    expect(screen.queryByText(/Active Players/i)).not.toBeInTheDocument();
    expect(screen.getByText(/No active match/i)).toBeInTheDocument();
  });
});
