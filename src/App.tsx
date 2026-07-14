import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { MatchLifecyclePanel } from "./features/matches/components/MatchLifecyclePanel";
import { PlayerPresencePanel } from "./features/playerpresences/components/PlayerPresencePanel";
import { seedTestData } from "./db/seed";
import { setPresenceLimits } from "./features/playerpresences/store/presenceSlice";
import { setActiveMatch } from "./features/matches/store/matchSlice";

const TEST_MATCH_ID = "6f2e8f1a-7b3c-4d5e-8f9a-0b1c2d3e4f70";

export const App: React.FC = () => {
  const dispatch = useDispatch();
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // 1. Seed the database with mock data if empty
        await seedTestData();

        // 2. Set the dynamic active players limit to Redux (defaulting to 7 for Water Polo)
        dispatch(
          setPresenceLimits({
            limit: 7, // Water Polo active players count (1 GK + 6 field players)
            period: 1,
          }),
        );

        // 3. Set the active match ID in matchSlice to prevent startup crashes
        dispatch(setActiveMatch(TEST_MATCH_ID));
      } catch (error) {
        console.error("Initialization failed:", error);
      } finally {
        setIsInitialized(true);
      }
    };

    initializeApp();
  }, [dispatch]);

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center font-mono">
        Loading database...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col justify-between p-4">
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
          <PlayerPresencePanel matchId={TEST_MATCH_ID} />
        </section>

        {/* Sectors 3 & 4: Positive & Negative TTD Actions (Placeholder) */}
        <section className="p-6 bg-gray-900/30 border border-dashed border-gray-800 rounded-xl text-center text-xs text-gray-600">
          Positive & Negative TTD Actions Panel (Placeholder)
        </section>

        {/* Sectors 5 & 6: Period and Match Time Control */}
        <section aria-label="Match Status Controls" className="mt-auto">
          <MatchLifecyclePanel />
        </section>
      </div>
    </div>
  );
};

export default App;
