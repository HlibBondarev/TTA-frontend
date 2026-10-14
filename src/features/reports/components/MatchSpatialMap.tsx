import React from "react";
import type { GameEventResponse } from "../../../services/reportService";
import type { EventDefinitionLookup } from "../../../db/ttaDatabase";
import { useSpatialMap } from "../hooks/useSpatialMap";

export interface MatchSpatialMapProps {
  events: GameEventResponse[];
  eventDefinitionsMap: Map<string, EventDefinitionLookup>;
  playgroundSvg?: string | null;
  showGoalLeadVectors?: boolean;
}

export const MatchSpatialMap: React.FC<MatchSpatialMapProps> = ({
  events,
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
  } = useSpatialMap({ events, eventDefinitionsMap });

  return (
    <div className="relative w-full aspect-5/3 bg-blue-950/60 border border-blue-900/60 rounded-2xl overflow-hidden select-none">
      {/* Background Court Layout */}
      {playgroundSvg ? (
        <div
          className="absolute inset-0 w-full h-full pointer-events-none opacity-50"
          dangerouslySetInnerHTML={{ __html: playgroundSvg }}
        />
      ) : (
        /* Full Regulation Water Polo Court SVG Layout */
        <svg
          viewBox="0 0 1000 600"
          className="absolute inset-0 w-full h-full pointer-events-none fill-none"
        >
          {/* Pool Outer Boundary & Water Fill */}
          <rect
            x="2"
            y="2"
            width="996"
            height="596"
            className="fill-sky-950/80 stroke-sky-500/50"
            strokeWidth="4"
            rx="8"
          />

          {/* Red 2-Meter Lines (6.7% from goals = x:67 & x:933) */}
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

          {/* Red 2-Meter Penalty Goal Boxes */}
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

          {/* Yellow 5-Meter Penalty Shot Lines (16.7% from goals = x:167 & x:833) */}
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

          {/* Green 6-Meter Lines (20% from goals = x:200 & x:800) */}
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

          {/* Halfway / Center Line (White x:500) */}
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

          {/* Goal Post Areas */}
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

          {/* Side Boundary Cones / Dots */}
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
      )}

      {/* SVG Interactive Overlay Layer */}
      <svg viewBox="0 0 1000 600" className="absolute inset-0 w-full h-full">
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

        {/* Directional Vectors Connecting Assist to Goal */}
        {showGoalLeadVectors &&
          goalLeadVectors.map((v) => (
            <g key={v.id}>
              <line
                x1={v.x1}
                y1={v.y1}
                x2={v.x2}
                y2={v.y2}
                stroke={v.isPositive ? "#10b981" : "#f43f5e"}
                strokeWidth="2.5"
                strokeDasharray="6 4"
                markerEnd={
                  v.isPositive ? "url(#arrow-emerald)" : "url(#arrow-rose)"
                }
                className="opacity-80"
              />
              <circle
                cx={v.x2}
                cy={v.y2}
                r="4"
                fill={v.isPositive ? "#10b981" : "#f43f5e"}
              />
            </g>
          ))}

        {/* Action Event Point Markers */}
        {renderablePoints.map(
          ({ event, cx, cy, shortCode, isSelected, isHovered }) => {
            if (!event.id) return null;
            const eventId = event.id;
            const isHighlighted = isSelected || isHovered;

            return (
              <g
                key={eventId}
                onClick={() => handleMarkerClick(eventId)}
                onMouseEnter={() => handleMarkerMouseEnter(eventId)}
                onMouseLeave={handleMarkerMouseLeave}
                className="cursor-pointer"
              >
                {event.isLeadToGoal && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isHighlighted ? "22" : "18"}
                    className="fill-none stroke-amber-400 stroke-2 animate-ping opacity-75"
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHighlighted ? "17" : "13"}
                  className={`${
                    event.isPositive
                      ? "fill-emerald-500 stroke-emerald-300"
                      : "fill-rose-600 stroke-rose-300"
                  } stroke-2 shadow-lg transition-all duration-150`}
                />
                <text
                  x={cx}
                  y={cy + 4}
                  textAnchor="middle"
                  className="fill-white font-mono font-black text-[10px] pointer-events-none select-none"
                >
                  {event.playerNumber != null
                    ? `#${event.playerNumber}`
                    : shortCode}
                </text>
              </g>
            );
          },
        )}
      </svg>

      {/* Active Event Hover / Selection Tooltip */}
      {activeEvent &&
        activeEvent.locationX != null &&
        activeEvent.locationY != null && (
          <div
            className={`absolute z-20 p-2.5 bg-gray-900/95 border border-gray-700 text-white rounded-xl shadow-2xl text-[11px] backdrop-blur-md pointer-events-none transition-all duration-150 ${
              Number(activeEvent.locationY) < 25
                ? "transform -translate-x-1/2 translate-y-4"
                : "transform -translate-x-1/2 -translate-y-full -mt-3"
            }`}
            style={{
              left: `${activeEvent.locationX}%`,
              top: `${activeEvent.locationY}%`,
            }}
          >
            <div className="flex items-center space-x-1.5 font-bold text-emerald-400 border-b border-gray-800 pb-1 mb-1">
              <span>#{activeEvent.playerNumber ?? "-"}</span>
              <span>{activeEvent.playerName || "Player"}</span>
            </div>
            <div className="space-y-0.5 text-gray-300">
              <div>
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
                    {activeEvent.normalizedMatchTime}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
    </div>
  );
};
