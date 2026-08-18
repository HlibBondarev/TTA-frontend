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
  onClose: () => void;
}

export const MatchReportModal: React.FC<MatchReportModalProps> = ({
  isOpen,
  matchId,
  teamId,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [summaryReports, setSummaryReports] = useState<
    TeamMatchSummaryReportResponse[]
  >([]);
  const [isSummaryLoading, setIsSummaryLoading] = useState<boolean>(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [selectedLineupId, setSelectedLineupId] = useState<string | null>(null);
  const [playerReport, setPlayerReport] =
    useState<PlayerDetailedMatchReportResponse | null>(null);
  const [isPlayerLoading, setIsPlayerLoading] = useState<boolean>(false);

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

  // Fetch Team Summary when modal opens
  useEffect(() => {
    if (!isOpen || !matchId || !teamId) return;

    let isMounted = true;

    const fetchSummaryReport = async () => {
      await Promise.resolve();
      if (!isMounted) return;

      setIsSummaryLoading(true);
      setSummaryError(null);

      try {
        const data = await reportService.getTeamSummaryReport(matchId, teamId);
        if (isMounted) {
          setSummaryReports(data);
        }
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
  }, [isOpen, matchId, teamId]);

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
      onCancel={handleCancel}
      aria-labelledby="report-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-2 sm:p-4 w-full h-full max-w-none max-h-none border-none m-0"
    >
      <div className="w-full max-w-sm sm:max-w-md bg-gray-900 border border-gray-800 text-white rounded-2xl shadow-2xl p-3 sm:p-4 flex flex-col space-y-3 max-h-[94vh] overflow-hidden">
        <header className="border-b border-gray-800 pb-2 flex items-center justify-between">
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
