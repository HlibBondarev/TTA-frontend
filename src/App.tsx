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

    initSyncEngine();

    const initializeApp = async () => {
      setIsInitializing(false);
    };

    initializeApp();
  }, [dispatch]);

  const handleQuickStart = async (
    sportId: string,
    configurationId: string,
    activePlayersLimit: number,
    selectedTeamId: string,
  ) => {
    const response = await apiClient.post<{ id: string }>("/Matches/quick", {
      sportId,
      configurationId,
    });

    const matchId = response.id;

    dispatch(
      setPresenceLimits({
        limit: activePlayersLimit,
        period: 1,
      }),
    );

    try {
      await hydrateMatchData(matchId, selectedTeamId);
    } catch (error) {
      console.error("Hydration failed (non-critical):", error);
      return;
    }

    dispatch(setActiveMatch(matchId));
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
