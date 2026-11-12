import React, { useMemo, useState, useRef, useEffect } from "react";
import DOMPurify from "dompurify";
import type { GameEventResponse } from "../../../services/reportService";
import type { EventDefinitionLookup } from "../../../db/ttaDatabase";
import { parseSvgDimensions } from "../../../utils/svgUtils";
import {
  useSpatialMap,
  type GoalLeadVector,
  type RenderableSpatialPoint,
} from "../hooks/useSpatialMap";

export interface MatchSpatialMapProps {
  events: GameEventResponse[];
  allEvents?: GameEventResponse[];
  eventDefinitionsMap: Map<string, EventDefinitionLookup>;
  playground?: string | null;
  shotMap?: string | null;
  showGoalLeadVectors?: boolean;
}

const getTooltipPositionClass = (locationX: number): string => {
  const yClass = locationX > 65 ? "translate-y-4" : "-translate-y-full -mt-4";
  return `transform ${yClass}`;
};

const formatMatchTime = (timeStr?: string): string => {
  if (!timeStr) return "";
  return timeStr.split(".")[0];
};

const SpatialTooltipGoalPreview: React.FC<{
  shotX: number;
  shotY: number;
  safeShotMap?: string | null;
  rawShotMap?: string | null;
}> = ({ shotX, shotY, safeShotMap, rawShotMap }) => {
  const dimensions = useMemo(
    () => parseSvgDimensions(rawShotMap),
    [rawShotMap],
  );

  if (!safeShotMap || !dimensions) {
    return null;
  }

  const cx = (shotX / 100) * dimensions.width;
  const cy = ((100 - shotY) / 100) * dimensions.height;

  return (
    <div
      className="relative w-full rounded border border-slate-700 overflow-hidden bg-sky-950/90"
      style={{ aspectRatio: dimensions.aspectRatio }}
    >
      <div
        className="w-full h-auto pointer-events-none opacity-90 [&>svg]:w-full [&>svg]:h-auto [&>svg]:block"
        dangerouslySetInnerHTML={{ __html: safeShotMap }}
      />
      <svg
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      >
        <circle
          cx={cx}
          cy={cy}
          r={Math.min(dimensions.width, dimensions.height) * 0.04}
          strokeWidth={Math.min(dimensions.width, dimensions.height) * 0.01}
          className="fill-amber-400 stroke-slate-950 shadow-md"
        />
      </svg>
    </div>
  );
};

const GoalLeadVectorLine: React.FC<{
  vector: GoalLeadVector;
  dimensions: { width: number; height: number };
}> = ({ vector, dimensions }) => {
  const minDim = Math.min(dimensions.width, dimensions.height);
  const dx = vector.x2 - vector.x1;
  const dy = vector.y2 - vector.y1;
  const dist = Math.hypot(dx, dy);

  const baseStartOffset = minDim * 0.04;
  const baseEndOffset = minDim * 0.045;
  const combinedOffset = baseStartOffset + baseEndOffset;

  let startOffset = 0;
  let endOffset = 0;

  if (dist > combinedOffset) {
    startOffset = baseStartOffset;
    endOffset = baseEndOffset;
  } else if (dist > 0) {
    const scale = (dist * 0.8) / combinedOffset;
    startOffset = baseStartOffset * scale;
    endOffset = baseEndOffset * scale;
  }

  const x1 = dist > 0 ? vector.x1 + (dx / dist) * startOffset : vector.x1;
  const y1 = dist > 0 ? vector.y1 + (dy / dist) * startOffset : vector.y1;
  const x2 = dist > 0 ? vector.x2 - (dx / dist) * endOffset : vector.x2;
  const y2 = dist > 0 ? vector.y2 - (dy / dist) * endOffset : vector.y2;

  const strokeColor = vector.isPositive ? "#ffffff" : "#fcd34d";
  const markerEnd = vector.isPositive
    ? "url(#arrow-white)"
    : "url(#arrow-amber)";

  const strokeWidth = minDim * 0.006;
  const circleRadius = minDim * 0.008;

  const dashOn = minDim * 0.0083;
  const dashOff = minDim * 0.0067;
  const strokeDasharray = `${dashOn} ${dashOff}`;

  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        markerEnd={markerEnd}
        className="opacity-95"
      />
      <circle
        cx={vector.x2}
        cy={vector.y2}
        r={circleRadius}
        fill={strokeColor}
      />
    </g>
  );
};

