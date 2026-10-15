import { vi, describe, test, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MatchResultModal } from "../components/MatchResultModal";
import matchReducer, { type MatchState } from "../store/matchSlice";
import navigationReducer, {
  type NavigationState,
} from "../../../store/slices/navigationSlice";
import { matchFinalizationService } from "../../../services/matchFinalizationService";
import { reportService } from "../../../services/reportService";

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    user: { sub: "test-user-id", email: "test@example.com" },
    isAuthenticated: true,
  }),
}));

vi.mock("../../../services/matchFinalizationService", () => ({
  matchFinalizationService: {
    finalizeMatch: vi.fn(),
  },
}));

vi.mock("../../../services/reportService", () => ({
  reportService: {
    getTeamSummaryReport: vi.fn(),
    getPlayerDetailedReport: vi.fn(),
  },
}));

// Mock IndexedDB queries in db
vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matches: {
      get: vi.fn(),
    },
    matchlineups: {
      where: vi.fn(),
    },
    playerrosters: {
      where: vi.fn(),
    },
    eventdefinitions: {
      toArray: vi.fn(),
    },
    gameevents: {
      where: vi.fn(),
    },
  },
}));

import { db } from "../../../db/ttaDatabase";

const setupDefaultDbMocks = () => {
  vi.mocked(db.matches.get).mockResolvedValue({
    id: "test-match-123",
    homeTeamId: "home-team-id",
    guestTeamId: "guest-team-id",
  } as unknown as Record<string, unknown>);

  vi.mocked(db.matchlineups.where).mockReturnValue({
    equals: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    }),
  } as unknown as ReturnType<typeof db.matchlineups.where>);

  vi.mocked(db.playerrosters.where).mockReturnValue({
    anyOf: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    }),
  } as unknown as ReturnType<typeof db.playerrosters.where>);

  vi.mocked(db.eventdefinitions.toArray).mockResolvedValue([]);

  vi.mocked(db.gameevents.where).mockReturnValue({
    anyOf: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    }),
  } as unknown as ReturnType<typeof db.gameevents.where>);
};

const createTestStore = (
  preloadedMatchState: Partial<MatchState> = {},
  preloadedNavigationState: Partial<NavigationState> = {},
) => {
  const initialNavigationState: NavigationState = {
    currentView: "QUICK_START",
    ...preloadedNavigationState,
  };

  return configureStore({
    reducer: {
      match: matchReducer,
      navigation: navigationReducer,
    },
    preloadedState: {
      match: {
        activeMatchId: "test-match-123",
        activeTeamId: "home-team-id",
        periodNumber: 4,
        homeScore: 8,
        guestScore: 5,
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: true,
        globalSequenceNumber: 10,
        recentActions: [],
        hydrationVersion: 0,
        ...preloadedMatchState,
      },
      navigation: initialNavigationState,
    },
  });
};

