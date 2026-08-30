import React, { useEffect, useRef, useState } from "react";
import {
  reportService,
  type TeamMatchSummaryReportResponse,
  type PlayerDetailedMatchReportResponse,
} from "../../../services/reportService";
import { TeamSummaryReportView } from "./TeamSummaryReportView";
import { PlayerDetailedReportView } from "./PlayerDetailedReportView";

export interface MatchReportModalProps {
  isOpen: boolean;
  matchId: string;
  teamId: string;
  guestTeamId?: string;
  onClose: () => void;
}

export const MatchReportModal: React.FC<MatchReportModalProps> = ({
  isOpen,
  matchId,
  teamId,
  guestTeamId,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [activeTeamId, setActiveTeamId] = useState<string>(teamId);
  const [hasAttemptedAutoSwitch, setHasAttemptedAutoSwitch] =
    useState<boolean>(false);

  const [summaryReports, setSummaryReports] = useState<
    TeamMatchSummaryReportResponse[]
  >([]);
  const [isSummaryLoading, setIsSummaryLoading] = useState<boolean>(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [selectedLineupId, setSelectedLineupId] = useState<string | null>(null);
  const [playerReport, setPlayerReport] =
    useState<PlayerDetailedMatchReportResponse | null>(null);
  const [isPlayerLoading, setIsPlayerLoading] = useState<boolean>(false);

  // Synchronize state during render when isOpen, matchId, teamId, or guestTeamId transitions
  const [prevProps, setPrevProps] = useState({
    isOpen,
    matchId,
    teamId,
    guestTeamId,
  });

  if (
    isOpen !== prevProps.isOpen ||
    matchId !== prevProps.matchId ||
    teamId !== prevProps.teamId ||
    guestTeamId !== prevProps.guestTeamId
  ) {
    setPrevProps({ isOpen, matchId, teamId, guestTeamId });
    if (isOpen) {
      setActiveTeamId(teamId);
      setSelectedLineupId(null);
      setHasAttemptedAutoSwitch(false);
    }
  }

  // Manage native dialog showModal and focus restoration
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      const dialog = dialogRef.current;
      if (dialog && !dialog.open) {
        if (typeof dialog.showModal === "function") {
          dialog.showModal();
        } else {
          dialog.setAttribute("open", "");
        }
      }
    }

    return () => {
      if (
        previousFocusRef.current &&
        typeof previousFocusRef.current.focus === "function"
      ) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen]);

  // Event handler for selecting a player row
  const handleSelectPlayer = (lineupId: string) => {
    setSelectedLineupId(lineupId);
    setIsPlayerLoading(true);
    setPlayerReport(null);
  };

  // Event handler for returning back to team summary
  const handleBackToSummary = () => {
    setSelectedLineupId(null);
    setPlayerReport(null);
  };

  // Helper to check if summary report contains any recorded TTA actions
  const hasTrackedActions = (reports: TeamMatchSummaryReportResponse[]) =>
    reports.some(
      (r) =>
        (r.totalPositiveActions ?? 0) > 0 ||
        (r.totalNegativeActions ?? 0) > 0 ||
        (r.goals ?? 0) > 0 ||
        (r.positiveGoalLeadingActions ?? 0) > 0 ||
        (r.negativeGoalLeadingActions ?? 0) > 0,
    );

  // Fetch Team Summary when modal opens or active team changes
  useEffect(() => {
    if (!isOpen || !matchId || !activeTeamId) return;

    let isMounted = true;

    const fetchSummaryReport = async () => {
      await Promise.resolve();
      if (!isMounted) return;

      setIsSummaryLoading(true);
      setSummaryError(null);

      try {
        const data = await reportService.getTeamSummaryReport(
          matchId,
          activeTeamId,
        );
        if (!isMounted) return;

        // Smart auto-select guest team if home team has 0 actions and guest team has recorded actions
        if (
          !hasAttemptedAutoSwitch &&
          activeTeamId === teamId &&
          guestTeamId &&
          !hasTrackedActions(data)
        ) {
          setHasAttemptedAutoSwitch(true);
          try {
            const guestData = await reportService.getTeamSummaryReport(
              matchId,
              guestTeamId,
            );
            if (isMounted && hasTrackedActions(guestData)) {
              setActiveTeamId(guestTeamId);
              setSummaryReports(guestData);
              return;
            }
          } catch {
            // Keep primary team data if guest fetch fails
          }
        }

        setSummaryReports(data);
      } catch (err) {
        if (isMounted) {
          console.error("Failed to load team summary report:", err);
          setSummaryError("Failed to load match summary report.");
        }
      } finally {
        if (isMounted) {
          setIsSummaryLoading(false);
        }
      }
    };

    fetchSummaryReport();

    return () => {
      isMounted = false;
    };
  }, [
    isOpen,
    matchId,
    activeTeamId,
    teamId,
    guestTeamId,
    hasAttemptedAutoSwitch,
  ]);

  // Fetch Player Detailed Report when a lineup is selected
  useEffect(() => {
    if (!isOpen || !matchId || !selectedLineupId) return;

    let isMounted = true;

    const fetchPlayerReport = async () => {
      await Promise.resolve();
      if (!isMounted) return;

      setIsPlayerLoading(true);

      try {
        const data = await reportService.getPlayerDetailedReport(
          matchId,
          selectedLineupId,
        );
        if (isMounted) {
          setPlayerReport(data);
        }
      } catch (err) {
        if (isMounted) {
          console.error("Failed to load player detailed report:", err);
          setPlayerReport(null);
        }
      } finally {
        if (isMounted) {
          setIsPlayerLoading(false);
        }
      }
    };

    fetchPlayerReport();

    return () => {
      isMounted = false;
    };
  }, [isOpen, matchId, selectedLineupId]);

  if (!isOpen) return null;

  const handleCancel = (e: React.SyntheticEvent<HTMLDialogElement, Event>) => {
    e.preventDefault();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      open={isOpen}
      onCancel={handleCancel}
      aria-labelledby="report-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-2 sm:p-4 w-full h-full max-w-none max-h-none border-none m-0"
    >
      <div className="w-full max-w-sm sm:max-w-md bg-gray-900 border border-gray-800 text-white rounded-2xl shadow-2xl p-3 sm:p-4 flex flex-col space-y-3 max-h-[94vh] overflow-hidden">
        <header className="border-b border-gray-800 pb-2 flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <h3
              id="report-modal-title"
              className="text-xs sm:text-sm font-black uppercase text-emerald-400 tracking-wider"
            >
              {selectedLineupId
                ? "Player TTA Detailed Report"
                : "Team TTA Summary Report"}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-white font-bold text-base px-2 py-0.5 rounded"
            >
              ✕
            </button>
          </div>

          {/* Team Switcher Tabs */}
          {!selectedLineupId && guestTeamId && (
            <div className="flex bg-gray-950 p-1 rounded-xl border border-gray-800 gap-1">
              <button
                type="button"
                onClick={() => {
                  setHasAttemptedAutoSwitch(true);
                  setSelectedLineupId(null);
                  setActiveTeamId(teamId);
                }}
                className={`flex-1 py-1.5 px-2 text-[11px] font-bold rounded-lg transition-colors ${
                  activeTeamId === teamId
                    ? "bg-indigo-600 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                Home Team
              </button>
              <button
                type="button"
                onClick={() => {
                  setHasAttemptedAutoSwitch(true);
                  setSelectedLineupId(null);
                  setActiveTeamId(guestTeamId);
                }}
                className={`flex-1 py-1.5 px-2 text-[11px] font-bold rounded-lg transition-colors ${
                  activeTeamId === guestTeamId
                    ? "bg-emerald-600 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                Guest Team
              </button>
            </div>
          )}
        </header>

        {summaryError && (
          <div
            role="alert"
            className="p-2 text-xs bg-red-900/50 border border-red-800 text-red-200 rounded text-center font-medium"
          >
            {summaryError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto pr-0.5">
          {selectedLineupId ? (
            <PlayerDetailedReportView
              report={playerReport}
              isLoading={isPlayerLoading}
              onBack={handleBackToSummary}
            />
          ) : (
            <TeamSummaryReportView
              reports={summaryReports}
              isLoading={isSummaryLoading}
              onSelectPlayer={handleSelectPlayer}
            />
          )}
        </div>

        <footer className="pt-2 border-t border-gray-800 text-right">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-gray-200 font-bold text-xs uppercase rounded-xl transition-colors"
          >
            Close Report
          </button>
        </footer>
      </div>
    </dialog>
  );
};
