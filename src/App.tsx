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
    if (initStarted.current) return;
    initStarted.current = true;

    const initializeApp = async () => {
      dispatch(
        setPresenceLimits({
          limit: 7,
          period: 1,
        }),
      );
      dispatch(setActiveMatch(TEST_MATCH_ID));

      try {
        await seedTestData();
      } catch (error) {
        console.error("Seeding failed (non-critical):", error);
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
