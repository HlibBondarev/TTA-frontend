import React, { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import type { GameEventResponse } from "../../../services/reportService";
import type { EventDefinitionLookup } from "../../../db/ttaDatabase";
import { useShotMap, type RenderableShotPoint } from "../hooks/useShotMap";

export interface MatchShotMapProps {
  events: GameEventResponse[];
  eventDefinitionsMap: Map<string, EventDefinitionLookup>;
  shotMap?: string | null;
}

const formatMatchTime = (timeStr?: string): string => {
  if (!timeStr) return "";
  return timeStr.split(".")[0];
};

const ShotMarker: React.FC<{
  point: RenderableShotPoint;
  dimensions: { width: number; height: number };
  onMarkerClick: (id: string) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: () => void;
}> = ({ point, dimensions, onMarkerClick, onMouseEnter, onMouseLeave }) => {
  const { event, cx, cy, shortCode, isSelected, isHovered, shotCategory } =
    point;
  if (!event.id) return null;

  const eventId = event.id;
  const isHighlighted = isSelected || isHovered;

  let colorClasses = "fill-sky-500 stroke-sky-300";
  if (shotCategory === "goal") {
    colorClasses = "fill-emerald-500 stroke-emerald-300";
  } else if (shotCategory === "conceded_goal") {
    colorClasses = "fill-rose-600 stroke-rose-300";
  } else if (shotCategory === "miss") {
    colorClasses = "fill-amber-400 stroke-amber-200";
  }

  const label =
    event.playerNumber != null ? `${event.playerNumber}` : shortCode;

  let playerPart = "Player";
  if (event.playerNumber != null) {
    playerPart = `Player #${event.playerNumber}`;
    if (event.playerName) {
      playerPart += ` (${event.playerName})`;
    }
  }

  const actionPart = event.eventName || "Shot";
  const periodPart = event.periodNumber ? `, Q${event.periodNumber}` : "";
  const timePart = event.normalizedMatchTime
    ? ` ${formatMatchTime(event.normalizedMatchTime)}`
    : "";

  const ariaLabel = `${playerPart}: ${actionPart}${periodPart}${timePart}`;

  const handleKeyDown = (e: React.KeyboardEvent<SVGGElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      onMarkerClick(eventId);
    }
  };

  const minDim = Math.min(dimensions.width, dimensions.height);
  const baseRadius = Math.min(8, minDim * 0.032);
  const hoverRadius = Math.min(11, minDim * 0.044);
  const radius = isHighlighted ? hoverRadius : baseRadius;
  const strokeWidth = Math.min(2, minDim * 0.01);

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      transform={`translate(${cx}, ${cy})`}
      onClick={(e) => {
        e.stopPropagation();
        onMarkerClick(eventId);
      }}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => onMouseEnter(eventId)}
      onMouseLeave={onMouseLeave}
      className="group cursor-pointer focus:outline-none focus-visible:outline-none"
    >
      <circle
        cx={0}
        cy={0}
        r={radius}
        strokeWidth={strokeWidth}
        style={{ vectorEffect: "non-scaling-stroke" }}
        className={`${colorClasses} shadow-md transition-all duration-150 group-focus-visible:stroke-amber-400 group-focus-visible:stroke-[3px]`}
      />
      <text
        x={0}
        y={3}
        textAnchor="middle"
        className="fill-slate-950 font-mono font-black text-[9px] pointer-events-none select-none"
      >
        {label}
      </text>
    </g>
  );
};

