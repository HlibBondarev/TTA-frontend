import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MatchSpatialMap } from "../components/MatchSpatialMap";
import type { GameEventResponse } from "../../../services/reportService";
import type { EventDefinitionLookup } from "../../../db/ttaDatabase";

describe("MatchSpatialMap Component", () => {
  const defaultPlayground =
    '<svg viewBox="0 0 600 1000" width="600" height="1000"><rect width="600" height="1000" fill="blue"/></svg>';
  const defaultShotMap =
    '<svg viewBox="0 0 615 248" width="615" height="248"><rect width="615" height="248" fill="green"/></svg>';

  const mockEventDefinitionsMap = new Map<string, EventDefinitionLookup>([
    [
      "def-1",
      {
        id: "def-1",
        sportId: "sport-1",
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
        sportId: "sport-1",
        name: "Foul",
        shortName: "FL",
        isPositive: false,
        isShot: false,
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
      shotLocationX: 45,
      shotLocationY: 80,
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

  it("renders fallback banner when playground SVG is absent or invalid", () => {
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
      />,
    );

    expect(
      screen.getByText("Field Map SVG is unavailable for this match."),
    ).toBeInTheDocument();
  });

  it("renders court SVG layout and player markers when playground is provided", () => {
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
      />,
    );

    expect(
      screen.getByLabelText("Match Spatial Event Map"),
    ).toBeInTheDocument();

    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("renders custom playground when provided", () => {
    const customSvg =
      '<svg data-testid="custom-court" viewBox="0 0 600 1000" width="600" height="1000"><rect width="600" height="1000"/></svg>';
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={customSvg}
      />,
    );

    expect(screen.getByTestId("custom-court")).toBeInTheDocument();
  });

  it("sanitizes malicious SVG markup using DOMPurify before rendering", () => {
    const xssSvg =
      '<svg data-testid="xss-svg" viewBox="0 0 600 1000" width="600" height="1000"><script>alert("xss")</script><circle cx="10" cy="10" r="5" onload="alert(1)" /></svg>';

    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={xssSvg}
      />,
    );

    expect(screen.getByTestId("xss-svg")).toBeInTheDocument();
    expect(document.querySelector("script")).not.toBeInTheDocument();
  });

  it("renders directional vector when showGoalLeadVectors is true", () => {
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
        playground={defaultPlayground}
        showGoalLeadVectors={true}
      />,
    );

    const vectorLine = container.querySelector("line[marker-end]");
    expect(vectorLine).toBeInTheDocument();
  });

  it("displays tooltip on hover with positivity colors (emerald for positive, rose for negative)", () => {
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
      />,
    );

    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();

    // Hover positive goal event (#9)
    const positiveMarker = screen.getByText("9");
    fireEvent.mouseEnter(positiveMarker);

    const positivePlayerSpan = screen.getByText("John Doe");
    const positiveHeader = positivePlayerSpan.parentElement!;
    expect(positiveHeader.className).toContain("text-emerald-400");

    fireEvent.mouseLeave(positiveMarker);

    // Hover negative foul event (#4)
    const negativeMarker = screen.getByText("4");
    fireEvent.mouseEnter(negativeMarker);

    const negativePlayerSpan = screen.getByText("Alex Smith");
    const negativeHeader = negativePlayerSpan.parentElement!;
    expect(negativeHeader.className).toContain("text-rose-400");
  });

  it("allows toggling between Info and Shot preview in tooltip for shot actions", () => {
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
        shotMap={defaultShotMap}
      />,
    );

    const shotMarker = screen.getByText("9");
    fireEvent.mouseEnter(shotMarker);

    // Default is Info view
    expect(screen.getByText("Action:")).toBeInTheDocument();
    expect(screen.getByText("Goal")).toBeInTheDocument();

    // Toggle to Shot view
    const shotButton = screen.getByRole("button", { name: "Shot" });
    fireEvent.click(shotButton);

    expect(screen.getByText("Goal Target")).toBeInTheDocument();
    expect(screen.getByText("X:45% Y:80%")).toBeInTheDocument();

    // Toggle back to Info view
    const infoButton = screen.getByRole("button", { name: "Info" });
    fireEvent.click(infoButton);

    expect(screen.getByText("Action:")).toBeInTheDocument();
  });

  it("resets tooltip mode back to Info when switching active events", () => {
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
        shotMap={defaultShotMap}
      />,
    );

    // 1. Hover shot event (#9) and toggle mode to "Shot"
    const shotMarker = screen.getByText("9");
    fireEvent.mouseEnter(shotMarker);

    const shotButton = screen.getByRole("button", { name: "Shot" });
    fireEvent.click(shotButton);
    expect(screen.getByText("Goal Target")).toBeInTheDocument();

    // 2. Hover non-shot event (#4) - state should reset to "Info" and show action info
    const nonShotMarker = screen.getByText("4");
    fireEvent.mouseEnter(nonShotMarker);

    expect(screen.getByText("Alex Smith")).toBeInTheDocument();
    expect(screen.getByText("Action:")).toBeInTheDocument();
    expect(screen.getByText("Foul")).toBeInTheDocument();
    expect(screen.queryByText("Goal Target")).not.toBeInTheDocument();
  });

  it("displays and closes interactive tooltip when clicking action markers or map background", () => {
    const { container } = render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
      />,
    );

    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();

    const marker = screen.getByText("9");
    fireEvent.click(marker);
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    // Click SVG map background to dismiss tooltip
    const overlaySvg = container.querySelector(
      'svg[aria-label="Match Spatial Event Map"]',
    )!;
    fireEvent.click(overlaySvg);

    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
  });

  it("adjusts tooltip positioning classes dynamically based on locationX boundary", () => {
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
        playground={defaultPlayground}
      />,
    );

    const marker = screen.getByText("3");
    fireEvent.mouseEnter(marker);

    const tooltip = container.querySelector(".shadow-2xl") as HTMLElement;
    expect(tooltip).toBeInTheDocument();
    expect(tooltip.className).toContain("translate-y-4");
  });
});
