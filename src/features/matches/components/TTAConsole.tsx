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
      {/* Header */}
      <header className="text-center py-2 border-b border-gray-800">
        <h1 className="text-xl font-black uppercase tracking-widest text-blue-500">
          TTA Match Recorder
        </h1>
        <p className="text-[10px] text-gray-500 font-mono mt-0.5">
          Offline Game Tracking Console
        </p>
      </header>

      {/* Sectors 1 & 2: Player Presence & Substitutions */}
      <section aria-label="Player Rosters">
        {activeMatchId && <PlayerPresencePanel matchId={activeMatchId} />}
      </section>

      {/* Sectors 3 & 4: Positive & Negative TTD Actions (Placeholder) */}
      <section className="p-6 bg-gray-900/30 border border-dashed border-gray-800 rounded-xl text-center text-xs text-gray-600">
        Positive & Negative TTD Actions Panel (To be implemented)
      </section>

      {/* Sectors 5 & 6: Period and Match Time Control */}
      <section aria-label="Match Status Controls" className="mt-auto">
        <MatchLifecyclePanel />
      </section>
    </div>
  );
};
