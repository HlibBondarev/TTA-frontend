import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useAuth0 } from "@auth0/auth0-react";
import { TTAConsole } from "./features/matches/components/TTAConsole";
import { MatchSetupWizard } from "./features/setup/components/MatchSetupWizard";
import { setPresenceLimits } from "./features/playerpresences/store/presenceSlice";
import { setActiveMatch } from "./features/matches/store/matchSlice";
import { hydrateMatchData } from "./services/hydrationService";
import { initSyncEngine } from "./services/syncService";
import { setTokenGetter } from "./services/tokenService";
import { apiClient } from "./api/client";
import type { RootState } from "./store";

export const App: React.FC = () => {
  const dispatch = useDispatch();
  const initStarted = useRef(false);
  const [isInitializing, setIsInitializing] = useState(true);

  const activeMatchId = useSelector(
    (state: RootState) => state.match.activeMatchId,
  );

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

      // Note: activeMatchId is now initialized via MatchSetupWizard workflow rather than hardcoded TEST_MATCH_ID
      setIsInitializing(false);
    };

    initializeApp();
  }, [dispatch]);

  // Handle quick start workflow: create match via API, set active match in store, and hydrate data
  const handleQuickStart = async (sportId: string, configurationId: string) => {
    const response = await apiClient.post<{ id: string }>("/Matches/quick", {
      sportId,
      configurationId,
    });

    const matchId = response.id;
    dispatch(setActiveMatch(matchId));

    try {
      await hydrateMatchData(matchId);
    } catch (error) {
      console.error("Hydration failed (non-critical):", error);
    }
  };

  if (isInitializing || isLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-gray-950 text-gray-100 font-medium text-sm">
        Initializing application...
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

      {activeMatchId ? (
        <TTAConsole />
      ) : (
        <MatchSetupWizard onQuickStart={handleQuickStart} />
      )}
    </div>
  );
};

export default App;
