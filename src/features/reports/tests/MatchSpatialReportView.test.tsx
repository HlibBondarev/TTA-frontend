import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MatchSpatialReportView } from "../components/MatchSpatialReportView";
import { useSpatialReport } from "../hooks/useSpatialReport";
import { reportService } from "../../../services/reportService";
import { db } from "../../../db/ttaDatabase";
import type {
  MatchLineupLookup,
  EventDefinitionLookup,
} from "../../../db/ttaDatabase";
import type { GameEventResponse } from "../../../services/reportService";

vi.mock("../hooks/useSpatialReport", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../hooks/useSpatialReport")>();
  return {
    ...actual,
    useSpatialReport: vi.fn(actual.useSpatialReport),
  };
});

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

describe("MatchSpatialReportView Component", () => {
  const mockTeamLineups: MatchLineupLookup[] = [
    {
      id: "l-1",
      matchId: "m-1",
      playerRosterId: "r-1",
      number: 7,
      positionId: "pos-1",
    },
    {
      id: "l-2",
      matchId: "m-1",
      playerRosterId: "r-2",
      number: 4,
      positionId: "pos-2",
    },
  ];

  const mockEvents: GameEventResponse[] = [
    {
      id: "ev-1",
      isPositive: true,
      periodNumber: 1,
      matchLineupId: "l-1",
      eventDefinitionId: "def-1",
      eventName: "Goal",
      eventTimestamp: "2026-10-14T10:00:00Z",
      isLeadToGoal: true,
      locationX: 80,
      locationY: 50,
      shotLocationX: 50,
      shotLocationY: 80,
    },
    {
      id: "ev-2",
      isPositive: false,
      periodNumber: 2,
      matchLineupId: "l-2",
      eventDefinitionId: "def-2",
      eventName: "Foul",
      eventTimestamp: "2026-10-14T10:05:00Z",
      isLeadToGoal: false,
      locationX: 30,
      locationY: 40,
    },
  ];

  const mockDefinitionsMap = new Map<string, EventDefinitionLookup>([
    [
      "def-1",
      {
        id: "def-1",
        sportId: "s-1",
        name: "Goal",
        shortName: "GL",
        isPositive: true,
        isShot: true,
      },
    ],
    [
      "def-2",
      {
        id: "def-2",
        sportId: "s-1",
        name: "Foul",
        shortName: "FL",
        isPositive: false,
        isShot: false,
      },
    ],
  ]);

  const mockHookReturnValue = {
    events: mockEvents,
    filteredEvents: mockEvents,
    teamLineups: mockTeamLineups,
    eventDefinitionsMap: mockDefinitionsMap,
    playground:
      '<svg viewBox="0 0 600 1000"><rect width="600" height="1000" /></svg>',
    shotMap:
      '<svg viewBox="0 0 615 248"><rect width="615" height="248" /></svg>',
    filters: {
      periodNumber: null,
      selectedLineupIds: [],
      selectedPositiveDefIds: [],
      selectedNegativeDefIds: [],
      activeTab: "all" as const,
      displayMode: "scatter" as const,
      showGoalLeadVectors: true,
      mapMode: "field" as const,
    },
    isLoading: false,
    error: null,
    togglePeriodFilter: vi.fn(),
    toggleActiveTab: vi.fn(),
    toggleGoalLeadVectors: vi.fn(),
    togglePlayerSelection: vi.fn(),
    handleSelectAllPlayers: vi.fn(),
    togglePositiveDefSelection: vi.fn(),
    toggleNegativeDefSelection: vi.fn(),
    toggleMapMode: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.matches.get).mockResolvedValue(undefined);
    vi.mocked(db.tournaments.get).mockResolvedValue(undefined);
    vi.mocked(db.sportconfigurations.get).mockResolvedValue(undefined);
    vi.mocked(reportService.getTeamLineup).mockResolvedValue([]);
    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    } as never);
  });

  it("renders loading indicator when isLoading is true", () => {
    vi.mocked(useSpatialReport).mockReturnValueOnce({
      ...mockHookReturnValue,
      isLoading: true,
    });

    render(<MatchSpatialReportView matchId="m-1" teamId="t-1" />);

    expect(
      screen.getByText(/Loading spatial analytics map.../i),
    ).toBeInTheDocument();
  });

  it("renders error message and handles back action when error occurs", () => {
    const mockOnBack = vi.fn();
    vi.mocked(useSpatialReport).mockReturnValueOnce({
      ...mockHookReturnValue,
      error: "Failed to load spatial analytics data.",
    });

    render(
      <MatchSpatialReportView matchId="m-1" teamId="t-1" onBack={mockOnBack} />,
    );

    expect(
      screen.getByText("Failed to load spatial analytics data."),
    ).toBeInTheDocument();

    const backButton = screen.getByRole("button", { name: "Back" });
    fireEvent.click(backButton);
    expect(mockOnBack).toHaveBeenCalledTimes(1);
  });

  it("renders filter controls, player chips, action definition chips, and field court map by default", () => {
    vi.mocked(useSpatialReport).mockReturnValueOnce(mockHookReturnValue);

    const { container } = render(
      <MatchSpatialReportView matchId="m-1" teamId="t-1" />,
    );

    expect(
      screen.getByText((_content, node) => {
        const hasText = (el?: Element | null) =>
          el?.textContent === "Actions: 2 / 2";
        const nodeHasText = hasText(node);
        const childrenDontHaveText = Array.from(node?.children || []).every(
          (child) => !hasText(child),
        );
        return nodeHasText && childrenDontHaveText;
      }),
    ).toBeInTheDocument();

    expect(screen.getByText("Field Map")).toBeInTheDocument();
    expect(screen.getByText("Shot Map")).toBeInTheDocument();
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("Q1")).toBeInTheDocument();
    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(screen.getByText("#4")).toBeInTheDocument();
    expect(screen.getByText("+ Positive Actions")).toBeInTheDocument();
    expect(screen.getAllByText("Goal")[0]).toBeInTheDocument();
    expect(screen.getByText("- Negative Actions")).toBeInTheDocument();
    expect(screen.getByText("Foul")).toBeInTheDocument();

    expect(
      container.querySelector('svg[viewBox="0 0 600 1000"]'),
    ).toBeInTheDocument();
    expect(screen.getByText("GL")).toBeInTheDocument();
    expect(screen.getByText("FL")).toBeInTheDocument();
  });

  it("renders MatchShotMap and legend when mapMode is set to shot", () => {
    vi.mocked(useSpatialReport).mockReturnValueOnce({
      ...mockHookReturnValue,
      filters: {
        ...mockHookReturnValue.filters,
        mapMode: "shot",
      },
    });

    const { container } = render(
      <MatchSpatialReportView matchId="m-1" teamId="t-1" />,
    );

    expect(screen.getAllByText("Goal")[0]).toBeInTheDocument();
    expect(screen.getByText("Shot on Goal")).toBeInTheDocument();
    expect(screen.getByText("Missed")).toBeInTheDocument();
    expect(screen.getByText("Conceded")).toBeInTheDocument();

    const shotSvg = container.querySelector('svg[viewBox="0 0 615 248"]');
    expect(shotSvg).toBeInTheDocument();
    expect(
      container.querySelectorAll('svg [role="button"]').length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText("Goal Shot Map SVG is unavailable for this match."),
    ).not.toBeInTheDocument();
  });

  it("renders fallback banner when mapMode is shot and effectiveShotMap is unavailable", () => {
    vi.mocked(useSpatialReport).mockReturnValueOnce({
      ...mockHookReturnValue,
      shotMap: null,
      filters: {
        ...mockHookReturnValue.filters,
        mapMode: "shot",
      },
    });

    render(<MatchSpatialReportView matchId="m-1" teamId="t-1" />);

    expect(
      screen.getByText("Goal Shot Map SVG is unavailable for this match."),
    ).toBeInTheDocument();
  });

  it("triggers filter callbacks on button clicks including mapMode switchers", () => {
    vi.mocked(useSpatialReport).mockReturnValueOnce(mockHookReturnValue);

    render(<MatchSpatialReportView matchId="m-1" teamId="t-1" />);

    fireEvent.click(screen.getByText("Shot Map"));
    expect(mockHookReturnValue.toggleMapMode).toHaveBeenCalledWith("shot");

    fireEvent.click(screen.getByText("Field Map"));
    expect(mockHookReturnValue.toggleMapMode).toHaveBeenCalledWith("field");

    fireEvent.click(screen.getByText("Q2"));
    expect(mockHookReturnValue.togglePeriodFilter).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByText("negative"));
    expect(mockHookReturnValue.toggleActiveTab).toHaveBeenCalledWith(
      "negative",
    );

    fireEvent.click(screen.getByText("#7"));
    expect(mockHookReturnValue.togglePlayerSelection).toHaveBeenCalledWith(
      "l-1",
    );

    fireEvent.click(screen.getByText("Select All"));
    expect(mockHookReturnValue.handleSelectAllPlayers).toHaveBeenCalled();

    const goalActionChip = screen
      .getAllByText("Goal")
      .find((el) => el.tagName === "BUTTON");
    expect(goalActionChip).toBeDefined();
    fireEvent.click(goalActionChip!);
    expect(mockHookReturnValue.togglePositiveDefSelection).toHaveBeenCalledWith(
      "def-1",
    );

    fireEvent.click(screen.getByText("Foul"));
    expect(mockHookReturnValue.toggleNegativeDefSelection).toHaveBeenCalledWith(
      "def-2",
    );

    fireEvent.click(screen.getByText("Vectors ON"));
    expect(mockHookReturnValue.toggleGoalLeadVectors).toHaveBeenCalled();
  });

  it("renders shot markers in UI with real useSpatialReport hook and MatchShotMap under both event sequence orders when mapMode is shot", async () => {
    const uncachedNonShot: GameEventResponse = {
      id: "view-uncached-nonshot-1",
      eventDefinitionId: "def-uncached-view-1",
      isPositive: true,
      playerNumber: 77,
      eventName: "Uncached Pass",
    };
    const uncachedShot: GameEventResponse = {
      id: "view-uncached-shot-2",
      eventDefinitionId: "def-uncached-view-1",
      isPositive: true,
      shotLocationX: 50,
      shotLocationY: 50,
      playerNumber: 77,
      eventName: "Uncached Drive Shot",
    };

    const mockShotMapSvg = `<svg viewBox="0 0 615 248"><rect width="615" height="248" fill="blue"/></svg>`;

    // Order 1: Non-shot event first, shot event second
    vi.mocked(reportService.getMatchEvents).mockResolvedValueOnce([
      uncachedNonShot,
      uncachedShot,
    ]);
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce([]);

    const { unmount: unmountFirstOrder } = render(
      <MatchSpatialReportView
        matchId="m-view-order-1"
        shotMap={mockShotMapSvg}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Shot Map")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Shot Map"));

    const markerOrder1 = await screen.findByRole("button", {
      name: /Player #77/,
    });
    expect(markerOrder1).toBeInTheDocument();

    unmountFirstOrder();

    // Order 2: Shot event first, non-shot event second
    vi.mocked(reportService.getMatchEvents).mockResolvedValueOnce([
      uncachedShot,
      uncachedNonShot,
    ]);
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce([]);

    render(
      <MatchSpatialReportView
        matchId="m-view-order-2"
        shotMap={mockShotMapSvg}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Shot Map")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Shot Map"));

    const markerOrder2 = await screen.findByRole("button", {
      name: /Player #77/,
    });
    expect(markerOrder2).toBeInTheDocument();
  });

  it("shows only action definition chips with isShot === true when mapMode is set to shot", () => {
    vi.mocked(useSpatialReport).mockReturnValueOnce({
      ...mockHookReturnValue,
      events: [
        ...mockEvents,
        {
          id: "ev-3",
          isPositive: true,
          periodNumber: 1,
          matchLineupId: "l-1",
          eventDefinitionId: "def-3",
          eventName: "Pass",
          eventTimestamp: "2026-10-14T10:02:00Z",
          isLeadToGoal: false,
          locationX: 50,
          locationY: 50,
          shotLocationX: 20,
          shotLocationY: 30,
        },
      ],
      eventDefinitionsMap: new Map([
        ...mockDefinitionsMap,
        [
          "def-3",
          {
            id: "def-3",
            sportId: "s-1",
            name: "Pass",
            shortName: "PS",
            isPositive: true,
            isShot: false,
          },
        ],
      ]),
      filters: {
        ...mockHookReturnValue.filters,
        mapMode: "shot",
      },
    });

    render(<MatchSpatialReportView matchId="m-1" teamId="t-1" />);

    // Goal (isShot: true) is available for selection
    const goalChip = screen
      .getAllByText("Goal")
      .find((el) => el.tagName === "BUTTON");
    expect(goalChip).toBeDefined();

    // Non-shot actions (isShot: false) are excluded even if an event has shot coordinates
    expect(screen.queryByText("Pass")).not.toBeInTheDocument();
    expect(screen.queryByText("Foul")).not.toBeInTheDocument();
  });
});
