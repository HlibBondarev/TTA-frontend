import React from "react";
import { useSpatialReport } from "../hooks/useSpatialReport";
import { MatchSpatialMap } from "./MatchSpatialMap";
import { MatchShotMap } from "./MatchShotMap";

export interface MatchSpatialReportViewProps {
  matchId: string;
  teamId?: string;
  playground?: string | null;
  shotMap?: string | null;
  onBack?: () => void;
}

export const MatchSpatialReportView: React.FC<MatchSpatialReportViewProps> = ({
  matchId,
  teamId,
  playground,
  shotMap,
  onBack,
}) => {
  const {
    events,
    filteredEvents,
    teamLineups,
    eventDefinitionsMap,
    playground: effectivePlayground,
    shotMap: effectiveShotMap,
    filters,
    isLoading,
    error,
    togglePeriodFilter,
    togglePlayerSelection,
    handleSelectAllPlayers,
    toggleActiveTab,
    togglePositiveDefSelection,
    toggleNegativeDefSelection,
    toggleGoalLeadVectors,
    toggleMapMode,
  } = useSpatialReport({ matchId, teamId, playground, shotMap });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-6 text-xs text-gray-400">
        Loading spatial analytics map...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 space-y-2 text-center">
        <div
          role="alert"
          className="p-2 text-xs bg-red-900/50 border border-red-800 text-red-200 rounded"
        >
          {error}
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-xs font-bold rounded"
          >
            Back
          </button>
        )}
      </div>
    );
  }

  const positiveDefIds = Array.from(
    new Set(
      events
        .filter((e) => e.isPositive && e.eventDefinitionId)
        .map((e) => e.eventDefinitionId!),
    ),
  );

  const negativeDefIds = Array.from(
    new Set(
      events
        .filter((e) => !e.isPositive && e.eventDefinitionId)
        .map((e) => e.eventDefinitionId!),
    ),
  );

  const renderMapContent = () => {
    if (filters.mapMode === "shot") {
      if (effectiveShotMap) {
        return (
          <MatchShotMap
            events={filteredEvents}
            eventDefinitionsMap={eventDefinitionsMap}
            shotMap={effectiveShotMap}
          />
        );
      }
      return (
        <div className="w-full p-4 text-center text-xs text-slate-400 bg-gray-950/80 border border-gray-800 rounded-2xl">
          Goal Shot Map SVG is unavailable for this match.
        </div>
      );
    }

    return (
      <MatchSpatialMap
        events={filteredEvents}
        allEvents={events}
        eventDefinitionsMap={eventDefinitionsMap}
        playground={effectivePlayground}
        shotMap={effectiveShotMap}
        showGoalLeadVectors={filters.showGoalLeadVectors}
      />
    );
  };

  return (
    <div className="flex flex-col space-y-2 text-white text-xs">
      {/* Top Header Actions Count & Controls */}
      <div className="flex items-center justify-between bg-gray-950 p-1.5 rounded-xl border border-gray-800">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-[10px] font-bold rounded-lg transition-colors"
          >
            ← BACK
          </button>
        )}
        <span className="text-[10px] text-gray-400 font-mono ml-auto">
          Actions:{" "}
          <strong className="text-emerald-400">{filteredEvents.length}</strong>{" "}
          / {events.length}
        </span>
      </div>

      {/* Map Mode Toggle */}
      <div className="space-y-1">
        <div className="flex bg-gray-950 p-1 rounded-xl border border-gray-800 gap-1">
          <button
            type="button"
            onClick={() => toggleMapMode("field")}
            className={`flex-1 py-1 text-[10px] font-bold rounded-lg transition-colors ${
              filters.mapMode === "field"
                ? "bg-indigo-600 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Field Map
          </button>
          <button
            type="button"
            onClick={() => toggleMapMode("shot")}
            className={`flex-1 py-1 text-[10px] font-bold rounded-lg transition-colors ${
              filters.mapMode === "shot"
                ? "bg-indigo-600 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Shot Map
          </button>
        </div>
      </div>

      {/* Color Indicators Legend for Shot Map Mode */}
      {filters.mapMode === "shot" && (
        <div className="flex items-center justify-around p-1 bg-gray-950/80 rounded-xl border border-gray-800 text-[9px] font-bold">
          <div className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 border border-emerald-300" />
            <span className="text-emerald-300">Goal</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-sky-500 border border-sky-300" />
            <span className="text-sky-300">Shot on Goal</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-amber-400 border border-amber-200" />
            <span className="text-amber-300">Missed</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-rose-600 border border-rose-300" />
            <span className="text-rose-300">Conceded</span>
          </div>
        </div>
      )}

      {/* Periods Filter */}
      <div className="space-y-0.5">
        <span className="text-[9px] uppercase text-gray-500 font-bold block">
          Period:
        </span>
        <div className="flex gap-1 bg-gray-950 p-0.5 rounded-xl border border-gray-800">
          {[null, 1, 2, 3, 4].map((p) => {
            const label = p === null ? "All" : `Q${p}`;
            const isSelected = filters.periodNumber === p;
            return (
              <button
                key={label}
                type="button"
                onClick={() => togglePeriodFilter(p)}
                className={`flex-1 py-0.5 text-[10px] font-bold rounded-lg transition-colors ${
                  isSelected
                    ? "bg-indigo-600 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Players Filter */}
      <div className="space-y-0.5">
        <div className="flex justify-between items-center text-[9px]">
          <span className="uppercase text-gray-500 font-bold">
            Players Filter
          </span>
          <button
            type="button"
            onClick={handleSelectAllPlayers}
            className="text-indigo-400 hover:underline text-[9px]"
          >
            Select All
          </button>
        </div>

        <div className="flex flex-wrap gap-1 max-h-14 overflow-y-auto pr-0.5">
          {teamLineups.map((lineup) => {
            const isSelected =
              filters.selectedLineupIds.length === 0 ||
              filters.selectedLineupIds.includes(lineup.id);
            return (
              <button
                key={lineup.id}
                type="button"
                onClick={() => togglePlayerSelection(lineup.id)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-colors ${
                  isSelected
                    ? "bg-emerald-950 border-emerald-500 text-emerald-300"
                    : "bg-gray-900 border-gray-800 text-gray-500"
                }`}
              >
                #{lineup.number}
              </button>
            );
          })}
        </div>
      </div>

      {/* Category Tabs: All / Positive / Negative / Vectors */}
      <div className="space-y-1.5">
        <div className="flex bg-gray-950 p-0.5 rounded-xl border border-gray-800 gap-1 items-center">
          {(["all", "positive", "negative"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => toggleActiveTab(tab)}
              className={`flex-1 py-0.5 text-[10px] font-bold capitalize rounded-lg transition-colors ${
                filters.activeTab === tab
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab}
            </button>
          ))}
          {filters.mapMode === "field" && (
            <button
              type="button"
              onClick={toggleGoalLeadVectors}
              className={`px-2 py-0.5 text-[9px] font-bold rounded-lg border transition-colors ${
                filters.showGoalLeadVectors
                  ? "bg-emerald-950 border-emerald-600 text-emerald-300"
                  : "bg-gray-900 border-gray-800 text-gray-500"
              }`}
            >
              Vectors {filters.showGoalLeadVectors ? "ON" : "OFF"}
            </button>
          )}
        </div>

        {/* Action Definition Sub-Filter Chips */}
        {(filters.activeTab === "all" || filters.activeTab === "positive") &&
          positiveDefIds.length > 0 && (
            <div className="flex flex-wrap gap-1 p-1 bg-gray-950/60 rounded-xl border border-gray-800/80">
              <span className="w-full text-[8px] uppercase text-emerald-400 font-bold">
                + Positive Actions
              </span>
              {positiveDefIds.map((defId) => {
                const def = eventDefinitionsMap.get(defId);
                const isSelected =
                  filters.selectedPositiveDefIds.length === 0 ||
                  filters.selectedPositiveDefIds.includes(defId);
                return (
                  <button
                    key={defId}
                    type="button"
                    onClick={() => togglePositiveDefSelection(defId)}
                    className={`px-1.5 py-0.5 text-[8px] font-semibold rounded border transition-colors ${
                      isSelected
                        ? "bg-emerald-900/60 border-emerald-600 text-emerald-200"
                        : "bg-gray-900 border-gray-800 text-gray-500"
                    }`}
                  >
                    {def?.name || "Action"}
                  </button>
                );
              })}
            </div>
          )}

        {(filters.activeTab === "all" || filters.activeTab === "negative") &&
          negativeDefIds.length > 0 && (
            <div className="flex flex-wrap gap-1 p-1 bg-gray-950/60 rounded-xl border border-gray-800/80">
              <span className="w-full text-[8px] uppercase text-red-400 font-bold">
                - Negative Actions
              </span>
              {negativeDefIds.map((defId) => {
                const def = eventDefinitionsMap.get(defId);
                const isSelected =
                  filters.selectedNegativeDefIds.length === 0 ||
                  filters.selectedNegativeDefIds.includes(defId);
                return (
                  <button
                    key={defId}
                    type="button"
                    onClick={() => toggleNegativeDefSelection(defId)}
                    className={`px-1.5 py-0.5 text-[8px] font-semibold rounded border transition-colors ${
                      isSelected
                        ? "bg-red-900/60 border-red-600 text-red-200"
                        : "bg-gray-900 border-gray-800 text-gray-500"
                    }`}
                  >
                    {def?.name || "Action"}
                  </button>
                );
              })}
            </div>
          )}
      </div>

      {/* Render Field Map vs Shot Map Component */}
      {renderMapContent()}
    </div>
  );
};
