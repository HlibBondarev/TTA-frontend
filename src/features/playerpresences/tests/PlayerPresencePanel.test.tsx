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

  it("should require explicit arming via the shorthanded toggle before entering a bench player, and show a hint when tapped unarmed", async () => {
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

    const shorthandedToggle = await screen.findByTestId(
      "shorthanded-indicator",
    );
    expect(shorthandedToggle).toHaveTextContent("Shorthanded 1/7");
    expect(shorthandedToggle).toHaveAttribute("aria-pressed", "false");

    const benchBtn = await screen.findByText("#10");

    // Unarmed bench tap shows guidance hint and does not enter player
    fireEvent.click(benchBtn);
    expect(mockEnterShorthanded).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Select an active player to substitute, or tap Shorthanded to enter a player.",
    );

    // Arming clears alert, updates label, and highlights eligible bench player
    fireEvent.click(shorthandedToggle);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(shorthandedToggle).toHaveAttribute("aria-pressed", "true");
    expect(shorthandedToggle).toHaveTextContent("Enter Player 1/7 · Cancel");
    expect(benchBtn.closest("button")).toHaveClass("ring-emerald-400");

    // Tapping eligible bench player while armed enters them and disarms synchronously
    fireEvent.click(benchBtn);

    await waitFor(() => {
      expect(mockEnterShorthanded).toHaveBeenCalledWith("lineup-2", 1);
    });
    expect(shorthandedToggle).toHaveAttribute("aria-pressed", "false");
    expect(shorthandedToggle).toHaveTextContent("Shorthanded 1/7");
  });

  it("should clear selected active player on arming, disarm on second toggle tap or active player tap, and preserve EX badge styling when armed", async () => {
    const mockEnterShorthanded = vi.fn().mockResolvedValue("new-id");
    vi.mocked(usePlayerPresence).mockReturnValue({
      currentPeriod: 1,
      activeLineupIds: ["lineup-1"],
      benchLineupIds: ["lineup-2"],
      selectedStartingIds: [],
      activePlayersLimit: 7,
      maxAllowedActive: 7,
      isShorthanded: true,
      disciplinaryState: {
        activePlayersLimit: 7,
        maxPersonalFouls: 3,
        isMaxPersonalFoulsKnown: true,
        permanentNoSubCount: 0,
        maxAllowedActive: 7,
        activeTimedPenalties: [],
        isShorthanded: true,
        shorthandedSlotsAvailable: 1,
        playersById: {
          "lineup-2": {
            matchLineupId: "lineup-2",
            personalFoulCount: 1,
            hasFoulWarning: false,
            isDisqualified: false,
            disqualificationReason: null,
            hasActiveTimedExclusion: true,
            activeTimedExclusionCount: 1,
          },
        },
      },
      refreshPresenceFromDB: vi.fn().mockResolvedValue(undefined),
      stageStartingLineup: mockStageStartingLineup,
      executeSubstitution: mockExecuteSubstitution,
      enterShorthandedPlayer: mockEnterShorthanded,
      startPeriodWithRoster: vi.fn(),
      endPeriodWithRoster: vi.fn(),
    } as unknown as ReturnType<typeof usePlayerPresence>);

    const TestWrapper = () => {
      const [selectedId, setSelectedId] = useState<string | null>("lineup-1");
      return (
        <PlayerPresencePanel
          matchId="test-match"
          selectedPlayerId={selectedId}
          setSelectedPlayerId={setSelectedId}
        />
      );
    };

    renderWithRedux(<TestWrapper />);

    const activeBtn = (await screen.findByText("#5")).closest("button")!;
    const benchBtn = (await screen.findByText("#10")).closest("button")!;
    const shorthandedToggle = screen.getByTestId("shorthanded-indicator");

    expect(activeBtn).toHaveAttribute("aria-pressed", "true");

    // Arming clears active selection and keeps EX badge + amber background with emerald ring
    fireEvent.click(shorthandedToggle);
    expect(activeBtn).toHaveAttribute("aria-pressed", "false");
    expect(shorthandedToggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("timed-exclusion-badge")).toHaveTextContent("EX");
    expect(benchBtn).toHaveClass("bg-amber-950/80");
    expect(benchBtn).toHaveClass("ring-emerald-400");

    // Second tap on toggle cancels armed mode
    fireEvent.click(shorthandedToggle);
    expect(shorthandedToggle).toHaveAttribute("aria-pressed", "false");

    // Re-arm, then tap an active player -> disarms shorthanded mode and selects active player
    fireEvent.click(shorthandedToggle);
    expect(shorthandedToggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(activeBtn);
    expect(shorthandedToggle).toHaveAttribute("aria-pressed", "false");
    expect(activeBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("should disarm synchronously on failed shorthanded entry and prevent disqualified bench entry when armed", async () => {
    let rejectEntry!: (error: Error) => void;
    const mockEnterShorthanded = vi.fn().mockImplementationOnce(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectEntry = reject;
        }),
    );

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { id: "lineup-1", matchId: "test-match", number: 5 },
          { id: "lineup-2", matchId: "test-match", number: 10 },
          { id: "lineup-3", matchId: "test-match", number: 11 },
        ]),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(usePlayerPresence).mockReturnValue({
      currentPeriod: 1,
      activeLineupIds: ["lineup-1"],
      benchLineupIds: ["lineup-2", "lineup-3"],
      selectedStartingIds: [],
      activePlayersLimit: 7,
      maxAllowedActive: 7,
      isShorthanded: true,
      disciplinaryState: {
        activePlayersLimit: 7,
        maxPersonalFouls: 3,
        isMaxPersonalFoulsKnown: true,
        permanentNoSubCount: 0,
        maxAllowedActive: 7,
        activeTimedPenalties: [],
        isShorthanded: true,
        shorthandedSlotsAvailable: 1,
        playersById: {
          "lineup-3": {
            matchLineupId: "lineup-3",
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

    const shorthandedToggle = await screen.findByTestId(
      "shorthanded-indicator",
    );
    const eligibleBenchBtn = (await screen.findByText("#10")).closest(
      "button",
    )!;
    const dqBenchBtn = (await screen.findByText("#11")).closest("button")!;

    fireEvent.click(shorthandedToggle);
    expect(shorthandedToggle).toHaveAttribute("aria-pressed", "true");
    expect(dqBenchBtn).toBeDisabled();
    expect(dqBenchBtn).not.toHaveClass("ring-emerald-400");

    fireEvent.click(eligibleBenchBtn);

    // Must disarm synchronously before the entry promise settles
    expect(shorthandedToggle).toHaveAttribute("aria-pressed", "false");
    expect(mockEnterShorthanded).toHaveBeenCalledTimes(1);

    // A rapid second tap while in flight must not trigger a duplicate entry
    fireEvent.click(eligibleBenchBtn);
    expect(mockEnterShorthanded).toHaveBeenCalledTimes(1);

    rejectEntry(new Error("Entry failed"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Failed to enter player.",
      );
    });
    expect(shorthandedToggle).toHaveAttribute("aria-pressed", "false");
  });

  it("should auto-disarm shorthanded entry mode when matchId, period lifecycle, or shorthanded eligibility changes", async () => {
    const mockEnterShorthanded = vi.fn().mockResolvedValue("new-id");
    const baseHookValue = {
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
    } as unknown as ReturnType<typeof usePlayerPresence>;

    vi.mocked(usePlayerPresence).mockReturnValue(baseHookValue);

    const store = createTestStore({
      match: { isPeriodActive: true, isPeriodEnded: false },
    });

    const { rerender } = render(
      <Provider store={store}>
        <PlayerPresencePanel
          matchId="test-match-1"
          selectedPlayerId={null}
          setSelectedPlayerId={vi.fn()}
        />
      </Provider>,
    );

    const shorthandedToggle = await screen.findByTestId(
      "shorthanded-indicator",
    );
    fireEvent.click(shorthandedToggle);
    expect(shorthandedToggle).toHaveAttribute("aria-pressed", "true");

    // Changing matchId disarms
    rerender(
      <Provider store={store}>
        <PlayerPresencePanel
          matchId="test-match-2"
          selectedPlayerId={null}
          setSelectedPlayerId={vi.fn()}
        />
      </Provider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("shorthanded-indicator")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    // Re-arm, then team ceases to be shorthanded and returns -> disarmed
    fireEvent.click(screen.getByTestId("shorthanded-indicator"));
    expect(screen.getByTestId("shorthanded-indicator")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    vi.mocked(usePlayerPresence).mockReturnValue({
      ...baseHookValue,
      isShorthanded: false,
    });
    rerender(
      <Provider store={store}>
        <PlayerPresencePanel
          matchId="test-match-2"
          selectedPlayerId={null}
          setSelectedPlayerId={vi.fn()}
        />
      </Provider>,
    );
    expect(screen.queryByTestId("shorthanded-indicator")).toBeNull();

    vi.mocked(usePlayerPresence).mockReturnValue(baseHookValue);
    rerender(
      <Provider store={store}>
        <PlayerPresencePanel
          matchId="test-match-2"
          selectedPlayerId={null}
          setSelectedPlayerId={vi.fn()}
        />
      </Provider>,
    );
    expect(screen.getByTestId("shorthanded-indicator")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
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

  it("should allow deselecting an already-staged disqualified starter while keeping unstaged DQ players disabled", async () => {
    const mockPrePeriodTap = vi.fn();

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { id: "lineup-1", matchId: "test-match", number: 5 },
          { id: "lineup-2", matchId: "test-match", number: 10 },
        ]),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

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
        eligibleLineupIds: [],
        disqualifiedLineupIds: ["lineup-1", "lineup-2"],
        eligibleLineupCount: 0,
        carriedOverPenalties: [],
        clearedPenaltyEventIds: [],
        effectiveCarriedOverPenalties: [],
        effectiveUnservedTimedPenalties: 0,
        highlightedLineupIds: [],
        requiredStartingPlayers: 0,
        canResetClearedPenalties: false,
        playersById: {
          "lineup-1": {
            matchLineupId: "lineup-1",
            personalFoulCount: 3,
            hasFoulWarning: false,
            isDisqualified: true,
            disqualificationReason: "PersonalFoulLimit",
            hasActiveTimedExclusion: false,
            activeTimedExclusionCount: 0,
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

    const stagedDqBtn = (await screen.findByText("#5")).closest("button")!;
    const unstagedDqBtn = (await screen.findByText("#10")).closest("button")!;

    expect(stagedDqBtn).not.toBeDisabled();
    expect(unstagedDqBtn).toBeDisabled();

    fireEvent.click(stagedDqBtn);
    expect(mockPrePeriodTap).toHaveBeenCalledWith("lineup-1");
  });

  it("should hide EX badge and amber style before period start when carried-over penalty is cleared, and keep EX during active period", async () => {
    const mockHookBase = {
      currentPeriod: 2,
      activeLineupIds: [],
      benchLineupIds: ["lineup-1"],
      selectedStartingIds: [],
      activePlayersLimit: 7,
      maxPersonalFouls: 3,
      requiredStartingPlayers: 7,
      carryoverState: {
        targetPeriodNumber: 2,
        activePlayersLimit: 7,
        maxPersonalFouls: 3,
        isMaxPersonalFoulsKnown: true,
        permanentNoSubCount: 0,
        maxAllowedActive: 7,
        eligibleLineupIds: ["lineup-1"],
        disqualifiedLineupIds: [],
        eligibleLineupCount: 1,
        carriedOverPenalties: [],
        clearedPenaltyEventIds: ["evt-1"],
        effectiveCarriedOverPenalties: [],
        effectiveUnservedTimedPenalties: 0,
        highlightedLineupIds: [],
        requiredStartingPlayers: 7,
        canResetClearedPenalties: true,
        playersById: {
          "lineup-1": {
            matchLineupId: "lineup-1",
            personalFoulCount: 1,
            hasFoulWarning: false,
            isDisqualified: false,
            disqualificationReason: null,
            hasActiveTimedExclusion: true,
            activeTimedExclusionCount: 1,
          },
        },
      },
      disciplinaryState: {
        activePlayersLimit: 7,
        maxPersonalFouls: 3,
        isMaxPersonalFoulsKnown: true,
        permanentNoSubCount: 0,
        maxAllowedActive: 7,
        activeTimedPenalties: [],
        isShorthanded: false,
        shorthandedSlotsAvailable: 0,
        playersById: {
          "lineup-1": {
            matchLineupId: "lineup-1",
            personalFoulCount: 1,
            hasFoulWarning: false,
            isDisqualified: false,
            disqualificationReason: null,
            hasActiveTimedExclusion: true,
            activeTimedExclusionCount: 1,
          },
        },
      },
      refreshPresenceFromDB: vi.fn().mockResolvedValue(undefined),
      stageStartingLineup: mockStageStartingLineup,
      executeSubstitution: mockExecuteSubstitution,
      startPeriodWithRoster: vi.fn(),
      endPeriodWithRoster: vi.fn(),
    } as unknown as ReturnType<typeof usePlayerPresence>;

    vi.mocked(usePlayerPresence).mockReturnValue(mockHookBase);

    const { rerender } = render(
      <Provider
        store={createTestStore({
          match: { isPeriodActive: false, periodNumber: 2 },
        })}
      >
        <PlayerPresencePanel
          matchId="test-match"
          selectedPlayerId={null}
          setSelectedPlayerId={vi.fn()}
        />
      </Provider>,
    );

    const prePeriodBtn = (await screen.findByText("#5")).closest("button")!;
    expect(screen.queryByTestId("timed-exclusion-badge")).toBeNull();
    expect(prePeriodBtn).toHaveClass("bg-gray-800");
    expect(prePeriodBtn).not.toHaveClass("bg-amber-950/80");

    rerender(
      <Provider
        store={createTestStore({
          match: { isPeriodActive: true, periodNumber: 2 },
        })}
      >
        <PlayerPresencePanel
          matchId="test-match"
          selectedPlayerId={null}
          setSelectedPlayerId={vi.fn()}
        />
      </Provider>,
    );

    const activePeriodBtn = (await screen.findByText("#5")).closest("button")!;
    expect(screen.getByTestId("timed-exclusion-badge")).toHaveTextContent("EX");
    expect(activePeriodBtn).toHaveClass("bg-amber-950/80");
  });

  it("should not clear selectedPlayerId after substitution if selection changed while substitution was in flight", async () => {
    let resolveSub!: (value: string) => void;
    mockExecuteSubstitution.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveSub = resolve;
        }),
    );

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { id: "lineup-1", matchId: "test-match", number: 5 },
          { id: "lineup-3", matchId: "test-match", number: 7 },
          { id: "lineup-2", matchId: "test-match", number: 10 },
        ]),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(usePlayerPresence).mockReturnValue({
      currentPeriod: 1,
      activeLineupIds: ["lineup-1", "lineup-3"],
      benchLineupIds: ["lineup-2"],
      selectedStartingIds: [],
      activePlayersLimit: 7,
      refreshPresenceFromDB: vi.fn().mockResolvedValue(undefined),
      stageStartingLineup: mockStageStartingLineup,
      executeSubstitution: mockExecuteSubstitution,
      startPeriodWithRoster: vi.fn(),
      endPeriodWithRoster: vi.fn(),
    });

    const mockSetSelected = vi.fn();
    const store = createTestStore({ match: { isPeriodActive: true } });

    const { rerender } = render(
      <Provider store={store}>
        <PlayerPresencePanel
          matchId="test-match"
          selectedPlayerId="lineup-1"
          setSelectedPlayerId={mockSetSelected}
        />
      </Provider>,
    );

    const benchBtn = await screen.findByText("#10");
    fireEvent.click(benchBtn);

    // While executeSubstitution is still pending, user selects a different active player
    rerender(
      <Provider store={store}>
        <PlayerPresencePanel
          matchId="test-match"
          selectedPlayerId="lineup-3"
          setSelectedPlayerId={mockSetSelected}
        />
      </Provider>,
    );

    resolveSub("new-presence-id");

    await waitFor(() => {
      expect(mockExecuteSubstitution).toHaveBeenCalledWith(
        "lineup-1",
        "lineup-2",
        1,
      );
    });
    expect(mockSetSelected).not.toHaveBeenCalledWith(null);
  });
});