const ShotTooltip: React.FC<{
  activeEvent: GameEventResponse | null;
  isVisible: boolean;
}> = ({ activeEvent, isVisible }) => {
  const [prevActiveEvent, setPrevActiveEvent] =
    useState<GameEventResponse | null>(activeEvent);
  const [displayEvent, setDisplayEvent] = useState<GameEventResponse | null>(
    activeEvent,
  );

  if (activeEvent !== prevActiveEvent) {
    setPrevActiveEvent(activeEvent);
    if (activeEvent) {
      setDisplayEvent(activeEvent);
    }
  }

  if (!displayEvent) return null;

  const locX = Number(displayEvent.shotLocationX ?? 50);
  const locY = Number(100 - Number(displayEvent.shotLocationY ?? 50));
  const headerColor = displayEvent.isPositive
    ? "text-emerald-400"
    : "text-rose-400";

  // Position tooltip below marker for upper half (<45%), above for lower half (>=45%)
  const isNearTop = locY < 45;
  const verticalPositionClass = isNearTop ? "mt-2" : "-translate-y-full -mt-2";

  return (
    <div
      className={`absolute z-30 min-w-36 max-w-48 p-1.5 bg-gray-900/95 border border-gray-700 text-white rounded-lg shadow-xl text-[9.5px] leading-tight backdrop-blur-md select-none transition-all duration-150 transform ${verticalPositionClass} ${
        isVisible
          ? "opacity-100 pointer-events-none"
          : "opacity-0 pointer-events-none invisible"
      }`}
      style={{
        left: `clamp(0.25rem, calc(${locX}% - 4.5rem), calc(100% - 9.5rem))`,
        top: `${Math.max(2, Math.min(98, locY))}%`,
        pointerEvents: "none",
      }}
    >
      {/* Line 1: Player info */}
      <div
        className={`font-bold border-b border-gray-800 pb-0.5 mb-1 truncate ${headerColor}`}
      >
        #{displayEvent.playerNumber ?? "-"}{" "}
        {displayEvent.playerName || "Player"}
      </div>

      {/* Line 2: Period & Match Time paired together on a dedicated line */}
      <div className="font-mono text-amber-400 text-[9px] font-bold mb-0.5">
        Q{displayEvent.periodNumber ?? "-"}
        {displayEvent.normalizedMatchTime
          ? ` ${formatMatchTime(displayEvent.normalizedMatchTime)}`
          : ""}
      </div>

      {/* Line 3: Action Name */}
      <div className="font-semibold text-white truncate text-[9px]">
        {displayEvent.eventName || "Shot"}
      </div>
    </div>
  );
};

export const MatchShotMap: React.FC<MatchShotMapProps> = ({
  events,
  eventDefinitionsMap,
  shotMap,
}) => {
  const safeSvg = useMemo(
    () =>
      shotMap
        ? DOMPurify.sanitize(shotMap, {
            USE_PROFILES: { svg: true, svgFilters: true },
          })
        : null,
    [shotMap],
  );

  const {
    activeEvent,
    renderablePoints,
    dimensions,
    handleMarkerClick,
    handleMarkerMouseEnter,
    handleMarkerMouseLeave,
    handleClearActiveEvent,
  } = useShotMap({
    events,
    eventDefinitionsMap,
    shotMap,
  });

  if (!safeSvg) {
    return null;
  }

  if (!dimensions) {
    return (
      <div className="w-full p-4 bg-gray-900/80 border border-gray-800 rounded-xl text-center text-xs text-gray-400">
        Shot map scheme unavailable
      </div>
    );
  }

  const hasTooltip =
    activeEvent?.shotLocationX != null && activeEvent?.shotLocationY != null;

  return (
    <div
      className="relative w-full bg-blue-950/60 border border-blue-900/60 rounded-2xl select-none overflow-hidden"
      style={{ aspectRatio: dimensions.aspectRatio }}
    >
      <div
        className="w-full h-auto pointer-events-none opacity-90 rounded-2xl overflow-hidden [&>svg]:w-full [&>svg]:h-auto [&>svg]:block"
        dangerouslySetInnerHTML={{ __html: safeSvg }}
      />

      <svg
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        className="absolute inset-0 w-full h-full"
        aria-label="Match Shot Map"
        onClick={handleClearActiveEvent}
      >
        {renderablePoints.map((point) => (
          <ShotMarker
            key={point.event.id}
            point={point}
            dimensions={dimensions}
            onMarkerClick={handleMarkerClick}
            onMouseEnter={handleMarkerMouseEnter}
            onMouseLeave={handleMarkerMouseLeave}
          />
        ))}
      </svg>

      <ShotTooltip activeEvent={activeEvent} isVisible={hasTooltip} />
    </div>
  );
};
