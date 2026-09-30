import React from "react";
import { TTAConsole } from "./features/matches/components/TTAConsole";
import { MatchSetupWizard } from "./features/setup/components/MatchSetupWizard";
import { MainDashboard } from "./features/dashboard/components/MainDashboard";
import { MyMatchesView } from "./features/matches/components/MyMatchesView";
import { TournamentStubView } from "./features/tournaments/components/TournamentStubView";
import { useAppSession } from "./hooks/useAppSession";

export const App: React.FC = () => {
  const {
    isInitializing,
    isLoading,
    isAuthenticated,
    loginWithRedirect,
    currentView,
    activeMatchId,
    handleQuickStart,
    handleResumeMatch,
  } = useAppSession();

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
