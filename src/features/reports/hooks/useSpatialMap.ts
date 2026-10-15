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
  allEvents?: GameEventResponse[];
  eventDefinitionsMap: Map<string, EventDefinitionLookup>;
  viewBoxWidth?: number;
  viewBoxHeight?: number;
}

export const useSpatialMap = ({
  events,
  allEvents,
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

  // Calculate directional vectors connecting Lead events directly to Goal events matching positivity
  const goalLeadVectors = useMemo<GoalLeadVector[]>(() => {
    // Strictly rely on isLeadToGoal flag
    const leadEvents = events.filter(
      (e) =>
        Boolean(e.isLeadToGoal) &&
        !e.eventName?.toLowerCase().includes("goal") &&
        e.locationX != null &&
        e.locationY != null &&
        e.id != null,
    );

    // Use full unfiltered allEvents array for target search if present
    const searchList = allEvents && allEvents.length > 0 ? allEvents : events;

    const goalEvents = searchList.filter(
      (e) =>
        e.eventName?.toLowerCase().includes("goal") &&
        !e.eventName?.toLowerCase().includes("missed") &&
        e.locationX != null &&
        e.locationY != null &&
        e.id != null,
    );

    return leadEvents.map((leadEv) => {
      const x1 = (Number(leadEv.locationX) / 100) * viewBoxWidth;
      const y1 = (Number(leadEv.locationY) / 100) * viewBoxHeight;

      const leadTimestamp =
        leadEv.eventTimestamp == null
          ? Number.NaN
          : Date.parse(leadEv.eventTimestamp);

      const isPositiveLead = leadEv.isPositive ?? true;

      // Strictly find nearest subsequent Goal event matching period, team AND positivity
      const candidateGoals = goalEvents
        .map((goal) => ({
          goal,
          timestamp:
            goal.eventTimestamp == null
              ? Number.NaN
              : Date.parse(goal.eventTimestamp),
        }))
        .filter(
          ({ goal, timestamp }) =>
            goal.id !== leadEv.id &&
            leadEv.periodNumber != null &&
            goal.periodNumber === leadEv.periodNumber &&
            leadEv.teamId != null &&
            goal.teamId === leadEv.teamId &&
            (goal.isPositive ?? true) === isPositiveLead &&
            Number.isFinite(leadTimestamp) &&
            Number.isFinite(timestamp) &&
            timestamp >= leadTimestamp,
        )
        .sort((a, b) => a.timestamp - b.timestamp);

      const matchingGoal = candidateGoals[0]?.goal;

      let x2: number;
      let y2: number;

      if (matchingGoal) {
        x2 = (Number(matchingGoal.locationX) / 100) * viewBoxWidth;
        y2 = (Number(matchingGoal.locationY) / 100) * viewBoxHeight;
      } else {
        // Standard convention for Reports in TTA:
        // - Our Goal is ALWAYS on the LEFT (x = 15)
        // - Opponent Goal is ALWAYS on the RIGHT (x = viewBoxWidth - 15 = 985)
        x2 = isPositiveLead ? viewBoxWidth - 15 : 15;
        y2 = viewBoxHeight / 2;
      }

      return {
        id: `vector-${leadEv.id!}`,
        x1,
        y1,
        x2,
        y2,
        isPositive: isPositiveLead,
      };
    });
  }, [events, allEvents, viewBoxWidth, viewBoxHeight]);

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
