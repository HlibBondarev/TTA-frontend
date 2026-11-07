import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useShotMap } from "../hooks/useShotMap";
import type { GameEventResponse } from "../../../services/reportService";
import type { EventDefinitionLookup } from "../../../db/ttaDatabase";

describe("useShotMap hook", () => {
  const goalDefId = "def-goal-id";
  const sogDefId = "def-sog-id";
  const missDefId = "def-miss-id";
  const nonShotDefId = "def-pass-id";
  const defaultShotMap = '<svg viewBox="0 0 615 248"></svg>';

  const mockDefinitionsMap = new Map<string, EventDefinitionLookup>([
    [
      goalDefId,
      {
        id: goalDefId,
        sportId: "wp-sport",
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
        sportId: "wp-sport",
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
        sportId: "wp-sport",
        name: "Missed Shot",
        shortName: "MS",
        isPositive: false,
        isShot: true,
      },
    ],
    [
      nonShotDefId,
      {
        id: nonShotDefId,
        sportId: "wp-sport",
        name: "Key Pass",
        shortName: "KP",
        isPositive: true,
        isShot: false,
      },
    ],
  ]);

  const sampleEvents: GameEventResponse[] = [
    {
      id: "event-1",
      eventDefinitionId: goalDefId,
      isPositive: true,
      shotLocationX: 50,
      shotLocationY: 80,
      playerNumber: 7,
      playerName: "Player 7",
    },
    {
      id: "event-2",
      eventDefinitionId: sogDefId,
      isPositive: true,
      shotLocationX: 20,
      shotLocationY: 60,
      playerNumber: 9,
      playerName: "Player 9",
    },
    {
      id: "event-3",
      eventDefinitionId: goalDefId,
      isPositive: false,
      shotLocationX: 10,
      shotLocationY: 50,
      playerNumber: 1,
      playerName: "Goalkeeper",
    },
    {
      id: "event-4",
      eventDefinitionId: missDefId,
      isPositive: false,
      shotLocationX: 80,
      shotLocationY: 20,
      playerNumber: 3,
      playerName: "Player 3",
    },
    {
      id: "event-non-shot",
      eventDefinitionId: nonShotDefId,
      isPositive: true,
      shotLocationX: 40,
      shotLocationY: 40,
    },
    {
      id: "event-no-coords",
      eventDefinitionId: goalDefId,
      isPositive: true,
      shotLocationX: null,
      shotLocationY: null,
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters out events without valid shot coordinates or where isShot is false", () => {
    const { result } = renderHook(() =>
      useShotMap({
        events: sampleEvents,
        eventDefinitionsMap: mockDefinitionsMap,
        shotMap: defaultShotMap,
      }),
    );

    expect(result.current.renderablePoints).toHaveLength(4);
    const pointIds = result.current.renderablePoints.map((p) => p.event.id);
    expect(pointIds).toEqual(["event-1", "event-2", "event-3", "event-4"]);
  });

  it("correctly computes SVG canvas coordinates (cx, cy)", () => {
    const { result } = renderHook(() =>
      useShotMap({
        events: [sampleEvents[0]], // shotLocationX: 50, shotLocationY: 80
        eventDefinitionsMap: mockDefinitionsMap,
        shotMap: '<svg viewBox="0 0 615 248"></svg>',
      }),
    );

    const point = result.current.renderablePoints[0];
    expect(point.cx).toBe(307.5); // (50 / 100) * 615
    expect(point.cy).toBe(49.6); // ((100 - 80) / 100) * 248
  });

  it("visually separates markers with identical shot target coordinates", () => {
    const overlappingEvents: GameEventResponse[] = [
      {
        id: "overlap-1",
        eventDefinitionId: goalDefId,
        isPositive: true,
        shotLocationX: 50,
        shotLocationY: 50,
        playerNumber: 7,
      },
      {
        id: "overlap-2",
        eventDefinitionId: sogDefId,
        isPositive: true,
        shotLocationX: 50,
        shotLocationY: 50,
        playerNumber: 9,
      },
    ];

    const { result } = renderHook(() =>
      useShotMap({
        events: overlappingEvents,
        eventDefinitionsMap: mockDefinitionsMap,
        shotMap: defaultShotMap,
      }),
    );

    expect(result.current.renderablePoints).toHaveLength(2);
    const [p1, p2] = result.current.renderablePoints;

    expect(p1.cx).not.toBe(p2.cx);
    expect(p1.event.shotLocationX).toBe(50);
    expect(p2.event.shotLocationX).toBe(50);
  });

  it("keeps overlapping markers within viewBox bounds and verifies pointer selection on small viewBox maps", () => {
    const smallMapEvents: GameEventResponse[] = [
      {
        id: "edge-1",
        eventDefinitionId: goalDefId,
        isPositive: true,
        shotLocationX: 100,
        shotLocationY: 50,
        playerNumber: 7,
      },
      {
        id: "edge-2",
        eventDefinitionId: sogDefId,
        isPositive: true,
        shotLocationX: 100,
        shotLocationY: 50,
        playerNumber: 9,
      },
    ];

    const { result } = renderHook(() =>
      useShotMap({
        events: smallMapEvents,
        eventDefinitionsMap: mockDefinitionsMap,
        shotMap: '<svg viewBox="0 0 10 10"></svg>',
      }),
    );

    expect(result.current.renderablePoints).toHaveLength(2);
    const [p1, p2] = result.current.renderablePoints;

    // Verify coordinates stay within viewBox 0..10 bounds and remain distinct
    expect(p1.cx).toBeLessThanOrEqual(10);
    expect(p1.cx).toBeGreaterThanOrEqual(0);
    expect(p2.cx).toBeLessThanOrEqual(10);
    expect(p2.cx).toBeGreaterThanOrEqual(0);
    expect(p1.cx).not.toBe(p2.cx);

    // Verify pointer selection for both edge markers
    act(() => {
      result.current.handleMarkerClick("edge-1");
    });
    expect(result.current.selectedEventId).toBe("edge-1");
    expect(result.current.activeEvent?.id).toBe("edge-1");

    act(() => {
      result.current.handleMarkerClick("edge-2");
    });
    expect(result.current.selectedEventId).toBe("edge-2");
    expect(result.current.activeEvent?.id).toBe("edge-2");
  });

  it("classifies shot events into 4 distinct colors/categories", () => {
    const { result } = renderHook(() =>
      useShotMap({
        events: sampleEvents,
        eventDefinitionsMap: mockDefinitionsMap,
        shotMap: defaultShotMap,
      }),
    );

    const points = result.current.renderablePoints;
    expect(points.find((p) => p.event.id === "event-1")?.shotCategory).toBe(
      "goal",
    );
    expect(points.find((p) => p.event.id === "event-2")?.shotCategory).toBe(
      "shot_on_goal",
    );
    expect(points.find((p) => p.event.id === "event-3")?.shotCategory).toBe(
      "conceded_goal",
    );
    expect(points.find((p) => p.event.id === "event-4")?.shotCategory).toBe(
      "miss",
    );
  });

  it("handles marker selection and auto-dismiss after 3500ms", () => {
    const { result } = renderHook(() =>
      useShotMap({
        events: sampleEvents,
        eventDefinitionsMap: mockDefinitionsMap,
        shotMap: defaultShotMap,
      }),
    );

    expect(result.current.selectedEventId).toBeNull();
    expect(result.current.activeEvent).toBeNull();

    act(() => {
      result.current.handleMarkerClick("event-1");
    });

    expect(result.current.selectedEventId).toBe("event-1");
    expect(result.current.activeEvent?.id).toBe("event-1");

    act(() => {
      vi.advanceTimersByTime(3500);
    });

    expect(result.current.selectedEventId).toBeNull();
    expect(result.current.activeEvent).toBeNull();
  });

  it("gives hovered event precedence over selected event for activeEvent", () => {
    const { result } = renderHook(() =>
      useShotMap({
        events: sampleEvents,
        eventDefinitionsMap: mockDefinitionsMap,
        shotMap: defaultShotMap,
      }),
    );

    act(() => {
      result.current.handleMarkerClick("event-1");
    });
    expect(result.current.activeEvent?.id).toBe("event-1");

    act(() => {
      result.current.handleMarkerMouseEnter("event-2");
    });
    expect(result.current.activeEvent?.id).toBe("event-2");

    act(() => {
      result.current.handleMarkerMouseLeave();
    });
    expect(result.current.activeEvent?.id).toBe("event-1");
  });

  it("clears active selection manually via handleClearActiveEvent", () => {
    const { result } = renderHook(() =>
      useShotMap({
        events: sampleEvents,
        eventDefinitionsMap: mockDefinitionsMap,
        shotMap: defaultShotMap,
      }),
    );

    act(() => {
      result.current.handleMarkerClick("event-1");
      result.current.handleMarkerMouseEnter("event-2");
    });

    act(() => {
      result.current.handleClearActiveEvent();
    });

    expect(result.current.selectedEventId).toBeNull();
    expect(result.current.hoveredEventId).toBeNull();
    expect(result.current.activeEvent).toBeNull();
  });
});
