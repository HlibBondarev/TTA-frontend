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
import matchReducer, { addRecentAction } from "../store/matchSlice";
import presenceReducer from "../../playerpresences/store/presenceSlice";
import uiReducer from "../../../store/slices/uiSlice";
import navigationReducer from "../../../store/slices/navigationSlice";
import { db } from "../../../db/ttaDatabase";
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

// Mock Auth0 to provide a valid authenticated user ID for TTAPanel
vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    user: { sub: "user-1", id: "user-1" },
  }),
}));

vi.mock("../components/MatchLifecyclePanel", () => ({
  MatchLifecyclePanel: ({
    onFinalizeSuccess,
  }: {
    onFinalizeSuccess?: () => void;
  }) => <button onClick={onFinalizeSuccess}>Mock Finalize Success</button>,
}));

vi.mock("../hooks/useMatchLifecycle", () => ({
  useMatchLifecycle: () => ({
    periodNumber: mockPeriodNumber,
    isPeriodActive: mockPeriodActive,
    isInsideStoppage: false,
  }),
}));

const mockRecordGameEvent = vi.fn();

vi.mock("../hooks/useGameEvents", () => ({
  useGameEvents: () => ({
    recordGameEvent: mockRecordGameEvent,
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

const mockWhereEqualsToArray = vi.hoisted(() => vi.fn());

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matches: {
      get: vi.fn(),
    },
    tournaments: {
      get: vi.fn(),
    },
    matchlineups: {
      get: vi.fn(),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    },
    playerrosters: {
      get: vi.fn(),
    },
    eventdefinitions: {
      toArray: vi.fn(),
      where: vi.fn(() => ({
        equals: mockWhereEqualsToArray,
      })),
    },
  },
}));

// Lightweight liveQuery mock for async state subscription in tests
vi.mock("dexie", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dexie")>();
  return {
    ...actual,
    liveQuery: (fn: () => Promise<unknown>) => ({
      subscribe: (observer: {
        next: (val: unknown) => void;
        error?: (err: unknown) => void;
      }) => {
        fn()
          .then((data) => observer.next(data))
          .catch((err) => observer.error?.(err));
        return { unsubscribe: vi.fn() };
      },
    }),
  };
});

vi.mock("../../../db/eventService", () => ({
  getEventDefinitionByName: vi.fn(),
  createGameEventTx: vi.fn(),
  clearEventDefinitionsCache: vi.fn(),
  isSportHydratedForUser: vi.fn().mockReturnValue(true),
}));

const rootReducer = combineReducers({
  match: matchReducer,
  presence: presenceReducer,
  ui: uiReducer,
  navigation: navigationReducer,
});

type RootState = ReturnType<typeof rootReducer>;

const initialMatchState = matchReducer(undefined, { type: "unknown" });

