import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MatchSpatialReportView } from "../components/MatchSpatialReportView";
import { useSpatialReport } from "../hooks/useSpatialReport";
import type {
  MatchLineupLookup,
  EventDefinitionLookup,
} from "../../../db/ttaDatabase";
import type { GameEventResponse } from "../../../services/reportService";

vi.mock("../hooks/useSpatialReport");

vi.mock("../components/MatchSpatialMap", () => ({
  MatchSpatialMap: ({
    events,
    allEvents,
  }: {
    events: GameEventResponse[];
    allEvents?: GameEventResponse[];
  }) => (
    <div data-testid="match-spatial-map">
      Field Map Canvas (Filtered: {events.length}, Total:{" "}
      {allEvents?.length ?? 0})
    </div>
  ),
}));

vi.mock("../components/MatchShotMap", () => ({
  MatchShotMap: ({ events }: { events: GameEventResponse[] }) => (
    <div data-testid="match-shot-map">
      Shot Map Canvas (Filtered: {events.length})
    </div>
  ),
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
    playground: "<svg>Playground</svg>",
    shotMap: "<svg>ShotMap</svg>",
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
    vi.mocked(useSpatialReport).mockReturnValue(mockHookReturnValue);

    render(<MatchSpatialReportView matchId="m-1" teamId="t-1" />);

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
    expect(screen.getByTestId("match-spatial-map")).toBeInTheDocument();
    expect(
      screen.getByText("Field Map Canvas (Filtered: 2, Total: 2)"),
    ).toBeInTheDocument();
  });

  it("renders MatchShotMap and legend when mapMode is set to shot", () => {
    vi.mocked(useSpatialReport).mockReturnValue({
      ...mockHookReturnValue,
      filters: {
        ...mockHookReturnValue.filters,
        mapMode: "shot",
      },
    });

    render(<MatchSpatialReportView matchId="m-1" teamId="t-1" />);

    expect(screen.getByTestId("match-shot-map")).toBeInTheDocument();
    expect(screen.queryByTestId("match-spatial-map")).not.toBeInTheDocument();

    // Check legend items
    expect(screen.getAllByText("Goal")[0]).toBeInTheDocument();
    expect(screen.getByText("Shot on Goal")).toBeInTheDocument();
    expect(screen.getByText("Missed")).toBeInTheDocument();
    expect(screen.getByText("Conceded")).toBeInTheDocument();
  });

  it("renders fallback banner when mapMode is shot and effectiveShotMap is unavailable", () => {
    vi.mocked(useSpatialReport).mockReturnValue({
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
    expect(screen.queryByTestId("match-shot-map")).not.toBeInTheDocument();
  });

  it("triggers filter callbacks on button clicks including mapMode switchers", () => {
    vi.mocked(useSpatialReport).mockReturnValue(mockHookReturnValue);

    render(<MatchSpatialReportView matchId="m-1" teamId="t-1" />);

    // Switch to Shot Map mode
    fireEvent.click(screen.getByText("Shot Map"));
    expect(mockHookReturnValue.toggleMapMode).toHaveBeenCalledWith("shot");

    // Switch to Field Map mode
    fireEvent.click(screen.getByText("Field Map"));
    expect(mockHookReturnValue.toggleMapMode).toHaveBeenCalledWith("field");

    // Click Period Q2
    fireEvent.click(screen.getByText("Q2"));
    expect(mockHookReturnValue.togglePeriodFilter).toHaveBeenCalledWith(2);

    // Click Category Tab Negative
    fireEvent.click(screen.getByText("negative"));
    expect(mockHookReturnValue.toggleActiveTab).toHaveBeenCalledWith(
      "negative",
    );

    // Click Player Chip #7
    fireEvent.click(screen.getByText("#7"));
    expect(mockHookReturnValue.togglePlayerSelection).toHaveBeenCalledWith(
      "l-1",
    );

    // Click Select All button
    fireEvent.click(screen.getByText("Select All"));
    expect(mockHookReturnValue.handleSelectAllPlayers).toHaveBeenCalled();

    // Click specific positive action chip "Goal"
    const goalActionChip = screen
      .getAllByText("Goal")
      .find((el) => el.tagName === "BUTTON");
    expect(goalActionChip).toBeDefined();
    fireEvent.click(goalActionChip!);
    expect(mockHookReturnValue.togglePositiveDefSelection).toHaveBeenCalledWith(
      "def-1",
    );

    // Click specific negative action chip "Foul"
    fireEvent.click(screen.getByText("Foul"));
    expect(mockHookReturnValue.toggleNegativeDefSelection).toHaveBeenCalledWith(
      "def-2",
    );

    // Toggle Vectors
    fireEvent.click(screen.getByText("Vectors ON"));
    expect(mockHookReturnValue.toggleGoalLeadVectors).toHaveBeenCalled();
  });
});
