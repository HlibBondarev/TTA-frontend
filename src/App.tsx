import React, { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { TTAConsole } from "./features/matches/components/TTAConsole";
import { seedTestData } from "./db/seed";
import { setPresenceLimits } from "./features/playerpresences/store/presenceSlice";
import { setActiveMatch } from "./features/matches/store/matchSlice";

export const TEST_MATCH_ID = "6f2e8f1a-7b3c-4d5e-8f9a-0b1c2d3e4f70";

export const App: React.FC = () => {
  const dispatch = useDispatch();
  const initStarted = useRef(false);

  useEffect(() => {
    // Guard against concurrent double-invocation in React 18 Strict Mode
    if (initStarted.current) return;
    initStarted.current = true;

    const initializeApp = async () => {
      try {
        // 1. Seed the database with mock data if empty
        await seedTestData();

        // 2. Set the dynamic active players limit to Redux
        dispatch(
          setPresenceLimits({
            limit: 7,
            period: 1,
          }),
        );

        // 3. Set the active match ID in matchSlice
        dispatch(setActiveMatch(TEST_MATCH_ID));
      } catch (error) {
        console.error("Initialization failed:", error);
      }
    };

    initializeApp();
  }, [dispatch]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col justify-between p-4">
      <TTAConsole />
    </div>
  );
};

export default App;
