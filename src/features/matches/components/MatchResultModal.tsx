import React, { useState } from "react";
import { useAppDispatch, useAppSelector } from "../../../hooks/hooks";
import { resetMatchState } from "../store/matchSlice";
import { navigateToMyMatches } from "../../../store/slices/navigationSlice";
import { matchFinalizationService } from "../../../services/matchFinalizationService";
import { MatchReportModal } from "./MatchReportModal";

export interface MatchResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const MatchResultModal: React.FC<MatchResultModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const dispatch = useAppDispatch();

  const {
    activeMatchId,
    activeTeamId,
    homeScore,
    guestScore,
    isPeriodActive,
    periodNumber,
  } = useAppSelector((state) => state.match);

  const [homeScoreInput, setHomeScoreInput] = useState<string>("0");
  const [guestScoreInput, setGuestScoreInput] = useState<string>("0");
  const [temperatureInput, setTemperatureInput] = useState<string>("");

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [completedMatchContext, setCompletedMatchContext] = useState<{
    matchId: string;
    teamId: string;
  } | null>(null);
  const [isReportOpen, setIsReportOpen] = useState<boolean>(false);

  const [prevIsOpen, setPrevIsOpen] = useState(false);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setHomeScoreInput(String(homeScore ?? 0));
      setGuestScoreInput(String(guestScore ?? 0));
      setTemperatureInput("");
      setErrorMessage(null);
      setIsSubmitting(false);
    }
  }

  if (!isOpen && !isReportOpen) return null;

  const isValidHomeScore =
    homeScoreInput.trim() !== "" &&
    /^\d+$/.test(homeScoreInput.trim()) &&
    Number(homeScoreInput) >= 0;

  const isValidGuestScore =
    guestScoreInput.trim() !== "" &&
    /^\d+$/.test(guestScoreInput.trim()) &&
    Number(guestScoreInput) >= 0;

  const trimmedTemp = temperatureInput.trim();
  const isStrictNumericTemp = /^-?\d+(\.\d+)?$/.test(trimmedTemp);
  const parsedTempNum =
    trimmedTemp !== "" && isStrictNumericTemp ? Number(trimmedTemp) : null;

  const isValidTemperature =
    trimmedTemp === "" ||
    (parsedTempNum !== null &&
      !Number.isNaN(parsedTempNum) &&
      Number.isFinite(parsedTempNum));

  const isFormValid =
    isValidHomeScore &&
    isValidGuestScore &&
    isValidTemperature &&
    !isSubmitting;

  const handleScoreStepper = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    currentVal: string,
    delta: number,
  ) => {
    const num = Number.parseInt(currentVal, 10);
    const safeNum = Number.isNaN(num) ? 0 : num;
    const nextVal = Math.max(0, safeNum + delta);
    setter(String(nextVal));
  };

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isFormValid || !activeMatchId || !activeTeamId) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const parsedHomeScore = Number.parseInt(homeScoreInput.trim(), 10);
    const parsedGuestScore = Number.parseInt(guestScoreInput.trim(), 10);
    const parsedTemperature = parsedTempNum;

    const currentMatchId = activeMatchId;
    const currentTeamId = activeTeamId;

    try {
      await matchFinalizationService.finalizeMatch({
        matchId: currentMatchId,
        activeTeamId: currentTeamId,
        homeScore: parsedHomeScore,
        guestScore: parsedGuestScore,
        temperature: parsedTemperature,
      });

      setCompletedMatchContext({
        matchId: currentMatchId,
        teamId: currentTeamId,
      });

      setIsReportOpen(true);
    } catch (err) {
      console.error("Failed to finalize match:", err);
      const isAbort = err instanceof Error && err.name === "AbortError";

      let errorText =
        "Failed to finalize match. Please verify connection and try again.";
      if (isAbort) {
        errorText =
          "Request timed out or was cancelled. Please check backend sync and retry.";
      } else if (err instanceof Error) {
        errorText = err.message;
      }

      setErrorMessage(errorText);
      setIsSubmitting(false);
    }
  };

  const handleReportClose = () => {
    setIsReportOpen(false);
    setCompletedMatchContext(null);

    dispatch(navigateToMyMatches());
    dispatch(resetMatchState());

    if (onSuccess) {
      onSuccess();
    }
    onClose();
  };

  if (isReportOpen && completedMatchContext) {
    return (
      <MatchReportModal
        isOpen={isReportOpen}
        matchId={completedMatchContext.matchId}
        teamId={completedMatchContext.teamId}
        onClose={handleReportClose}
      />
    );
  }

  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 w-full h-full max-w-none max-h-none border-none m-0"
    >
      <div className="w-full max-w-xs bg-gray-900 border border-gray-800 text-white rounded-2xl shadow-2xl p-4 flex flex-col space-y-4">
        <header className="border-b border-gray-800 pb-2 text-center">
          <h3
            id="modal-title"
            className="text-sm font-black uppercase text-emerald-400 tracking-wider"
          >
            Match Result Finalization
          </h3>
          <p className="text-[10px] text-gray-400 mt-0.5">
            Confirm scores and weather/pool temperature
          </p>
        </header>

        {isPeriodActive && (
          <div
            role="note"
            className="p-2 text-[10px] bg-amber-900/40 border border-amber-800 text-amber-200 rounded-lg text-center font-medium"
          >
            Period {periodNumber} is currently active. Finalizing will
            automatically end the active period and close player lineups.
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="p-2 text-[11px] bg-red-900/50 border border-red-800 text-red-200 rounded-lg text-center font-medium"
          >
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label
              htmlFor="home-score-input"
              className="block text-[10px] uppercase font-bold text-gray-400"
            >
              Home Team Score <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  handleScoreStepper(setHomeScoreInput, homeScoreInput, -1)
                }
                disabled={isSubmitting}
                className="w-10 h-10 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-40 text-white font-black text-lg rounded-lg transition-colors border border-gray-700"
              >
                -
              </button>
              <input
                id="home-score-input"
                type="text"
                inputMode="numeric"
                value={homeScoreInput}
                onChange={(e) => setHomeScoreInput(e.target.value)}
                disabled={isSubmitting}
                className="flex-1 h-10 bg-gray-950 border border-gray-800 rounded-lg text-center font-mono font-bold text-base text-emerald-400 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() =>
                  handleScoreStepper(setHomeScoreInput, homeScoreInput, 1)
                }
                disabled={isSubmitting}
                className="w-10 h-10 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-40 text-white font-black text-lg rounded-lg transition-colors border border-gray-700"
              >
                +
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="guest-score-input"
              className="block text-[10px] uppercase font-bold text-gray-400"
            >
              Guest Team Score <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  handleScoreStepper(setGuestScoreInput, guestScoreInput, -1)
                }
                disabled={isSubmitting}
                className="w-10 h-10 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-40 text-white font-black text-lg rounded-lg transition-colors border border-gray-700"
              >
                -
              </button>
              <input
                id="guest-score-input"
                type="text"
                inputMode="numeric"
                value={guestScoreInput}
                onChange={(e) => setGuestScoreInput(e.target.value)}
                disabled={isSubmitting}
                className="flex-1 h-10 bg-gray-950 border border-gray-800 rounded-lg text-center font-mono font-bold text-base text-emerald-400 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() =>
                  handleScoreStepper(setGuestScoreInput, guestScoreInput, 1)
                }
                disabled={isSubmitting}
                className="w-10 h-10 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-40 text-white font-black text-lg rounded-lg transition-colors border border-gray-700"
              >
                +
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="temperature-input"
              className="block text-[10px] uppercase font-bold text-gray-400"
            >
              Temperature (°C) <span className="text-gray-500">(Optional)</span>
            </label>
            <input
              id="temperature-input"
              type="text"
              inputMode="decimal"
              placeholder="e.g., 26.5"
              value={temperatureInput}
              onChange={(e) => setTemperatureInput(e.target.value)}
              disabled={isSubmitting}
              className={`w-full h-10 bg-gray-950 border rounded-lg px-3 text-center font-mono text-sm text-gray-200 focus:outline-none disabled:opacity-50 ${
                !isValidTemperature
                  ? "border-red-600 focus:border-red-500"
                  : "border-gray-800 focus:border-emerald-500"
              }`}
            />
            {!isValidTemperature && (
              <span className="block text-[9px] text-red-400 text-center">
                Enter a valid numeric temperature value.
              </span>
            )}
          </div>

          <div className="pt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="py-3 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 font-bold text-xs uppercase rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isFormValid}
              className="py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-black text-xs uppercase rounded-xl transition-colors shadow-lg"
            >
              {isSubmitting ? "Submitting..." : "Confirm & Submit"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
};
