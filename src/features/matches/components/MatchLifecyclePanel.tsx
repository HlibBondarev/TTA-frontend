import React, { useState } from "react";
import { useSelector } from "react-redux";
import { useMatchLifecycle } from "../hooks/useMatchLifecycle";
import { usePlayerPresence } from "../../../features/playerpresences/hooks/usePlayerPresence";
import { MatchResultModal } from "./MatchResultModal";
import type { RootState } from "../../../store";

interface MatchLifecyclePanelProps {
  onFinalizeSuccess?: () => void;
}

export const MatchLifecyclePanel: React.FC<MatchLifecyclePanelProps> = ({
  onFinalizeSuccess,
}) => {
  const {
    periodNumber,
    isPeriodActive,
    isInsideStoppage,
    isPeriodEnded,
    canUndoEndPeriod,
    periodsCount,
    isLoadingConfig,
    configError,
    isResultModalOpen,
    setIsResultModalOpen,
    startPeriod,
    endPeriod,
    revertStartPeriod,
    revertEndPeriod,
    stopTime,
    startTime,
    prevPeriod,
    syncPeriodStateWithDB,
  } = useMatchLifecycle();

  const activeMatchId = useSelector(
    (state: RootState) => state.match.activeMatchId || "",
  );

  const {
    selectedStartingIds,
    activePlayersLimit,
    startPeriodWithRoster,
    endPeriodWithRoster,
    refreshPresenceFromDB,
  } = usePlayerPresence(activeMatchId);

  const [panelError, setPanelError] = useState<string | null>(null);

  const handleStartPeriod = async (targetPeriod?: number) => {
    setPanelError(null);
    if (selectedStartingIds.length !== activePlayersLimit) {
      setPanelError(`Select exactly ${activePlayersLimit} players.`);
      return;
    }

    const effectivePeriod = targetPeriod ?? periodNumber;
    let anchorId: string | null | undefined = null;

    try {
      // Step 1: Log time anchor first to ensure atomic coordination
      anchorId = await startPeriod(targetPeriod);

      // Step 2: Initialize roster presence transaction for the TARGET period explicitly
      await startPeriodWithRoster(new Date().toISOString(), effectivePeriod);
    } catch (err) {
      console.error(err);
      try {
        if (anchorId) {
          await revertStartPeriod(anchorId);
        }
        if (targetPeriod && targetPeriod > 1) {
          prevPeriod();
          if (activeMatchId) {
            await syncPeriodStateWithDB(activeMatchId, targetPeriod - 1);
          }
        }
        await refreshPresenceFromDB(effectivePeriod);
        setPanelError("Failed to start period. Transaction fully reverted.");
      } catch (compensationErr) {
        console.error("Compensation failed:", compensationErr);
        setPanelError("Failed to start period. Compensation incomplete.");
      }
    }
  };

  const handleEndPeriod = async () => {
    setPanelError(null);
    let anchorId: string | null | undefined = null;
    try {
      // Step 1: Log time anchor first and receive final-period status
      const endResult = await endPeriod();
      anchorId = endResult?.anchorId;

      // Step 2: Terminate roster presence transaction for current period
      await endPeriodWithRoster(new Date().toISOString(), periodNumber);

      // Step 3: Open result modal ONLY after successful roster termination on final period
      if (endResult?.isFinal) {
        setIsResultModalOpen(true);
      }
    } catch (err) {
      console.error(err);
      try {
        if (anchorId) {
          await revertEndPeriod(anchorId);
        }
        await refreshPresenceFromDB(periodNumber);
        setPanelError("Failed to end period. Transaction fully reverted.");
      } catch (compensationErr) {
        console.error("Compensation failed:", compensationErr);
        setPanelError("Failed to end period. Compensation incomplete.");
      }
    }
  };

  const handleUndoEndPeriod = async () => {
    setPanelError(null);
    try {
      await revertEndPeriod();
      await refreshPresenceFromDB(periodNumber);
    } catch (err) {
      console.error("Failed to undo end period:", err);
      setPanelError("Failed to undo end period.");
    }
  };

  const displayError = panelError || configError;
  const isConfigDisabled =
    isLoadingConfig || periodsCount === null || Boolean(configError);
  const hasReachedMaxPeriods =
    periodsCount !== null && periodNumber >= periodsCount;

  return (
    <div className="w-full bg-gray-900 text-white rounded-xl border border-gray-800 p-2">
      {displayError && (
        <div
          role="alert"
          className="mb-2 p-1 text-[10px] bg-red-900/50 text-red-200 rounded"
        >
          {displayError}
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-300">Period</span>
        <span className="text-sm font-black text-emerald-400 min-w-4 text-center">
          {isLoadingConfig ? "..." : periodNumber}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1 mb-2">
        {!isPeriodEnded ? (
          <>
            <button
              type="button"
              onClick={() => handleStartPeriod()}
              disabled={isPeriodActive || isConfigDisabled}
              className="py-1 min-h-11 bg-emerald-700 rounded text-[10px] font-bold uppercase disabled:opacity-30"
            >
              START PERIOD
            </button>
            <button
              type="button"
              onClick={handleEndPeriod}
              disabled={!isPeriodActive || isInsideStoppage || isConfigDisabled}
              className="py-1 min-h-11 bg-rose-700 rounded text-[10px] font-bold uppercase disabled:opacity-30"
            >
              END PERIOD
            </button>
          </>
        ) : (
          <>
            {!hasReachedMaxPeriods ? (
              <button
                type="button"
                onClick={() => handleStartPeriod(periodNumber + 1)}
                disabled={isConfigDisabled}
                className="py-1 min-h-11 bg-emerald-700 hover:bg-emerald-600 rounded text-[10px] font-bold uppercase disabled:opacity-30"
              >
                START PERIOD {periodNumber + 1}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsResultModalOpen(true)}
                disabled={isConfigDisabled}
                className="py-1 min-h-11 bg-emerald-800 hover:bg-emerald-700 rounded text-[10px] font-bold uppercase disabled:opacity-30"
              >
                MATCH ENDED
              </button>
            )}

            {canUndoEndPeriod ? (
              <button
                type="button"
                onClick={handleUndoEndPeriod}
                disabled={isConfigDisabled}
                className="py-1 min-h-11 bg-amber-700 hover:bg-amber-600 rounded text-[10px] font-bold uppercase disabled:opacity-30"
              >
                UNDO END PERIOD {periodNumber}
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="py-1 min-h-11 bg-rose-700 rounded text-[10px] font-bold uppercase opacity-30"
              >
                END PERIOD
              </button>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={startTime}
          disabled={!isPeriodActive || !isInsideStoppage || isConfigDisabled}
          className="py-1 min-h-11 bg-blue-700 rounded text-[10px] font-bold uppercase disabled:opacity-30"
        >
          Resume
        </button>
        <button
          type="button"
          onClick={stopTime}
          disabled={!isPeriodActive || isInsideStoppage || isConfigDisabled}
          className="py-1 min-h-11 bg-amber-700 rounded text-[10px] font-bold uppercase disabled:opacity-30"
        >
          Stop
        </button>
      </div>

      <MatchResultModal
        isOpen={isResultModalOpen}
        onClose={() => setIsResultModalOpen(false)}
        onSuccess={onFinalizeSuccess}
      />
    </div>
  );
};
