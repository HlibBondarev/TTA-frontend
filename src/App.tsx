import React, { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { useAuth0 } from "@auth0/auth0-react";
import { TTAConsole } from "./features/matches/components/TTAConsole";
import { setPresenceLimits } from "./features/playerpresences/store/presenceSlice";
import { setActiveMatch } from "./features/matches/store/matchSlice";
import { hydrateMatchData } from "./services/hydrationService";
import { initSyncEngine } from "./services/syncService";
import { setTokenGetter } from "./services/tokenService";

export const TEST_MATCH_ID = "33333333-3333-0000-0000-333333333001";

export const App: React.FC = () => {
  const dispatch = useDispatch();
  const initStarted = useRef(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const {
    getAccessTokenSilently,
    isAuthenticated,
    isLoading,
    loginWithRedirect,
  } = useAuth0();

  useEffect(() => {
    if (isLoading) return;

    // Register Auth0 token resolver globally for apiClient and syncService
    setTokenGetter(async () => {
      try {
        return await getAccessTokenSilently();
      } catch {
        return null;
      }
    });
  }, [isLoading, getAccessTokenSilently]);

  useEffect(() => {
    if (initStarted.current) return;
    initStarted.current = true;

    // Initialize background sync engine listener
    initSyncEngine();

    const initializeApp = async () => {
      dispatch(
        setPresenceLimits({
          limit: 7,
          period: 1,
        }),
      );
      dispatch(setActiveMatch(TEST_MATCH_ID));

      try {
        await hydrateMatchData(TEST_MATCH_ID);
      } catch (error) {
        console.error("Hydration failed (non-critical):", error);
      } finally {
        setIsInitializing(false);
      }
    };

    initializeApp();
  }, [dispatch]);

  if (isInitializing) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-gray-950 text-gray-100 font-medium text-sm">
        Hydrating match data...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col justify-between p-4">
      {/* Optional login button trigger if user is unauthenticated and Auth0 is not loading */}
      {!isLoading && !isAuthenticated && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={() => void loginWithRedirect()}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded transition-colors"
          >
            Log In
          </button>
        </div>
      )}
      <TTAConsole />
    </div>
  );
};

export default App;
