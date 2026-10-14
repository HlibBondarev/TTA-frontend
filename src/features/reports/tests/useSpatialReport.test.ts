import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSpatialReport } from "../hooks/useSpatialReport";
import { reportService } from "../../../services/reportService";
import { db } from "../../../db/ttaDatabase";
import type { GameEventResponse } from "../../../services/reportService";

vi.mock("../../../services/reportService", () => ({
  reportService: {
    getMatchEvents: vi.fn(),
    getTeamLineup: vi.fn(),
  },
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matchlineups: {
      where: vi.fn(),
    },
    eventdefinitions: {
      toArray: vi.fn(),
    },
  },
}));

describe("useSpatialReport Custom Hook", () => {
  const mockEvents: GameEventResponse[] = [
    {
      id: "ev-1",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      eventName: "Goal",
      isPositive: true,
      periodNumber: 1,
      eventTimestamp: "2026-10-14T10:00:00Z",
      isLeadToGoal: true,
      locationX: 80,
      locationY: 50,
      teamId: "t-1",
      playerNumber: 7,
    },
    {
      id: "ev-2",
      matchLineupId: "lineup-2",
      eventDefinitionId: "def-2",
      eventName: "Foul",
      isPositive: false,
      periodNumber: 2,
      eventTimestamp: "2026-10-14T10:05:00Z",
      isLeadToGoal: false,
      locationX: 30,
      locationY: 40,
      teamId: "t-1",
      playerNumber: 4,
    },
  ];

  const mockLineups = [
    {
      id: "lineup-1",
      matchId: "m-1",
      playerRosterId: "r-1",
      number: 7,
      positionId: "pos-1",
    },
    {
      id: "lineup-2",
      matchId: "m-1",
      playerRosterId: "r-2",
      number: 4,
      positionId: "pos-2",
    },
  ];

  const mockDefinitions = [
    {
      id: "def-1",
      sportId: "s-1",
      name: "Goal",
      shortName: "GL",
      isPositive: true,
    },
    {
      id: "def-2",
      sportId: "s-1",
      name: "Foul",
      shortName: "FL",
      isPositive: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(reportService.getMatchEvents).mockResolvedValue(mockEvents);
    vi.mocked(reportService.getTeamLineup).mockResolvedValue(mockLineups);

    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockLineups),
      }),
    } as never);

    vi.mocked(db.eventdefinitions.toArray).mockResolvedValue(mockDefinitions);
  });

  it("loads events, lineups, and definitions on mount", async () => {
    const { result } = renderHook(() =>
      useSpatialReport({ matchId: "m-1", teamId: "t-1" }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.events).toHaveLength(2);
    });

    expect(reportService.getTeamLineup).toHaveBeenCalledWith("m-1", "t-1");
    expect(result.current.teamLineups).toHaveLength(2);
    expect(result.current.eventDefinitionsMap.size).toBe(2);
    expect(result.current.error).toBeNull();
  });

  it("normalizes missing playerRosterId and positionId to null when loading team lineups", async () => {
    const incompleteLineups = [
      {
        id: "lineup-incomplete",
        matchId: "m-1",
        number: 10,
        playerRosterId: undefined,
        positionId: undefined,
      },
    ];
    vi.mocked(reportService.getTeamLineup).mockResolvedValueOnce(
      incompleteLineups as never,
    );

    const { result } = renderHook(() =>
      useSpatialReport({ matchId: "m-1", teamId: "t-1" }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.teamLineups).toHaveLength(1);
    expect(result.current.teamLineups[0].playerRosterId).toBeNull();
    expect(result.current.teamLineups[0].positionId).toBeNull();
  });

  it("loads lineups from IndexedDB when teamId is omitted", async () => {
    const { result } = renderHook(() => useSpatialReport({ matchId: "m-1" }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(reportService.getTeamLineup).not.toHaveBeenCalled();
    expect(db.matchlineups.where).toHaveBeenCalledWith("matchId");
    expect(result.current.teamLineups).toHaveLength(2);
  });

  it("filters events by teamId when provided", async () => {
    const multiTeamEvents: GameEventResponse[] = [
      { ...mockEvents[0], teamId: "team-home" },
      { ...mockEvents[1], teamId: "team-guest" },
    ];
    vi.mocked(reportService.getMatchEvents).mockResolvedValueOnce(
      multiTeamEvents,
    );

    const { result } = renderHook(() =>
      useSpatialReport({ matchId: "m-1", teamId: "team-home" }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].teamId).toBe("team-home");
  });

  it("dynamically constructs team lineups from server events when local IndexedDB and server teamLineup are empty", async () => {
    vi.mocked(reportService.getTeamLineup).mockResolvedValueOnce([]);
    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    } as never);

    const { result } = renderHook(() =>
      useSpatialReport({ matchId: "m-1", teamId: "t-1" }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.teamLineups).toHaveLength(2);
    expect(result.current.teamLineups[0].number).toBe(4);
    expect(result.current.teamLineups[1].number).toBe(7);
    expect(result.current.teamLineups[0].positionId).toBeNull();
  });

  it("enriches event definitions from server events when missing in local IndexedDB", async () => {
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce([]);

    const { result } = renderHook(() =>
      useSpatialReport({ matchId: "m-1", teamId: "t-1" }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.eventDefinitionsMap.size).toBe(2);
    expect(result.current.eventDefinitionsMap.get("def-1")?.name).toBe("Goal");
  });

  it("filters events by period number", async () => {
    const { result } = renderHook(() =>
      useSpatialReport({ matchId: "m-1", teamId: "t-1" }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.events).toHaveLength(2);
    });

    act(() => {
      result.current.togglePeriodFilter(1);
    });

    expect(result.current.filteredEvents).toHaveLength(1);
    expect(result.current.filteredEvents[0].id).toBe("ev-1");

    act(() => {
      result.current.togglePeriodFilter(null);
    });

    expect(result.current.filteredEvents).toHaveLength(2);
  });

  it("filters events by active action tab category (positive/negative/all)", async () => {
    const { result } = renderHook(() =>
      useSpatialReport({ matchId: "m-1", teamId: "t-1" }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.events).toHaveLength(2);
    });

    act(() => {
      result.current.toggleActiveTab("positive");
    });
    expect(result.current.filteredEvents).toHaveLength(1);
    expect(result.current.filteredEvents[0].isPositive).toBe(true);

    act(() => {
      result.current.toggleActiveTab("negative");
    });
    expect(result.current.filteredEvents).toHaveLength(1);
    expect(result.current.filteredEvents[0].isPositive).toBe(false);
  });

  it("supports toggling positive and negative definition selection filters", async () => {
    const { result } = renderHook(() =>
      useSpatialReport({ matchId: "m-1", teamId: "t-1" }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.togglePositiveDefSelection("def-1");
    });
    expect(result.current.filters.selectedPositiveDefIds).toContain("def-1");

    act(() => {
      result.current.toggleNegativeDefSelection("def-2");
    });
    expect(result.current.filters.selectedNegativeDefIds).toContain("def-2");
  });

  it("supports multi-selecting and clearing player filters", async () => {
    const { result } = renderHook(() =>
      useSpatialReport({ matchId: "m-1", teamId: "t-1" }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.events).toHaveLength(2);
    });

    act(() => {
      result.current.togglePlayerSelection("lineup-1");
    });
    expect(result.current.filteredEvents).toHaveLength(1);
    expect(result.current.filteredEvents[0].matchLineupId).toBe("lineup-1");

    act(() => {
      result.current.handleSelectAllPlayers();
    });
    expect(result.current.filters.selectedLineupIds).toHaveLength(2);

    act(() => {
      result.current.handleClearPlayerSelection();
    });
    expect(result.current.filters.selectedLineupIds).toHaveLength(0);
    expect(result.current.filteredEvents).toHaveLength(2);
  });

  it("toggles goal lead vectors display state", async () => {
    const { result } = renderHook(() =>
      useSpatialReport({ matchId: "m-1", teamId: "t-1" }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.filters.showGoalLeadVectors).toBe(true);

    act(() => {
      result.current.toggleGoalLeadVectors();
    });

    expect(result.current.filters.showGoalLeadVectors).toBe(false);
  });

  it("handles error state when fetching fails", async () => {
    vi.mocked(reportService.getMatchEvents).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const { result } = renderHook(() =>
      useSpatialReport({ matchId: "m-1", teamId: "t-1" }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load spatial analytics data.");
  });
});
