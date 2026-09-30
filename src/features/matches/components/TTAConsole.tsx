import React from "react";
import { MatchLifecyclePanel } from "./MatchLifecyclePanel";
import { PlayerPresencePanel } from "../../../features/playerpresences/components/PlayerPresencePanel";
import { ActionsLog } from "./ActionsLog";
import { TTAPanel } from "./TTAPanel";
import { SyncStatusBadge } from "./SyncStatusBadge";
import {
  useTTAConsole,
  type UseTTAConsoleOptions,
} from "../hooks/useTTAConsole";

export type TTAConsoleProps = UseTTAConsoleOptions;

export const TTAConsole: React.FC<TTAConsoleProps> = ({ onCompleteMatch }) => {
  const {
    activeMatchId,
    periodNumber,
    isRecordingEnabled,
    pendingAction,
    selectedPlayerId,
    setSelectedPlayerId,
    consoleError,
    isSubmitting,
    handleFinalizeSuccess,
    handleEnter,
    handleActionSelect,
  } = useTTAConsole({ onCompleteMatch });

  return (
    <div className="w-full max-w-sm mx-auto flex flex-col h-screen pb-safe overflow-hidden">
      <header className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <h1 className="text-sm font-black uppercase text-blue-500">
          TTA Match Recorder
        </h1>
        <SyncStatusBadge />
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
            <MatchLifecyclePanel onFinalizeSuccess={handleFinalizeSuccess} />

            <ActionsLog />

            <PlayerPresencePanel
              key={periodNumber}
              matchId={activeMatchId}
              selectedPlayerId={selectedPlayerId}
              setSelectedPlayerId={setSelectedPlayerId}
            />

            <TTAPanel
              disabled={!isRecordingEnabled}
              selectedAction={pendingAction?.name || null}
              onActionSelect={handleActionSelect}
            />
          </div>
          <button
            type="button"
            onClick={handleEnter}
            disabled={
              !isRecordingEnabled ||
              !pendingAction ||
              !selectedPlayerId ||
              isSubmitting
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
