import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MatchShotMap } from "../components/MatchShotMap";
import type { GameEventResponse } from "../../../services/reportService";
import type { EventDefinitionLookup } from "../../../db/ttaDatabase";

describe("MatchShotMap Component", () => {
  const goalDefId = "def-goal";
  const sogDefId = "def-sog";
  const missDefId = "def-miss";

  const defaultSvgLayout = `<svg viewBox="0 0 615 248" width="615" height="248"><rect width="615" height="248" fill="blue"/></svg>`;

  const mockDefinitionsMap = new Map<string, EventDefinitionLookup>([
    [
      goalDefId,
      {
        id: goalDefId,
        sportId: "wp",
        name: "Goal",
        shortName: "G",
        isPositive: true,
        isShot: true,
      },
    ],
    [
      sogDefId,
      {
        id: sogDefId,
        sportId: "wp",
        name: "Shot on Goal",
        shortName: "SOG",
        isPositive: true,
        isShot: true,
      },
    ],
    [
      missDefId,
      {
        id: missDefId,
        sportId: "wp",
        name: "Missed Shot",
        shortName: "MS",
        isPositive: false,
        isShot: true,
      },
    ],
  ]);

  const mockEvents: GameEventResponse[] = [
    {
      id: "event-goal",
      eventDefinitionId: goalDefId,
      isPositive: true,
      shotLocationX: 50,
      shotLocationY: 80,
      playerNumber: 7,
      playerName: "Forward",
      eventName: "Goal",
      periodNumber: 1,
      normalizedMatchTime: "02:15.000",
    },
    {
      id: "event-sog",
      eventDefinitionId: sogDefId,
      isPositive: true,
      shotLocationX: 30,
      shotLocationY: 60,
      playerNumber: 10,
      playerName: "Driver",
      eventName: "Shot on Goal",
      periodNumber: 2,
    },
    {
      id: "event-conceded",
      eventDefinitionId: goalDefId,
      isPositive: false,
      shotLocationX: 20,
      shotLocationY: 40,
      playerNumber: 1,
      playerName: "Keeper",
      eventName: "Conceded Goal",
      periodNumber: 3,
    },
    {
      id: "event-miss",
      eventDefinitionId: missDefId,
      isPositive: false,
      shotLocationX: 70,
      shotLocationY: 10,
      playerNumber: 5,
      playerName: "Center Back",
      eventName: "Missed Shot",
      periodNumber: 4,
    },
  ];

  it("returns null when shotMap SVG prop is omitted or empty", () => {
    const { container } = render(
      <MatchShotMap
        events={mockEvents}
        eventDefinitionsMap={mockDefinitionsMap}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders shotMap layout SVG and player number markers when shotMap is provided", () => {
    render(
      <MatchShotMap
        events={mockEvents}
        eventDefinitionsMap={mockDefinitionsMap}
        shotMap={defaultSvgLayout}
      />,
    );

    const svgCanvas = screen.getByLabelText("Match Shot Map");
    expect(svgCanvas).toBeInTheDocument();

    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders sanitized custom shotMap SVG elements", () => {
    const customSvg = `<svg viewBox="0 0 615 248"><rect data-testid="custom-rect" width="615" height="248" fill="blue"/></svg>`;

    render(
      <MatchShotMap
        events={mockEvents}
        eventDefinitionsMap={mockDefinitionsMap}
        shotMap={customSvg}
      />,
    );

    expect(screen.getByTestId("custom-rect")).toBeInTheDocument();
  });

  it("shows tooltip with player name, period/time, and action details when a marker is clicked", () => {
    render(
      <MatchShotMap
        events={mockEvents}
        eventDefinitionsMap={mockDefinitionsMap}
        shotMap={defaultSvgLayout}
      />,
    );

    expect(screen.queryByText(/Forward/)).not.toBeInTheDocument();

    const markerText = screen.getByText("7");
    fireEvent.click(markerText);

    expect(screen.getByText(/Forward/)).toBeInTheDocument();
    expect(screen.getByText("Q1 02:15")).toBeInTheDocument();
    expect(screen.getByText("Goal")).toBeInTheDocument();
  });

  it("updates tooltip details on marker mouse enter", () => {
    render(
      <MatchShotMap
        events={mockEvents}
        eventDefinitionsMap={mockDefinitionsMap}
        shotMap={defaultSvgLayout}
      />,
    );

    const markerText10 = screen.getByText("10");
    fireEvent.mouseEnter(markerText10);

    expect(screen.getByText(/Driver/)).toBeInTheDocument();
    expect(screen.getByText("Q2")).toBeInTheDocument();
    expect(screen.getByText("Shot on Goal")).toBeInTheDocument();
  });

  it("clears active event tooltip when canvas background is clicked", () => {
    render(
      <MatchShotMap
        events={mockEvents}
        eventDefinitionsMap={mockDefinitionsMap}
        shotMap={defaultSvgLayout}
      />,
    );

    const markerText = screen.getByText("7");
    fireEvent.click(markerText);

    const tooltipHeader = screen.getByText(/Forward/);
    expect(tooltipHeader.closest(".invisible")).not.toBeInTheDocument();

    const svgCanvas = screen.getByLabelText("Match Shot Map");
    fireEvent.click(svgCanvas);

    expect(tooltipHeader.closest(".invisible")).toBeInTheDocument();
  });
});
