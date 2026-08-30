import React from "react";
import type { TeamMatchSummaryReportResponse } from "../../../services/reportService";

export interface TeamSummaryReportViewProps {
  reports: TeamMatchSummaryReportResponse[];
  isLoading: boolean;
  onSelectPlayer: (matchLineupId: string) => void;
}

export const TeamSummaryReportView: React.FC<TeamSummaryReportViewProps> = ({
  reports,
  isLoading,
  onSelectPlayer,
}) => {
  if (isLoading) {
    return (
      <div className="p-8 text-center text-xs sm:text-sm text-gray-400 animate-pulse">
        Loading team summary performance report...
      </div>
    );
  }

  if (!reports || reports.length === 0) {
    return (
      <div className="p-8 text-center text-xs sm:text-sm text-gray-500">
        No report data available for this team.
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-2.5 w-full">
      <div className="text-[11px] text-gray-400 text-center font-medium">
        Tap a player to view detailed TTA event timeline
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-xs text-gray-300 border-collapse min-w-85">
          <thead className="bg-gray-950 text-[9px] sm:text-[10px] uppercase font-bold text-gray-400 border-b border-gray-800 select-none">
            <tr>
              <th className="py-2 px-1.5 text-center w-6">#</th>
              <th className="py-2 px-2">Player</th>
              <th className="py-2 px-1 text-center text-emerald-400">G</th>
              <th className="py-2 px-1 text-center text-blue-400">+TTA</th>
              <th className="py-2 px-1 text-center text-rose-400">-TTA</th>
              <th className="py-2 px-1 text-center text-emerald-300">+GL</th>
              <th className="py-2 px-1 text-center text-rose-400">-GL</th>
              <th className="py-2 px-1.5 text-center text-amber-400">Play%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60 font-mono text-[10px] sm:text-[11px]">
            {reports.map((p) => {
              const fullName =
                `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Player";
              return (
                <tr
                  key={p.matchLineupId}
                  className="hover:bg-gray-800/70 active:bg-gray-700/80 transition-colors"
                >
                  <td className="py-2 px-1.5 text-center font-bold text-gray-400">
                    {p.number ?? "-"}
                  </td>
                  <td className="py-2 px-2 font-sans font-semibold text-gray-100 truncate max-w-28 sm:max-w-36">
                    <button
                      type="button"
                      onClick={() =>
                        p.matchLineupId && onSelectPlayer(p.matchLineupId)
                      }
                      onKeyDown={(e) => {
                        if (
                          (e.key === "Enter" || e.key === " ") &&
                          p.matchLineupId
                        ) {
                          e.preventDefault();
                          onSelectPlayer(p.matchLineupId);
                        }
                      }}
                      className="text-left font-sans font-semibold text-gray-100 hover:text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:text-emerald-400 rounded transition-colors"
                    >
                      {fullName}
                    </button>
                  </td>
                  <td className="py-2 px-1 text-center font-bold text-emerald-400">
                    {p.goals ?? 0}
                  </td>
                  <td className="py-2 px-1 text-center text-blue-300">
                    {p.totalPositiveActions ?? 0}
                  </td>
                  <td className="py-2 px-1 text-center text-rose-300">
                    {p.totalNegativeActions ?? 0}
                  </td>
                  <td className="py-2 px-1 text-center text-emerald-300 font-bold">
                    {p.positiveGoalLeadingActions ?? 0}
                  </td>
                  <td className="py-2 px-1 text-center text-rose-400 font-bold">
                    {p.negativeGoalLeadingActions ?? 0}
                  </td>
                  <td className="py-2 px-1.5 text-center font-bold text-amber-300">
                    {(p.playPercentage ?? 0).toFixed(0)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
