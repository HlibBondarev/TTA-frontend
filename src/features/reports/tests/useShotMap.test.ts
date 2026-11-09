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

  it("visually separates markers with identical shot target coordinates proportionally on large viewBox maps", () => {
    const largeSvgMap = '<svg viewBox="0 0 6150 2480"></svg>';
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
        shotMap: largeSvgMap,
      }),
    );

    expect(result.current.renderablePoints).toHaveLength(2);
    const [p1, p2] = result.current.renderablePoints;

    const distance = Math.hypot(p1.cx - p2.cx, p1.cy - p2.cy);
    expect(distance).toBeGreaterThan(100);
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

    expect(p1.cx).toBeLessThanOrEqual(10);
    expect(p1.cx).toBeGreaterThanOrEqual(0);
    expect(p2.cx).toBeLessThanOrEqual(10);
    expect(p2.cx).toBeGreaterThanOrEqual(0);
    expect(p1.cx).not.toBe(p2.cx);

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

  it("renders shot event on Shot Map when eventDefinitionId is uncached but valid shot coordinates exist", () => {
    const uncachedEvents: GameEventResponse[] = [
      {
        id: "uncached-event-1",
        eventDefinitionId: "def-unknown-id",
        isPositive: true,
        shotLocationX: 45,
        shotLocationY: 55,
        playerNumber: 12,
        eventName: "Unknown Shot",
      },
    ];

    const { result } = renderHook(() =>
      useShotMap({
        events: uncachedEvents,
        eventDefinitionsMap: new Map(),
        shotMap: defaultShotMap,
      }),
    );

    expect(result.current.renderablePoints).toHaveLength(1);
    expect(result.current.renderablePoints[0].event.id).toBe(
      "uncached-event-1",
    );
    expect(result.current.renderablePoints[0].shortCode).toBe("UNK");
  });

  it("groups and disperses nearby shots with differing numeric representation into distinct pointer-selectable coordinates", () => {
    const nearbyEvents: GameEventResponse[] = [
      {
        id: "nearby-1",
        eventDefinitionId: goalDefId,
        isPositive: true,
        shotLocationX: 50,
        shotLocationY: 80,
        playerNumber: 7,
      },
      {
        id: "nearby-2",
        eventDefinitionId: sogDefId,
        isPositive: true,
        shotLocationX: 50.02,
        shotLocationY: 80.01,
        playerNumber: 10,
      },
    ];

    const { result } = renderHook(() =>
      useShotMap({
        events: nearbyEvents,
        eventDefinitionsMap: mockDefinitionsMap,
        shotMap: defaultShotMap,
      }),
    );

    expect(result.current.renderablePoints).toHaveLength(2);
    const [p1, p2] = result.current.renderablePoints;

    expect(p1.cx).not.toBe(p2.cx);

    act(() => {
      result.current.handleMarkerClick("nearby-1");
    });
    expect(result.current.activeEvent?.id).toBe("nearby-1");

    act(() => {
      result.current.handleMarkerClick("nearby-2");
    });
    expect(result.current.activeEvent?.id).toBe("nearby-2");
  });

  it("groups 5 adjacent shots into a single cluster and continuously wraps selection cycling when starting from the last marker", () => {
    const fiveShots: GameEventResponse[] = [
      {
        id: "shot-1",
        eventDefinitionId: goalDefId,
        isPositive: true,
        shotLocationX: 50,
        shotLocationY: 50,
        playerNumber: 1,
      },
      {
        id: "shot-2",
        eventDefinitionId: sogDefId,
        isPositive: true,
        shotLocationX: 49,
        shotLocationY: 50,
        playerNumber: 2,
      },
      {
        id: "shot-3",
        eventDefinitionId: sogDefId,
        isPositive: true,
        shotLocationX: 51,
        shotLocationY: 50,
        playerNumber: 3,
      },
      {
        id: "shot-4",
        eventDefinitionId: sogDefId,
        isPositive: true,
        shotLocationX: 50,
        shotLocationY: 51,
        playerNumber: 4,
      },
      {
        id: "shot-5",
        eventDefinitionId: missDefId,
        isPositive: false,
        shotLocationX: 50,
        shotLocationY: 49,
        playerNumber: 5,
      },
    ];

    const { result } = renderHook(() =>
      useShotMap({
        events: fiveShots,
        eventDefinitionsMap: mockDefinitionsMap,
        shotMap: defaultShotMap,
      }),
    );

    expect(result.current.renderablePoints).toHaveLength(5);

    const centerCoordinates = result.current.renderablePoints.map(
      (p) => `${p.cx}_${p.cy}`,
    );
    const uniqueCoordinates = new Set(centerCoordinates);
    expect(uniqueCoordinates.size).toBe(5);

    act(() => {
      result.current.handleMarkerClick("shot-5");
    });
    expect(result.current.selectedEventId).toBe("shot-5");

    act(() => {
      result.current.handleMarkerClick("shot-5");
    });
    expect(result.current.selectedEventId).toBe("shot-1");

    act(() => {
      result.current.handleMarkerClick("shot-5");
    });
    expect(result.current.selectedEventId).toBe("shot-2");

    act(() => {
      result.current.handleMarkerClick("shot-5");
    });
    expect(result.current.selectedEventId).toBe("shot-3");

    act(() => {
      result.current.handleMarkerClick("shot-5");
    });
    expect(result.current.selectedEventId).toBe("shot-4");

    act(() => {
      result.current.handleMarkerClick("shot-5");
    });
    expect(result.current.selectedEventId).toBe("shot-5");

    act(() => {
      result.current.handleMarkerClick("shot-5");
    });
    expect(result.current.selectedEventId).toBe("shot-1");
  });
});
