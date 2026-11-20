import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { PlayerPresencePanel } from "../components/PlayerPresencePanel";
import { usePlayerPresence } from "../hooks/usePlayerPresence";
import { Provider } from "react-redux";
import { configureStore, combineReducers } from "@reduxjs/toolkit";
import matchReducer from "../../matches/store/matchSlice";
import presenceReducer from "../store/presenceSlice";
import { db } from "../../../db/ttaDatabase";

vi.mock("../hooks/usePlayerPresence");
vi.mock("../../../db/ttaDatabase");

const rootReducer = combineReducers({
  match: matchReducer,
  presence: presenceReducer,
});

type RootState = ReturnType<typeof rootReducer>;

const renderWithRedux = (
  ui: React.ReactElement,
  {
    preloadedState = { match: { isPeriodActive: true } },
    store = configureStore({
      reducer: rootReducer,
      preloadedState: preloadedState as unknown as RootState,
    }),
  } = {},
) => ({
  ...render(<Provider store={store}>{ui}</Provider>),
  store,
});

const createTestStore = (preloadedState?: Record<string, unknown>) =>
  configureStore({
    reducer: rootReducer,
    preloadedState: preloadedState as unknown as RootState,
  });

describe("PlayerPresencePanel Component", () => {
  const mockExecuteSubstitution = vi.fn().mockResolvedValue("new-id");
  const mockStageStartingLineup = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { id: "lineup-1", matchId: "test-match", number: 5 },
          { id: "lineup-2", matchId: "test-match", number: 10 },
        ]),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(usePlayerPresence).mockReturnValue({
      currentPeriod: 1,
      activeLineupIds: ["lineup-1"],
      benchLineupIds: ["lineup-2"],
      selectedStartingIds: [],
      activePlayersLimit: 7,
      refreshPresenceFromDB: vi.fn().mockResolvedValue(undefined),
      stageStartingLineup: mockStageStartingLineup,
      executeSubstitution: mockExecuteSubstitution,
      startPeriodWithRoster: vi.fn(),
      endPeriodWithRoster: vi.fn(),
    });
  });

  it("should render roster structure correctly", async () => {
    renderWithRedux(
      <PlayerPresencePanel
        matchId="test-match"
        selectedPlayerId={null}
        setSelectedPlayerId={vi.fn()}
      />,
    );
    expect(await screen.findByText("Period 1 Roster")).toBeInTheDocument();
  });

  it("should render active and bench players sorted in ascending numerical order with missing numbers placed last", async () => {
    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { id: "lineup-no-num-active", matchId: "test-match" },
          { id: "lineup-c", matchId: "test-match", number: 12 },
          { id: "lineup-a", matchId: "test-match", number: 2 },
          { id: "lineup-b", matchId: "test-match", number: 5 },
          { id: "lineup-e", matchId: "test-match", number: 8 },
          { id: "lineup-no-num-bench", matchId: "test-match" },
          { id: "lineup-d", matchId: "test-match", number: 1 },
        ]),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(usePlayerPresence).mockReturnValue({
      currentPeriod: 1,
      activeLineupIds: [
        "lineup-no-num-active",
        "lineup-c",
        "lineup-a",
        "lineup-b",
      ],
      benchLineupIds: ["lineup-no-num-bench", "lineup-e", "lineup-d"],
      selectedStartingIds: [],
      activePlayersLimit: 7,
      refreshPresenceFromDB: vi.fn().mockResolvedValue(undefined),
      stageStartingLineup: mockStageStartingLineup,
      executeSubstitution: mockExecuteSubstitution,
      startPeriodWithRoster: vi.fn(),
      endPeriodWithRoster: vi.fn(),
    });

    renderWithRedux(
      <PlayerPresencePanel
        matchId="test-match"
        selectedPlayerId={null}
        setSelectedPlayerId={vi.fn()}
      />,
    );

    await screen.findByText("#2");

    const activeHeader = screen.getByText("Active Players");
    const activeSection = activeHeader.nextElementSibling!;
    const activeButtons = Array.from(activeSection.querySelectorAll("button"));
    const activeNumbers = activeButtons.map((btn) => btn.textContent?.trim());

    expect(activeNumbers).toEqual(["#2", "#5", "#12", "#"]);

    const benchHeader = screen.getByText("Bench");
    const benchSection = benchHeader.nextElementSibling!;
    const benchButtons = Array.from(benchSection.querySelectorAll("button"));
    const benchNumbers = benchButtons.map((btn) => btn.textContent?.trim());

    expect(benchNumbers).toEqual(["#1", "#8", "#"]);
  });

  it("should support runtime player substitutions with period number passed", async () => {
    const TestWrapper = () => {
      const [selectedId, setSelectedId] = useState<string | null>(null);
      return (
        <PlayerPresencePanel
          matchId="test-match"
          selectedPlayerId={selectedId}
          setSelectedPlayerId={setSelectedId}
        />
      );
    };

    renderWithRedux(<TestWrapper />);

    const activeBtn = await screen.findByText("#5");
    fireEvent.click(activeBtn);

    expect(activeBtn).toHaveClass("bg-blue-600");

    const benchBtn = await screen.findByText("#10");
    fireEvent.click(benchBtn);

    await waitFor(() => {
      expect(mockExecuteSubstitution).toHaveBeenCalledWith(
        "lineup-1",
        "lineup-2",
        1,
      );
    });
  });

  it("should handle failed substitutions gracefully", async () => {
    mockExecuteSubstitution.mockRejectedValueOnce(new Error("Sub failure"));
    renderWithRedux(
      <PlayerPresencePanel
        matchId="test-match"
        selectedPlayerId="lineup-1"
        setSelectedPlayerId={vi.fn()}
      />,
    );

    const benchBtn = await screen.findByText("#10");
    fireEvent.click(benchBtn);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Substitution failed.",
    );
  });

  it("should prompt user if bench player is tapped without active selection", async () => {
    renderWithRedux(
      <PlayerPresencePanel
        matchId="test-match"
        selectedPlayerId={null}
        setSelectedPlayerId={vi.fn()}
      />,
    );

    const benchBtn = await screen.findByText("#10");
    fireEvent.click(benchBtn);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please select an active player in the water first to substitute out.",
    );
  });

  it("should display custom descriptive strings if staging throws string errors", async () => {
    mockStageStartingLineup.mockImplementationOnce(() => {
      throw "Custom string validation error";
    });

    renderWithRedux(
      <PlayerPresencePanel
        matchId="test-match"
        selectedPlayerId={null}
        setSelectedPlayerId={vi.fn()}
      />,
      {
        preloadedState: {
          match: { isPeriodActive: false },
        } as unknown as RootState,
      },
    );

    const benchBtn = await screen.findByText("#10");
    fireEvent.click(benchBtn);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An unknown error occurred.",
    );
  });

  it("should successfully recover and display player numbers after an initial empty database state (seeding delay)", async () => {
    const mockToArray = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "lineup-1", matchId: "test-match", number: 5 },
      ]);

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: mockToArray,
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    renderWithRedux(
      <PlayerPresencePanel
        matchId="test-match"
        selectedPlayerId={null}
        setSelectedPlayerId={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("#5")).toBeInTheDocument();
    });
  });

  it("should support staging starting lineup during inactive period", async () => {
    vi.mocked(usePlayerPresence).mockReturnValue({
      currentPeriod: 1,
      activeLineupIds: [],
      benchLineupIds: ["lineup-2"],
      selectedStartingIds: [],
      activePlayersLimit: 7,
      refreshPresenceFromDB: vi.fn().mockResolvedValue(undefined),
      stageStartingLineup: mockStageStartingLineup,
      executeSubstitution: vi.fn(),
      startPeriodWithRoster: vi.fn(),
      endPeriodWithRoster: vi.fn(),
    });

    renderWithRedux(
      <PlayerPresencePanel
        matchId="test-match"
        selectedPlayerId={null}
        setSelectedPlayerId={vi.fn()}
      />,
      {
        preloadedState: {
          match: { isPeriodActive: false },
        } as unknown as RootState,
      },
    );

    const benchBtn = await screen.findByText("#10");
    fireEvent.click(benchBtn);

    expect(mockStageStartingLineup).toHaveBeenCalledWith(["lineup-2"]);
  });

  it("should display error message if database query fails inside useEffect", async () => {
    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockRejectedValue(new Error("Database error")),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    renderWithRedux(
      <PlayerPresencePanel
        matchId="test-match"
        selectedPlayerId={null}
        setSelectedPlayerId={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to fetch fresh roster data.",
    );
  });

  it("should clear error message when period becomes active (isPeriodActive changes to true)", async () => {
    mockStageStartingLineup.mockImplementationOnce(() => {
      throw new Error("Cannot exceed the limit of 7 active players.");
    });

    const store = createTestStore({
      match: { isPeriodActive: false, isPeriodEnded: false },
    });

    const { rerender } = render(
      <Provider store={store}>
        <PlayerPresencePanel
          matchId="test-match"
          selectedPlayerId={null}
          setSelectedPlayerId={vi.fn()}
        />
      </Provider>,
    );

    // Trigger an error by tapping bench player when limit exceeded
    const benchBtn = await screen.findByText("#10");
    fireEvent.click(benchBtn);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cannot exceed the limit of 7 active players.",
    );

    // Rerender with period active state set to true (simulating START PERIOD)
    const activeStore = createTestStore({
      match: { isPeriodActive: true, isPeriodEnded: false },
    });

    rerender(
      <Provider store={activeStore}>
        <PlayerPresencePanel
          matchId="test-match"
          selectedPlayerId={null}
          setSelectedPlayerId={vi.fn()}
        />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("should automatically clear stale selectedPlayerId when the selected player exits activeLineupIds", async () => {
    const mockSetSelected = vi.fn();
    vi.mocked(usePlayerPresence).mockReturnValue({
      currentPeriod: 1,
      activeLineupIds: ["lineup-1"],
      benchLineupIds: ["lineup-2"],
      selectedStartingIds: [],
      activePlayersLimit: 7,
      refreshPresenceFromDB: vi.fn().mockResolvedValue(undefined),
      stageStartingLineup: mockStageStartingLineup,
      executeSubstitution: mockExecuteSubstitution,
      startPeriodWithRoster: vi.fn(),
      endPeriodWithRoster: vi.fn(),
    } as unknown as ReturnType<typeof usePlayerPresence>);

    renderWithRedux(
      <PlayerPresencePanel
        matchId="test-match"
        selectedPlayerId="lineup-2"
        setSelectedPlayerId={mockSetSelected}
      />,
    );

    await waitFor(() => {
      expect(mockSetSelected).toHaveBeenCalledWith(null);
    });
  });

  it("should support direct shorthanded bench entry without outgoing player selection", async () => {
    const mockEnterShorthanded = vi.fn().mockResolvedValue("new-id");
    vi.mocked(usePlayerPresence).mockReturnValue({
      currentPeriod: 1,
      activeLineupIds: ["lineup-1"],
      benchLineupIds: ["lineup-2"],
      selectedStartingIds: [],
      activePlayersLimit: 7,
      maxAllowedActive: 7,
      isShorthanded: true,
      refreshPresenceFromDB: vi.fn().mockResolvedValue(undefined),
      stageStartingLineup: mockStageStartingLineup,
      executeSubstitution: mockExecuteSubstitution,
      enterShorthandedPlayer: mockEnterShorthanded,
      startPeriodWithRoster: vi.fn(),
      endPeriodWithRoster: vi.fn(),
    } as unknown as ReturnType<typeof usePlayerPresence>);

    renderWithRedux(
      <PlayerPresencePanel
        matchId="test-match"
        selectedPlayerId={null}
        setSelectedPlayerId={vi.fn()}
      />,
    );

    expect(
      await screen.findByTestId("shorthanded-indicator"),
    ).toHaveTextContent("Shorthanded 1/7");

    const benchBtn = await screen.findByText("#10");
    fireEvent.click(benchBtn);

    await waitFor(() => {
      expect(mockEnterShorthanded).toHaveBeenCalledWith("lineup-2", 1);
    });
  });

  it("should render disciplinary badges (foul count, warning, timed exclusion, DQ) and pre-period Reset button", async () => {
    const mockResetCleared = vi.fn();
    const mockPrePeriodTap = vi.fn();

    vi.mocked(usePlayerPresence).mockReturnValue({
      currentPeriod: 2,
      activeLineupIds: [],
      benchLineupIds: ["lineup-1", "lineup-2"],
      selectedStartingIds: ["lineup-1"],
      activePlayersLimit: 7,
      maxPersonalFouls: 3,
      requiredStartingPlayers: 6,
      carryoverState: {
        targetPeriodNumber: 2,
        activePlayersLimit: 7,
        maxPersonalFouls: 3,
        isMaxPersonalFoulsKnown: true,
        permanentNoSubCount: 0,
        maxAllowedActive: 7,
        eligibleLineupIds: ["lineup-1"],
        disqualifiedLineupIds: ["lineup-2"],
        eligibleLineupCount: 1,
        carriedOverPenalties: [],
        clearedPenaltyEventIds: ["evt-1"],
        effectiveCarriedOverPenalties: [],
        effectiveUnservedTimedPenalties: 1,
        highlightedLineupIds: ["lineup-1"],
        requiredStartingPlayers: 6,
        canResetClearedPenalties: true,
        playersById: {
          "lineup-1": {
            matchLineupId: "lineup-1",
            personalFoulCount: 2,
            hasFoulWarning: true,
            isDisqualified: false,
            disqualificationReason: null,
            hasActiveTimedExclusion: true,
            activeTimedExclusionCount: 1,
          },
          "lineup-2": {
            matchLineupId: "lineup-2",
            personalFoulCount: 3,
            hasFoulWarning: false,
            isDisqualified: true,
            disqualificationReason: "PersonalFoulLimit",
            hasActiveTimedExclusion: false,
            activeTimedExclusionCount: 0,
          },
        },
      },
      refreshPresenceFromDB: vi.fn().mockResolvedValue(undefined),
      stageStartingLineup: mockStageStartingLineup,
      handlePrePeriodBenchTap: mockPrePeriodTap,
      resetPrePeriodClearedPenalties: mockResetCleared,
      executeSubstitution: mockExecuteSubstitution,
      startPeriodWithRoster: vi.fn(),
      endPeriodWithRoster: vi.fn(),
    } as unknown as ReturnType<typeof usePlayerPresence>);

    renderWithRedux(
      <PlayerPresencePanel
        matchId="test-match"
        selectedPlayerId={null}
        setSelectedPlayerId={vi.fn()}
      />,
      {
        preloadedState: {
          match: { isPeriodActive: false, periodNumber: 2 },
        } as unknown as RootState,
      },
    );

    expect(await screen.findByTestId("starting-counter")).toHaveTextContent(
      "1/6",
    );
    expect(screen.getAllByTestId("foul-count-badge")[0]).toHaveTextContent(
      "F2",
    );
    expect(screen.getByTestId("timed-exclusion-badge")).toHaveTextContent("EX");
    expect(screen.getByTestId("dq-badge")).toHaveTextContent("DQ");

    const resetBtn = screen.getByRole("button", { name: "Reset" });
    fireEvent.click(resetBtn);
    expect(mockResetCleared).toHaveBeenCalled();
  });
});