interface MarkerProps {
  isPositive: boolean;
  isHighlighted: boolean;
  playerNumber?: number | null;
  shortCode: string;
  dimensions: { width: number; height: number };
}

const GoalMarker: React.FC<MarkerProps> = ({
  isPositive,
  isHighlighted,
  playerNumber,
  shortCode,
  dimensions,
}) => {
  const minDim = Math.min(dimensions.width, dimensions.height);
  const baseRadius = minDim * 0.04;
  const hoverRadius = minDim * 0.053;
  const radius = isHighlighted ? hoverRadius : baseRadius;

  const strokeWidth = minDim * 0.01;
  const fontSize = minDim * 0.028;
  const textY = minDim * 0.0095;

  const ringClass = isPositive
    ? "fill-amber-400 stroke-emerald-400"
    : "fill-amber-400 stroke-rose-500";
  const label = playerNumber != null ? `${playerNumber}` : shortCode;

  return (
    <g>
      <circle
        cx={0}
        cy={0}
        r={radius}
        strokeWidth={strokeWidth}
        className={`${ringClass} shadow-lg transition-all duration-150`}
      />
      <text
        x={0}
        y={textY}
        fontSize={fontSize}
        textAnchor="middle"
        className="fill-slate-950 font-mono font-black pointer-events-none select-none"
      >
        {label}
      </text>
    </g>
  );
};

const LeadMarker: React.FC<MarkerProps> = ({
  isPositive,
  isHighlighted,
  playerNumber,
  shortCode,
  dimensions,
}) => {
  const minDim = Math.min(dimensions.width, dimensions.height);
  const baseRadius = minDim * 0.036;
  const hoverRadius = minDim * 0.048;
  const radius = isHighlighted ? hoverRadius : baseRadius;
  const strokeWidth = minDim * 0.006;
  const fontSize = minDim * 0.028;
  const textY = minDim * 0.0095;

  const circleClass = isPositive
    ? "fill-emerald-500 stroke-amber-400"
    : "fill-rose-600 stroke-amber-400";
  const label = playerNumber != null ? `${playerNumber}` : shortCode;

  return (
    <g>
      <circle
        cx={0}
        cy={0}
        r={radius}
        strokeWidth={strokeWidth}
        className={`${circleClass} shadow-md transition-all duration-150`}
      />
      <text
        x={0}
        y={textY}
        fontSize={fontSize}
        textAnchor="middle"
        className="fill-white font-mono font-black pointer-events-none select-none"
      >
        {label}
      </text>
    </g>
  );
};

const StandardMarker: React.FC<MarkerProps> = ({
  isPositive,
  isHighlighted,
  playerNumber,
  shortCode,
  dimensions,
}) => {
  const minDim = Math.min(dimensions.width, dimensions.height);
  const baseRadius = minDim * 0.036;
  const hoverRadius = minDim * 0.048;
  const radius = isHighlighted ? hoverRadius : baseRadius;
  const strokeWidth = minDim * 0.005;
  const fontSize = minDim * 0.028;
  const textY = minDim * 0.0095;

  const circleClass = isPositive
    ? "fill-emerald-500 stroke-emerald-300"
    : "fill-rose-600 stroke-rose-300";
  const label = playerNumber != null ? `${playerNumber}` : shortCode;

  return (
    <g>
      <circle
        cx={0}
        cy={0}
        r={radius}
        strokeWidth={strokeWidth}
        className={`${circleClass} shadow-md transition-all duration-150`}
      />
      <text
        x={0}
        y={textY}
        fontSize={fontSize}
        textAnchor="middle"
        className="fill-white font-mono font-black pointer-events-none select-none"
      >
        {label}
      </text>
    </g>
  );
};

