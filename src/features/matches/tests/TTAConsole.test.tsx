import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore, combineReducers } from "@reduxjs/toolkit";
import { TTAConsole } from "../components/TTAConsole";
import matchReducer from "../store/matchSlice";
import presenceReducer from "../../playerpresences/store/presenceSlice";

interface MockPresenceProps {
  setSelectedPlayerId: (id: string | null) => void;
  selectedPlayerId: string | null;
}

let mockPeriodActive = true;
let mockPeriodNumber = 1;

vi.mock("../hooks/useMatchLifecycle", () => ({
  useMatchLifecycle: () => ({
    periodnumber: mockPeriodNumber,
    isPeriodActive: mockPeriodActive,
    isInsideStoppage: false,
  }),
}));

vi.mock("../../playerpresences/components/PlayerPresencePanel", () => ({
  PlayerPresencePanel: ({
    setSelectedPlayerId,
    selectedPlayerId,
  }: MockPresenceProps) => (
    <div>
      <button onClick={() => setSelectedPlayerId("player-1")}>
        Mock Player
      </button>
      <span>Selected: {selectedPlayerId || "none"}</span>
    </div>
  ),
}));

const rootReducer = combineReducers({
  match: matchReducer,
  presence: presenceReducer,
});

type RootState = ReturnType<typeof rootReducer>;

const initialMatchState = matchReducer(undefined, { type: "unknown" });

describe("TTAConsole Component", () => {
  beforeEach(() => {
    mockPeriodActive = true;
    mockPeriodNumber = 1;
  });

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

    fireEvent.click(screen.getByText("Pass"));
    fireEvent.click(screen.getByText("Mock Player"));

    const enterBtn = screen.getByRole("button", { name: /Enter/i });
    expect(enterBtn).not.toBeDisabled();
    fireEvent.click(enterBtn);

    expect(store.getState().match.recentActions.length).toBe(1);
    expect(store.getState().match.recentActions[0].actionName).toBe("Pass");
  });

  test("resets selection and action states when period transitions", () => {
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

    const { rerender } = render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    // Select player and check selection presence
    fireEvent.click(screen.getByText("Mock Player"));
    expect(screen.getByText("Selected: player-1")).toBeInTheDocument();

    // Trigger runtime period number increment simulation
    mockPeriodNumber = 2;

    rerender(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    // Verify selection state rolled back to clear out state for the new period block
    expect(screen.getByText("Selected: none")).toBeInTheDocument();
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
