import React, { useMemo } from "react";
import DOMPurify from "dompurify";
import type { GameEventResponse } from "../../../services/reportService";
import type { EventDefinitionLookup } from "../../../db/ttaDatabase";
import {
  useSpatialMap,
  type GoalLeadVector,
  type RenderableSpatialPoint,
} from "../hooks/useSpatialMap";

export interface MatchSpatialMapProps {
  events: GameEventResponse[];
  allEvents?: GameEventResponse[];
  eventDefinitionsMap: Map<string, EventDefinitionLookup>;
  playgroundSvg?: string | null;
  showGoalLeadVectors?: boolean;
}

const getTooltipPositionClass = (locationY: number): string => {
  const yClass = locationY < 35 ? "translate-y-4" : "-translate-y-full -mt-4";
  return `transform ${yClass}`;
};

const formatMatchTime = (timeStr?: string): string => {
  if (!timeStr) return "";
  return timeStr.split(".")[0];
};

/* --- Extracted Sub-Components for Sonar Cognitive Complexity Optimization --- */

const WaterPoloCourtSvg: React.FC = () => (
  <svg
    viewBox="0 0 1000 600"
    className="absolute inset-0 w-full h-full pointer-events-none fill-none"
    aria-hidden="true"
  >
    <rect
      x="2"
      y="2"
      width="996"
      height="596"
      className="fill-sky-950/80 stroke-sky-500/50"
      strokeWidth="4"
      rx="8"
    />
    <line
      x1="67"
      y1="0"
      x2="67"
      y2="600"
      className="stroke-rose-500/80"
      strokeWidth="2"
      strokeDasharray="6 4"
    />
    <line
      x1="933"
      y1="0"
      x2="933"
      y2="600"
      className="stroke-rose-500/80"
      strokeWidth="2"
      strokeDasharray="6 4"
    />
    <rect
      x="0"
      y="150"
      width="67"
      height="300"
      className="fill-rose-500/10 stroke-rose-500/50"
      strokeWidth="1.5"
      strokeDasharray="4 4"
    />
    <rect
      x="933"
      y="150"
      width="67"
      height="300"
      className="fill-rose-500/10 stroke-rose-500/50"
      strokeWidth="1.5"
      strokeDasharray="4 4"
    />
    <line
      x1="167"
      y1="0"
      x2="167"
      y2="600"
      className="stroke-amber-400/80"
      strokeWidth="2"
      strokeDasharray="6 4"
    />
    <line
      x1="833"
      y1="0"
      x2="833"
      y2="600"
      className="stroke-amber-400/80"
      strokeWidth="2"
      strokeDasharray="6 4"
    />
    <line
      x1="200"
      y1="0"
      x2="200"
      y2="600"
      className="stroke-emerald-400/80"
      strokeWidth="2"
      strokeDasharray="6 4"
    />
    <line
      x1="800"
      y1="0"
      x2="800"
      y2="600"
      className="stroke-emerald-400/80"
      strokeWidth="2"
      strokeDasharray="6 4"
    />
    <line
      x1="500"
      y1="0"
      x2="500"
      y2="600"
      className="stroke-white/80"
      strokeWidth="2.5"
      strokeDasharray="8 6"
    />
    <circle
      cx="500"
      cy="300"
      r="8"
      className="fill-white stroke-sky-950"
      strokeWidth="2"
    />
    <rect
      x="0"
      y="200"
      width="30"
      height="200"
      className="fill-rose-500/20 stroke-rose-500/80"
      strokeWidth="2"
    />
    <rect
      x="970"
      y="200"
      width="30"
      height="200"
      className="fill-rose-500/20 stroke-rose-500/80"
      strokeWidth="2"
    />
    <circle cx="67" cy="8" r="4" className="fill-rose-500" />
    <circle cx="67" cy="592" r="4" className="fill-rose-500" />
    <circle cx="167" cy="8" r="4" className="fill-amber-400" />
    <circle cx="167" cy="592" r="4" className="fill-amber-400" />
    <circle cx="200" cy="8" r="4" className="fill-emerald-400" />
    <circle cx="200" cy="592" r="4" className="fill-emerald-400" />
    <circle cx="500" cy="8" r="4" className="fill-white" />
    <circle cx="500" cy="592" r="4" className="fill-white" />
    <circle cx="800" cy="8" r="4" className="fill-emerald-400" />
    <circle cx="800" cy="592" r="4" className="fill-emerald-400" />
    <circle cx="833" cy="8" r="4" className="fill-amber-400" />
    <circle cx="833" cy="592" r="4" className="fill-amber-400" />
    <circle cx="933" cy="8" r="4" className="fill-rose-500" />
    <circle cx="933" cy="592" r="4" className="fill-rose-500" />
  </svg>
);

