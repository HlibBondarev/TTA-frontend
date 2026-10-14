import { useState, useMemo, useCallback } from "react";
import type { GameEventResponse } from "../../../services/reportService";
import type { EventDefinitionLookup } from "../../../db/ttaDatabase";

export interface GoalLeadVector {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isPositive: boolean;
}

export interface RenderableSpatialPoint {
  event: GameEventResponse;
  cx: number;
  cy: number;
  shortCode: string;
  isSelected: boolean;
  isHovered: boolean;
}

export interface UseSpatialMapParams {
  events: GameEventResponse[];
  eventDefinitionsMap: Map<string, EventDefinitionLookup>;
  viewBoxWidth?: number;
  viewBoxHeight?: number;
}

export const useSpatialMap = ({
  events,
  eventDefinitionsMap,
  viewBoxWidth = 1000,
  viewBoxHeight = 600,
}: UseSpatialMapParams) => {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);

  const handleMarkerClick = useCallback((eventId: string) => {
    setSelectedEventId((prev) => (prev === eventId ? null : eventId));
  }, []);

  const handleMarkerMouseEnter = useCallback((eventId: string) => {
    setHoveredEventId(eventId);
  }, []);

  const handleMarkerMouseLeave = useCallback(() => {
    setHoveredEventId(null);
  }, []);

  const handleClearActiveEvent = useCallback(() => {
    setSelectedEventId(null);
    setHoveredEventId(null);
  }, []);

  // Currently active event for tooltip (hovered event takes precedence over selected)
  const activeEvent = useMemo(() => {
    const activeId = hoveredEventId ?? selectedEventId;
    return events.find((e) => e.id === activeId) ?? null;
  }, [events, hoveredEventId, selectedEventId]);

  // Convert percentages to SVG canvas coordinates
  const renderablePoints = useMemo<RenderableSpatialPoint[]>(() => {
    return events
      .filter((e) => e.locationX != null && e.locationY != null && e.id != null)
      .map((e) => {
        const cx = (Number(e.locationX) / 100) * viewBoxWidth;
        const cy = (Number(e.locationY) / 100) * viewBoxHeight;
        const def = e.eventDefinitionId
          ? eventDefinitionsMap.get(e.eventDefinitionId)
          : undefined;
        const shortCode =
          def?.shortName || e.eventName?.slice(0, 3).toUpperCase() || "TTA";

        return {
          event: e,
          cx,
          cy,
          shortCode,
          isSelected: selectedEventId === e.id,
          isHovered: hoveredEventId === e.id,
        };
      });
  }, [
    events,
    eventDefinitionsMap,
    selectedEventId,
    hoveredEventId,
    viewBoxWidth,
    viewBoxHeight,
  ]);

  // Calculate directional vectors connecting Assist events directly to Goal events
  const goalLeadVectors = useMemo<GoalLeadVector[]>(() => {
    const assistEvents = events.filter(
      (e) =>
        (Boolean(e.isLeadToGoal) ||
          e.eventName?.toLowerCase().includes("assist")) &&
        e.locationX != null &&
        e.locationY != null &&
        e.id != null,
    );

    const goalEvents = events.filter(
      (e) =>
        e.eventName?.toLowerCase().includes("goal") &&
        !e.eventName?.toLowerCase().includes("missed") &&
        e.locationX != null &&
        e.locationY != null &&
        e.id != null,
    );

    return assistEvents.map((assistEv) => {
      const x1 = (Number(assistEv.locationX) / 100) * viewBoxWidth;
      const y1 = (Number(assistEv.locationY) / 100) * viewBoxHeight;

      // Find matching Goal event in the same period
      let matchingGoal = goalEvents.find(
        (g) => g.periodNumber === assistEv.periodNumber && g.id !== assistEv.id,
      );

      // Fallback: if no goal found in same period, try any goal in dataset
      if (!matchingGoal && goalEvents.length > 0) {
        matchingGoal = goalEvents.find((g) => g.id !== assistEv.id);
      }

      let x2: number;
      let y2: number;

      if (matchingGoal) {
        x2 = (Number(matchingGoal.locationX) / 100) * viewBoxWidth;
        y2 = (Number(matchingGoal.locationY) / 100) * viewBoxHeight;
      } else {
        // Fallback to opponent goal center if goal location is unknown
        x2 = x1 > viewBoxWidth / 2 ? viewBoxWidth - 15 : 15;
        y2 = viewBoxHeight / 2;
      }

      return {
        id: `vector-${assistEv.id!}`,
        x1,
        y1,
        x2,
        y2,
        isPositive: assistEv.isPositive ?? true,
      };
    });
  }, [events, viewBoxWidth, viewBoxHeight]);

  return {
    activeEvent,
    selectedEventId,
    hoveredEventId,
    renderablePoints,
    goalLeadVectors,
    handleMarkerClick,
    handleMarkerMouseEnter,
    handleMarkerMouseLeave,
    handleClearActiveEvent,
  };
};
