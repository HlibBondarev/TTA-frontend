import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { useAuth0 } from "@auth0/auth0-react";
import { setCurrentView } from "../../../store/slices/navigationSlice";
import { checkUnfinishedMatch } from "../../../services/hydrationService";
import type { MatchLookup } from "../../../db/ttaDatabase";

export interface MainDashboardProps {
  onResumeMatch?: (matchId: string, teamId: string) => Promise<void>;
}

export const MainDashboard: React.FC<MainDashboardProps> = ({
  onResumeMatch,
}) => {
  const dispatch = useDispatch();
  const { user, logout } = useAuth0();

  const [unfinishedMatch, setUnfinishedMatch] = useState<MatchLookup | null>(
    null,
  );
  const [isResuming, setIsResuming] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const checkForInterruptedMatch = async () => {
      try {
        const match = await checkUnfinishedMatch();
        if (isMounted) {
          setUnfinishedMatch(match);
        }
      } catch (err) {
        console.error("Failed to check unfinished match:", err);
      }
    };

    checkForInterruptedMatch();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleResume = async () => {
    if (!unfinishedMatch || isResuming) return;
    setIsResuming(true);
    try {
      if (onResumeMatch) {
        await onResumeMatch(
          unfinishedMatch.id,
          unfinishedMatch.homeTeamId || "",
        );
      }
    } finally {
      setIsResuming(false);
    }
  };

  const handleDismiss = () => {
    setUnfinishedMatch(null);
  };

  return (
    <div className="w-full max-w-sm mx-auto flex flex-col flex-1 p-4 bg-gray-950 text-gray-100 overflow-y-auto">
      {/* Header with User Profile */}
      <header className="flex items-center justify-between pb-4 border-b border-gray-800 mb-6">
        <div className="flex flex-col min-w-0 pr-2">
          <span className="text-[10px] uppercase font-bold text-gray-500">
            Logged in as
          </span>
          <span className="text-xs font-semibold text-emerald-400 truncate">
            {user?.email ?? user?.name ?? "User"}
          </span>
        </div>
        <button
          type="button"
          onClick={() =>
            void logout({ logoutParams: { returnTo: window.location.origin } })
          }
          className="text-xs bg-red-950/60 hover:bg-red-900 border border-red-800/80 text-red-200 px-3 py-1.5 rounded-lg transition-colors font-medium"
        >
          Log Out
        </button>
      </header>

      {/* Session Recovery Gate Prompt */}
      {unfinishedMatch && (
        <div
          role="region"
          aria-label="Session Recovery Prompt"
          className="mb-6 p-4 bg-amber-950/40 border border-amber-600/60 rounded-2xl shadow-xl flex flex-col space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center space-x-1.5">
              <span>⚠️</span>
              <span>Interrupted Match Found</span>
            </span>
            <span className="text-[10px] text-amber-300/80 font-mono">
              ID: {unfinishedMatch.id.slice(0, 8)}...
            </span>
          </div>

          <p className="text-[11px] text-gray-300 leading-relaxed">
            An active unfinished match session was detected in local storage.
            Would you like to resume tracking?
          </p>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              disabled={isResuming}
              onClick={() => void handleResume()}
              className="py-2.5 px-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-black uppercase text-[10px] rounded-xl transition-all tracking-wider text-center"
            >
              {isResuming ? "Resuming..." : "Resume Match"}
            </button>
            <button
              type="button"
              disabled={isResuming}
              onClick={handleDismiss}
              className="py-2.5 px-3 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-gray-300 font-bold uppercase text-[10px] rounded-xl border border-gray-700 transition-all text-center"
            >
              Discard / Dismiss
            </button>
          </div>
        </div>
      )}

      <h2 className="text-sm font-black uppercase text-blue-500 mb-6 text-center tracking-wider">
        TTA Hub Navigation
      </h2>

      {/* Navigation Pathways */}
      <div className="space-y-4 flex-1 flex flex-col justify-center">
        {/* Pathway 1: Quick Start Match */}
        <button
          type="button"
          onClick={() => dispatch(setCurrentView("QUICK_START"))}
          className="p-4 bg-linear-to-r from-blue-900/40 to-indigo-900/40 hover:from-blue-900/60 hover:to-indigo-900/60 border border-blue-700/50 rounded-2xl text-left transition-all shadow-lg group"
        >
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-black uppercase text-blue-400 group-hover:text-blue-300">
              Quick Start Match
            </h3>
            <span className="text-xs text-blue-400 font-bold group-hover:translate-x-1 transition-transform">
              →
            </span>
          </div>
          <p className="text-[11px] text-gray-400 leading-tight">
            Create an instant match, select sport and configuration, and record
            player actions in real-time.
          </p>
        </button>

        {/* Pathway 2: My Tracked Matches */}
        <button
          type="button"
          onClick={() => dispatch(setCurrentView("MY_MATCHES"))}
          className="p-4 bg-linear-to-r from-emerald-900/40 to-teal-900/40 hover:from-emerald-900/60 hover:to-teal-900/60 border border-emerald-700/50 rounded-2xl text-left transition-all shadow-lg group"
        >
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-black uppercase text-emerald-400 group-hover:text-emerald-300">
              My Tracked Matches
            </h3>
            <span className="text-xs text-emerald-400 font-bold group-hover:translate-x-1 transition-transform">
              →
            </span>
          </div>
          <p className="text-[11px] text-gray-400 leading-tight">
            View completed matches, analyze team summary and detailed player TTA
            reports, or share matches.
          </p>
        </button>

        {/* Pathway 3: Tournament Management */}
        <button
          type="button"
          onClick={() => dispatch(setCurrentView("TOURNAMENT_STUB"))}
          className="p-4 bg-linear-to-r from-purple-900/40 to-fuchsia-900/40 hover:from-purple-900/60 hover:to-fuchsia-900/60 border border-purple-700/50 rounded-2xl text-left transition-all shadow-lg group"
        >
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-black uppercase text-purple-400 group-hover:text-purple-300">
              Tournaments
            </h3>
            <span className="text-xs text-purple-400 font-bold group-hover:translate-x-1 transition-transform">
              →
            </span>
          </div>
          <p className="text-[11px] text-gray-400 leading-tight">
            Participate in club and team tournament structures. View policy
            permissions and scopes.
          </p>
        </button>
      </div>
    </div>
  );
};
