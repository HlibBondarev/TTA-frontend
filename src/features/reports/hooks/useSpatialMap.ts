import { useState, useMemo, useCallback, useEffect, useRef } from "react";
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
  isGoal: boolean;
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
  viewBoxWidth = 600,
  viewBoxHeight = 1000,
}: UseSpatialMapParams) => {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const clearAutoDismissTimer = useCallback(() => {
    if (autoDismissTimerRef.current !== null) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
  }, []);

  const handleClearActiveEvent = useCallback(() => {
    clearAutoDismissTimer();
    setSelectedEventId(null);
    setHoveredEventId(null);
  }, [clearAutoDismissTimer]);

  const handleMarkerClick = useCallback(
    (eventId: string) => {
      clearAutoDismissTimer();
      setSelectedEventId((prev) => (prev === eventId ? null : eventId));
    },
    [clearAutoDismissTimer],
  );

  const handleMarkerMouseEnter = useCallback((eventId: string) => {
    setHoveredEventId(eventId);
  }, []);

  const handleMarkerMouseLeave = useCallback(() => {
    setHoveredEventId(null);
  }, []);

  useEffect(() => {
    if (!selectedEventId) return;

    autoDismissTimerRef.current = setTimeout(() => {
      autoDismissTimerRef.current = null;
      setSelectedEventId(null);
    }, 3500);

    return clearAutoDismissTimer;
  }, [selectedEventId, clearAutoDismissTimer]);

  // Set of definition IDs strictly representing "Goal" events
  const goalDefinitionIds = useMemo(() => {
    const goalIds = new Set<string>();
    eventDefinitionsMap.forEach((def, id) => {
      if (def.name?.trim().toLowerCase() === "goal") {
        goalIds.add(id);
      }
    });
    return goalIds;
  }, [eventDefinitionsMap]);

  // Currently active event for tooltip display
  const activeEvent = useMemo(() => {
    const activeId = hoveredEventId ?? selectedEventId;
    return events.find((e) => e.id === activeId) ?? null;
  }, [events, hoveredEventId, selectedEventId]);

  // Convert percentages to SVG canvas coordinates and apply collision offset for overlapping markers
  const renderablePoints = useMemo<RenderableSpatialPoint[]>(() => {
    const validEvents = events.filter(
      (e) => e.locationX != null && e.locationY != null && e.id != null,
    );

    // Calculate raw canvas coordinates for portrait pitch layout
    const basePoints = validEvents.map((e) => {
      const baseCx = (Number(e.locationY) / 100) * viewBoxWidth;
      const baseCy = ((100 - Number(e.locationX)) / 100) * viewBoxHeight;
      const def = e.eventDefinitionId
        ? eventDefinitionsMap.get(e.eventDefinitionId)
        : undefined;
      const shortCode =
        def?.shortName || e.eventName?.slice(0, 3).toUpperCase() || "TTA";

      const isGoal = Boolean(
        e.eventDefinitionId && goalDefinitionIds.has(e.eventDefinitionId),
      );

      return {
        event: e,
        baseCx,
        baseCy,
        shortCode,
        isGoal,
      };
    });

    // Group overlapping points within collision distance threshold (14px)
    const clusterGroups: (typeof basePoints)[] = [];
    const collisionThreshold = 14;

    basePoints.forEach((point) => {
      let groupFound = false;
      for (const group of clusterGroups) {
        const center = group[0];
        const dist = Math.hypot(
          point.baseCx - center.baseCx,
          point.baseCy - center.baseCy,
        );
        if (dist < collisionThreshold) {
          group.push(point);
          groupFound = true;
          break;
        }
      }

      if (!groupFound) {
        clusterGroups.push([point]);
      }
    });

    // Apply radial spiderfy displacement for clustered overlapping markers with boundary safety
    const finalRenderablePoints: RenderableSpatialPoint[] = [];
    const minDim = Math.min(viewBoxWidth, viewBoxHeight);
    const offsetRadius = Math.min(14, minDim * 0.15);
    const minPadding = Math.min(12, minDim * 0.05);

    clusterGroups.forEach((group) => {
      const count = group.length;

      if (count > 1) {
        const safeRadiusX = Math.min(
          viewBoxWidth / 2,
          minPadding + offsetRadius,
        );
        const safeRadiusY = Math.min(
          viewBoxHeight / 2,
          minPadding + offsetRadius,
        );

        const centerCx = Math.max(
          safeRadiusX,
          Math.min(viewBoxWidth - safeRadiusX, group[0].baseCx),
        );
        const centerCy = Math.max(
          safeRadiusY,
          Math.min(viewBoxHeight - safeRadiusY, group[0].baseCy),
        );

        group.forEach((pt, idx) => {
          const angle = (idx / count) * 2 * Math.PI;
          const rawCx = centerCx + offsetRadius * Math.cos(angle);
          const rawCy = centerCy + offsetRadius * Math.sin(angle);

          const finalCx = Math.max(
            minPadding,
            Math.min(viewBoxWidth - minPadding, rawCx),
          );
          const finalCy = Math.max(
            minPadding,
            Math.min(viewBoxHeight - minPadding, rawCy),
          );

          finalRenderablePoints.push({
            event: pt.event,
            cx: finalCx,
            cy: finalCy,
            shortCode: pt.shortCode,
            isSelected: selectedEventId === pt.event.id,
            isHovered: hoveredEventId === pt.event.id,
            isGoal: pt.isGoal,
          });
        });
      } else {
        const pt = group[0];
        const paddingX = Math.min(viewBoxWidth / 2, minPadding);
        const paddingY = Math.min(viewBoxHeight / 2, minPadding);

        const finalCx = Math.max(
          paddingX,
          Math.min(viewBoxWidth - paddingX, pt.baseCx),
        );
        const finalCy = Math.max(
          paddingY,
          Math.min(viewBoxHeight - paddingY, pt.baseCy),
        );

        finalRenderablePoints.push({
          event: pt.event,
          cx: finalCx,
          cy: finalCy,
          shortCode: pt.shortCode,
          isSelected: selectedEventId === pt.event.id,
          isHovered: hoveredEventId === pt.event.id,
          isGoal: pt.isGoal,
        });
      }
    });

    return finalRenderablePoints;
  }, [
    events,
    eventDefinitionsMap,
    goalDefinitionIds,
    selectedEventId,
    hoveredEventId,
    viewBoxWidth,
    viewBoxHeight,
  ]);

  // Calculate directional vectors connecting Lead events directly to Goal events
  const goalLeadVectors = useMemo<GoalLeadVector[]>(() => {
    const leadEvents = events.filter(
      (e) =>
        Boolean(e.isLeadToGoal) &&
        (!e.eventDefinitionId || !goalDefinitionIds.has(e.eventDefinitionId)) &&
        e.locationX != null &&
        e.locationY != null &&
        e.id != null,
    );

    const searchList = allEvents && allEvents.length > 0 ? allEvents : events;

    const goalEvents = searchList.filter(
      (e) =>
        e.eventDefinitionId &&
        goalDefinitionIds.has(e.eventDefinitionId) &&
        e.locationX != null &&
        e.locationY != null &&
        e.id != null,
    );

    const renderableMap = new Map(
      renderablePoints.map((pt) => [pt.event.id, pt]),
    );

    return leadEvents.map((leadEv) => {
      const leadPoint = renderableMap.get(leadEv.id);
      const x1 = leadPoint
        ? leadPoint.cx
        : (Number(leadEv.locationY) / 100) * viewBoxWidth;
      const y1 = leadPoint
        ? leadPoint.cy
        : ((100 - Number(leadEv.locationX)) / 100) * viewBoxHeight;

      const leadTimestamp =
        leadEv.eventTimestamp == null
          ? Number.NaN
          : Date.parse(leadEv.eventTimestamp);

      const isPositiveLead = leadEv.isPositive ?? true;

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
        const goalPoint = matchingGoal.id
          ? renderableMap.get(matchingGoal.id)
          : undefined;
        if (goalPoint) {
          x2 = goalPoint.cx;
          y2 = goalPoint.cy;
        } else {
          x2 = (Number(matchingGoal.locationY) / 100) * viewBoxWidth;
          y2 = ((100 - Number(matchingGoal.locationX)) / 100) * viewBoxHeight;
        }
      } else {
        x2 = viewBoxWidth / 2;
        y2 = isPositiveLead ? 15 : viewBoxHeight - 15;
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
  }, [
    events,
    allEvents,
    goalDefinitionIds,
    renderablePoints,
    viewBoxWidth,
    viewBoxHeight,
  ]);

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
