import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useAuth0 } from "@auth0/auth0-react";
import { TTAConsole } from "./features/matches/components/TTAConsole";
import { MatchSetupWizard } from "./features/setup/components/MatchSetupWizard";
import { MainDashboard } from "./features/dashboard/components/MainDashboard";
import { MyMatchesView } from "./features/matches/components/MyMatchesView";
import { TournamentStubView } from "./features/tournaments/components/TournamentStubView";

import { setPresenceLimits } from "./features/playerpresences/store/presenceSlice";
import { setActiveMatch } from "./features/matches/store/matchSlice";
import { hydrateMatchData } from "./services/hydrationService";
import { setTokenGetter } from "./services/tokenService";
import type { RootState } from "./store";

export const App: React.FC = () => {
  const dispatch = useDispatch();
  const initStarted = useRef(false);
  const [isInitializing, setIsInitializing] = useState(true);

  const activeMatchId = useSelector(
    (state: RootState) => state.match.activeMatchId,
  );
  const isPeriodActive = useSelector(
    (state: RootState) => state.match.isPeriodActive,
  );
  const currentView = useSelector(
    (state: RootState) => state.navigation.currentView,
  );

  const {
    getAccessTokenSilently,
    isAuthenticated,
    isLoading,
    loginWithRedirect,
  } = useAuth0();

  // Tab protection during active match session (even during inter-period breaks)
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (activeMatchId || isPeriodActive) {
        event.preventDefault();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [activeMatchId, isPeriodActive]);

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

    const initializeApp = async () => {
      setIsInitializing(false);
    };

    initializeApp();
  }, [dispatch]);

  const handleQuickStart = async (
    matchId: string,
    _sportId: string,
    _configurationId: string,
    activePlayersLimit: number,
    selectedTeamId: string,
  ) => {
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

    dispatch(
      setActiveMatch({
        matchId,
        teamId: selectedTeamId,
      }),
    );
  };

  const handleResumeMatch = async (matchId: string, teamId: string) => {
    dispatch(
      setPresenceLimits({
        limit: 7,
        period: 1,
      }),
    );

    try {
      await hydrateMatchData(matchId, teamId);
    } catch (error) {
      console.error("Session recovery hydration failed (non-critical):", error);
    }

    dispatch(
      setActiveMatch({
        matchId,
        teamId,
      }),
    );
  };

  if (isInitializing || isLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-gray-950 text-gray-100 font-medium text-sm">
        Initializing application...
      </div>
    );
  }

  // Auth Gate: Unauthenticated users are gated at the Welcome screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-full max-w-xs space-y-6">
          <header className="space-y-2">
            <h1 className="text-xl font-black uppercase text-blue-500 tracking-wider">
              TTA Match Recorder
            </h1>
            <p className="text-xs text-gray-400">
              Technical & Tactical Actions recording and match performance
              analytics.
            </p>
          </header>

          <button
            type="button"
            onClick={() => void loginWithRedirect()}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase rounded-xl transition-all shadow-lg text-xs tracking-wider"
          >
            Log In / Register
          </button>
        </div>
      </div>
    );
  }

  // Active Match Mode or explicit CONSOLE view: Show Console
  if (activeMatchId || currentView === "CONSOLE") {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col justify-between p-4">
        <TTAConsole />
      </div>
    );
  }

  // Authenticated Dashboard & Hub View Router
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col justify-between p-4">
      {(currentView === "HUB" || currentView === "AUTH_GATE") && (
        <MainDashboard onResumeMatch={handleResumeMatch} />
      )}
      {currentView === "QUICK_START" && (
        <MatchSetupWizard onQuickStart={handleQuickStart} />
      )}
      {currentView === "MY_MATCHES" && <MyMatchesView />}
      {currentView === "TOURNAMENT_STUB" && <TournamentStubView />}
    </div>
  );
};

export default App;
