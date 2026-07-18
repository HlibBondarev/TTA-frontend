import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { PlayerPresencePanel } from "../components/PlayerPresencePanel";
import { usePlayerPresence } from "../hooks/usePlayerPresence";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import matchReducer from "../../matches/store/matchSlice";
import { db } from "../../../db/ttaDatabase";

vi.mock("../hooks/usePlayerPresence");
vi.mock("../../../db/ttaDatabase"); // Mock db

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

  // Replace the previous mock assignment in beforeEach with this typed version:
  beforeEach(() => {
    vi.clearAllMocks();

    // Create a helper type or use the return type of the chain
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
    renderWithRedux(<PlayerPresencePanel matchId="test-match" />);
    // Use a simpler query that works with the DOM structure in logs
    expect(await screen.findByText("Period 1 Roster")).toBeInTheDocument();
  });

  it("should support runtime player substitutions", async () => {
    renderWithRedux(<PlayerPresencePanel matchId="test-match" />);

    // 1. Find and click the active player
    const activeBtn = await screen.findByText("#5");
    await act(async () => {
      fireEvent.click(activeBtn);
    });

    // 2. Verify that active player is visually selected (it should have 'bg-blue-600')
    expect(activeBtn).toHaveClass("bg-blue-600");

    // 3. Find and click the bench player
    const benchBtn = await screen.findByText("#10");
    await act(async () => {
      fireEvent.click(benchBtn);
    });

    // 4. Check if executeSubstitution was called
    await waitFor(() => {
      expect(mockExecuteSubstitution).toHaveBeenCalledWith(
        "lineup-1",
        "lineup-2",
      );
    });
  });
});
