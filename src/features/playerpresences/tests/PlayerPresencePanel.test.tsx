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
import { configureStore } from "@reduxjs/toolkit";
import matchReducer from "../../matches/store/matchSlice";
import { db } from "../../../db/ttaDatabase";

vi.mock("../hooks/usePlayerPresence");
vi.mock("../../../db/ttaDatabase");

const renderWithRedux = (
  ui: React.ReactElement,
  {
    preloadedState = { match: { isPeriodActive: true } },
    store = configureStore({
      reducer: { match: matchReducer },
      preloadedState,
    }),
  } = {},
) => ({
  ...render(<Provider store={store}>{ui}</Provider>),
  store,
});

describe("PlayerPresencePanel Component", () => {
  const mockExecuteSubstitution = vi.fn().mockResolvedValue("new-id");

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
      stageStartingLineup: vi.fn(),
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

  it("should successfully recover and display player numbers after an initial empty database state (seeding delay)", async () => {
    const mockToArray = vi
      .fn()
      .mockResolvedValueOnce([]) // First attempt: seeding still in progress, empty
      .mockResolvedValueOnce([
        { id: "lineup-1", matchid: "test-match", number: 5 },
      ]); // Second attempt: data ready

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

    // Use waitFor to cleanly wait for the retry mechanism to pick up the populated lineup data
    await waitFor(() => {
      expect(screen.getByText("#5")).toBeInTheDocument();
    });
  });
});
