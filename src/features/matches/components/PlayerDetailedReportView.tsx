import React from "react";
import type { PlayerDetailedMatchReportResponse } from "../../../services/reportService";

export interface PlayerDetailedReportViewProps {
  report: PlayerDetailedMatchReportResponse | null;
  isLoading: boolean;
  onBack: () => void;
}

const formatEventTime = (
  normalizedTime?: string | null,
  timestamp?: string | null,
): string => {
  if (normalizedTime) {
    return normalizedTime;
  }
  if (timestamp) {
    return new Date(timestamp).toLocaleTimeString();
  }
  return "-";
};

export const PlayerDetailedReportView: React.FC<
  PlayerDetailedReportViewProps
> = ({ report, isLoading, onBack }) => {
  if (isLoading) {
    return (
      <div className="p-8 text-center text-xs sm:text-sm text-gray-400 animate-pulse">
        Loading player detailed report...
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-6 text-center text-xs sm:text-sm text-gray-500 flex flex-col space-y-4">
        <span>Failed to load player report details.</span>
        <button
          type="button"
          onClick={onBack}
          className="self-center px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-bold"
        >
          Back to Team Summary
        </button>
      </div>
    );
  }

  const fullName =
    `${report.firstName ?? ""} ${report.lastName ?? ""}`.trim() || "Player";
  const events = report.events ?? [];

  // 1. Calculate aggregated TTA summaries (Positive vs Negative counts)
  const positiveSummary: Record<string, number> = {};
  const negativeSummary: Record<string, number> = {};

  events.forEach((ev) => {
    const name = ev.eventName ?? "Action";
    if (ev.isPositive) {
      positiveSummary[name] = (positiveSummary[name] || 0) + 1;
    } else {
      negativeSummary[name] = (negativeSummary[name] || 0) + 1;
    }
  });

  // 2. Group events chronologically by Period Number
  const eventsByPeriod = events.reduce<Record<number, typeof events>>(
    (acc, ev) => {
      const period = ev.periodNumber ?? 1;
      if (!acc[period]) acc[period] = [];
      acc[period].push(ev);
      return acc;
    },
    {},
  );

  // Sort events within each period ascending by normalizedMatchTime, falling back to eventTimestamp
  Object.values(eventsByPeriod).forEach((periodEvents) => {
    periodEvents.sort((a, b) => {
      const timeA = a.normalizedMatchTime ?? a.eventTimestamp ?? "";
      const timeB = b.normalizedMatchTime ?? b.eventTimestamp ?? "";
      return timeA.localeCompare(timeB);
    });
  });

  const sortedPeriods = Object.keys(eventsByPeriod)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div className="flex flex-col space-y-3.5 w-full text-white">
      {/* Header with Back button and Player Info */}
      <div className="flex items-center justify-between border-b border-gray-800 pb-2.5">
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold text-xs uppercase rounded-lg transition-colors border border-gray-700"
        >
          ← Back
        </button>
        <div className="text-right">
          <h4 className="text-xs sm:text-sm font-black text-emerald-400 uppercase">
            #{report.number ?? "-"} {fullName}
          </h4>
          <span className="text-[10px] text-gray-400">
            Total Actions: {events.length}
          </span>
        </div>
      </div>

      {/* TTA Summary Cards (Positive & Negative Totals) */}
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        {/* Positive TTA Summary Card */}
        <div className="bg-emerald-950/40 border border-emerald-900/60 p-2 rounded-xl flex flex-col space-y-1">
          <span className="text-[9px] font-black uppercase text-emerald-400 border-b border-emerald-900/50 pb-1">
            + Positive Actions
          </span>
          {Object.keys(positiveSummary).length === 0 ? (
            <span className="text-gray-500 italic text-[9px]">None</span>
          ) : (
            <ul className="space-y-0.5 max-h-20 overflow-y-auto pr-0.5">
              {Object.entries(positiveSummary).map(([action, count]) => (
                <li
                  key={action}
                  className="flex justify-between items-center text-gray-200"
                >
                  <span className="truncate max-w-22.5">{action}:</span>
                  <span className="font-mono font-bold text-emerald-300">
                    {count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Negative TTA Summary Card */}
        <div className="bg-rose-950/40 border border-rose-900/60 p-2 rounded-xl flex flex-col space-y-1">
          <span className="text-[9px] font-black uppercase text-rose-400 border-b border-rose-900/50 pb-1">
            - Negative Actions
          </span>
          {Object.keys(negativeSummary).length === 0 ? (
            <span className="text-gray-500 italic text-[9px]">None</span>
          ) : (
            <ul className="space-y-0.5 max-h-20 overflow-y-auto pr-0.5">
              {Object.entries(negativeSummary).map(([action, count]) => (
                <li
                  key={action}
                  className="flex justify-between items-center text-gray-200"
                >
                  <span className="truncate max-w-22.5">{action}:</span>
                  <span className="font-mono font-bold text-rose-300">
                    {count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Events Chronology Stream Header */}
      <div className="text-[10px] font-bold uppercase text-gray-400 border-b border-gray-800/80 pb-1">
        Match Events Timeline
      </div>

      {sortedPeriods.length === 0 ? (
        <div className="p-4 text-center text-xs text-gray-500">
          No events recorded for this player during the match.
        </div>
      ) : (
        <div className="space-y-3 max-h-60 sm:max-h-80 overflow-y-auto pr-1">
          {sortedPeriods.map((period) => (
            <div key={period} className="space-y-1.5">
              <div className="sticky top-0 bg-gray-900/95 backdrop-blur-sm px-2 py-0.5 border-b border-gray-800 text-[10px] font-bold uppercase text-blue-400 tracking-wider">
                Period {period}
              </div>
              <div className="space-y-1">
                {eventsByPeriod[period].map((ev, index) => (
                  <div
                    key={`${ev.eventTimestamp ?? index}-${index}`}
                    className="flex items-center justify-between p-2 rounded-lg bg-gray-950/80 border border-gray-800/80 text-xs"
                  >
                    <div className="flex items-center space-x-1.5">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          ev.isPositive ? "bg-emerald-400" : "bg-rose-500"
                        }`}
                      />
                      <span className="font-semibold text-gray-200 text-[11px] truncate max-w-32 sm:max-w-44">
                        {ev.eventName ?? "Event"}
                      </span>

                      {/* Goal Lead Badge with distinctive styling for positive (+) vs negative (-) */}
                      {ev.isLeadToGoal && (
                        <span
                          className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border shrink-0 ${
                            ev.isPositive
                              ? "bg-emerald-950/90 text-emerald-300 border-emerald-800"
                              : "bg-rose-950/90 text-rose-300 border-rose-800"
                          }`}
                        >
                          {ev.isPositive ? "+Goal Lead" : "-Goal Lead"}
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-gray-400 shrink-0">
                      {formatEventTime(
                        ev.normalizedMatchTime,
                        ev.eventTimestamp,
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
