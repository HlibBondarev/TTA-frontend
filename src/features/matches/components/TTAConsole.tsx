import React from "react";
import { useSelector } from "react-redux";
import { MatchLifecyclePanel } from "./MatchLifecyclePanel";
import { PlayerPresencePanel } from "../../../features/playerpresences/components/PlayerPresencePanel";
import type { RootState } from "../../../store";

export const TTAConsole: React.FC = () => {
  const activeMatchId = useSelector(
    (state: RootState) => state.match.activeMatchId,
  );

  return (
    <div className="w-full max-w-md mx-auto space-y-4 grow flex flex-col justify-start">
      {/* Header section for the console */}
      <header className="text-center py-2 border-b border-gray-800">
        <h1 className="text-xl font-black uppercase tracking-widest text-blue-500">
          TTA Match Recorder
        </h1>
        <p className="text-[10px] text-gray-500 font-mono mt-0.5">
          Offline Game Tracking Console
        </p>
      </header>

      {/* Unified contract: both panels require an activeMatchId to be rendered */}
      {activeMatchId ? (
        <>
          <section aria-label="Player Rosters">
            <PlayerPresencePanel matchId={activeMatchId} />
          </section>

          {/* Placeholder for future TTD action recording functionality */}
          <section className="p-6 bg-gray-900/30 border border-dashed border-gray-800 rounded-xl text-center text-xs text-gray-600">
            Positive & Negative TTD Actions Panel (To be implemented)
          </section>

          <section aria-label="Match Status Controls" className="mt-auto">
            <MatchLifecyclePanel />
          </section>
        </>
      ) : (
        /* Fallback view when no match is selected */
        <div className="p-6 text-center text-gray-500 border border-dashed border-gray-800 rounded-xl">
          <p className="text-sm">
            No active match. Please select a match to begin recording.
          </p>
        </div>
      )}
    </div>
  );
};
