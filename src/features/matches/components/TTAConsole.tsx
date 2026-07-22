import React, { useState } from "react";
import { useSelector } from "react-redux";
import { MatchLifecyclePanel } from "./MatchLifecyclePanel";
import { PlayerPresencePanel } from "../../../features/playerpresences/components/PlayerPresencePanel";
import { ActionsLog } from "./ActionsLog";
import { TTDActionsPanel } from "./TTAPanel";
import { useMatchLifecycle } from "../hooks/useMatchLifecycle";
import { useGameEvents } from "../hooks/useGameEvents";
import type { RootState } from "../../../store";

export const TTAConsole: React.FC = () => {
  const activeMatchId = useSelector(
    (state: RootState) => state.match.activeMatchId,
  );
  const { periodnumber, isPeriodActive, isInsideStoppage } =
    useMatchLifecycle();

  const { recordGameEvent } = useGameEvents(activeMatchId || "");

  const [pendingAction, setPendingAction] = useState<{
    name: string;
    isPositive: boolean;
  } | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [consoleError, setConsoleError] = useState<string | null>(null);

  // Use state to track the "current" period to detect changes
  const [prevPeriod, setPrevPeriod] = useState(periodnumber);

  // If the period from props/hooks changes, reset state and update prevPeriod
  if (periodnumber !== prevPeriod) {
    setPrevPeriod(periodnumber);
    setPendingAction(null);
    setSelectedPlayerId(null);
    setConsoleError(null);
  }

  const isRecordingEnabled = isPeriodActive && !isInsideStoppage;

  const handleEnter = async () => {
    if (pendingAction && selectedPlayerId && activeMatchId) {
      setConsoleError(null);
      try {
        await recordGameEvent({
          selectedPlayerId,
          actionName: pendingAction.name,
          isPositive: pendingAction.isPositive,
        });

        // Clear selections only after successful DB persistence
        setPendingAction(null);
        setSelectedPlayerId(null);
      } catch (err: unknown) {
        console.error("Failed to record game event:", err);
        setConsoleError(
          err instanceof Error
            ? err.message
            : "Failed to record action into database.",
        );
      }
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto flex flex-col h-screen pb-safe overflow-hidden">
      <header className="text-center py-2 border-b border-gray-800">
        <h1 className="text-xl font-black uppercase text-blue-500">
          TTA Match Recorder
        </h1>
      </header>
      {activeMatchId ? (
        <div className="flex flex-col flex-1 overflow-hidden">
          {consoleError && (
            <div
              role="alert"
              className="mx-2 mt-2 p-1.5 text-[11px] bg-red-900/50 border border-red-800 text-red-200 rounded text-center font-medium"
            >
              {consoleError}
            </div>
          )}
          <div className="flex-1 overflow-y-auto w-full px-2 space-y-2">
            <MatchLifecyclePanel />

            <ActionsLog />

            <PlayerPresencePanel
              key={periodnumber}
              matchId={activeMatchId}
              selectedPlayerId={selectedPlayerId}
              setSelectedPlayerId={setSelectedPlayerId}
            />

            <TTDActionsPanel
              disabled={!isRecordingEnabled}
              selectedAction={pendingAction?.name || null}
              onActionSelect={(name, isPositive) => {
                setConsoleError(null);
                setPendingAction({ name, isPositive });
              }}
            />
          </div>
          <button
            type="button"
            onClick={handleEnter}
            disabled={
              !isRecordingEnabled || !pendingAction || !selectedPlayerId
            }
            className="w-full py-4 bg-blue-600 disabled:bg-gray-800 text-white font-black uppercase rounded-lg"
          >
            Enter
          </button>
        </div>
      ) : (
        <div className="p-6 text-center text-gray-500">No active match.</div>
      )}
    </div>
  );
};
