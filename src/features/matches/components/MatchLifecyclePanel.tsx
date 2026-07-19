import React, { useState } from "react";
import { useSelector } from "react-redux";
import { useMatchLifecycle } from "../hooks/useMatchLifecycle";
import { usePlayerPresence } from "../../../features/playerpresences/hooks/usePlayerPresence";
import type { RootState } from "../../../store";
import { TEST_MATCH_ID } from "../../../App";

export const MatchLifecyclePanel: React.FC = () => {
  const {
    periodnumber,
    isPeriodActive,
    isInsideStoppage,
    startPeriod,
    endPeriod,
    stopTime,
    startTime,
    nextPeriod,
    prevPeriod,
  } = useMatchLifecycle();
  const activeMatchId =
    useSelector((state: RootState) => state.match.activeMatchId) ||
    TEST_MATCH_ID;
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
      setPanelError(`Select exactly ${activePlayersLimit} players.`);
      return;
    }
    try {
      // Atomic operation: commit roster to DB first, then update lifecycle state
      await startPeriodWithRoster(new Date().toISOString());
      await startPeriod();
    } catch {
      // Error handling without unused variables
      setPanelError("Failed to start period. Please try again.");
    }
  };

  const handleEndPeriod = async () => {
    setPanelError(null);
    try {
      // Atomic operation: terminate presence in DB first, then update lifecycle state
      await endPeriodWithRoster(new Date().toISOString());
      await endPeriod();
    } catch {
      // Error handling without unused variables
      setPanelError("Failed to end period. Please try again.");
    }
  };

  return (
    <div className="w-full bg-gray-900 text-white rounded-xl border border-gray-800 p-2">
      {panelError && (
        <div
          role="alert"
          className="mb-2 p-1 text-[10px] bg-red-900/50 text-red-200 rounded"
        >
          {panelError}
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-300">Period</span>
        <div className="flex items-center gap-2">
          <button
            onClick={prevPeriod}
            disabled={isPeriodActive}
            className="w-6 h-6 bg-gray-800 rounded text-xs hover:bg-gray-700 disabled:opacity-30"
          >
            &lt;
          </button>
          <span className="text-sm font-black text-emerald-400 min-w-4 text-center">
            {periodnumber}
          </span>
          <button
            onClick={nextPeriod}
            disabled={isPeriodActive}
            className="w-6 h-6 bg-gray-800 rounded text-xs hover:bg-gray-700 disabled:opacity-30"
          >
            &gt;
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 mb-2">
        <button
          onClick={handleStartPeriod}
          disabled={
            isPeriodActive || selectedStartingIds.length !== activePlayersLimit
          }
          className="py-1 bg-emerald-700 rounded text-[10px] font-bold uppercase disabled:opacity-30"
        >
          START PERIOD
        </button>
        <button
          onClick={handleEndPeriod}
          disabled={!isPeriodActive}
          className="py-1 bg-rose-700 rounded text-[10px] font-bold uppercase disabled:opacity-30"
        >
          END PERIOD
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <button
          onClick={startTime}
          disabled={!isPeriodActive || !isInsideStoppage}
          className="py-1 bg-blue-700 rounded text-[10px] font-bold uppercase disabled:opacity-30"
        >
          Resume
        </button>
        <button
          onClick={stopTime}
          disabled={!isPeriodActive || isInsideStoppage}
          className="py-1 bg-amber-700 rounded text-[10px] font-bold uppercase disabled:opacity-30"
        >
          Stop
        </button>
      </div>
    </div>
  );
};
