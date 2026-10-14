import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
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
      eventDefinitionId: "def-2",
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

  it("calculates renderablePoints correctly from percentage coordinates", () => {
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
    expect(firstPoint.cx).toBe(800); // 80% of 1000
    expect(firstPoint.cy).toBe(300); // 50% of 600
    expect(firstPoint.shortCode).toBe("AST");
    expect(firstPoint.isSelected).toBe(false);
    expect(firstPoint.isHovered).toBe(false);

    const secondPoint = result.current.renderablePoints[1];
    expect(secondPoint.cx).toBe(900); // 90% of 1000
    expect(secondPoint.cy).toBe(240); // 40% of 600
    expect(secondPoint.shortCode).toBe("GOA"); // fallback to eventName first 3 uppercase letters
  });

  it("calculates goalLeadVectors connecting Assist directly to nearest subsequent Goal in the same period", () => {
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
    expect(vector.x1).toBe(800); // Assist X (80%)
    expect(vector.y1).toBe(300); // Assist Y (50%)
    expect(vector.x2).toBe(900); // Goal X (90%)
    expect(vector.y2).toBe(240); // Goal Y (40%)
    expect(vector.isPositive).toBe(true);
  });

  it("targets goal coordinates from allEvents even when goal is filtered out from active events", () => {
    const filteredEvents = [mockEvents[0]]; // Only Assist event
    const allEvents = mockEvents; // Full list with Assist and Goal

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

    // Goal event coordinates from allEvents (90%, 40%) -> (900, 240)
    expect(vector.x2).toBe(900);
    expect(vector.y2).toBe(240);
  });

  it("falls back vector target to opponent goal center when no goal matches in the same period", () => {
    const unmatchedEvents: GameEventResponse[] = [
      {
        id: "assist-q2",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        eventName: "Assist",
        isPositive: true,
        periodNumber: 2,
        eventTimestamp: "2026-10-14T10:20:00Z",
        locationX: 70,
        locationY: 50,
        teamId: "team-1",
      },
      {
        id: "goal-q1",
        matchLineupId: "lineup-2",
        eventDefinitionId: "def-2",
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

  it("falls back vector target to opponent goal center when teamId, period, or timestamp metadata is missing", () => {
    const missingMetadataEvents: GameEventResponse[] = [
      {
        id: "assist-incomplete",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        eventName: "Assist",
        isPositive: true,
        periodNumber: 1,
        eventTimestamp: "2026-10-14T10:00:00Z",
        locationX: 80,
        locationY: 50,
        teamId: undefined, // Missing teamId
      },
      {
        id: "goal-complete",
        matchLineupId: "lineup-2",
        eventDefinitionId: "def-2",
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
        events: missingMetadataEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
        viewBoxWidth: 1000,
        viewBoxHeight: 600,
      }),
    );

    expect(result.current.goalLeadVectors).toHaveLength(1);
    const vector = result.current.goalLeadVectors[0];

    // Assist missing teamId cannot verify match, should fall back to goal center (x2=985, y2=300)
    expect(vector.x2).toBe(985);
    expect(vector.y2).toBe(300);
  });

  it("handles marker hover and click interactions correctly", () => {
    const { result } = renderHook(() =>
      useSpatialMap({
        events: mockEvents,
        eventDefinitionsMap: mockEventDefinitionsMap,
      }),
    );

    expect(result.current.activeEvent).toBeNull();

    // Hover over event-1
    act(() => {
      result.current.handleMarkerMouseEnter("event-1");
    });

    expect(result.current.hoveredEventId).toBe("event-1");
    expect(result.current.activeEvent?.id).toBe("event-1");
    expect(result.current.renderablePoints[0].isHovered).toBe(true);

    // Mouse leave event-1
    act(() => {
      result.current.handleMarkerMouseLeave();
    });

    expect(result.current.hoveredEventId).toBeNull();
    expect(result.current.activeEvent).toBeNull();

    // Select event-1 via click
    act(() => {
      result.current.handleMarkerClick("event-1");
    });

    expect(result.current.selectedEventId).toBe("event-1");
    expect(result.current.activeEvent?.id).toBe("event-1");
    expect(result.current.renderablePoints[0].isSelected).toBe(true);

    // Toggle off event-1
    act(() => {
      result.current.handleMarkerClick("event-1");
    });

    expect(result.current.activeEvent).toBeNull();
    expect(result.current.renderablePoints[0].isSelected).toBe(false);

    // Select event-2 and clear
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