interface SpatialMapMarkerProps {
  point: RenderableSpatialPoint;
  dimensions: { width: number; height: number };
  isActive?: boolean;
  onMarkerClick: (id: string) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: () => void;
  onActiveMarkerTab?: () => boolean;
}

const SpatialMapMarker: React.FC<SpatialMapMarkerProps> = ({
  point,
  dimensions,
  isActive = false,
  onMarkerClick,
  onMouseEnter,
  onMouseLeave,
  onActiveMarkerTab,
}) => {
  const { event, cx, cy, shortCode, isSelected, isHovered, isGoal } = point;
  if (!event.id) return null;

  const eventId = event.id;
  const isHighlighted = isSelected || isHovered;

  const renderMarkerContent = () => {
    const markerProps: MarkerProps = {
      isPositive: Boolean(event.isPositive),
      isHighlighted,
      playerNumber: event.playerNumber,
      shortCode,
      dimensions,
    };

    if (isGoal) {
      return <GoalMarker {...markerProps} />;
    }

    if (event.isLeadToGoal) {
      return <LeadMarker {...markerProps} />;
    }

    return <StandardMarker {...markerProps} />;
  };

  return (
    <g
      transform={`translate(${cx}, ${cy})`}
      role="button"
      tabIndex={0}
      aria-label={`${event.playerName || "Player"} #${event.playerNumber ?? ""} ${shortCode}`}
      onClick={(e) => {
        e.stopPropagation();
        onMarkerClick(eventId);
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab" && !e.shiftKey && isActive && onActiveMarkerTab) {
          if (onActiveMarkerTab()) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onMarkerClick(eventId);
        }
      }}
      onMouseEnter={() => onMouseEnter(eventId)}
      onMouseLeave={onMouseLeave}
      className="cursor-pointer outline-none focus-visible:[&_circle]:stroke-white"
    >
      {renderMarkerContent()}
    </g>
  );
};

