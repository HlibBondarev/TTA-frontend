import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { PlayerPresencePanel } from "../components/PlayerPresencePanel";
import { usePlayerPresence } from "../hooks/usePlayerPresence";
import { db } from "../../../db/ttaDatabase";

// Mock the custom hook to control its return values in tests
vi.mock("../hooks/usePlayerPresence");

// Mock IndexedDB
vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matchlineups: {
      where: vi.fn().mockReturnThis(),
      equals: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        { id: "lineup-1", matchid: "test-match", number: 5 },
        { id: "lineup-2", matchid: "test-match", number: 10 },
        { id: "lineup-gk", matchid: "test-match", number: -1 }, // GK
      ]),
    },
  },
}));

describe("PlayerPresencePanel Component", () => {
  const mockRefreshPresenceFromDB = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);
  const mockStageStartingLineup = vi.fn<(lineupIds: string[]) => void>();
  const mockExecuteSubstitution = vi
    .fn<(outId: string, inId: string) => Promise<string>>()
    .mockResolvedValue("new-id");
  const mockStartPeriodWithRoster = vi
    .fn<(startTimestamp: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const mockEndPeriodWithRoster = vi
    .fn<(endTimestamp: string) => Promise<void>>()
    .mockResolvedValue(undefined);

  const defaultHookMock = {
    currentPeriod: 1,
    activeLineupIds: [] as string[],
    benchLineupIds: ["lineup-1", "lineup-2", "lineup-gk"] as string[],
    selectedStartingIds: [] as string[],
    activePlayersLimit: 7,
    refreshPresenceFromDB: mockRefreshPresenceFromDB,
    stageStartingLineup: mockStageStartingLineup,
    executeSubstitution: mockExecuteSubstitution,
    startPeriodWithRoster: mockStartPeriodWithRoster,
    endPeriodWithRoster: mockEndPeriodWithRoster,
  } as unknown as ReturnType<typeof usePlayerPresence>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePlayerPresence).mockReturnValue(defaultHookMock);
  });

  it("should render placeholder text and allow staging starting lineup when there is no active lineup", async () => {
    render(<PlayerPresencePanel matchId="test-match" />);

    // Wait for the async IndexedDB load to complete and render the actual jersey numbers
    const p1Button = await screen.findByText("#5");
    expect(p1Button).toBeInTheDocument();

    // Now safely execute other assertions
    expect(screen.getByText("Period 1 Roster")).toBeInTheDocument();
    expect(screen.getByText("Limit: 7 Active")).toBeInTheDocument();
    expect(
      screen.getByText("No active lineup defined for Period 1."),
    ).toBeInTheDocument();
    expect(screen.getByText("#10")).toBeInTheDocument();
    expect(screen.getByText("GK")).toBeInTheDocument(); // Number -1 is mapped to GK

    // Tap on a bench player to stage them inside act() to prevent warnings
    await act(async () => {
      fireEvent.click(p1Button.closest("button")!);
    });

    expect(mockStageStartingLineup).toHaveBeenCalledWith(["lineup-1"]);
  });

  it("should toggle (remove) staged player when clicked again", async () => {
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultHookMock,
      selectedStartingIds: ["lineup-1"],
    } as unknown as ReturnType<typeof usePlayerPresence>);

    render(<PlayerPresencePanel matchId="test-match" />);

    const p1Button = await screen.findByText("#5");

    await act(async () => {
      fireEvent.click(p1Button.closest("button")!);
    });

    expect(mockStageStartingLineup).toHaveBeenCalledWith([]);
  });

  it("should prevent staging more players than the limit", async () => {
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultHookMock,
      selectedStartingIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
      activePlayersLimit: 7,
    } as unknown as ReturnType<typeof usePlayerPresence>);

    render(<PlayerPresencePanel matchId="test-match" />);

    const p1Button = await screen.findByText("#5");

    await act(async () => {
      fireEvent.click(p1Button.closest("button")!);
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "You can only select up to 7 starting players.",
    );
    expect(mockStageStartingLineup).not.toHaveBeenCalled();
  });

  it("should support runtime player substitutions in the water", async () => {
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultHookMock,
      activeLineupIds: ["lineup-1"],
      benchLineupIds: ["lineup-2"],
    } as unknown as ReturnType<typeof usePlayerPresence>);

    render(<PlayerPresencePanel matchId="test-match" />);

    // Ensure roster loaded
    await screen.findByText("#10");

    // Click active player in water to select them (handles tap and clears errors)
    const activeBtn = screen.getByText("Active").closest("button");
    await act(async () => {
      fireEvent.click(activeBtn!);
    });

    // Tap bench player to trigger swap
    const benchBtn = screen.getByText("#10").closest("button");
    await act(async () => {
      fireEvent.click(benchBtn!);
    });

    await waitFor(() => {
      expect(mockExecuteSubstitution).toHaveBeenCalledWith(
        "lineup-1",
        "lineup-2",
      );
    });
  });

  it("should show error when trying to substitute bench player without active selection", async () => {
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultHookMock,
      activeLineupIds: ["lineup-1"],
      benchLineupIds: ["lineup-2"],
    } as unknown as ReturnType<typeof usePlayerPresence>);

    render(<PlayerPresencePanel matchId="test-match" />);

    await screen.findByText("#10");

    const benchBtn = screen.getByText("#10").closest("button");
    await act(async () => {
      fireEvent.click(benchBtn!);
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Please select an active player in the water first to substitute out.",
    );
  });

  it("should show error and cancel substitution if active selection becomes stale/invalidated", async () => {
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultHookMock,
      activeLineupIds: ["lineup-1"], // Player 1 is active
      benchLineupIds: ["lineup-2", "lineup-gk"],
    } as unknown as ReturnType<typeof usePlayerPresence>);

    const { rerender } = render(<PlayerPresencePanel matchId="test-match" />);

    await screen.findByText("#5");

    // Select active player (lineup-1)
    const activeBtn = screen.getByText("Active").closest("button");
    await act(async () => {
      fireEvent.click(activeBtn!);
    });

    // Force hook to update and remove player-1 from active water roster, but keep active list non-empty
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultHookMock,
      activeLineupIds: ["lineup-gk"], // lineup-gk is now active, lineup-1 is gone
      benchLineupIds: ["lineup-1", "lineup-2"],
    } as unknown as ReturnType<typeof usePlayerPresence>);

    rerender(<PlayerPresencePanel matchId="test-match" />);

    // Tap bench player #10 (lineup-2) to substitute
    const benchBtn = screen.getByText("#10").closest("button");
    await act(async () => {
      fireEvent.click(benchBtn!);
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The selected player is no longer active in the game.",
    );
    expect(mockExecuteSubstitution).not.toHaveBeenCalled();
  });

  it("should display error on DB metadata failure", async () => {
    vi.mocked(db.matchlineups.toArray).mockRejectedValueOnce(
      new Error("DB Connection Interrupted"),
    );

    render(<PlayerPresencePanel matchId="test-match" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Failed to fetch fresh roster data from the local database.",
    );
  });
});
