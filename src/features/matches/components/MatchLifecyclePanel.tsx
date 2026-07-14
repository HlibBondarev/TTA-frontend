import React, { useState } from "react";
import { useSelector } from "react-redux";
import { useMatchLifecycle } from "../hooks/useMatchLifecycle";
import { usePlayerPresence } from "../../../features/playerpresences/hooks/usePlayerPresence";
import type { RootState } from "../../../store";

export const MatchLifecyclePanel: React.FC = () => {
  const {
    periodnumber,
    isPeriodActive,
    isInsideStoppage,
    globalSequenceNumber,
    startPeriod,
    endPeriod,
    stopTime,
    startTime,
    nextPeriod,
    prevPeriod,
  } = useMatchLifecycle();

  // Resolve activeMatchId from Redux, fallback to test UUID to prevent errors
  const activeMatchId =
    useSelector((state: RootState) => state.match.activeMatchId) ||
    "6f2e8f1a-7b3c-4d5e-8f9a-0b1c2d3e4f70";

  // Connect player presence tracking hook to lifecycle panel
  const {
    selectedStartingIds,
    activePlayersLimit,
    startPeriodWithRoster,
    endPeriodWithRoster,
  } = usePlayerPresence(activeMatchId);

  const [panelError, setPanelError] = useState<string | null>(null);

  const handleStartPeriod = async () => {
    setPanelError(null);
    if (selectedStartingIds.length !== activePlayersLimit) {
      setPanelError(
        `Please select exactly ${activePlayersLimit} players on the bench first.`,
      );
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      // 1. Commit active lineup to local IndexedDB
      await startPeriodWithRoster(timestamp);
      // 2. Start match timer and period lifecycle
      await startPeriod();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start period.";
      setPanelError(message);
      console.error(error);
    }
  };

  const handleEndPeriod = async () => {
    setPanelError(null);
    try {
      const timestamp = new Date().toISOString();
      // 1. Terminate all active sessions in water and move players back to bench
      await endPeriodWithRoster(timestamp);
      // 2. Stop the period lifecycle timer
      await endPeriod();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to end period.";
      setPanelError(message);
      console.error(error);
    }
  };

  // Enforce validation: cannot start the period unless the starting lineup is complete (exactly 7 players)
  const isStartDisabled =
    isPeriodActive || selectedStartingIds.length !== activePlayersLimit;

  return (
    <div className="p-4 m-4 bg-gray-900 text-white rounded-xl shadow-lg max-w-sm border border-gray-800 w-full">
      {/* Sector 5: Period Control */}
      <div className="mb-6 bg-gray-950 p-4 rounded-lg border border-gray-800">
        <span className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
          Sector 5: Period Control
        </span>

        {panelError && (
          <div className="mb-3 p-2 text-xs bg-red-900/50 border border-red-700 text-red-200 rounded font-sans">
            {panelError}
          </div>
        )}

        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-gray-300">
            Active Period
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={prevPeriod}
              disabled={isPeriodActive}
              className="w-8 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 disabled:opacity-30 rounded font-black transition-all"
            >
              &lt;
            </button>
            <span className="text-xl font-black text-emerald-400 min-w-6 text-center font-mono">
              {periodnumber}
            </span>
            <button
              onClick={nextPeriod}
              disabled={isPeriodActive}
              className="w-8 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 disabled:opacity-30 rounded font-black transition-all"
            >
              &gt;
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleStartPeriod}
            disabled={isStartDisabled}
            className="py-2 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-600 rounded text-xs font-bold uppercase tracking-wider transition-colors"
          >
            Start Period
          </button>
          <button
            onClick={handleEndPeriod}
            disabled={!isPeriodActive || isInsideStoppage}
            className="py-2 px-3 bg-rose-600 hover:bg-rose-500 disabled:bg-gray-800 disabled:text-gray-600 rounded text-xs font-bold uppercase tracking-wider transition-colors"
          >
            End Period
          </button>
        </div>

        {/* Dynamic Coach Helper Guidance */}
        {!isPeriodActive && selectedStartingIds.length < activePlayersLimit && (
          <p className="mt-3 text-[10px] text-amber-400/90 leading-tight">
            ⚠️ Select {activePlayersLimit - selectedStartingIds.length} more
            player(s) on the bench before starting the period.
          </p>
        )}
        {!isPeriodActive &&
          selectedStartingIds.length === activePlayersLimit && (
            <p className="mt-3 text-[10px] text-emerald-400 font-semibold leading-tight animate-pulse">
              ✓ Lineup prepared! Ready to start the period.
            </p>
          )}
      </div>

      {/* Sector 6: Time Control */}
      <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
        <span className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
          Sector 6: Time Control
        </span>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={startTime}
            disabled={!isPeriodActive || !isInsideStoppage}
            className="py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 rounded font-extrabold uppercase tracking-widest text-sm transition-colors"
          >
            Start
          </button>
          <button
            onClick={stopTime}
            disabled={!isPeriodActive || isInsideStoppage}
            className="py-3 px-4 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800 disabled:text-gray-600 rounded font-extrabold uppercase tracking-widest text-sm transition-colors"
          >
            Stop
          </button>
        </div>
      </div>

      {/* Operational Tracker */}
      <div className="mt-4 pt-3 border-t border-gray-800 flex justify-between text-[10px] tracking-wider text-gray-500 font-mono uppercase">
        <span>
          Sequence:{" "}
          <strong className="text-gray-400">#{globalSequenceNumber}</strong>
        </span>
        <span>
          State:
          <strong
            className={`ml-1 ${isPeriodActive ? (isInsideStoppage ? "text-amber-400" : "text-emerald-400") : "text-rose-500"}`}
          >
            {isPeriodActive
              ? isInsideStoppage
                ? "Stopped (Timeout)"
                : "Live Running"
              : "In-active"}
          </strong>
        </span>
      </div>
    </div>
  );
};
