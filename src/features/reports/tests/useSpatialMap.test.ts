import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useSpatialMap } from "../hooks/useSpatialMap";
import type { GameEventResponse } from "../../../services/reportService";
import type { EventDefinitionLookup } from "../../../db/ttaDatabase";

describe("useSpatialMap Custom Hook", () => {
  const mockEventDefinitionsMap = new Map<string, EventDefinitionLookup>([
    [
      "def-1",
      {
        id: "def-1",
        sportId: "sport-1",
        name: "Assist",
        shortName: "AST",
        isPositive: true,
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

  it("calculates renderablePoints correctly from percentage coordinates and identifies isGoal strictly by eventDefinitionId", () => {
    const { result } = renderHook(() =>
      useSpatialMap({
        events: mockEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 1000,
        viewBoxHeight: 600,
      }),
    );

    expect(result.current.renderablePoints).toHaveLength(2);

    const firstPoint = result.current.renderablePoints[0];
    expect(firstPoint.cx).toBe(800);
    expect(firstPoint.cy).toBe(300);
    expect(firstPoint.shortCode).toBe("AST");
    expect(firstPoint.isSelected).toBe(false);
    expect(firstPoint.isHovered).toBe(false);
    expect(firstPoint.isGoal).toBe(false);

    const secondPoint = result.current.renderablePoints[1];
    expect(secondPoint.cx).toBe(900);
    expect(secondPoint.cy).toBe(240);
    expect(secondPoint.shortCode).toBe("GOA");
    expect(secondPoint.isGoal).toBe(true);
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

    vi.useRealTimers();
  });

  it("calculates goalLeadVectors connecting lead events directly to nearest subsequent Goal in the same period matching positivity", () => {
    const { result } = renderHook(() =>
      useSpatialMap({
        events: mockEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 1000,
        viewBoxHeight: 600,
      }),
    );

    expect(result.current.goalLeadVectors).toHaveLength(1);
    const vector = result.current.goalLeadVectors[0];

    expect(vector.id).toBe("vector-event-1");
    expect(vector.x1).toBe(800);
    expect(vector.y1).toBe(300);
    expect(vector.x2).toBe(900);
    expect(vector.y2).toBe(240);
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
        viewBoxWidth: 1000,
        viewBoxHeight: 600,
      }),
    );

    expect(result.current.goalLeadVectors).toHaveLength(1);
    const vector = result.current.goalLeadVectors[0];

    expect(vector.x2).toBe(100);
    expect(vector.y2).toBe(300);
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
        viewBoxWidth: 1000,
        viewBoxHeight: 600,
      }),
    );

    expect(result.current.goalLeadVectors).toHaveLength(1);
    const vector = result.current.goalLeadVectors[0];

    expect(vector.x2).toBe(900);
    expect(vector.y2).toBe(240);
  });

  it("falls back vector target to opponent goal center (right) for positive actions when no goal matches", () => {
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
      {
        id: "goal-q1",
        matchLineupId: "lineup-2",
        eventDefinitionId: "def-goal",
        eventName: "Goal",
        isPositive: true,
        periodNumber: 1,
        eventTimestamp: "2026-10-14T10:05:00Z",
        locationX: 90,
        locationY: 40,
        teamId: "team-1",
      },
    ];

    const { result } = renderHook(() =>
      useSpatialMap({
        events: unmatchedEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 1000,
        viewBoxHeight: 600,
      }),
    );

    expect(result.current.goalLeadVectors).toHaveLength(1);
    const vector = result.current.goalLeadVectors[0];

    expect(vector.x2).toBe(985);
    expect(vector.y2).toBe(300);
  });

  it("falls back vector target to OUR goal center (left) for negative actions when no goal matches", () => {
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
        viewBoxWidth: 1000,
        viewBoxHeight: 600,
      }),
    );

    expect(result.current.goalLeadVectors).toHaveLength(1);
    const vector = result.current.goalLeadVectors[0];

    expect(vector.x2).toBe(15);
    expect(vector.y2).toBe(300);
    expect(vector.isPositive).toBe(false);
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
    expect(result.current.renderablePoints[0].isHovered).toBe(true);

    act(() => {
      result.current.handleMarkerMouseLeave();
    });

    expect(result.current.hoveredEventId).toBeNull();
    expect(result.current.activeEvent).toBeNull();

    act(() => {
      result.current.handleMarkerClick("event-1");
    });

    expect(result.current.selectedEventId).toBe("event-1");
    expect(result.current.activeEvent?.id).toBe("event-1");
    expect(result.current.renderablePoints[0].isSelected).toBe(true);

    act(() => {
      result.current.handleMarkerClick("event-1");
    });

    expect(result.current.activeEvent).toBeNull();
    expect(result.current.renderablePoints[0].isSelected).toBe(false);

    act(() => {
      result.current.handleMarkerClick("event-2");
    });
    expect(result.current.activeEvent?.id).toBe("event-2");

    act(() => {
      result.current.handleClearActiveEvent();
    });
    expect(result.current.activeEvent).toBeNull();
  });
});
