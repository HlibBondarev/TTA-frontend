import { vi, describe, test, expect, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore, combineReducers } from "@reduxjs/toolkit";
import { TTAConsole } from "../components/TTAConsole";
import matchReducer from "../store/matchSlice";
import presenceReducer from "../../playerpresences/store/presenceSlice";
import { db, type GameEvent } from "../../../db/ttaDatabase";
import {
  getEventDefinitionByName,
  createGameEventTx,
} from "../../../db/eventService";

interface MockPresenceProps {
  setSelectedPlayerId: (id: string | null) => void;
  selectedPlayerId: string | null;
}

let mockPeriodActive = true;
let mockPeriodNumber = 1;

vi.mock("../hooks/useMatchLifecycle", () => ({
  useMatchLifecycle: () => ({
    periodNumber: mockPeriodNumber,
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

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matchlineups: {
      get: vi.fn(),
    },
  },
}));

vi.mock("../../../db/eventService", () => ({
  getEventDefinitionByName: vi.fn(),
  createGameEventTx: vi.fn(),
}));

const rootReducer = combineReducers({
  match: matchReducer,
  presence: presenceReducer,
});

type RootState = ReturnType<typeof rootReducer>;

const initialMatchState = matchReducer(undefined, { type: "unknown" });

describe("TTAConsole Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPeriodActive = true;
    mockPeriodNumber = 1;

    vi.mocked(db.matchlineups.get).mockResolvedValue({
      id: "player-1",
      matchId: "test-id",
      number: 7,
      playerRosterId: "roster-1",
      isInStartingLineup: true,
      positionId: null,
    });

    vi.mocked(getEventDefinitionByName).mockResolvedValue({
      id: "def-pass",
      sportId: "sport-1",
      name: "Pass",
      shortName: "PS",
      isPositive: true,
      createdAt: new Date().toISOString(),
    });

    vi.mocked(createGameEventTx).mockResolvedValue({
      id: "event-uuid-1",
      matchLineupId: "player-1",
      eventDefinitionId: "def-pass",
      periodNumber: 1,
      eventTimestamp: new Date().toISOString(),
      isLeadToGoal: false,
      createdAt: new Date().toISOString(),
      sequenceNumber: 1,
      isSynced: 0,
    });
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

  test("successfully dispatches addRecentAction when ENTER is clicked", async () => {
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

    await waitFor(() => {
      expect(store.getState().match.recentActions).toHaveLength(1);
    });

    expect(store.getState().match.recentActions[0].actionName).toBe("Pass");
    expect(store.getState().match.recentActions[0].playerNumber).toBe(7);
  });

  test("prevents rapid double submission when ENTER is clicked twice quickly", async () => {
    let resolveEvent: (value: GameEvent) => void;
    vi.mocked(createGameEventTx).mockImplementationOnce(
      () =>
        new Promise<GameEvent>((resolve) => {
          resolveEvent = resolve;
        }),
    );

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

    // First click initiates transaction
    fireEvent.click(enterBtn);
    // Rapid second click during in-flight submission
    fireEvent.click(enterBtn);

    // Wait for the async lookup chain to reach createGameEventTx
    await waitFor(() => {
      expect(createGameEventTx).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      resolveEvent!({
        id: "event-uuid-1",
        matchLineupId: "player-1",
        eventDefinitionId: "def-pass",
        periodNumber: 1,
        eventTimestamp: new Date().toISOString(),
        isLeadToGoal: false,
        createdAt: new Date().toISOString(),
        sequenceNumber: 1,
        isSynced: 0,
      });
    });

    expect(createGameEventTx).toHaveBeenCalledTimes(1);
  });

  test("displays error alert if event recording fails", async () => {
    vi.mocked(db.matchlineups.get).mockRejectedValueOnce(
      new Error("Database write error"),
    );

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

    fireEvent.click(enterBtn);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Database write error",
    );
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