const GoalLeadVectorLine: React.FC<{ vector: GoalLeadVector }> = ({
  vector,
}) => {
  const dx = vector.x2 - vector.x1;
  const dy = vector.y2 - vector.y1;
  const dist = Math.hypot(dx, dy);

  const startOffset = dist > 30 ? 14 : 0;
  const endOffset = dist > 30 ? 18 : 0;

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
        strokeWidth="2.5"
        strokeDasharray="6 4"
        markerEnd={markerEnd}
        className="opacity-80"
      />
      <circle cx={vector.x2} cy={vector.y2} r="4" fill={strokeColor} />
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
    ? "fill-emerald-950/80 stroke-emerald-400"
    : "fill-rose-950/80 stroke-rose-500";
  const label = playerNumber != null ? `#${playerNumber}` : shortCode;

  return (
    <g>
      <circle
        cx={0}
        cy={0}
        r={isHighlighted ? 20 : 16}
        className={`${ringClass} stroke-3 shadow-xl transition-all duration-150`}
      />
      <circle
        cx={0}
        cy={0}
        r={isHighlighted ? 14 : 11}
        className="fill-amber-400 stroke-amber-600 stroke-1"
      />
      <path
        d="M -9 0 Q 0 -6 9 0 M -9 0 Q 0 6 9 0 M 0 -9 Q -6 0 0 9 M 0 -9 Q 6 0 0 9"
        className="fill-none stroke-gray-950/80 stroke-[1.2]"
      />
      <text
        x={0}
        y={3.5}
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
  const label = playerNumber != null ? `#${playerNumber}` : shortCode;

  return (
    <g>
      <circle
        cx={0}
        cy={0}
        r={isHighlighted ? 17 : 13}
        className={`${circleClass} stroke-2 shadow-lg transition-all duration-150`}
      />
      <text
        x={0}
        y={4}
        textAnchor="middle"
        className="fill-white font-mono font-black text-[10px] pointer-events-none select-none"
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
          r={isHighlighted ? 24 : 20}
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

const SpatialTooltip: React.FC<{ activeEvent: GameEventResponse }> = ({
  activeEvent,
}) => {
  const locX = Number(activeEvent.locationX);
  const locY = Number(activeEvent.locationY);
  const headerColor = activeEvent.isPositive
    ? "text-emerald-400"
    : "text-rose-400";

  return (
    <div
      className={`absolute z-20 min-w-40 max-w-55 p-2.5 bg-gray-900/95 border border-gray-700 text-white rounded-xl shadow-2xl text-[11px] backdrop-blur-md pointer-events-none transition-all duration-150 ${getTooltipPositionClass(
        locY,
      )}`}
      style={{
        left: `clamp(0px, calc(${locX}% - 6.875rem), calc(100% - 13.75rem))`,
        top: `${Math.max(5, Math.min(95, locY))}%`,
      }}
    >
      <div
        className={`flex items-center space-x-1.5 font-bold border-b border-gray-800 pb-1 mb-1 whitespace-nowrap ${headerColor}`}
      >
        <span>#{activeEvent.playerNumber ?? "-"}</span>
        <span>{activeEvent.playerName || "Player"}</span>
      </div>
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
    </div>
  );
};

/* --- Main MatchSpatialMap Component --- */

export const MatchSpatialMap: React.FC<MatchSpatialMapProps> = ({
  events,
  allEvents,
  eventDefinitionsMap,
  playgroundSvg,
  showGoalLeadVectors = false,
}) => {
  const {
    activeEvent,
    renderablePoints,
    goalLeadVectors,
    handleMarkerClick,
    handleMarkerMouseEnter,
    handleMarkerMouseLeave,
    handleClearActiveEvent,
  } = useSpatialMap({ events, allEvents, eventDefinitionsMap });

  const safeSvg = useMemo(
    () =>
      playgroundSvg
        ? DOMPurify.sanitize(playgroundSvg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          })
        : null,
    [playgroundSvg],
  );

  const hasTooltip =
    activeEvent?.locationX != null && activeEvent?.locationY != null;

  return (
    <div className="relative w-full aspect-5/3 bg-blue-950/60 border border-blue-900/60 rounded-2xl overflow-hidden select-none">
      {/* Background Court Layout */}
      {safeSvg ? (
        <div
          className="absolute inset-0 w-full h-full pointer-events-none opacity-50"
          dangerouslySetInnerHTML={{ __html: safeSvg }}
        />
      ) : (
        <WaterPoloCourtSvg />
      )}

      {/* SVG Interactive Overlay Layer */}
      <svg
        viewBox="0 0 1000 600"
        className="absolute inset-0 w-full h-full"
        aria-label="Match Spatial Event Map"
        onClick={handleClearActiveEvent}
      >
        <defs>
          <marker
            id="arrow-emerald"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />
          </marker>
          <marker
            id="arrow-rose"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#f43f5e" />
          </marker>
        </defs>

        {/* Directional Vectors Connecting Lead Events to Goal */}
        {showGoalLeadVectors &&
          goalLeadVectors.map((v) => (
            <GoalLeadVectorLine key={v.id} vector={v} />
          ))}

        {/* Action Event Point Markers */}
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

      {/* Active Event Hover / Selection Tooltip */}
      {hasTooltip && <SpatialTooltip activeEvent={activeEvent} />}
    </div>
  );
};