describe("MatchResultModal Component", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultDbMocks();
  });

  test("should render nothing when isOpen is false", () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={false} onClose={mockOnClose} />
      </Provider>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("should render modal and fallback to scores from Redux when IndexedDB has no lineup events", async () => {
    const store = createTestStore({ homeScore: 12, guestScore: 7 });
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Match Result Finalization")).toBeInTheDocument();

    const inputs = screen.getAllByRole("textbox");
    await waitFor(() => {
      expect(inputs[0]).toHaveValue("12");
      expect(inputs[1]).toHaveValue("7");
    });
  });

  test("should fallback to scores from Redux when IndexedDB events exist but contain no Goal-definition events", async () => {
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "test-match-123",
      homeTeamId: "home-team-id",
      guestTeamId: "guest-team-id",
    } as unknown as Record<string, unknown>);

    vi.mocked(db.matchlineups.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([
            { id: "lineup-home-1", playerRosterId: "roster-home-1" },
          ]),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(db.playerrosters.where).mockReturnValueOnce({
      anyOf: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ id: "roster-home-1", teamId: "home-team-id" }]),
      }),
    } as unknown as ReturnType<typeof db.playerrosters.where>);

    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce([
      { id: "def-steal", name: "Steal", isPositive: true },
      { id: "def-goal", name: "Goal", isPositive: true },
    ] as unknown as Record<string, unknown>[]);

    vi.mocked(db.gameevents.where).mockReturnValueOnce({
      anyOf: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([
            { matchLineupId: "lineup-home-1", eventDefinitionId: "def-steal" },
          ]),
      }),
    } as unknown as ReturnType<typeof db.gameevents.where>);

    const store = createTestStore({ homeScore: 8, guestScore: 5 });
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const inputs = screen.getAllByRole("textbox");

    await waitFor(() => {
      expect(inputs[0]).toHaveValue("8");
      expect(inputs[1]).toHaveValue("5");
    });
  });

  test("should preserve user manual score edits if user interacts before initial score calculation completes", async () => {
    let resolveEvents: (value: unknown) => void;
    const eventsPromise = new Promise((resolve) => {
      resolveEvents = resolve;
    });

    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "test-match-123",
      homeTeamId: "home-team-id",
      guestTeamId: "guest-team-id",
    } as unknown as Record<string, unknown>);

    vi.mocked(db.matchlineups.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([
            { id: "lineup-home-1", playerRosterId: "roster-home-1" },
          ]),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(db.playerrosters.where).mockReturnValueOnce({
      anyOf: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ id: "roster-home-1", teamId: "home-team-id" }]),
      }),
    } as unknown as ReturnType<typeof db.playerrosters.where>);

    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce([
      { id: "def-goal-pos", name: "Goal", isPositive: true },
    ] as unknown as Record<string, unknown>[]);

    vi.mocked(db.gameevents.where).mockReturnValueOnce({
      anyOf: vi.fn().mockReturnValue({
        toArray: vi.fn().mockReturnValue(eventsPromise),
      }),
    } as unknown as ReturnType<typeof db.gameevents.where>);

    const store = createTestStore({ homeScore: 0, guestScore: 0 });
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const inputs = screen.getAllByRole("textbox");

    // User edits score manually before async query resolves
    fireEvent.change(inputs[0], { target: { value: "99" } });
    expect(inputs[0]).toHaveValue("99");

    // Resolve async calculation with 5 goals
    resolveEvents!([
      { matchLineupId: "lineup-home-1", eventDefinitionId: "def-goal-pos" },
      { matchLineupId: "lineup-home-1", eventDefinitionId: "def-goal-pos" },
      { matchLineupId: "lineup-home-1", eventDefinitionId: "def-goal-pos" },
      { matchLineupId: "lineup-home-1", eventDefinitionId: "def-goal-pos" },
      { matchLineupId: "lineup-home-1", eventDefinitionId: "def-goal-pos" },
    ]);

    // Value should stay 99 and not be overwritten by 5
    await waitFor(() => {
      expect(inputs[0]).toHaveValue("99");
    });
  });

  test("should auto-calculate initial scores from positive and negative Goal events in IndexedDB", async () => {
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "test-match-123",
      homeTeamId: "home-team-id",
      guestTeamId: "guest-team-id",
    } as unknown as Record<string, unknown>);

    vi.mocked(db.matchlineups.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { id: "lineup-home-1", playerRosterId: "roster-home-1" },
          { id: "lineup-guest-gk", playerRosterId: "roster-guest-gk" },
        ]),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(db.playerrosters.where).mockReturnValueOnce({
      anyOf: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { id: "roster-home-1", teamId: "home-team-id" },
          { id: "roster-guest-gk", teamId: "guest-team-id" },
        ]),
      }),
    } as unknown as ReturnType<typeof db.playerrosters.where>);

    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce([
      { id: "def-goal-pos", name: "Goal", isPositive: true },
      { id: "def-goal-neg", name: "Goal", isPositive: false },
    ] as unknown as Record<string, unknown>[]);

    vi.mocked(db.gameevents.where).mockReturnValueOnce({
      anyOf: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { matchLineupId: "lineup-home-1", eventDefinitionId: "def-goal-pos" },
          { matchLineupId: "lineup-home-1", eventDefinitionId: "def-goal-pos" },
          {
            matchLineupId: "lineup-guest-gk",
            eventDefinitionId: "def-goal-neg",
          },
          {
            matchLineupId: "lineup-guest-gk",
            eventDefinitionId: "def-goal-pos",
          },
        ]),
      }),
    } as unknown as ReturnType<typeof db.gameevents.where>);

    const store = createTestStore({ homeScore: 0, guestScore: 0 });
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const inputs = screen.getAllByRole("textbox");

    await waitFor(() => {
      expect(inputs[0]).toHaveValue("3");
      expect(inputs[1]).toHaveValue("1");
    });
  });

  test("should increment and decrement scores using stepper buttons", async () => {
    const store = createTestStore({ homeScore: 2, guestScore: 0 });
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const stepperButtons = screen.getAllByRole("button", { name: /[+-]/ });
    const homeMinus = stepperButtons[0];
    const homePlus = stepperButtons[1];
    const guestMinus = stepperButtons[2];

    const inputs = screen.getAllByRole("textbox");

    await waitFor(() => {
      expect(inputs[0]).toHaveValue("2");
    });

    fireEvent.click(homePlus);
    expect(inputs[0]).toHaveValue("3");

    fireEvent.click(homeMinus);
    expect(inputs[0]).toHaveValue("2");

    fireEvent.click(guestMinus);
    expect(inputs[1]).toHaveValue("0");
  });

  test("should disable submit button when scores are invalid", async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const inputs = screen.getAllByRole("textbox");
    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });

    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
    });

    fireEvent.change(inputs[0], { target: { value: "-3" } });
    expect(submitBtn).toBeDisabled();

    fireEvent.change(inputs[0], { target: { value: "abc" } });
    expect(submitBtn).toBeDisabled();
  });

  test("should validate optional temperature input correctly", async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const inputs = screen.getAllByRole("textbox");
    const tempInput = inputs[2];
    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });

    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
    });

    fireEvent.change(tempInput, { target: { value: "invalid-temp" } });
    expect(submitBtn).toBeDisabled();
    expect(
      screen.getByText("Enter a valid numeric temperature value."),
    ).toBeInTheDocument();

    fireEvent.change(tempInput, { target: { value: "26.5" } });
    expect(submitBtn).not.toBeDisabled();
    expect(
      screen.queryByText("Enter a valid numeric temperature value."),
    ).toBeNull();
  });

  test("should trigger match finalization pipeline, keep match in Redux, and display report modal on successful submit", async () => {
    vi.mocked(matchFinalizationService.finalizeMatch).mockResolvedValueOnce(
      undefined,
    );
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce([]);

    const store = createTestStore({ homeScore: 10, guestScore: 8 });
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[2], { target: { value: "24.0" } });

    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(matchFinalizationService.finalizeMatch).toHaveBeenCalledWith({
        matchId: "test-match-123",
        activeTeamId: "home-team-id",
        homeScore: 10,
        guestScore: 8,
        temperature: 24.0,
        userId: "test-user-id",
      });
    });

    expect(store.getState().match.activeMatchId).toBe("test-match-123");

    await waitFor(() => {
      expect(screen.getByText("Team TTA Summary Report")).toBeInTheDocument();
    });
  });

  test("should reset Redux state, switch navigation to MY_MATCHES, and call onClose when report modal is closed after finalization", async () => {
    vi.mocked(matchFinalizationService.finalizeMatch).mockResolvedValueOnce(
      undefined,
    );
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce([]);

    const store = createTestStore({ homeScore: 10, guestScore: 8 });
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Team TTA Summary Report")).toBeInTheDocument();
    });

    const closeReportBtn = screen.getByRole("button", {
      name: /close report/i,
    });
    fireEvent.click(closeReportBtn);

    expect(store.getState().match.activeMatchId).toBeNull();
    expect(store.getState().navigation.currentView).toBe("MY_MATCHES");
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  test("should display error message alert when finalization service fails", async () => {
    vi.mocked(matchFinalizationService.finalizeMatch).mockRejectedValueOnce(
      new Error("Network timeout during sync"),
    );

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });
    fireEvent.click(submitBtn);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Network timeout during sync");

    expect(store.getState().match.activeMatchId).toBe("test-match-123");
  });

  test("should display error message alert when finalizeMatch rejects due to match lock", async () => {
    vi.mocked(matchFinalizationService.finalizeMatch).mockRejectedValueOnce(
      new Error(
        "Cannot finalize match test-match-123: match is currently locked for finalization.",
      ),
    );

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });
    fireEvent.click(submitBtn);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Cannot finalize match test-match-123: match is currently locked for finalization.",
    );
    expect(store.getState().match.activeMatchId).toBe("test-match-123");
  });

  test("should call onClose callback when Cancel button is clicked", () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  test("should not render Cancel button when modal is closed", () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={false} onClose={mockOnClose} />
      </Provider>,
    );

    const cancelBtn = screen.queryByRole("button", { name: "Cancel" });
    expect(cancelBtn).toBeNull();
  });

  test("should reject hexadecimal string as temperature input", async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const inputs = screen.getAllByRole("textbox");
    const tempInput = inputs[2];
    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });

    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
    });

    fireEvent.change(tempInput, { target: { value: "0x10" } });
    expect(submitBtn).toBeDisabled();
    expect(
      screen.getByText("Enter a valid numeric temperature value."),
    ).toBeInTheDocument();
  });

  test("should display friendly timeout message when finalization request is aborted", async () => {
    const abortError = new Error("signal is aborted without reason");
    abortError.name = "AbortError";

    vi.mocked(matchFinalizationService.finalizeMatch).mockRejectedValueOnce(
      abortError,
    );

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={vi.fn()} />
      </Provider>,
    );

    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });
    fireEvent.click(submitBtn);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Request timed out or was cancelled. Please check backend sync and retry.",
    );
  });

  test("should display active period warning banner when modal is opened while period is active", () => {
    const store = createTestStore({
      isPeriodActive: true,
      periodNumber: 3,
    });

    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={vi.fn()} />
      </Provider>,
    );

    expect(screen.getByRole("note")).toHaveTextContent(
      "Period 3 is currently active. Finalizing will automatically end the active period and close player lineups.",
    );
  });
});
