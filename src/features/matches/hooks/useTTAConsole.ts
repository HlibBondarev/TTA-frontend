import { useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useMatchLifecycle } from "./useMatchLifecycle";
import { useGameEvents } from "./useGameEvents";
import { resetMatchState } from "../store/matchSlice";
import { resetPresenceState } from "../../playerpresences/store/presenceSlice";
import type { RootState, AppDispatch } from "../../../store";

export interface UseTTAConsoleOptions {
  onCompleteMatch?: () => void;
}

export function useTTAConsole({ onCompleteMatch }: UseTTAConsoleOptions = {}) {
  const dispatch = useDispatch<AppDispatch>();
  const activeMatchId = useSelector(
    (state: RootState) => state.match.activeMatchId,
  );
  const { periodNumber, isPeriodActive, isInsideStoppage } =
    useMatchLifecycle();

  const { recordGameEvent } = useGameEvents(activeMatchId || "");

  const [pendingAction, setPendingAction] = useState<{
    name: string;
    isPositive: boolean;
    eventDefinitionId: string;
  } | null>(null);
  const [pendingLocation, setPendingLocation] = useState<{
    locationX: number;
    locationY: number;
  } | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [consoleError, setConsoleError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [prevPeriod, setPrevPeriod] = useState(periodNumber);

  if (periodNumber !== prevPeriod) {
    setPrevPeriod(periodNumber);
    setPendingAction(null);
    setPendingLocation(null);
    setSelectedPlayerId(null);
    setConsoleError(null);
  }

  const isRecordingEnabled = isPeriodActive && !isInsideStoppage;

  const handleFinalizeSuccess = () => {
    dispatch(resetMatchState());
    dispatch(resetPresenceState());
    if (onCompleteMatch) {
      onCompleteMatch();
    }
  };

  const clearPendingAction = () => {
    setPendingAction(null);
    setPendingLocation(null);
    setConsoleError(null);
  };

  const handleLocationSelect = (x: number | null, y: number | null) => {
    if (x === null || y === null) {
      setPendingLocation(null);
    } else {
      setPendingLocation({ locationX: x, locationY: y });
    }
  };

  const handleEnter = async () => {
    if (
      pendingAction?.eventDefinitionId &&
      selectedPlayerId &&
      activeMatchId &&
      !isSubmitting
    ) {
      setIsSubmitting(true);
      setConsoleError(null);
      try {
        await recordGameEvent({
          selectedPlayerId,
          actionName: pendingAction.name,
          isPositive: pendingAction.isPositive,
          eventDefinitionId: pendingAction.eventDefinitionId,
          isLeadToGoal: false,
          locationX: pendingLocation?.locationX ?? null,
          locationY: pendingLocation?.locationY ?? null,
        });

        setPendingAction(null);
        setPendingLocation(null);
        setSelectedPlayerId(null);
      } catch (err: unknown) {
        console.error("Failed to record game event:", err);
        setConsoleError(
          err instanceof Error
            ? err.message
            : "Failed to record action into database.",
        );
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleActionSelect = (
    name: string,
    isPositive: boolean,
    eventDefinitionId?: string,
  ) => {
    setConsoleError(null);
    if (!eventDefinitionId) return;
    setPendingAction({ name, isPositive, eventDefinitionId });
  };

  return {
    activeMatchId,
    periodNumber,
    isRecordingEnabled,
    pendingAction,
    pendingLocation,
    selectedPlayerId,
    setSelectedPlayerId,
    consoleError,
    isSubmitting,
    handleFinalizeSuccess,
    handleEnter,
    handleActionSelect,
    handleLocationSelect,
    clearPendingAction,
  };
}
