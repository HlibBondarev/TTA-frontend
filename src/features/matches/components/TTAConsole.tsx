import React, { useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { MatchLifecyclePanel } from "./MatchLifecyclePanel";
import { PlayerPresencePanel } from "../../../features/playerpresences/components/PlayerPresencePanel";
import { ActionsLog } from "./ActionsLog";
import { TTDActionsPanel } from "./TTDActionsPanel";
import { useMatchLifecycle } from "../hooks/useMatchLifecycle";
import { addRecentAction } from "../store/matchSlice";
import type { RootState } from "../../../store";

export const TTAConsole: React.FC = () => {
  const dispatch = useDispatch();
  const activeMatchId = useSelector(
    (state: RootState) => state.match.activeMatchId,
  );
  const { periodnumber, isPeriodActive, isInsideStoppage } =
    useMatchLifecycle();

  const [pendingAction, setPendingAction] = useState<{
    name: string;
    isPositive: boolean;
  } | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const isRecordingEnabled = isPeriodActive && !isInsideStoppage;

  const handleEnter = () => {
    if (pendingAction && selectedPlayerId) {
      dispatch(
        addRecentAction({
          id: crypto.randomUUID(),
          playerNumber: 1,
          actionName: pendingAction.name,
          isPositive: pendingAction.isPositive,
          timestamp: new Date().toISOString(),
        }),
      );
      setPendingAction(null);
      setSelectedPlayerId(null);
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
          <div className="flex-1 overflow-y-auto w-full px-2 space-y-2">
            <MatchLifecyclePanel />

            <ActionsLog />

            <PlayerPresencePanel
              key={periodnumber}
              matchId={activeMatchId}
              selectedPlayerId={selectedPlayerId}
              setSelectedPlayerId={setSelectedPlayerId}
              onPlayerSelect={(id) => setSelectedPlayerId(id)}
            />

            <TTDActionsPanel
              disabled={!isRecordingEnabled}
              selectedAction={pendingAction?.name || null}
              onActionSelect={(name, isPositive) =>
                setPendingAction({ name, isPositive })
              }
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
