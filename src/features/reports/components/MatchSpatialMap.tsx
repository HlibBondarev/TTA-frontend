import React, { useMemo, useState } from "react";
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
      >
        <circle
          cx={cx}
          cy={cy}
          r={Math.min(dimensions.width, dimensions.height) * 0.04}
          className="fill-amber-400 stroke-slate-950 stroke-2 shadow-md"
        />
      </svg>
    </div>
  );
};

const GoalLeadVectorLine: React.FC<{ vector: GoalLeadVector }> = ({
  vector,
}) => {
  const dx = vector.x2 - vector.x1;
  const dy = vector.y2 - vector.y1;
  const dist = Math.hypot(dx, dy);

  const startOffset = dist > 20 ? 8 : 0;
  const endOffset = dist > 20 ? 10 : 0;

  const x1 = dist > 0 ? vector.x1 + (dx / dist) * startOffset : vector.x1;
  const y1 = dist > 0 ? vector.y1 + (dy / dist) * startOffset : vector.y1;
  const x2 = dist > 0 ? vector.x2 - (dx / dist) * endOffset : vector.x2;
  const y2 = dist > 0 ? vector.y2 - (dy / dist) * endOffset : vector.y2;

  const strokeColor = vector.isPositive ? "#10b981" : "#f43f5e";
  const markerEnd = vector.isPositive
    ? "url(#arrow-emerald)"
    : "url(#arrow-rose)";

  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={strokeColor}
        strokeWidth="2"
        strokeDasharray="4 3"
        markerEnd={markerEnd}
        className="opacity-80"
      />
      <circle cx={vector.x2} cy={vector.y2} r="3" fill={strokeColor} />
    </g>
  );
};

interface MarkerProps {
  isPositive: boolean;
  isHighlighted: boolean;
  playerNumber?: number | null;
  shortCode: string;
}

const GoalMarker: React.FC<MarkerProps> = ({
  isPositive,
  isHighlighted,
  playerNumber,
  shortCode,
}) => {
  const ringClass = isPositive
    ? "fill-amber-400 stroke-emerald-400"
    : "fill-amber-400 stroke-rose-500";
  const label = playerNumber != null ? `${playerNumber}` : shortCode;

  return (
    <g>
      <circle
        cx={0}
        cy={0}
        r={isHighlighted ? 11 : 7.5}
        className={`${ringClass} stroke-2 shadow-lg transition-all duration-150`}
      />
      <text
        x={0}
        y={3}
        textAnchor="middle"
        className="fill-gray-950 font-mono font-black text-[9px] pointer-events-none select-none"
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
}) => {
  const circleClass = isPositive
    ? "fill-emerald-500 stroke-emerald-300"
    : "fill-rose-600 stroke-rose-300";
  const label = playerNumber != null ? `${playerNumber}` : shortCode;

  return (
    <g>
      <circle
        cx={0}
        cy={0}
        r={isHighlighted ? 10 : 6.5}
        className={`${circleClass} stroke-[1.5] shadow-md transition-all duration-150`}
      />
      <text
        x={0}
        y={3}
        textAnchor="middle"
        className="fill-white font-mono font-black text-[9px] pointer-events-none select-none"
      >
        {label}
      </text>
    </g>
  );
};

interface SpatialMapMarkerProps {
  point: RenderableSpatialPoint;
  onMarkerClick: (id: string) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: () => void;
}

const SpatialMapMarker: React.FC<SpatialMapMarkerProps> = ({
  point,
  onMarkerClick,
  onMouseEnter,
  onMouseLeave,
}) => {
  const { event, cx, cy, shortCode, isSelected, isHovered, isGoal } = point;
  if (!event.id) return null;

  const eventId = event.id;
  const isHighlighted = isSelected || isHovered;

  return (
    <g
      transform={`translate(${cx}, ${cy})`}
      onClick={(e) => {
        e.stopPropagation();
        onMarkerClick(eventId);
      }}
      onMouseEnter={() => onMouseEnter(eventId)}
      onMouseLeave={onMouseLeave}
      className="cursor-pointer"
    >
      {event.isLeadToGoal && (
        <circle
          cx={0}
          cy={0}
          r={isHighlighted ? 14 : 11}
          className="fill-none stroke-amber-400 stroke-2 animate-ping opacity-75"
        />
      )}

      {isGoal ? (
        <GoalMarker
          isPositive={Boolean(event.isPositive)}
          isHighlighted={isHighlighted}
          playerNumber={event.playerNumber}
          shortCode={shortCode}
        />
      ) : (
        <StandardMarker
          isPositive={Boolean(event.isPositive)}
          isHighlighted={isHighlighted}
          playerNumber={event.playerNumber}
          shortCode={shortCode}
        />
      )}
    </g>
  );
};

const SpatialTooltip: React.FC<{
  activeEvent: GameEventResponse;
  eventDefinitionsMap: Map<string, EventDefinitionLookup>;
  shotMap?: string | null;
}> = ({ activeEvent, eventDefinitionsMap, shotMap }) => {
  const [tooltipMode, setTooltipMode] = useState<"info" | "shot">("info");

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
      onClick={(e) => e.stopPropagation()}
      className={`absolute z-20 min-w-44 max-w-60 p-2.5 bg-gray-900/95 border border-gray-700 text-white rounded-xl shadow-2xl text-[11px] backdrop-blur-md pointer-events-auto transition-all duration-150 ${getTooltipPositionClass(
        locX,
      )}`}
      style={{
        left: `clamp(0px, calc(${screenLeftPct}% - 6.875rem), calc(100% - 13.75rem))`,
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
  } = useSpatialMap({
    events,
    allEvents,
    eventDefinitionsMap,
    viewBoxWidth,
    viewBoxHeight,
  });

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
    activeEvent?.locationX != null && activeEvent?.locationY != null;

  return (
    <div
      className="relative w-full bg-blue-950/60 border border-blue-900/60 rounded-2xl overflow-hidden select-none"
      style={{ aspectRatio: dimensions.aspectRatio }}
    >
      <div
        className="w-full h-auto pointer-events-none opacity-90 [&>svg]:w-full [&>svg]:h-auto [&>svg]:block"
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
            id="arrow-emerald"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />
          </marker>
          <marker
            id="arrow-rose"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#f43f5e" />
          </marker>
        </defs>

        {showGoalLeadVectors &&
          goalLeadVectors.map((v) => (
            <GoalLeadVectorLine key={v.id} vector={v} />
          ))}

        {renderablePoints.map((point) => (
          <SpatialMapMarker
            key={point.event.id}
            point={point}
            onMarkerClick={handleMarkerClick}
            onMouseEnter={handleMarkerMouseEnter}
            onMouseLeave={handleMarkerMouseLeave}
          />
        ))}
      </svg>

      {hasTooltip && (
        <SpatialTooltip
          activeEvent={activeEvent!}
          eventDefinitionsMap={eventDefinitionsMap}
          shotMap={shotMap}
        />
      )}
    </div>
  );
};
