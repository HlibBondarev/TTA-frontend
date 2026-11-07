import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { GameEventResponse } from "../../../services/reportService";
import type { EventDefinitionLookup } from "../../../db/ttaDatabase";
import { parseSvgDimensions } from "../../../utils/svgUtils";

export type ShotCategory = "goal" | "conceded_goal" | "shot_on_goal" | "miss";

export interface RenderableShotPoint {
  event: GameEventResponse;
  cx: number;
  cy: number;
  shortCode: string;
  isSelected: boolean;
  isHovered: boolean;
  shotCategory: ShotCategory;
}

export interface UseShotMapParams {
  events: GameEventResponse[];
  eventDefinitionsMap: Map<string, EventDefinitionLookup>;
  shotMap?: string | null;
}

export const useShotMap = ({
  events,
  eventDefinitionsMap,
  shotMap,
}: UseShotMapParams) => {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const dimensions = useMemo(() => parseSvgDimensions(shotMap), [shotMap]);

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

  const goalDefinitionIds = useMemo(() => {
    const goalIds = new Set<string>();
    eventDefinitionsMap.forEach((def, id) => {
      if (def.name?.trim().toLowerCase() === "goal") {
        goalIds.add(id);
      }
    });
    return goalIds;
  }, [eventDefinitionsMap]);

  const activeEvent = useMemo(() => {
    const activeId = hoveredEventId ?? selectedEventId;
    return events.find((e) => e.id === activeId) ?? null;
  }, [events, hoveredEventId, selectedEventId]);

  const renderablePoints = useMemo<RenderableShotPoint[]>(() => {
    if (!dimensions) return [];

    return events
      .filter((e) => {
        if (e.shotLocationX == null || e.shotLocationY == null || !e.id) {
          return false;
        }
        const def = e.eventDefinitionId
          ? eventDefinitionsMap.get(e.eventDefinitionId)
          : undefined;
        return def?.isShot === true;
      })
      .map((e) => {
        const cx = (Number(e.shotLocationX) / 100) * dimensions.width;
        const cy = ((100 - Number(e.shotLocationY)) / 100) * dimensions.height;

        const def = e.eventDefinitionId
          ? eventDefinitionsMap.get(e.eventDefinitionId)
          : undefined;
        const shortCode =
          def?.shortName || e.eventName?.slice(0, 3).toUpperCase() || "SHT";

        const isGoalEvent = Boolean(
          e.eventDefinitionId && goalDefinitionIds.has(e.eventDefinitionId),
        );

        let shotCategory: ShotCategory;
        if (e.isPositive) {
          shotCategory = isGoalEvent ? "goal" : "shot_on_goal";
        } else {
          shotCategory = isGoalEvent ? "conceded_goal" : "miss";
        }

        return {
          event: e,
          cx,
          cy,
          shortCode,
          isSelected: selectedEventId === e.id,
          isHovered: hoveredEventId === e.id,
          shotCategory,
        };
      });
  }, [
    events,
    eventDefinitionsMap,
    goalDefinitionIds,
    selectedEventId,
    hoveredEventId,
    dimensions,
  ]);

  return {
    activeEvent,
    selectedEventId,
    hoveredEventId,
    renderablePoints,
    dimensions,
    handleMarkerClick,
    handleMarkerMouseEnter,
    handleMarkerMouseLeave,
    handleClearActiveEvent,
  };
};
