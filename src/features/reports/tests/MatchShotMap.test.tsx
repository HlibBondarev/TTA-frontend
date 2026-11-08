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

  it("renders fallback unavailable message when safeSvg is non-empty but dimensions are missing", () => {
    const invalidDimensionsSvg = `<svg><rect width="100" height="50" /></svg>`;

    render(
      <MatchShotMap
        events={mockEvents}
        eventDefinitionsMap={mockDefinitionsMap}
        shotMap={invalidDimensionsSvg}
      />,
    );

    expect(screen.getByText("Shot map scheme unavailable")).toBeInTheDocument();
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
    const customSvg = `<svg viewBox="0 0 615 248" onload="alert('xss')"><rect data-testid="custom-rect" width="615" height="248" fill="blue" onload="alert('xss2')"/></svg>`;

    render(
      <MatchShotMap
        events={mockEvents}
        eventDefinitionsMap={mockDefinitionsMap}
        shotMap={customSvg}
      />,
    );

    const rect = screen.getByTestId("custom-rect");
    const svgElement = rect.closest("svg");

    expect(rect).toBeInTheDocument();
    expect(rect).not.toHaveAttribute("onload");
    expect(svgElement).toBeInTheDocument();
    expect(svgElement).not.toHaveAttribute("onload");
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

  it("supports keyboard navigation (Enter and Space) and ARIA attributes on markers", () => {
    render(
      <MatchShotMap
        events={mockEvents}
        eventDefinitionsMap={mockDefinitionsMap}
        shotMap={defaultSvgLayout}
      />,
    );

    const markerBtn = screen.getByRole("button", {
      name: "Player #7 (Forward): Goal, Q1 02:15",
    });

    expect(markerBtn).toBeInTheDocument();
    expect(markerBtn).toHaveAttribute("tabindex", "0");

    const circle = markerBtn.querySelector("circle");
    expect(circle).toHaveClass("group-focus-visible:stroke-amber-400");

    // Enter key opens tooltip
    fireEvent.keyDown(markerBtn, { key: "Enter" });
    expect(screen.getByText("Q1 02:15")).toBeInTheDocument();

    // Space key opens tooltip and prevents default scroll
    const markerBtn10 = screen.getByRole("button", {
      name: "Player #10 (Driver): Shot on Goal, Q2",
    });
    fireEvent.keyDown(markerBtn10, { key: " " });
    expect(screen.getByText("Shot on Goal")).toBeInTheDocument();
  });

  it("allows pointer selection of overlapping edge markers on small viewBox maps even when one is hovered", () => {
    const smallSvg = `<svg viewBox="0 0 10 10" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>`;
    const edgeEvents: GameEventResponse[] = [
      {
        id: "edge-event-1",
        eventDefinitionId: goalDefId,
        isPositive: true,
        shotLocationX: 100,
        shotLocationY: 50,
        playerNumber: 7,
        playerName: "Player Seven",
        eventName: "Goal",
        periodNumber: 1,
      },
      {
        id: "edge-event-2",
        eventDefinitionId: sogDefId,
        isPositive: true,
        shotLocationX: 100,
        shotLocationY: 50,
        playerNumber: 9,
        playerName: "Player Nine",
        eventName: "Shot on Goal",
        periodNumber: 1,
      },
    ];

    render(
      <MatchShotMap
        events={edgeEvents}
        eventDefinitionsMap={mockDefinitionsMap}
        shotMap={smallSvg}
      />,
    );

    const marker1 = screen.getByRole("button", {
      name: /Player #7/,
    });
    const marker2 = screen.getByRole("button", {
      name: /Player #9/,
    });

    expect(marker1).toBeInTheDocument();
    expect(marker2).toBeInTheDocument();

    // Hover marker 2
    fireEvent.mouseEnter(marker2);
    expect(screen.getByText("Shot on Goal")).toBeInTheDocument();

    // Move pointer from marker 2 to marker 1 and click marker 1
    fireEvent.mouseLeave(marker2);
    fireEvent.mouseEnter(marker1);
    fireEvent.click(marker1);
    expect(screen.getByText("Goal")).toBeInTheDocument();

    // Move pointer from marker 1 to marker 2 and click marker 2
    fireEvent.mouseLeave(marker1);
    fireEvent.mouseEnter(marker2);
    fireEvent.click(marker2);
    expect(screen.getByText("Shot on Goal")).toBeInTheDocument();
  });

  it("scales marker stroke width dynamically and applies non-scaling-stroke for micro viewBox maps", () => {
    const microSvg = `<svg viewBox="0 0 1 1" width="1" height="1"><rect width="1" height="1" fill="blue"/></svg>`;
    const microEvents: GameEventResponse[] = [
      {
        id: "micro-1",
        eventDefinitionId: goalDefId,
        isPositive: true,
        shotLocationX: 100,
        shotLocationY: 50,
        playerNumber: 7,
      },
    ];

    render(
      <MatchShotMap
        events={microEvents}
        eventDefinitionsMap={mockDefinitionsMap}
        shotMap={microSvg}
      />,
    );

    const markerBtn = screen.getByRole("button", { name: /Player #7/ });
    const circle = markerBtn.querySelector("circle");

    expect(circle).toBeInTheDocument();
    expect(circle).toHaveAttribute("stroke-width", "0.01");
    expect(circle).toHaveStyle({ vectorEffect: "non-scaling-stroke" });
  });

  it("renders distinct scaled hit targets and handles pointer events for overlapping edge markers on a 1x1 map", () => {
    const microSvg = `<svg viewBox="0 0 1 1" width="100" height="100"><rect width="1" height="1" fill="blue"/></svg>`;
    const microEdgeEvents: GameEventResponse[] = [
      {
        id: "micro-edge-1",
        eventDefinitionId: goalDefId,
        isPositive: true,
        shotLocationX: 100,
        shotLocationY: 50,
        playerNumber: 7,
        playerName: "Player Seven",
        eventName: "Goal",
        periodNumber: 1,
      },
      {
        id: "micro-edge-2",
        eventDefinitionId: sogDefId,
        isPositive: true,
        shotLocationX: 100,
        shotLocationY: 50,
        playerNumber: 9,
        playerName: "Player Nine",
        eventName: "Shot on Goal",
        periodNumber: 1,
      },
    ];

    render(
      <MatchShotMap
        events={microEdgeEvents}
        eventDefinitionsMap={mockDefinitionsMap}
        shotMap={microSvg}
      />,
    );

    const marker1 = screen.getByRole("button", { name: /Player #7/ });
    const marker2 = screen.getByRole("button", { name: /Player #9/ });

    // Verify markers are rendered at distinct translated center coordinates (cx = 0.75 vs cx = 0.25)
    expect(marker1).toHaveAttribute("transform", "translate(0.75, 0.5)");
    expect(marker2).toHaveAttribute("transform", "translate(0.25, 0.5)");

    // Verify micro-scaled circle radii and non-scaling strokes to prevent hit target coverage
    const circle1 = marker1.querySelector("circle");
    const circle2 = marker2.querySelector("circle");

    expect(circle1).toHaveAttribute("r", "0.032");
    expect(circle2).toHaveAttribute("r", "0.032");
    expect(circle1).toHaveAttribute("stroke-width", "0.01");
    expect(circle2).toHaveAttribute("stroke-width", "0.01");
    expect(circle1).toHaveStyle({ vectorEffect: "non-scaling-stroke" });
    expect(circle2).toHaveStyle({ vectorEffect: "non-scaling-stroke" });

    // Verify independent pointer event interactions
    fireEvent.mouseEnter(marker2);
    expect(screen.getByText("Shot on Goal")).toBeInTheDocument();

    fireEvent.mouseLeave(marker2);
    fireEvent.mouseEnter(marker1);
    fireEvent.click(marker1);
    expect(screen.getByText("Goal")).toBeInTheDocument();

    fireEvent.mouseLeave(marker1);
    fireEvent.mouseEnter(marker2);
    fireEvent.click(marker2);
    expect(screen.getByText("Shot on Goal")).toBeInTheDocument();
  });

  it("renders markers for uncached event definitions when valid shot coordinates are present", () => {
    const uncachedEvents: GameEventResponse[] = [
      {
        id: "uncached-event-1",
        eventDefinitionId: "def-unknown-id",
        isPositive: true,
        shotLocationX: 50,
        shotLocationY: 50,
        playerNumber: 88,
      },
    ];

    render(
      <MatchShotMap
        events={uncachedEvents}
        eventDefinitionsMap={new Map()}
        shotMap={defaultSvgLayout}
      />,
    );

    expect(screen.getByText("88")).toBeInTheDocument();
  });
});
