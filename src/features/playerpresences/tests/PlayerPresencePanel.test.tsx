import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
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

describe("PlayerPresencePanel Component", () => {
  const mockExecuteSubstitution = vi.fn().mockResolvedValue("new-id");
  const mockStageStartingLineup = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { id: "lineup-1", matchid: "test-match", number: 5 },
          { id: "lineup-2", matchid: "test-match", number: 10 },
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

  it("should support runtime player substitutions", async () => {
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
    await act(async () => {
      fireEvent.click(activeBtn);
    });

    expect(activeBtn).toHaveClass("bg-blue-600");

    const benchBtn = await screen.findByText("#10");
    await act(async () => {
      fireEvent.click(benchBtn);
    });

    await waitFor(() => {
      expect(mockExecuteSubstitution).toHaveBeenCalledWith(
        "lineup-1",
        "lineup-2",
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
    await act(async () => {
      fireEvent.click(benchBtn);
    });

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
    await act(async () => {
      fireEvent.click(benchBtn);
    });

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
    await act(async () => {
      fireEvent.click(benchBtn);
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An unknown error occurred.",
    );
  });

  it("should successfully recover and display player numbers after an initial empty database state (seeding delay)", async () => {
    const mockToArray = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "lineup-1", matchid: "test-match", number: 5 },
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
    await act(async () => {
      fireEvent.click(benchBtn);
    });

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
});