describe("TTAConsole Component", () => {
  const mockEventDefs = [
    {
      id: "def-pass",
      sportId: "sport-1",
      name: "Pass",
      shortName: "PS",
      isPositive: true,
      isEnabled: true,
    },
    {
      id: "def-goal",
      sportId: "sport-1",
      name: "Goal",
      shortName: "GL",
      isPositive: true,
      isEnabled: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockPeriodActive = true;
    mockPeriodNumber = 1;

    vi.mocked(db.matches.get).mockResolvedValue({
      id: "test-id",
      tournamentId: "t-1",
      userId: "user-1",
    } as never);

    vi.mocked(db.tournaments.get).mockResolvedValue({
      id: "t-1",
      sportId: "sport-1",
    } as never);

    mockWhereEqualsToArray.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockEventDefs),
    });

    vi.mocked(db.eventdefinitions.toArray).mockResolvedValue(mockEventDefs);

    vi.mocked(db.matchlineups.get).mockResolvedValue({
      id: "player-1",
      matchId: "test-id",
      number: 7,
      playerRosterId: "roster-1",
      positionId: null,
    });

    vi.mocked(db.playerrosters.get).mockResolvedValue({
      id: "roster-1",
      teamId: "team-123",
      number: 7,
      playerId: "person-1",
      tournamentId: "t-1",
      createdAt: "",
      positionId: "",
    });

    vi.mocked(getEventDefinitionByName).mockResolvedValue({
      id: "def-pass",
      sportId: "sport-1",
      name: "Pass",
      shortName: "PS",
      isPositive: true,
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
        match: {
          ...initialMatchState,
          activeMatchId: "test-id",
          activeTeamId: "team-123",
        },
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
          activeTeamId: "team-123",
          isPeriodActive: true,
        },
      } as unknown as RootState,
    });

    mockRecordGameEvent.mockImplementationOnce(async ({ actionName }) => {
      store.dispatch(
        addRecentAction({
          id: "event-uuid-1",
          playerNumber: 7,
          actionName,
          isPositive: true,
          timestamp: new Date().toISOString(),
          matchLineupId: "player-1",
          eventDefinitionId: "def-pass",
          isLeadToGoal: false,
          isSynced: 0,
        }),
      );
    });

    render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    const passBtn = await screen.findByText("Pass");
    fireEvent.click(passBtn);
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
    let resolveEvent: () => void;
    mockRecordGameEvent.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveEvent = resolve;
        }),
    );

    const store = configureStore({
      reducer: rootReducer,
      preloadedState: {
        match: {
          ...initialMatchState,
          activeMatchId: "test-id",
          activeTeamId: "team-123",
          isPeriodActive: true,
        },
      } as unknown as RootState,
    });

    render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    const passBtn = await screen.findByText("Pass");
    fireEvent.click(passBtn);
    fireEvent.click(screen.getByText("Mock Player"));

    const enterBtn = screen.getByRole("button", { name: /Enter/i });

    // First click initiates transaction
    fireEvent.click(enterBtn);
    // Rapid second click during in-flight submission
    fireEvent.click(enterBtn);

    await waitFor(() => {
      expect(mockRecordGameEvent).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      resolveEvent!();
    });

    expect(mockRecordGameEvent).toHaveBeenCalledTimes(1);
  });

  test("displays error alert if event recording fails", async () => {
    mockRecordGameEvent.mockRejectedValueOnce(
      new Error("Database write error"),
    );

    const store = configureStore({
      reducer: rootReducer,
      preloadedState: {
        match: {
          ...initialMatchState,
          activeMatchId: "test-id",
          activeTeamId: "team-123",
          isPeriodActive: true,
        },
      } as unknown as RootState,
    });

    render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    const passBtn = await screen.findByText("Pass");
    fireEvent.click(passBtn);
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
          activeTeamId: "team-123",
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
        match: {
          ...initialMatchState,
          activeMatchId: null,
          activeTeamId: null,
        },
      } as unknown as RootState,
    });

    render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    expect(screen.getByText(/No active match/i)).toBeInTheDocument();
  });

  test("records events with default isLeadToGoal = false for all actions", async () => {
    const store = configureStore({
      reducer: rootReducer,
      preloadedState: {
        match: {
          ...initialMatchState,
          activeMatchId: "test-id",
          activeTeamId: "team-123",
          isPeriodActive: true,
        },
      } as unknown as RootState,
    });

    render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    // Select "Pass" and record
    const passBtn = await screen.findByText("Pass");
    fireEvent.click(passBtn);
    fireEvent.click(screen.getByText("Mock Player"));

    const enterBtn = screen.getByRole("button", { name: /Enter/i });
    fireEvent.click(enterBtn);

    await waitFor(() => {
      expect(mockRecordGameEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          isLeadToGoal: false,
        }),
      );
    });
  });

  test("triggers handleFinalizeSuccess, resets match and presence states, and calls onCompleteMatch", () => {
    const onCompleteMatchMock = vi.fn();
    const store = configureStore({
      reducer: rootReducer,
      preloadedState: {
        match: {
          ...initialMatchState,
          activeMatchId: "test-id",
          activeTeamId: "team-123",
          isPeriodActive: true,
          homeScore: 5,
          guestScore: 3,
        },
        presence: {
          currentPeriod: 2,
          activeLineupIds: ["p1", "p2"],
          benchLineupIds: ["p3"],
          selectedStartingIds: ["p4"],
          activePlayersLimit: 7,
          isLoading: false,
        },
      } as unknown as RootState,
    });

    render(
      <Provider store={store}>
        <TTAConsole onCompleteMatch={onCompleteMatchMock} />
      </Provider>,
    );

    fireEvent.click(screen.getByText("Mock Finalize Success"));

    expect(onCompleteMatchMock).toHaveBeenCalledTimes(1);
    expect(store.getState().match.activeMatchId).toBeNull();
    expect(store.getState().presence.currentPeriod).toBe(1);
    expect(store.getState().presence.activeLineupIds).toEqual([]);
  });
});
