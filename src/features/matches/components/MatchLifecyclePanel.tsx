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
    removeTimeAnchor,
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

    let anchorId: string | null | undefined = null;
    try {
      // Step 1: Log time anchor first to ensure atomic coordination
      anchorId = await startPeriod();

      // Step 2: Initialize roster presence transaction
      await startPeriodWithRoster(new Date().toISOString());
    } catch (err) {
      console.error(err);
      // Compensate if second step fails after first step succeeded
      if (anchorId) {
        await removeTimeAnchor(anchorId);
      }
      setPanelError("Failed to start period. Transaction fully reverted.");
    }
  };

  const handleEndPeriod = async () => {
    setPanelError(null);
    let anchorId: string | null | undefined = null;
    try {
      // Step 1: Log time anchor first
      anchorId = await endPeriod();

      // Step 2: Terminate roster presence transaction
      await endPeriodWithRoster(new Date().toISOString());
    } catch (err) {
      console.error(err);
      // Compensate if second step fails
      if (anchorId) {
        await removeTimeAnchor(anchorId);
      }
      setPanelError("Failed to end period. Transaction fully reverted.");
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
            type="button"
            onClick={prevPeriod}
            disabled={isPeriodActive}
            className="w-6 h-6 min-h-11 min-w-11 bg-gray-800 rounded text-xs hover:bg-gray-700 disabled:opacity-30"
          >
            &lt;
          </button>
          <span className="text-sm font-black text-emerald-400 min-w-4 text-center">
            {periodnumber}
          </span>
          <button
            type="button"
            onClick={nextPeriod}
            disabled={isPeriodActive}
            className="w-6 h-6 min-h-11 min-w-11 bg-gray-800 rounded text-xs hover:bg-gray-700 disabled:opacity-30"
          >
            &gt;
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 mb-2">
        <button
          type="button"
          onClick={handleStartPeriod}
          disabled={
            isPeriodActive || selectedStartingIds.length !== activePlayersLimit
          }
          className="py-1 min-h-11 bg-emerald-700 rounded text-[10px] font-bold uppercase disabled:opacity-30"
        >
          START PERIOD
        </button>
        <button
          type="button"
          onClick={handleEndPeriod}
          disabled={!isPeriodActive}
          className="py-1 min-h-11 bg-rose-700 rounded text-[10px] font-bold uppercase disabled:opacity-30"
        >
          END PERIOD
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={startTime}
          disabled={!isPeriodActive || !isInsideStoppage}
          className="py-1 min-h-11 bg-blue-700 rounded text-[10px] font-bold uppercase disabled:opacity-30"
        >
          Resume
        </button>
        <button
          type="button"
          onClick={stopTime}
          disabled={!isPeriodActive || isInsideStoppage}
          className="py-1 min-h-11 bg-amber-700 rounded text-[10px] font-bold uppercase disabled:opacity-30"
        >
          Stop
        </button>
      </div>
    </div>
  );
};
