import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSpatialReport } from "../hooks/useSpatialReport";
import { reportService } from "../../../services/reportService";
import { db } from "../../../db/ttaDatabase";
import type { GameEventResponse } from "../../../services/reportService";
import type { EventDefinitionLookup } from "../../../db/ttaDatabase";
import { sportService } from "../../../services/sportService";

vi.mock("../../../services/reportService", () => ({
  reportService: {
    getMatchEvents: vi.fn(),
    getTeamLineup: vi.fn(),
  },
}));

vi.mock("../../../api/client", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

vi.mock("../../../services/sportService", () => ({
  sportService: {
    getSportConfigurations: vi.fn(),
  },
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matches: {
      get: vi.fn(),
    },
    tournaments: {
      get: vi.fn(),
      put: vi.fn(),
    },
    sportconfigurations: {
      get: vi.fn(),
      put: vi.fn(),
    },
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
      shotLocationX: 45,
      shotLocationY: 80,
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

  const mockDefinitions: EventDefinitionLookup[] = [
    {
      id: "def-1",
      sportId: "s-1",
      name: "Goal",
      shortName: "GL",
      isPositive: true,
      isShot: true,
    },
    {
      id: "def-2",
      sportId: "s-1",
      name: "Foul",
      shortName: "FL",
      isPositive: false,
      isShot: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(reportService.getMatchEvents).mockResolvedValue(mockEvents);
    vi.mocked(reportService.getTeamLineup).mockResolvedValue(mockLineups);

    vi.mocked(db.matches.get).mockResolvedValue(undefined);
    vi.mocked(db.tournaments.get).mockResolvedValue(undefined);
    vi.mocked(db.sportconfigurations.get).mockResolvedValue(undefined);

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

  it("uses playground and shotMap passed directly in props", async () => {
    const customPlayground = "<svg id='pg'></svg>";
    const customShotMap = "<svg id='sm'></svg>";

    const { result } = renderHook(() =>
      useSpatialReport({
        matchId: "m-1",
        playground: customPlayground,
        shotMap: customShotMap,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.playground).toBe(customPlayground);
    expect(result.current.shotMap).toBe(customShotMap);
  });

  it("resolves sport SVGs from tournament and sport configuration when missing in props", async () => {
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "m-1",
      tournamentId: "tourn-1",
    } as never);

    vi.mocked(db.tournaments.get).mockResolvedValueOnce({
      id: "tourn-1",
      sportId: "waterpolo",
      configurationId: "cfg-1",
    } as never);

    vi.mocked(db.sportconfigurations.get).mockResolvedValueOnce({
      id: "cfg-1",
      playground: "<svg id='db-pg'></svg>",
      shotMap: "<svg id='db-sm'></svg>",
    } as never);

    const { result } = renderHook(() => useSpatialReport({ matchId: "m-1" }));

    await waitFor(() => {
      expect(result.current.playground).toBe("<svg id='db-pg'></svg>");
      expect(result.current.shotMap).toBe("<svg id='db-sm'></svg>");
    });
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

  it("toggles map mode and filters events accordingly when switching to shot map", async () => {
    const { result } = renderHook(() =>
      useSpatialReport({ matchId: "m-1", teamId: "t-1" }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.filters.mapMode).toBe("field");
    expect(result.current.filteredEvents).toHaveLength(2);

    act(() => {
      result.current.toggleMapMode("shot");
    });

    expect(result.current.filters.mapMode).toBe("shot");
    expect(result.current.filteredEvents).toHaveLength(1);
    expect(result.current.filteredEvents[0].id).toBe("ev-1");

    act(() => {
      result.current.toggleMapMode();
    });

    expect(result.current.filters.mapMode).toBe("field");
    expect(result.current.filteredEvents).toHaveLength(2);
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

  it("supports selecting and resetting player filters", async () => {
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

  it("includes uncached event definitions in spatial shot report regardless of event order", async () => {
    const uncachedNonShotFirst: GameEventResponse = {
      id: "ev-non-shot-1",
      eventDefinitionId: "def-uncached-order-1",
      isPositive: true,
      playerNumber: 10,
      eventName: "Uncached Action",
    };
    const uncachedShotSecond: GameEventResponse = {
      id: "ev-shot-2",
      eventDefinitionId: "def-uncached-order-1",
      isPositive: true,
      shotLocationX: 60,
      shotLocationY: 70,
      playerNumber: 10,
      eventName: "Uncached Action",
    };

    vi.mocked(reportService.getMatchEvents).mockResolvedValueOnce([
      uncachedNonShotFirst,
      uncachedShotSecond,
    ]);
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce([]);

    const { result: resultA } = renderHook(() =>
      useSpatialReport({ matchId: "m-order-a" }),
    );

    await waitFor(() => {
      expect(resultA.current.isLoading).toBe(false);
    });

    act(() => {
      resultA.current.toggleMapMode("shot");
    });

    expect(resultA.current.filteredEvents).toHaveLength(1);
    expect(resultA.current.filteredEvents[0].id).toBe("ev-shot-2");

    vi.mocked(reportService.getMatchEvents).mockResolvedValueOnce([
      uncachedShotSecond,
      uncachedNonShotFirst,
    ]);
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce([]);

    const { result: resultB } = renderHook(() =>
      useSpatialReport({ matchId: "m-order-b" }),
    );

    await waitFor(() => {
      expect(resultB.current.isLoading).toBe(false);
    });

    act(() => {
      resultB.current.toggleMapMode("shot");
    });

    expect(resultB.current.filteredEvents).toHaveLength(1);
    expect(resultB.current.filteredEvents[0].id).toBe("ev-shot-2");
  });

  it("excludes non-shot events with extraneous shot coordinates on Shot Map when definition is confirmed as non-shot in DB", async () => {
    const foulWithShotCoords: GameEventResponse = {
      id: "ev-foul-extraneous-coords",
      eventDefinitionId: "def-foul-1",
      isPositive: false,
      playerNumber: 4,
      eventName: "Foul",
      locationX: 30,
      locationY: 40,
      shotLocationX: 50,
      shotLocationY: 50,
    };

    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce([
      {
        id: "def-foul-1",
        sportId: "s-1",
        name: "Foul",
        shortName: "FL",
        isPositive: false,
        isShot: false,
      },
    ]);

    vi.mocked(reportService.getMatchEvents).mockResolvedValueOnce([
      foulWithShotCoords,
    ]);

    const { result } = renderHook(() =>
      useSpatialReport({ matchId: "m-extraneous-coords-test" }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.toggleMapMode("shot");
    });

    expect(result.current.filteredEvents).toHaveLength(0);
    expect(result.current.eventDefinitionsMap.get("def-foul-1")?.isShot).toBe(
      false,
    );
  });

  it("fetches remote sport configuration when local cached config is missing shotMap", async () => {
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "m-1",
      tournamentId: "tourn-1",
    } as never);

    vi.mocked(db.tournaments.get).mockResolvedValueOnce({
      id: "tourn-1",
      sportId: "waterpolo",
      configurationId: "cfg-1",
    } as never);

    // Local cache contains playground but lacks shotMap
    vi.mocked(db.sportconfigurations.get).mockResolvedValueOnce({
      id: "cfg-1",
      playground: "<svg id='local-pg'></svg>",
      shotMap: undefined,
    } as never);

    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce([
      {
        id: "cfg-1",
        sportId: "waterpolo",
        usesCleanTime: true,
        periodsCount: 4,
        periodDurationMinutes: 8,
        fieldSize: "30x20",
        rosterLimit: 13,
        lineupLimit: 13,
        activePlayersLimit: 7,
        playground: "<svg id='remote-pg'></svg>",
        shotMap: "<svg id='remote-sm'></svg>",
      },
    ]);

    const { result } = renderHook(() => useSpatialReport({ matchId: "m-1" }));

    await waitFor(() => {
      expect(result.current.shotMap).toBe("<svg id='remote-sm'></svg>");
    });

    expect(sportService.getSportConfigurations).toHaveBeenCalledWith(
      "waterpolo",
    );
  });
});
