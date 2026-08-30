import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { navigateToHub } from "../../../store/slices/navigationSlice";
import {
  userMatchService,
  type MatchWithDetailsResponse,
} from "../../../services/userMatchService";
import { MatchReportModal } from "./MatchReportModal";

export const MyMatchesView: React.FC = () => {
  const dispatch = useDispatch();

  const [matches, setMatches] = useState<MatchWithDetailsResponse[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modal State for Reports
  const [activeReportContext, setActiveReportContext] = useState<{
    matchId: string;
    teamId: string;
    teamName?: string;
    guestTeamId?: string;
    guestTeamName?: string;
  } | null>(null);

  // Modal State for Sharing
  const [shareMatchTarget, setShareMatchTarget] =
    useState<MatchWithDetailsResponse | null>(null);
  const [shareEmail, setShareEmail] = useState<string>("");
  const [isSharing, setIsSharing] = useState<boolean>(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareSuccess, setShareSuccess] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchCatchedMatches = async () => {
      try {
        setErrorMessage(null);
        const data = await userMatchService.getCatchedMatches();
        if (isMounted) {
          setMatches(data);
        }
      } catch (err) {
        if (isMounted) {
          setErrorMessage(
            err instanceof Error
              ? err.message
              : "Failed to load tracked matches.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void fetchCatchedMatches();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleUncatch = async (matchId: string, teamId: string) => {
    try {
      await userMatchService.uncatchMatch(matchId, teamId);
      setMatches((prev) => prev.filter((m) => m.id !== matchId));
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to remove match tracking link.",
      );
    }
  };

  const handleExecuteShare = async (
    e: React.SyntheticEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();
    if (!shareMatchTarget || !shareEmail.trim() || isSharing) return;

    try {
      setIsSharing(true);
      setShareError(null);
      setShareSuccess(null);
      await userMatchService.addUserToTrackedMatch(
        shareMatchTarget.id,
        shareMatchTarget.homeTeamId,
        shareEmail.trim(),
      );
      setShareSuccess(`Match successfully shared with ${shareEmail}`);
      setShareEmail("");
      setTimeout(() => setShareMatchTarget(null), 1500);
    } catch (err) {
      setShareError(
        err instanceof Error ? err.message : "Failed to share match.",
      );
    } finally {
      setIsSharing(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-500">
          Loading tracked matches...
        </div>
      );
    }

    if (errorMessage && matches.length === 0) {
      return null;
    }

    if (matches.length === 0) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-gray-500 space-y-3">
          <div className="text-xs">No tracked matches found.</div>
          <p className="text-[11px] text-gray-600">
            Completed quick matches will automatically appear here once
            finalized.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3 flex-1 overflow-y-auto pr-0.5">
        {matches.map((match) => (
          <div
            key={match.id}
            className="p-3 bg-gray-900 border border-gray-800 rounded-xl space-y-2.5 shadow-md"
          >
            {/* Date & Score Header */}
            <div className="flex justify-between items-center text-[11px] text-gray-400 border-b border-gray-800/60 pb-1.5">
              <span>{formatDate(match.scheduledAt)}</span>
              <span className="font-mono font-bold text-xs text-emerald-400">
                {match.homeScore ?? 0} : {match.guestScore ?? 0}
              </span>
            </div>

            {/* Teams Display */}
            <div className="grid grid-cols-2 gap-2 text-xs font-bold text-center">
              <div className="p-1.5 bg-black/30 rounded border border-gray-800 truncate text-indigo-300">
                <span className="text-[9px] uppercase text-gray-500 block font-normal">
                  Home
                </span>
                {match.homeTeamName}
              </div>
              <div className="p-1.5 bg-black/30 rounded border border-gray-800 truncate text-emerald-300">
                <span className="text-[9px] uppercase text-gray-500 block font-normal">
                  Guest
                </span>
                {match.guestTeamName}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1.5 pt-1">
              <button
                type="button"
                onClick={() =>
                  setActiveReportContext({
                    matchId: match.id,
                    teamId: match.homeTeamId,
                    teamName: match.homeTeamName,
                    guestTeamId: match.guestTeamId,
                    guestTeamName: match.guestTeamName,
                  })
                }
                className="flex-1 py-1.5 bg-emerald-700/80 hover:bg-emerald-600 text-white font-bold text-[11px] rounded transition-colors"
              >
                View Report
              </button>
              <button
                type="button"
                onClick={() => {
                  setShareMatchTarget(match);
                  setShareEmail("");
                  setShareError(null);
                  setShareSuccess(null);
                }}
                className="px-2.5 py-1.5 bg-indigo-950 hover:bg-indigo-900 text-indigo-200 border border-indigo-700/60 font-semibold text-[11px] rounded transition-colors"
              >
                Share
              </button>
              <button
                type="button"
                onClick={() => void handleUncatch(match.id, match.homeTeamId)}
                className="px-2.5 py-1.5 bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800/80 font-semibold text-[11px] rounded transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="w-full max-w-sm mx-auto flex flex-col flex-1 p-4 bg-gray-950 text-gray-100 overflow-y-auto">
      <header className="flex items-center justify-between pb-3 border-b border-gray-800 mb-4">
        <h2 className="text-sm font-black uppercase text-emerald-400 tracking-wider">
          My Tracked Matches
        </h2>
        <button
          type="button"
          onClick={() => dispatch(navigateToHub())}
          className="text-xs bg-gray-900 hover:bg-gray-800 text-gray-300 px-3 py-1 rounded border border-gray-700 transition-colors"
        >
          Back to Menu
        </button>
      </header>

      {errorMessage && (
        <div
          role="alert"
          className="mb-3 p-2 text-xs bg-red-900/50 border border-red-800 text-red-200 rounded text-center font-medium"
        >
          {errorMessage}
        </div>
      )}

      {renderContent()}

      {/* Share Match Modal Dialog */}
      {shareMatchTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <form
            onSubmit={(e) => void handleExecuteShare(e)}
            className="w-full max-w-xs bg-gray-900 border border-gray-800 text-white rounded-xl p-4 space-y-3"
          >
            <h3 className="text-xs font-black uppercase text-indigo-400">
              Share Match with User
            </h3>
            <p className="text-[11px] text-gray-400">
              Enter target user email to grant tracking access.
            </p>

            {shareError && (
              <div className="p-2 text-[11px] bg-red-900/50 border border-red-800 text-red-200 rounded">
                {shareError}
              </div>
            )}
            {shareSuccess && (
              <div className="p-2 text-[11px] bg-emerald-900/50 border border-emerald-800 text-emerald-200 rounded">
                {shareSuccess}
              </div>
            )}

            <input
              type="email"
              required
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded text-xs text-white focus:outline-none focus:border-indigo-500"
            />

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={isSharing || !shareEmail.trim()}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 text-white font-bold text-xs rounded"
              >
                {isSharing ? "Sharing..." : "Confirm Share"}
              </button>
              <button
                type="button"
                onClick={() => setShareMatchTarget(null)}
                className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold text-xs rounded"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TTA Report Modal Component */}
      {activeReportContext && (
        <MatchReportModal
          isOpen={!!activeReportContext}
          matchId={activeReportContext.matchId}
          teamId={activeReportContext.teamId}
          teamName={activeReportContext.teamName}
          guestTeamId={activeReportContext.guestTeamId}
          guestTeamName={activeReportContext.guestTeamName}
          onClose={() => setActiveReportContext(null)}
        />
      )}
    </div>
  );
};