const SpatialTooltip: React.FC<{
  tooltipRef?: React.RefObject<HTMLDivElement | null>;
  activeEvent: GameEventResponse;
  eventDefinitionsMap: Map<string, EventDefinitionLookup>;
  shotMap?: string | null;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onPauseAutoDismiss?: () => void;
  onResumeAutoDismiss?: () => void;
}> = ({
  tooltipRef,
  activeEvent,
  eventDefinitionsMap,
  shotMap,
  onMouseEnter,
  onMouseLeave,
  onPauseAutoDismiss,
  onResumeAutoDismiss,
}) => {
  const [tooltipMode, setTooltipMode] = useState<"info" | "shot">("info");
  const isPointerInsideRef = useRef(false);
  const isFocusInsideRef = useRef(false);

  const handlePointerEnter = () => {
    isPointerInsideRef.current = true;
    onPauseAutoDismiss?.();
    onMouseEnter?.();
  };

  const handlePointerLeave = () => {
    isPointerInsideRef.current = false;
    if (!isFocusInsideRef.current) {
      onResumeAutoDismiss?.();
    }
    onMouseLeave?.();
  };

  const handleFocus = () => {
    isFocusInsideRef.current = true;
    onPauseAutoDismiss?.();
  };

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) {
      return;
    }
    isFocusInsideRef.current = false;
    if (!isPointerInsideRef.current) {
      onResumeAutoDismiss?.();
    }
  };

  const safeShotMap = useMemo(
    () =>
      shotMap
        ? DOMPurify.sanitize(shotMap, {
            USE_PROFILES: { svg: true, svgFilters: true },
          })
        : null,
    [shotMap],
  );

  const locX = Number(activeEvent.locationX ?? 50);
  const locY = Number(activeEvent.locationY ?? 50);

  const screenLeftPct = locY;
  const screenTopPct = 100 - locX;

  const headerColor = activeEvent.isPositive
    ? "text-emerald-400"
    : "text-rose-400";

  const def = activeEvent.eventDefinitionId
    ? eventDefinitionsMap.get(activeEvent.eventDefinitionId)
    : undefined;

  const isShotAction =
    def?.isShot === true &&
    activeEvent.shotLocationX != null &&
    activeEvent.shotLocationY != null;

  const shotX = Number(activeEvent.shotLocationX ?? 50);
  const shotY = Number(activeEvent.shotLocationY ?? 50);

  return (
    <div
      ref={tooltipRef}
      tabIndex={-1}
      role="tooltip"
      aria-label="Event Details"
      onMouseEnter={handlePointerEnter}
      onMouseLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={`absolute z-20 min-w-44 max-w-60 p-2.5 bg-gray-900/95 border border-gray-700 text-white rounded-xl shadow-2xl text-[11px] backdrop-blur-md pointer-events-auto outline-none transition-all duration-150 ${getTooltipPositionClass(
        locX,
      )}`}
      style={{
        left: `clamp(0px, calc(${screenLeftPct}% - 6.875rem), calc(100% - 15rem))`,
        top: `${Math.max(5, Math.min(95, screenTopPct))}%`,
      }}
    >
      <div className="flex items-center justify-between border-b border-gray-800 pb-1 mb-1.5 gap-2">
        <div
          className={`flex items-center space-x-1.5 font-bold whitespace-nowrap truncate ${headerColor}`}
        >
          <span>#{activeEvent.playerNumber ?? "-"}</span>
          <span className="truncate">{activeEvent.playerName || "Player"}</span>
        </div>

        {isShotAction && (
          <div className="flex bg-gray-950 p-0.5 rounded-lg border border-gray-800 shrink-0">
            <button
              type="button"
              onClick={() => setTooltipMode("info")}
              className={`px-1.5 py-0.5 text-[9px] font-bold rounded transition-colors ${
                tooltipMode === "info"
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Info
            </button>
            <button
              type="button"
              onClick={() => setTooltipMode("shot")}
              className={`px-1.5 py-0.5 text-[9px] font-bold rounded transition-colors ${
                tooltipMode === "shot"
                  ? "bg-amber-600 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Shot
            </button>
          </div>
        )}
      </div>

      {tooltipMode === "info" ? (
        <div className="space-y-0.5 text-gray-300">
          <div className="wrap-break-word">
            <span className="text-gray-400">Action: </span>
            <span className="font-semibold text-white">
              {activeEvent.eventName || "Action"}
            </span>
          </div>
          <div>
            <span className="text-gray-400">Period: </span>
            <span>Q{activeEvent.periodNumber ?? "-"}</span>
          </div>
          {activeEvent.normalizedMatchTime && (
            <div>
              <span className="text-gray-400">Time: </span>
              <span className="font-mono">
                {formatMatchTime(activeEvent.normalizedMatchTime)}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-[9px] text-gray-400 font-bold uppercase">
            <span>Goal Target</span>
            <span className="font-mono text-amber-400">
              X:{shotX}% Y:{shotY}%
            </span>
          </div>
          <SpatialTooltipGoalPreview
            shotX={shotX}
            shotY={shotY}
            safeShotMap={safeShotMap}
            rawShotMap={shotMap}
          />
        </div>
      )}
    </div>
  );
};

export const MatchSpatialMap: React.FC<MatchSpatialMapProps> = ({
  events,
  allEvents,
  eventDefinitionsMap,
  playground,
  shotMap,
  showGoalLeadVectors = false,
}) => {
  const dimensions = useMemo(
    () => parseSvgDimensions(playground),
    [playground],
  );

  const viewBoxWidth = dimensions?.width ?? 600;
  const viewBoxHeight = dimensions?.height ?? 1000;

  const {
    activeEvent,
    renderablePoints,
    goalLeadVectors,
    handleMarkerClick,
    handleMarkerMouseEnter,
    handleMarkerMouseLeave,
    handleClearActiveEvent,
    pauseAutoDismiss,
    resumeAutoDismiss,
  } = useSpatialMap({
    events,
    allEvents,
    eventDefinitionsMap,
    viewBoxWidth,
    viewBoxHeight,
  });

  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const isTooltipPointerInsideRef = useRef(false);

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
      }
    };
  }, []);

  const handleMouseEnterWithDelay = (id?: string) => {
    if (!id) return;
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    handleMarkerMouseEnter(id);
  };

  const handleMouseLeaveWithDelay = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
    }
    leaveTimerRef.current = setTimeout(() => {
      handleMarkerMouseLeave();
      leaveTimerRef.current = null;
    }, 150);
  };

  const focusTooltip = (): boolean => {
    const tooltipEl = tooltipRef.current;
    if (!tooltipEl) return false;
    const firstFocusable = tooltipEl.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    (firstFocusable ?? tooltipEl).focus();
    return true;
  };

  const handleMarkerActivate = (id: string) => {
    handleMarkerClick(id);
    if (mapContainerRef.current?.contains(document.activeElement)) {
      pauseAutoDismiss();
    }
  };

  const safeSvg = useMemo(
    () =>
      playground
        ? DOMPurify.sanitize(playground, {
            USE_PROFILES: { svg: true, svgFilters: true },
          })
        : null,
    [playground],
  );

  if (!safeSvg || !dimensions) {
    return (
      <div className="w-full p-6 text-center text-xs text-slate-400 bg-gray-950/80 border border-gray-800 rounded-2xl">
        Field Map SVG is unavailable for this match.
      </div>
    );
  }

  const hasTooltip =
    activeEvent?.id != null &&
    activeEvent?.locationX != null &&
    activeEvent?.locationY != null;

  return (
    <div
      ref={mapContainerRef}
      onKeyDown={(e) => {
        if (!hasTooltip) return;
        if (e.key === "Escape") {
          e.preventDefault();
          handleClearActiveEvent();
        } else if (e.key === "Tab") {
          pauseAutoDismiss();
        }
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) {
          return;
        }
        if (!isTooltipPointerInsideRef.current) {
          resumeAutoDismiss();
        }
      }}
      className="relative w-full bg-blue-950/60 border border-blue-900/60 rounded-2xl select-none"
      style={{ aspectRatio: dimensions.aspectRatio }}
    >
      <div
        className="w-full h-auto pointer-events-none opacity-90 rounded-2xl overflow-hidden [&>svg]:w-full [&>svg]:h-auto [&>svg]:block"
        dangerouslySetInnerHTML={{ __html: safeSvg }}
      />

      <svg
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        className="absolute inset-0 w-full h-full"
        aria-label="Match Spatial Event Map"
        onClick={handleClearActiveEvent}
      >
        <defs>
          <marker
            id="arrow-white"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#ffffff" />
          </marker>
          <marker
            id="arrow-amber"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#fcd34d" />
          </marker>
        </defs>

        {showGoalLeadVectors &&
          goalLeadVectors.map((v) => (
            <GoalLeadVectorLine key={v.id} vector={v} dimensions={dimensions} />
          ))}

        {renderablePoints.map((point) => (
          <SpatialMapMarker
            key={point.event.id}
            point={point}
            dimensions={dimensions}
            isActive={activeEvent?.id === point.event.id}
            onMarkerClick={handleMarkerActivate}
            onMouseEnter={handleMouseEnterWithDelay}
            onMouseLeave={handleMouseLeaveWithDelay}
            onActiveMarkerTab={focusTooltip}
          />
        ))}
      </svg>

      {hasTooltip && (
        <SpatialTooltip
          key={activeEvent.id}
          tooltipRef={tooltipRef}
          activeEvent={activeEvent}
          eventDefinitionsMap={eventDefinitionsMap}
          shotMap={shotMap}
          onMouseEnter={() => {
            isTooltipPointerInsideRef.current = true;
            handleMouseEnterWithDelay(activeEvent.id);
          }}
          onMouseLeave={() => {
            isTooltipPointerInsideRef.current = false;
            handleMouseLeaveWithDelay();
          }}
          onPauseAutoDismiss={pauseAutoDismiss}
          onResumeAutoDismiss={resumeAutoDismiss}
        />
      )}
    </div>
  );
};
