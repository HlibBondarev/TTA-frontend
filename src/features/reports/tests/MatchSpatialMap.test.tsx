import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MatchSpatialMap } from "../components/MatchSpatialMap";
import type { GameEventResponse } from "../../../services/reportService";
import type { EventDefinitionLookup } from "../../../db/ttaDatabase";

describe("MatchSpatialMap Component", () => {
  const mockEventDefinitionsMap = new Map<string, EventDefinitionLookup>([
    [
      "def-1",
      {
        id: "def-1",
        sportId: "sport-1",
        name: "Goal",
        shortName: "GL",
        isPositive: true,
      },
    ],
    [
      "def-2",
      {
        id: "def-2",
        sportId: "sport-1",
        name: "Foul",
        shortName: "FL",
        isPositive: false,
      },
    ],
  ]);

  const mockEvents: GameEventResponse[] = [
    {
      id: "event-1",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      eventName: "Goal",
      isPositive: true,
      periodNumber: 1,
      eventTimestamp: "2026-10-14T10:00:00Z",
      normalizedMatchTime: "03:45.1234567",
      isLeadToGoal: true,
      locationX: 75,
      locationY: 50,
      playerName: "John Doe",
      playerNumber: 9,
    },
    {
      id: "event-2",
      matchLineupId: "lineup-2",
      eventDefinitionId: "def-2",
      eventName: "Foul",
      isPositive: false,
      periodNumber: 2,
      eventTimestamp: "2026-10-14T10:05:00Z",
      normalizedMatchTime: "06:12",
      isLeadToGoal: false,
      locationX: 25,
      locationY: 30,
      playerName: "Alex Smith",
      playerNumber: 4,
    },
  ];

  it("renders default court SVG layout with water polo markings when custom playgroundSvg is absent", () => {
    const { container } = render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
      />,
    );

    const svgElements = container.querySelectorAll("svg");
    expect(svgElements.length).toBeGreaterThanOrEqual(2);
  });

  it("renders custom playgroundSvg when provided", () => {
    const customSvg =
      '<svg data-testid="custom-court"><rect width="100" height="100"/></svg>';
    const { container } = render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playgroundSvg={customSvg}
      />,
    );

    expect(container.innerHTML).toContain('data-testid="custom-court"');
  });

  it("sanitizes malicious SVG markup using DOMPurify before rendering", () => {
    const xssSvg =
      '<svg data-testid="xss-svg"><script>alert("xss")</script><circle cx="10" cy="10" r="5" onload="alert(1)" /></svg>';

    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playgroundSvg={xssSvg}
      />,
    );

    expect(screen.getByTestId("xss-svg")).toBeInTheDocument();
    expect(document.querySelector("script")).not.toBeInTheDocument();
  });

  it("renders event markers on court with jersey numbers and ball markers for goals", () => {
    const { container } = render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
      />,
    );

    expect(screen.getByText("#9")).toBeInTheDocument();
    expect(screen.getByText("#4")).toBeInTheDocument();

    // Goal event (#9) should render custom ball pattern seam paths
    const ballSeamPath = container.querySelector("path[d*='Q 0 -6']");
    expect(ballSeamPath).toBeInTheDocument();
  });

  it("renders directional vector when showGoalLeadVectors is true and respects allEvents prop", () => {
    const vectorEvents: GameEventResponse[] = [
      {
        id: "lead-1",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-2",
        eventName: "Key Pass",
        isPositive: true,
        periodNumber: 1,
        eventTimestamp: "2026-10-14T10:00:00Z",
        isLeadToGoal: true,
        locationX: 40,
        locationY: 50,
        teamId: "team-1",
      },
      {
        id: "goal-1",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        eventName: "Goal",
        isPositive: true,
        periodNumber: 1,
        eventTimestamp: "2026-10-14T10:01:00Z",
        isLeadToGoal: false,
        locationX: 90,
        locationY: 50,
        teamId: "team-1",
      },
    ];

    const { container } = render(
      <MatchSpatialMap
        events={vectorEvents}
        allEvents={vectorEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        showGoalLeadVectors={true}
      />,
    );

    const vectorLine = container.querySelector("line[marker-end]");
    expect(vectorLine).toBeInTheDocument();
  });

  it("displays tooltip on hover with positivity colors (green for positive, red for negative)", () => {
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
      />,
    );

    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();

    // Hover positive goal event (#9)
    const positiveMarker = screen.getByText("#9");
    fireEvent.mouseEnter(positiveMarker);

    const positiveHeader = screen.getByText("John Doe").parentElement!;
    expect(positiveHeader.className).toContain("text-emerald-400");

    fireEvent.mouseLeave(positiveMarker);

    // Hover negative foul event (#4)
    const negativeMarker = screen.getByText("#4");
    fireEvent.mouseEnter(negativeMarker);

    const negativeHeader = screen.getByText("Alex Smith").parentElement!;
    expect(negativeHeader.className).toContain("text-rose-400");
  });

  it("displays and closes interactive tooltip when clicking action markers or map background", () => {
    const { container } = render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
      />,
    );

    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();

    const marker = screen.getByText("#9");
    fireEvent.click(marker);

    expect(screen.getByText("John Doe")).toBeInTheDocument();

    // Click SVG map background to dismiss tooltip
    const overlaySvg = container.querySelector(
      'svg[aria-label="Match Spatial Event Map"]',
    )!;
    fireEvent.click(overlaySvg);

    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
  });

  it("auto-dismisses active tooltip after 3.5 seconds", () => {
    vi.useFakeTimers();

    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
      />,
    );

    const marker = screen.getByText("#9");
    fireEvent.click(marker);

    expect(screen.getByText("John Doe")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3500);
    });

    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("adjusts tooltip positioning classes dynamically based on boundary coordinates to prevent clipping", () => {
    const boundaryEvents: GameEventResponse[] = [
      {
        id: "right-edge-event",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        eventName: "Goal",
        isPositive: true,
        periodNumber: 1,
        locationX: 85,
        locationY: 10,
        playerName: "Right Top Player",
        playerNumber: 3,
      },
    ];

    const { container } = render(
      <MatchSpatialMap
        events={boundaryEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
      />,
    );

    const marker = screen.getByText("#3");
    fireEvent.mouseEnter(marker);

    const tooltip = container.querySelector(".shadow-2xl")!;
    expect(tooltip).toBeInTheDocument();
    expect(tooltip.className).toContain("-translate-x-full");
    expect(tooltip.className).toContain("translate-y-4");
  });
});
