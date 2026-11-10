import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useSpatialMap } from "../hooks/useSpatialMap";
import type { GameEventResponse } from "../../../services/reportService";
import type { EventDefinitionLookup } from "../../../db/ttaDatabase";

describe("useSpatialMap Custom Hook", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const mockEventDefinitionsMap = new Map<string, EventDefinitionLookup>([
    [
      "def-1",
      {
        id: "def-1",
        sportId: "sport-1",
        name: "Assist",
        shortName: "AST",
        isPositive: true,
        isShot: false,
      },
    ],
    [
      "def-goal",
      {
        id: "def-goal",
        sportId: "sport-1",
        name: "Goal",
        shortName: "GOA",
        isPositive: true,
        isShot: false,
      },
    ],
    [
      "def-goal-conceded",
      {
        id: "def-goal-conceded",
        sportId: "sport-1",
        name: "Goal",
        shortName: "GOA",
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
      eventName: "Assist",
      isPositive: true,
      periodNumber: 1,
      eventTimestamp: "2026-10-14T10:00:00Z",
      normalizedMatchTime: "02:15",
      isLeadToGoal: true,
      locationX: 80,
      locationY: 50,
      playerName: "John Doe",
      playerNumber: 7,
      teamId: "team-1",
    },
    {
      id: "event-2",
      matchLineupId: "lineup-2",
      eventDefinitionId: "def-goal",
      eventName: "Goal",
      isPositive: true,
      periodNumber: 1,
      eventTimestamp: "2026-10-14T10:05:00Z",
      normalizedMatchTime: "02:16",
      isLeadToGoal: false,
      locationX: 90,
      locationY: 40,
      playerName: "Jane Smith",
      playerNumber: 3,
      teamId: "team-1",
    },
    {
      id: "event-no-location",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      eventName: "Shot",
      isPositive: true,
      periodNumber: 1,
      eventTimestamp: "2026-10-14T10:10:00Z",
      locationX: null,
      locationY: null,
    },
  ];

  it("calculates renderablePoints correctly from percentage coordinates (locationY -> cx, 100-locationX -> cy) and identifies isGoal", () => {
    const { result } = renderHook(() =>
      useSpatialMap({
        events: mockEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 600,
        viewBoxHeight: 1000,
      }),
    );

    expect(result.current.renderablePoints).toHaveLength(2);

    const firstPoint = result.current.renderablePoints[0];
    expect(firstPoint.cx).toBe(300);
    expect(firstPoint.cy).toBe(200);
    expect(firstPoint.shortCode).toBe("AST");
    expect(firstPoint.isSelected).toBe(false);
    expect(firstPoint.isHovered).toBe(false);
    expect(firstPoint.isGoal).toBe(false);

    const secondPoint = result.current.renderablePoints[1];
    expect(secondPoint.cx).toBe(240);
    expect(secondPoint.cy).toBe(100);
    expect(secondPoint.shortCode).toBe("GOA");
    expect(secondPoint.isGoal).toBe(true);
  });

  it("applies radial spiderfy displacement when markers overlap closely", () => {
    const overlappingEvents: GameEventResponse[] = [
      {
        id: "overlap-1",
        matchLineupId: "l-1",
        eventDefinitionId: "def-1",
        locationX: 50,
        locationY: 50,
      },
      {
        id: "overlap-2",
        matchLineupId: "l-2",
        eventDefinitionId: "def-1",
        locationX: 50,
        locationY: 50,
      },
    ];

    const { result } = renderHook(() =>
      useSpatialMap({
        events: overlappingEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 600,
        viewBoxHeight: 1000,
      }),
    );

    const points = result.current.renderablePoints;
    expect(points).toHaveLength(2);
    expect(
      Math.hypot(points[0].cx - points[1].cx, points[0].cy - points[1].cy),
    ).toBeGreaterThan(0);
  });

  it("keeps spiderfied overlapping markers near field-map boundaries strictly within viewBox bounds", () => {
    const edgeOverlappingEvents: GameEventResponse[] = [
      {
        id: "edge-overlap-1",
        matchLineupId: "l-1",
        eventDefinitionId: "def-1",
        locationX: 100,
        locationY: 0,
      },
      {
        id: "edge-overlap-2",
        matchLineupId: "l-2",
        eventDefinitionId: "def-1",
        locationX: 100,
        locationY: 0,
      },
    ];

    const { result } = renderHook(() =>
      useSpatialMap({
        events: edgeOverlappingEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 600,
        viewBoxHeight: 1000,
      }),
    );

    const points = result.current.renderablePoints;
    expect(points).toHaveLength(2);

    expect(
      Math.hypot(points[0].cx - points[1].cx, points[0].cy - points[1].cy),
    ).toBeGreaterThan(0);
    points.forEach((point) => {
      expect(point.cx).toBeGreaterThanOrEqual(27);
      expect(point.cx).toBeLessThanOrEqual(573);
      expect(point.cy).toBeGreaterThanOrEqual(27);
      expect(point.cy).toBeLessThanOrEqual(973);
    });
  });

  it("auto-dismisses selected event after 3.5 seconds", () => {
    vi.useFakeTimers();

    const { result } = renderHook(() =>
      useSpatialMap({
        events: mockEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
      }),
    );

    act(() => {
      result.current.handleMarkerClick("event-1");
    });

    expect(result.current.selectedEventId).toBe("event-1");

    act(() => {
      vi.advanceTimersByTime(3500);
    });

    expect(result.current.selectedEventId).toBeNull();
  });

  it("calculates goalLeadVectors connecting lead events directly to nearest subsequent Goal in the same period", () => {
    const { result } = renderHook(() =>
      useSpatialMap({
        events: mockEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 600,
        viewBoxHeight: 1000,
      }),
    );

    expect(result.current.goalLeadVectors).toHaveLength(1);
    const vector = result.current.goalLeadVectors[0];

    expect(vector.id).toBe("vector-event-1");
    expect(vector.x1).toBe(300);
    expect(vector.y1).toBe(200);
    expect(vector.x2).toBe(240);
    expect(vector.y2).toBe(100);
    expect(vector.isPositive).toBe(true);
  });

  it("matches negative lead events specifically to negative goal events and not positive goals", () => {
    const mixedEvents: GameEventResponse[] = [
      {
        id: "foul-1",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        eventName: "Exclusion",
        isPositive: false,
        periodNumber: 1,
        eventTimestamp: "2026-10-14T10:00:00Z",
        isLeadToGoal: true,
        locationX: 30,
        locationY: 40,
        teamId: "team-1",
      },
      {
        id: "goal-positive",
        matchLineupId: "lineup-2",
        eventDefinitionId: "def-goal",
        eventName: "Goal Scored",
        isPositive: true,
        periodNumber: 1,
        eventTimestamp: "2026-10-14T10:02:00Z",
        locationX: 90,
        locationY: 50,
        teamId: "team-1",
      },
      {
        id: "goal-negative",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-goal-conceded",
        eventName: "Goal Conceded",
        isPositive: false,
        periodNumber: 1,
        eventTimestamp: "2026-10-14T10:03:00Z",
        locationX: 10,
        locationY: 50,
        teamId: "team-1",
      },
    ];

    const { result } = renderHook(() =>
      useSpatialMap({
        events: mixedEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 600,
        viewBoxHeight: 1000,
      }),
    );

    expect(result.current.goalLeadVectors).toHaveLength(1);
    const vector = result.current.goalLeadVectors[0];

    expect(vector.x2).toBe(300);
    expect(vector.y2).toBe(900);
    expect(vector.isPositive).toBe(false);
  });

  it("targets goal coordinates from allEvents even when goal is filtered out from active events", () => {
    const filteredEvents = [mockEvents[0]];
    const allEvents = mockEvents;

    const { result } = renderHook(() =>
      useSpatialMap({
        events: filteredEvents,
        allEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 600,
        viewBoxHeight: 1000,
      }),
    );

    expect(result.current.goalLeadVectors).toHaveLength(1);
    const vector = result.current.goalLeadVectors[0];

    expect(vector.x2).toBe(240);
    expect(vector.y2).toBe(100);
  });

  it("falls back vector target to top goal line (0.015 * viewBoxHeight) for positive actions when no goal matches", () => {
    const unmatchedEvents: GameEventResponse[] = [
      {
        id: "assist-q2",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        eventName: "Assist",
        isPositive: true,
        isLeadToGoal: true,
        periodNumber: 2,
        eventTimestamp: "2026-10-14T10:20:00Z",
        locationX: 70,
        locationY: 50,
        teamId: "team-1",
      },
    ];

    const { result } = renderHook(() =>
      useSpatialMap({
        events: unmatchedEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 600,
        viewBoxHeight: 1000,
      }),
    );

    expect(result.current.goalLeadVectors).toHaveLength(1);
    const vector = result.current.goalLeadVectors[0];

    expect(vector.x2).toBe(300);
    expect(vector.y2).toBe(15);
  });

  it("falls back vector target to bottom goal line (viewBoxHeight - 0.015 * viewBoxHeight) for negative actions when no goal matches", () => {
    const unmatchedNegativeEvents: GameEventResponse[] = [
      {
        id: "foul-q1",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        eventName: "Exclusion",
        isPositive: false,
        isLeadToGoal: true,
        periodNumber: 1,
        eventTimestamp: "2026-10-14T10:00:00Z",
        locationX: 40,
        locationY: 50,
        teamId: "team-1",
      },
    ];

    const { result } = renderHook(() =>
      useSpatialMap({
        events: unmatchedNegativeEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 600,
        viewBoxHeight: 1000,
      }),
    );

    expect(result.current.goalLeadVectors).toHaveLength(1);
    const vector = result.current.goalLeadVectors[0];

    expect(vector.x2).toBe(300);
    expect(vector.y2).toBe(985);
    expect(vector.isPositive).toBe(false);
  });

  it("scales collision threshold, spiderfy displacement, and unmatched vector fallback coordinates dynamically for custom viewBox dimensions", () => {
    const unmatchedCustomEvents: GameEventResponse[] = [
      {
        id: "unmatched-pos",
        matchLineupId: "l-1",
        eventDefinitionId: "def-1",
        eventName: "Assist",
        isPositive: true,
        isLeadToGoal: true,
        periodNumber: 1,
        locationX: 80,
        locationY: 50,
      },
      {
        id: "unmatched-neg",
        matchLineupId: "l-2",
        eventDefinitionId: "def-1",
        eventName: "Foul",
        isPositive: false,
        isLeadToGoal: true,
        periodNumber: 1,
        locationX: 20,
        locationY: 50,
      },
    ];

    const { result } = renderHook(() =>
      useSpatialMap({
        events: unmatchedCustomEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 300,
        viewBoxHeight: 500,
      }),
    );

    expect(result.current.goalLeadVectors).toHaveLength(2);
    const [posVector, negVector] = result.current.goalLeadVectors;

    expect(posVector.x2).toBe(150);
    expect(posVector.y2).toBe(7.5);

    expect(negVector.x2).toBe(150);
    expect(negVector.y2).toBe(492.5);
  });

  it("handles marker hover and click interactions correctly", () => {
    const { result } = renderHook(() =>
      useSpatialMap({
        events: mockEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
      }),
    );

    expect(result.current.activeEvent).toBeNull();

    act(() => {
      result.current.handleMarkerMouseEnter("event-1");
    });

    expect(result.current.hoveredEventId).toBe("event-1");
    expect(result.current.activeEvent?.id).toBe("event-1");

    act(() => {
      result.current.handleMarkerMouseLeave();
    });

    expect(result.current.hoveredEventId).toBeNull();

    act(() => {
      result.current.handleMarkerClick("event-1");
    });

    expect(result.current.selectedEventId).toBe("event-1");
    expect(result.current.activeEvent?.id).toBe("event-1");

    act(() => {
      result.current.handleClearActiveEvent();
    });

    expect(result.current.activeEvent).toBeNull();
  });

  it("uses displaced coordinates for lead and goal vector endpoints when markers are clustered", () => {
    const clusteredEvents: GameEventResponse[] = [
      {
        id: "lead-cluster-1",
        matchLineupId: "l-1",
        eventDefinitionId: "def-1",
        isPositive: true,
        periodNumber: 1,
        eventTimestamp: "2026-10-14T10:00:00Z",
        isLeadToGoal: true,
        locationX: 50,
        locationY: 50,
        teamId: "team-1",
      },
      {
        id: "goal-cluster-1",
        matchLineupId: "l-2",
        eventDefinitionId: "def-goal",
        isPositive: true,
        periodNumber: 1,
        eventTimestamp: "2026-10-14T10:01:00Z",
        isLeadToGoal: false,
        locationX: 50,
        locationY: 50,
        teamId: "team-1",
      },
    ];

    const { result } = renderHook(() =>
      useSpatialMap({
        events: clusteredEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 600,
        viewBoxHeight: 1000,
      }),
    );

    const points = result.current.renderablePoints;
    expect(points).toHaveLength(2);

    const leadPoint = points.find((p) => p.event.id === "lead-cluster-1")!;
    const goalPoint = points.find((p) => p.event.id === "goal-cluster-1")!;

    expect(result.current.goalLeadVectors).toHaveLength(1);
    const vector = result.current.goalLeadVectors[0];

    expect(vector.x1).toBe(leadPoint.cx);
    expect(vector.y1).toBe(leadPoint.cy);
    expect(vector.x2).toBe(goalPoint.cx);
    expect(vector.y2).toBe(goalPoint.cy);
  });

  it("sorts candidate goals with finite timestamps chronologically ahead of non-finite timestamps", () => {
    const invalidTimestampEvents: GameEventResponse[] = [
      {
        id: "lead-1",
        matchLineupId: "l-1",
        eventDefinitionId: "def-1",
        isPositive: true,
        periodNumber: 1,
        eventTimestamp: "2026-10-14T10:00:00Z",
        isLeadToGoal: true,
        locationX: 50,
        locationY: 50,
        teamId: "team-1",
      },
      {
        id: "goal-invalid-ts",
        matchLineupId: "l-2",
        eventDefinitionId: "def-goal",
        isPositive: true,
        periodNumber: 1,
        eventTimestamp: "invalid-date-string",
        locationX: 90,
        locationY: 50,
        teamId: "team-1",
      },
      {
        id: "goal-valid-ts",
        matchLineupId: "l-3",
        eventDefinitionId: "def-goal",
        isPositive: true,
        periodNumber: 1,
        eventTimestamp: "2026-10-14T10:05:00Z",
        locationX: 90,
        locationY: 60,
        teamId: "team-1",
      },
    ];

    const { result } = renderHook(() =>
      useSpatialMap({
        events: invalidTimestampEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 600,
        viewBoxHeight: 1000,
      }),
    );

    expect(result.current.goalLeadVectors).toHaveLength(1);
    const vector = result.current.goalLeadVectors[0];

    expect(vector.x2).toBe(360);
    expect(vector.y2).toBe(100);
  });
});
