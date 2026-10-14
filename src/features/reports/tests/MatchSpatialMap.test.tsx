import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
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
      normalizedMatchTime: "03:45",
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
    expect(svgElements.length).toBeGreaterThanOrEqual(2); // Fallback court background + Overlay
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

  it("renders event markers on court with jersey numbers", () => {
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
      />,
    );

    expect(screen.getByText("#9")).toBeInTheDocument();
    expect(screen.getByText("#4")).toBeInTheDocument();
  });

  it("renders directional vector when showGoalLeadVectors is true", () => {
    const { container } = render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        showGoalLeadVectors={true}
      />,
    );

    const line = container.querySelector("line");
    expect(line).toBeInTheDocument();
  });

  it("displays tooltip on hover and closes tooltip on mouse leave", () => {
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
      />,
    );

    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();

    const marker = screen.getByText("#9");
    fireEvent.mouseEnter(marker);

    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Action:")).toBeInTheDocument();
    expect(screen.getByText("Goal")).toBeInTheDocument();
    expect(screen.getByText("Q1")).toBeInTheDocument();
    expect(screen.getByText("03:45")).toBeInTheDocument();

    // Mouse leave to close tooltip
    fireEvent.mouseLeave(marker);
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
  });

  it("displays and closes interactive tooltip when clicking action markers", () => {
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
      />,
    );

    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();

    const marker = screen.getByText("#9");
    fireEvent.click(marker);

    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Action:")).toBeInTheDocument();

    // Click again to close
    fireEvent.click(marker);
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
  });
});
