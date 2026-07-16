import React, { useEffect, useState, useRef } from "react";
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
  const [initError, setInitError] = useState<string | null>(null);
  const initStarted = useRef(false);

  useEffect(() => {
    // Guard against concurrent double-invocation in React 18 Strict Mode
    if (initStarted.current) return;
    initStarted.current = true;

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

        setIsInitialized(true);
      } catch (error) {
        console.error("Initialization failed:", error);
        setInitError(
          error instanceof Error
            ? error.message
            : "Failed to initialize the app.",
        );
      }
    };

    initializeApp();
  }, [dispatch]);

  if (initError) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="w-full max-w-md p-6 bg-red-950/40 border border-red-800 rounded-xl text-center shadow-lg">
          <h2 className="text-xl font-bold text-red-400 mb-2">
            Initialization Error
          </h2>
          <p className="text-sm text-red-200/80 mb-4 font-mono">{initError}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-red-800 hover:bg-red-700 active:bg-red-900 text-white text-xs font-bold uppercase tracking-wider rounded transition-colors"
          >
            Retry Loading
          </button>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center font-mono">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-t-blue-500 border-gray-800 rounded-full animate-spin"></div>
          <span className="text-xs text-gray-400 mt-2">
            Loading database...
          </span>
        </div>
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
