import React, { useEffect, useRef, useState } from "react";
import {
  reportService,
  type TeamMatchSummaryReportResponse,
  type PlayerDetailedMatchReportResponse,
} from "../../../services/reportService";
import { TeamSummaryReportView } from "./TeamSummaryReportView";
import { PlayerDetailedReportView } from "./PlayerDetailedReportView";
import { MatchSpatialReportView } from "../../reports/components/MatchSpatialReportView";

export interface MatchReportModalProps {
  isOpen: boolean;
  matchId: string;
  teamId: string;
  teamName?: string;
  guestTeamId?: string;
  guestTeamName?: string;
  playgroundSvg?: string | null;
  onClose: () => void;
}

export const MatchReportModal: React.FC<MatchReportModalProps> = ({
  isOpen,
  matchId,
  teamId,
  teamName,
  guestTeamId,
  guestTeamName,
  playgroundSvg,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [activeTeamId, setActiveTeamId] = useState<string>(teamId);
  const [reportMode, setReportMode] = useState<"summary" | "spatial">(
    "summary",
  );
  const [fetchGeneration, setFetchGeneration] = useState<number>(0);
  const hasAttemptedAutoSwitchRef = useRef<boolean>(false);
  const requestIdRef = useRef<number>(0);

  const [summaryReports, setSummaryReports] = useState<
    TeamMatchSummaryReportResponse[]
  >([]);
  const [isSummaryLoading, setIsSummaryLoading] = useState<boolean>(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [selectedLineupId, setSelectedLineupId] = useState<string | null>(null);
  const [playerReport, setPlayerReport] =
    useState<PlayerDetailedMatchReportResponse | null>(null);
  const [isPlayerLoading, setIsPlayerLoading] = useState<boolean>(false);

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
      setReportMode("summary");
    }
  }

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

  useEffect(() => {
    if (isOpen) {
      hasAttemptedAutoSwitchRef.current = false;
    }
  }, [isOpen, matchId, teamId, guestTeamId]);

  const handleSelectPlayer = (lineupId: string) => {
    setSelectedLineupId(lineupId);
    setIsPlayerLoading(true);
    setPlayerReport(null);
  };

  const handleBackToSummary = () => {
    setSelectedLineupId(null);
    setPlayerReport(null);
  };

  const hasTrackedActions = (reports: TeamMatchSummaryReportResponse[]) =>
    reports.some(
      (r) =>
        (r.totalPositiveActions ?? 0) > 0 ||
        (r.totalNegativeActions ?? 0) > 0 ||
        (r.goals ?? 0) > 0 ||
        (r.positiveGoalLeadingActions ?? 0) > 0 ||
        (r.negativeGoalLeadingActions ?? 0) > 0,
    );

  useEffect(() => {
    if (!isOpen || !matchId || !activeTeamId || reportMode !== "summary")
      return;

    let isMounted = true;
    const currentRequestId = ++requestIdRef.current;

    const fetchSummaryReport = async () => {
      await Promise.resolve();
      if (!isMounted || currentRequestId !== requestIdRef.current) return;

      setIsSummaryLoading(true);
      setSummaryError(null);

      try {
        const data = await reportService.getTeamSummaryReport(
          matchId,
          activeTeamId,
        );
        if (!isMounted || currentRequestId !== requestIdRef.current) return;

        setSummaryReports(data);

        if (
          !hasAttemptedAutoSwitchRef.current &&
          activeTeamId === teamId &&
          guestTeamId &&
          !hasTrackedActions(data)
        ) {
          hasAttemptedAutoSwitchRef.current = true;
          try {
            const guestData = await reportService.getTeamSummaryReport(
              matchId,
              guestTeamId,
            );
            if (
              isMounted &&
              currentRequestId === requestIdRef.current &&
              hasTrackedActions(guestData)
            ) {
              setActiveTeamId(guestTeamId);
              setSummaryReports(guestData);
              return;
            }
          } catch {
            // Keep primary team data if guest fetch fails
          }
        }
      } catch (err) {
        if (isMounted && currentRequestId === requestIdRef.current) {
          console.error("Failed to load team summary report:", err);
          setSummaryError("Failed to load match summary report.");
        }
      } finally {
        if (isMounted && currentRequestId === requestIdRef.current) {
          setIsSummaryLoading(false);
        }
      }
    };

    void fetchSummaryReport();

    return () => {
      isMounted = false;
    };
  }, [
    isOpen,
    matchId,
    activeTeamId,
    teamId,
    guestTeamId,
    fetchGeneration,
    reportMode,
  ]);

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

    void fetchPlayerReport();

    return () => {
      isMounted = false;
    };
  }, [isOpen, matchId, selectedLineupId]);

  if (!isOpen) return null;

  const handleCancel = (e: React.SyntheticEvent<HTMLDialogElement, Event>) => {
    e.preventDefault();
    onClose();
  };

  const getModalTitle = (): string => {
    if (selectedLineupId) {
      return "Player TTA Detailed Report";
    }
    if (reportMode === "spatial") {
      return "Match Spatial Analytics";
    }
    return "Team TTA Summary Report";
  };

  const renderReportContent = (): React.ReactNode => {
    if (selectedLineupId) {
      return (
        <PlayerDetailedReportView
          report={playerReport}
          isLoading={isPlayerLoading}
          onBack={handleBackToSummary}
        />
      );
    }
    if (reportMode === "spatial") {
      return (
        <MatchSpatialReportView
          matchId={matchId}
          teamId={activeTeamId}
          playgroundSvg={playgroundSvg}
          onBack={() => setReportMode("summary")}
        />
      );
    }
    return (
      <TeamSummaryReportView
        reports={summaryReports}
        isLoading={isSummaryLoading}
        onSelectPlayer={handleSelectPlayer}
      />
    );
  };

  return (
    <dialog
      ref={dialogRef}
      open={isOpen}
      onCancel={handleCancel}
      aria-labelledby="report-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-2 sm:p-4 w-full h-full max-w-none max-h-none border-none m-0"
    >
      <div className="w-full max-w-sm sm:max-w-lg bg-gray-900 border border-gray-800 text-white rounded-2xl shadow-2xl p-3 sm:p-4 flex flex-col space-y-3 max-h-[94vh] overflow-hidden">
        <header className="border-b border-gray-800 pb-2 flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <h3
              id="report-modal-title"
              className="text-xs sm:text-sm font-black uppercase text-emerald-400 tracking-wider"
            >
              {getModalTitle()}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-white font-bold text-base px-2 py-0.5 rounded"
            >
              ✕
            </button>
          </div>

          {/* Report Type View Mode Switcher */}
          {!selectedLineupId && (
            <div className="flex bg-gray-950 p-1 rounded-xl border border-gray-800 gap-1">
              <button
                type="button"
                onClick={() => setReportMode("summary")}
                className={`flex-1 py-1 text-[11px] font-bold rounded-lg transition-colors ${
                  reportMode === "summary"
                    ? "bg-indigo-600 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                Summary Report
              </button>
              <button
                type="button"
                onClick={() => setReportMode("spatial")}
                className={`flex-1 py-1 text-[11px] font-bold rounded-lg transition-colors ${
                  reportMode === "spatial"
                    ? "bg-emerald-600 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                📍 Spatial Map
              </button>
            </div>
          )}

          {/* Team Switcher Tabs */}
          {!selectedLineupId && guestTeamId && (
            <div className="flex bg-gray-950 p-1 rounded-xl border border-gray-800 gap-1">
              <button
                type="button"
                onClick={() => {
                  hasAttemptedAutoSwitchRef.current = true;
                  setSelectedLineupId(null);
                  if (activeTeamId !== teamId) {
                    setActiveTeamId(teamId);
                  } else {
                    setFetchGeneration((prev) => prev + 1);
                  }
                }}
                className={`flex-1 py-1.5 px-2 text-[11px] font-bold rounded-lg transition-colors ${
                  activeTeamId === teamId
                    ? "bg-indigo-600 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {teamName || "Home Team"}
              </button>
              <button
                type="button"
                onClick={() => {
                  hasAttemptedAutoSwitchRef.current = true;
                  setSelectedLineupId(null);
                  if (activeTeamId !== guestTeamId) {
                    setActiveTeamId(guestTeamId);
                  } else {
                    setFetchGeneration((prev) => prev + 1);
                  }
                }}
                className={`flex-1 py-1.5 px-2 text-[11px] font-bold rounded-lg transition-colors ${
                  activeTeamId === guestTeamId
                    ? "bg-emerald-600 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {guestTeamName || "Guest Team"}
              </button>
            </div>
          )}
        </header>

        {summaryError && reportMode === "summary" && (
          <div
            role="alert"
            className="p-2 text-xs bg-red-900/50 border border-red-800 text-red-200 rounded text-center font-medium"
          >
            {summaryError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto pr-0.5">
          {renderReportContent()}
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
