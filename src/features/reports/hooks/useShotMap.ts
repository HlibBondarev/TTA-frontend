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

  const validShotEvents = useMemo(() => {
    return events.filter((e) => {
      if (e.shotLocationX == null || e.shotLocationY == null || !e.id) {
        return false;
      }
      const def = e.eventDefinitionId
        ? eventDefinitionsMap.get(e.eventDefinitionId)
        : undefined;
      return def ? def.isShot === true : true;
    });
  }, [events, eventDefinitionsMap]);

  const clusters = useMemo(() => {
    const clusterList: GameEventResponse[][] = [];
    validShotEvents.forEach((evt) => {
      let added = false;
      for (const cluster of clusterList) {
        const ref = cluster[0];
        const dist = Math.hypot(
          Number(evt.shotLocationX) - Number(ref.shotLocationX),
          Number(evt.shotLocationY) - Number(ref.shotLocationY),
        );
        if (dist <= 3.5) {
          cluster.push(evt);
          added = true;
          break;
        }
      }
      if (!added) {
        clusterList.push([evt]);
      }
    });
    return clusterList;
  }, [validShotEvents]);

  const handleMarkerClick = useCallback(
    (eventId: string) => {
      clearAutoDismissTimer();
      setHoveredEventId(null);

      setSelectedEventId((prevSelectedId): string | null => {
        const hasClickedEvt = events.some((e) => e.id === eventId);
        if (!hasClickedEvt) return prevSelectedId === eventId ? null : eventId;

        const cluster = clusters.find((c) =>
          c.some((item) => item.id === eventId),
        );

        if (!cluster || cluster.length <= 1) {
          return prevSelectedId === eventId ? null : eventId;
        }

        if (prevSelectedId === eventId) {
          const idx = cluster.findIndex((e) => e.id === eventId);
          return cluster[(idx + 1) % cluster.length].id ?? null;
        }

        return eventId;
      });
    },
    [clearAutoDismissTimer, events, clusters],
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

    const minDim = Math.min(dimensions.width, dimensions.height);
    const baseMarkerRadius = minDim * 0.045;
    const minPadding = minDim * 0.05;

    const points = validShotEvents.map((e) => {
      const baseCx = (Number(e.shotLocationX) / 100) * dimensions.width;
      const baseCy =
        ((100 - Number(e.shotLocationY)) / 100) * dimensions.height;

      const cluster = clusters.find((c) =>
        c.some((item) => item.id === e.id),
      ) || [e];
      const totalInGroup = cluster.length;
      const groupIndex = cluster.findIndex((item) => item.id === e.id);

      let cx: number;
      let cy: number;

      if (totalInGroup > 1) {
        const offsetRadius = Math.min(
          baseMarkerRadius * Math.max(0.75, Math.sqrt(totalInGroup) * 0.5),
          minDim * 0.25,
        );
        const safeRadiusX = Math.min(
          dimensions.width / 2,
          minPadding + offsetRadius,
        );
        const safeRadiusY = Math.min(
          dimensions.height / 2,
          minPadding + offsetRadius,
        );

        const centerCx = Math.max(
          safeRadiusX,
          Math.min(dimensions.width - safeRadiusX, baseCx),
        );
        const centerCy = Math.max(
          safeRadiusY,
          Math.min(dimensions.height - safeRadiusY, baseCy),
        );

        const angle = (groupIndex * 2 * Math.PI) / totalInGroup;
        const rawCx = centerCx + Math.cos(angle) * offsetRadius;
        const rawCy = centerCy + Math.sin(angle) * offsetRadius;

        cx = Number(Math.max(0, Math.min(dimensions.width, rawCx)).toFixed(2));
        cy = Number(Math.max(0, Math.min(dimensions.height, rawCy)).toFixed(2));
      } else {
        const paddingX = Math.min(dimensions.width / 2, minPadding);
        const paddingY = Math.min(dimensions.height / 2, minPadding);

        cx = Number(
          Math.max(
            paddingX,
            Math.min(dimensions.width - paddingX, baseCx),
          ).toFixed(2),
        );
        cy = Number(
          Math.max(
            paddingY,
            Math.min(dimensions.height - paddingY, baseCy),
          ).toFixed(2),
        );
      }

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

    // Bring active (selected or hovered) marker to the top in SVG DOM order
    return points.sort((a, b) => {
      const aActive = a.isSelected || a.isHovered ? 1 : 0;
      const bActive = b.isSelected || b.isHovered ? 1 : 0;
      return aActive - bActive;
    });
  }, [
    dimensions,
    validShotEvents,
    clusters,
    eventDefinitionsMap,
    goalDefinitionIds,
    selectedEventId,
    hoveredEventId,
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
