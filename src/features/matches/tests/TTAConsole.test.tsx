import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore, combineReducers } from "@reduxjs/toolkit";
import { TTAConsole } from "../components/TTAConsole";
import matchReducer from "../store/matchSlice";
import presenceReducer from "../../playerpresences/store/presenceSlice";

interface MockPresenceProps {
  setSelectedPlayerId: (id: string | null) => void;
}

vi.mock("../hooks/useMatchLifecycle", () => ({
  useMatchLifecycle: () => ({
    periodnumber: 1,
    isPeriodActive: true,
    isInsideStoppage: false,
  }),
}));

vi.mock("../../playerpresences/components/PlayerPresencePanel", () => ({
  PlayerPresencePanel: ({ setSelectedPlayerId }: MockPresenceProps) => (
    <button onClick={() => setSelectedPlayerId("player-1")}>Mock Player</button>
  ),
}));

const rootReducer = combineReducers({
  match: matchReducer,
  presence: presenceReducer,
});

type RootState = ReturnType<typeof rootReducer>;

const initialMatchState = matchReducer(undefined, { type: "unknown" });

describe("TTAConsole Component", () => {
  test("renders TTAConsole components correctly with active match", () => {
    const store = configureStore({
      reducer: rootReducer,
      preloadedState: {
        match: { ...initialMatchState, activeMatchId: "test-id" },
      } as unknown as RootState,
    });

    render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    expect(screen.getByText(/TTA Match Recorder/i)).toBeDefined();
  });

  test("successfully dispatches addRecentAction when ENTER is clicked", () => {
    const store = configureStore({
      reducer: rootReducer,
      preloadedState: {
        match: {
          ...initialMatchState,
          activeMatchId: "test-id",
          isPeriodActive: true,
        },
      } as unknown as RootState,
    });

    render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    // 1. Select action
    fireEvent.click(screen.getByText("Pass"));

    // 2. Select player via mocked presence panel
    fireEvent.click(screen.getByText("Mock Player"));

    // 3. Click Enter
    const enterBtn = screen.getByRole("button", { name: /Enter/i });
    expect(enterBtn).not.toBeDisabled();
    fireEvent.click(enterBtn);

    // 4. Verify action was cleared and pushed into Redux store
    expect(store.getState().match.recentActions.length).toBe(1);
    expect(store.getState().match.recentActions[0].actionName).toBe("Pass");
  });

  test("renders fallback message when activeMatchId is missing", () => {
    const store = configureStore({
      reducer: rootReducer,
      preloadedState: {
        match: { ...initialMatchState, activeMatchId: null },
      } as unknown as RootState,
    });

    render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    expect(screen.getByText(/No active match/i)).toBeInTheDocument();
  });
});
