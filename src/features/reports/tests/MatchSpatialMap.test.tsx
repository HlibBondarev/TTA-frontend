import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MatchSpatialMap } from "../components/MatchSpatialMap";
import type { GameEventResponse } from "../../../services/reportService";
import type { EventDefinitionLookup } from "../../../db/ttaDatabase";

describe("MatchSpatialMap Component", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

    const svg = screen.getByTestId("xss-svg");
    expect(svg).toBeInTheDocument();
    expect(document.querySelector("script")).not.toBeInTheDocument();

    const circle = svg.querySelector("circle");
    expect(circle).toBeInTheDocument();
    expect(circle).not.toHaveAttribute("onload");
  });

  it("renders directional vector when showGoalLeadVectors is true and scales stroke-dasharray proportionally", () => {
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
    expect(vectorLine).toHaveAttribute("stroke", "#ffffff");
    expect(vectorLine).toHaveAttribute("marker-end", "url(#arrow-white)");

    const dashArray = vectorLine?.getAttribute("stroke-dasharray");
    expect(dashArray).toBeDefined();
    const [dashOn, dashOff] = dashArray!.split(" ").map(Number);
    expect(dashOn).toBeCloseTo(4.98, 1);
    expect(dashOff).toBeCloseTo(4.02, 1);
  });

  it("renders GoalMarker with yellow fill and emerald outline for positive goals", () => {
    render(
      <MatchSpatialMap
        events={[mockEvents[0]]}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
      />,
    );

    const goalText = screen.getByText("9");
    const circle = goalText.previousElementSibling!;
    expect(circle).toHaveClass("fill-amber-400");
    expect(circle).toHaveClass("stroke-emerald-400");
  });

  it("renders LeadMarker with green fill and yellow outline for positive lead-to-goal actions", () => {
    const leadOnlyEvents: GameEventResponse[] = [
      {
        id: "lead-only-1",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-2",
        eventName: "Assist",
        isPositive: true,
        periodNumber: 1,
        isLeadToGoal: true,
        locationX: 60,
        locationY: 40,
        playerNumber: 7,
      },
    ];

    render(
      <MatchSpatialMap
        events={leadOnlyEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
      />,
    );

    const leadText = screen.getByText("7");
    const circle = leadText.previousElementSibling!;
    expect(circle).toHaveClass("fill-emerald-500");
    expect(circle).toHaveClass("stroke-amber-400");
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

    const positiveMarker = screen.getByText("9");
    fireEvent.mouseEnter(positiveMarker);

    const positivePlayerSpan = screen.getByText("John Doe");
    const positiveHeader = positivePlayerSpan.parentElement!;
    expect(positiveHeader.className).toContain("text-emerald-400");

    fireEvent.mouseLeave(positiveMarker);

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

    expect(screen.getByText("Action:")).toBeInTheDocument();
    expect(screen.getByText("Goal")).toBeInTheDocument();

    fireEvent.mouseLeave(shotMarker);
    const tooltip = screen.getByRole("tooltip");
    fireEvent.mouseEnter(tooltip);

    const shotButton = screen.getByRole("button", { name: "Shot" });
    fireEvent.click(shotButton);

    expect(screen.getByText("Goal Target")).toBeInTheDocument();
    expect(screen.getByText("X:45% Y:80%")).toBeInTheDocument();

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

    const shotMarker = screen.getByText("9");
    fireEvent.mouseEnter(shotMarker);

    const shotButton = screen.getByRole("button", { name: "Shot" });
    fireEvent.click(shotButton);
    expect(screen.getByText("Goal Target")).toBeInTheDocument();

    const nonShotMarker = screen.getByText("4");
    fireEvent.mouseEnter(nonShotMarker);

    expect(screen.getByText("Alex Smith")).toBeInTheDocument();
    expect(screen.getByText("Action:")).toBeInTheDocument();
    expect(screen.getByText("Foul")).toBeInTheDocument();
    expect(screen.queryByText("Goal Target")).not.toBeInTheDocument();
  });

  it("keeps tooltip open when pointer moves from marker onto the tooltip", () => {
    vi.useFakeTimers();
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

    expect(screen.getByText("John Doe")).toBeInTheDocument();

    fireEvent.mouseLeave(shotMarker);

    const tooltip = screen.getByRole("tooltip");
    fireEvent.mouseEnter(tooltip);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText("John Doe")).toBeInTheDocument();

    const shotButton = screen.getByRole("button", { name: "Shot" });
    fireEvent.click(shotButton);

    expect(screen.getByText("Goal Target")).toBeInTheDocument();
  });

  it("pauses tooltip auto-dismiss while pointer or keyboard focus is inside and restarts when interaction leaves", () => {
    vi.useFakeTimers();
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
        shotMap={defaultShotMap}
      />,
    );

    const marker = screen.getByText("9");
    fireEvent.click(marker);

    expect(screen.getByText("John Doe")).toBeInTheDocument();

    const tooltip = screen.getByRole("tooltip");
    fireEvent.mouseEnter(tooltip);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    const shotButton = screen.getByRole("button", { name: "Shot" });
    fireEvent.focus(shotButton);
    fireEvent.mouseLeave(tooltip);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    fireEvent.blur(shotButton);

    act(() => {
      vi.advanceTimersByTime(3499);
    });
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
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

  it("triggers marker selection on Enter and Space keypress while preventing default behavior", () => {
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
      />,
    );

    const markerGroup = screen.getByRole("button", {
      name: "John Doe #9 GL",
    });

    fireEvent.keyDown(markerGroup, { key: "Enter" });
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    const overlaySvg = screen.getByLabelText("Match Spatial Event Map");
    fireEvent.click(overlaySvg);
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();

    const spaceEvent = fireEvent.keyDown(markerGroup, { key: " " });
    expect(spaceEvent).toBe(false);
    expect(screen.getByText("John Doe")).toBeInTheDocument();
  });

  it("scales marker sizes, stroke widths, font sizes, and vector offsets dynamically for custom viewBox dimensions", () => {
    const customSmallPlayground =
      '<svg viewBox="0 0 300 500" width="300" height="500"><rect width="300" height="500" fill="blue"/></svg>';

    const customEvents: GameEventResponse[] = [
      {
        id: "custom-goal",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        eventName: "Goal",
        isPositive: true,
        periodNumber: 1,
        locationX: 90,
        locationY: 50,
        playerNumber: 7,
      },
    ];

    render(
      <MatchSpatialMap
        events={customEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={customSmallPlayground}
      />,
    );

    const markerBtn = screen.getByRole("button", { name: /#7/ });
    const circle = markerBtn.querySelector("circle");
    const text = markerBtn.querySelector("text");

    expect(circle).toBeInTheDocument();
    expect(circle).toHaveAttribute("r", "12");
    expect(Number(circle?.getAttribute("stroke-width"))).toBeCloseTo(3, 3);
    expect(circle).not.toHaveAttribute(
      "style",
      expect.stringContaining("non-scaling-stroke"),
    );
    expect(text).toHaveAttribute("font-size", "8.4");
  });

  it("removes overflow clipping from outer container and applies rounded-2xl overflow-hidden to inner SVG wrapper", () => {
    const { container } = render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
      />,
    );

    const outerContainer = container.firstChild as HTMLElement;
    expect(outerContainer).not.toHaveClass("overflow-hidden");

    const innerWrapper = container.querySelector(
      ".pointer-events-none.opacity-90",
    );
    expect(innerWrapper).toHaveClass("rounded-2xl", "overflow-hidden");

    const positiveMarker = screen.getByText("9");
    fireEvent.mouseEnter(positiveMarker);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("does not reverse short vector direction when vector length is smaller than combined base offsets", () => {
    const shortVectorEvents: GameEventResponse[] = [
      {
        id: "short-lead",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-2",
        eventName: "Short Pass",
        isPositive: true,
        periodNumber: 1,
        isLeadToGoal: true,
        locationX: 50,
        locationY: 50,
        teamId: "team-1",
      },
      {
        id: "short-goal",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        eventName: "Goal",
        isPositive: true,
        periodNumber: 1,
        isLeadToGoal: false,
        locationX: 54,
        locationY: 54, // Задано 54 замість 50, щоб вектор мав діагональне зміщення
        teamId: "team-1",
      },
    ];

    const { container } = render(
      <MatchSpatialMap
        events={shortVectorEvents}
        allEvents={shortVectorEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
        showGoalLeadVectors={true}
      />,
    );

    const line = container.querySelector("line[marker-end]");
    expect(line).toBeInTheDocument();

    const x1 = Number(line?.getAttribute("x1"));
    const x2 = Number(line?.getAttribute("x2"));
    const y1 = Number(line?.getAttribute("y1"));
    const y2 = Number(line?.getAttribute("y2"));

    // Перевіряємо, що кінцеві точки не перехрещуються і вектор зберігає напрямок
    expect(x1).toBeLessThan(x2);
    expect(y1).toBeGreaterThan(y2);
  });

  it("updates tooltip content when cycling through stacked markers while mouse hover remains active", () => {
    const stackedEvents: GameEventResponse[] = Array.from(
      { length: 20 },
      (_, idx) => ({
        id: `stack-${idx + 1}`,
        matchLineupId: "lineup-1",
        eventDefinitionId: idx === 0 ? "def-1" : "def-2",
        eventName: idx === 0 ? "Goal" : "Foul",
        isPositive: idx === 0,
        periodNumber: 1,
        locationX: 100,
        locationY: 0,
        playerName:
          idx === 0
            ? "Player One"
            : idx === 1
              ? "Player Two"
              : `Player ${idx + 1}`,
        playerNumber: idx + 1,
      }),
    );

    render(
      <MatchSpatialMap
        events={stackedEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
      />,
    );

    const markerGroup1 = screen.getByText("1").parentElement!;
    const markerGroup2 = screen.getByText("2").parentElement!;

    fireEvent.mouseEnter(markerGroup1);

    // Initial hover displays Player One
    expect(screen.getByText("Player One")).toBeInTheDocument();
    expect(screen.getByText("Goal")).toBeInTheDocument();

    // Click marker 1 to explicitly select Player One in stack
    fireEvent.click(markerGroup1);
    expect(screen.getByText("Player One")).toBeInTheDocument();
    expect(screen.getByText("Goal")).toBeInTheDocument();

    // Click spiderfied marker 2 to select Player Two in stack
    fireEvent.click(markerGroup2);
    expect(screen.getByText("Player Two")).toBeInTheDocument();
    expect(screen.getByText("Foul")).toBeInTheDocument();
  });

  it("scales goal-preview circle strokeWidth proportionally with shotMap viewBox dimensions", () => {
    const customShotMap =
      '<svg viewBox="0 0 100 50" width="100" height="50"><rect width="100" height="50" fill="green"/></svg>';

    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
        shotMap={customShotMap}
      />,
    );

    const shotMarker = screen.getByText("9");
    fireEvent.mouseEnter(shotMarker);

    const shotButton = screen.getByRole("button", { name: "Shot" });
    fireEvent.click(shotButton);

    const tooltip = screen.getByRole("tooltip");
    const previewCircle = tooltip.querySelector("svg circle");

    expect(previewCircle).toBeInTheDocument();
    expect(previewCircle).toHaveAttribute("r", "2");
    expect(previewCircle).toHaveAttribute("stroke-width", "0.5");
    expect(previewCircle).toHaveClass(
      "fill-amber-400",
      "stroke-slate-950",
      "shadow-md",
    );
    expect(previewCircle).not.toHaveClass("stroke-2");
  });

  it("provides a direct Tab focus path from active marker to tooltip and keeps tooltip open during keyboard navigation", () => {
    vi.useFakeTimers();
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
        shotMap={defaultShotMap}
      />,
    );

    const firstMarker = screen.getByRole("button", {
      name: "John Doe #9 GL",
    });

    firstMarker.focus();
    fireEvent.keyDown(firstMarker, { key: "Enter" });
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    // Even if keyboard navigation takes longer than 3.5s before tabbing into tooltip, it stays open
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    // Pressing Tab on the active marker moves focus directly to the tooltip's Info button
    const tabEvent = fireEvent.keyDown(firstMarker, { key: "Tab" });
    expect(tabEvent).toBe(false);

    const infoButton = screen.getByRole("button", { name: "Info" });
    expect(document.activeElement).toBe(infoButton);

    // Moving focus to Shot button keeps tooltip open
    const shotButton = screen.getByRole("button", { name: "Shot" });
    shotButton.focus();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    // Moving focus outside the map/tooltip restarts the 3.5s auto-dismiss timer
    shotButton.blur();
    act(() => {
      vi.advanceTimersByTime(3499);
    });
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
  });

  it("keeps auto-dismiss timer paused when focus returns from tooltip Info button back to a marker via Shift+Tab", () => {
    vi.useFakeTimers();
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
        shotMap={defaultShotMap}
      />,
    );

    const firstMarker = screen.getByRole("button", {
      name: "John Doe #9 GL",
    });

    firstMarker.focus();
    fireEvent.keyDown(firstMarker, { key: "Enter" });
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    // Tab into tooltip's Info button
    fireEvent.keyDown(firstMarker, { key: "Tab" });
    const infoButton = screen.getByRole("button", { name: "Info" });
    expect(document.activeElement).toBe(infoButton);

    // Shift+Tab from Info moves focus back to the active marker inside the map
    const shiftTabEvent = fireEvent.keyDown(infoButton, {
      key: "Tab",
      shiftKey: true,
    });
    expect(shiftTabEvent).toBe(false);
    expect(document.activeElement).toBe(firstMarker);

    // Timer stays paused for > 3.5s while focus remains inside the map
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    // Moving focus completely outside the map restarts the 3.5s timer
    firstMarker.blur();
    act(() => {
      vi.advanceTimersByTime(3499);
    });
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
  });

  it("clears active selection when pressing Escape inside the spatial map", () => {
    render(
      <MatchSpatialMap
        events={mockEvents}
        eventDefinitionsMap={mockEventDefinitionsMap}
        playground={defaultPlayground}
      />,
    );

    const markerGroup = screen.getByRole("button", {
      name: "John Doe #9 GL",
    });
    markerGroup.focus();
    fireEvent.keyDown(markerGroup, { key: "Enter" });
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    fireEvent.keyDown(markerGroup, { key: "Escape" });
    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
  });
});
