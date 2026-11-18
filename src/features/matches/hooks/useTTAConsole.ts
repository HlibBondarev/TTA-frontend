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

const isPendingRemovalOutcome = (result: unknown): boolean =>
  typeof result === "object" &&
  result !== null &&
  "removalPending" in result &&
  (result as { removalPending?: unknown }).removalPending === true;

export function useTTAConsole({ onCompleteMatch }: UseTTAConsoleOptions = {}) {
  const dispatch = useDispatch<AppDispatch>();
  const activeMatchId = useSelector(
    (state: RootState) => state.match.activeMatchId,
  );
  const activeLineupIds = useSelector(
    (state: RootState) => state.presence?.activeLineupIds ?? [],
  );
  const { periodNumber, isPeriodActive, isInsideStoppage } =
    useMatchLifecycle();

  const {
    recordGameEvent,
    hasPendingRemovals = false,
    retryPendingDisciplinaryRemovals,
    clearPendingRemovals,
  } = useGameEvents(activeMatchId || "");

  const [pendingAction, setPendingAction] = useState<{
    name: string;
    isPositive: boolean;
    eventDefinitionId: string;
  } | null>(null);
  const [pendingLocation, setPendingLocation] = useState<{
    locationX: number;
    locationY: number;
  } | null>(null);
  const [pendingShotLocation, setPendingShotLocation] = useState<{
    shotLocationX: number;
    shotLocationY: number;
  } | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [consoleError, setConsoleError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [prevPeriod, setPrevPeriod] = useState(periodNumber);
  const [prevActiveLineupIds, setPrevActiveLineupIds] =
    useState<string[]>(activeLineupIds);

  if (periodNumber !== prevPeriod) {
    setPrevPeriod(periodNumber);
    setPendingAction(null);
    setPendingLocation(null);
    setPendingShotLocation(null);
    setSelectedPlayerId(null);
    setConsoleError(null);
  }

  if (activeLineupIds !== prevActiveLineupIds) {
    const wasSelectedPreviouslyActive =
      selectedPlayerId !== null &&
      prevActiveLineupIds.includes(selectedPlayerId);
    setPrevActiveLineupIds(activeLineupIds);
    if (
      selectedPlayerId !== null &&
      !activeLineupIds.includes(selectedPlayerId) &&
      (wasSelectedPreviouslyActive || activeLineupIds.length > 0)
    ) {
      setSelectedPlayerId(null);
    }
  }

  const isRecordingEnabled = isPeriodActive && !isInsideStoppage;

  const handleFinalizeSuccess = () => {
    clearPendingRemovals?.();
    dispatch(resetMatchState());
    dispatch(resetPresenceState());
    if (onCompleteMatch) {
      onCompleteMatch();
    }
  };

  const clearPendingAction = () => {
    setPendingAction(null);
    setPendingLocation(null);
    setPendingShotLocation(null);
    setConsoleError(null);
  };

  const handleLocationSelect = (x: number | null, y: number | null) => {
    if (isSubmitting) return;
    if (x === null || y === null) {
      setPendingLocation(null);
    } else {
      setPendingLocation({ locationX: x, locationY: y });
    }
  };

  const handleShotLocationSelect = (x: number | null, y: number | null) => {
    if (isSubmitting) return;
    if (x === null || y === null) {
      setPendingShotLocation(null);
    } else {
      setPendingShotLocation({ shotLocationX: x, shotLocationY: y });
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
        const result = await recordGameEvent({
          selectedPlayerId,
          actionName: pendingAction.name,
          isPositive: pendingAction.isPositive,
          eventDefinitionId: pendingAction.eventDefinitionId,
          isLeadToGoal: false,
          locationX: pendingLocation?.locationX ?? null,
          locationY: pendingLocation?.locationY ?? null,
          shotLocationX: pendingShotLocation?.shotLocationX ?? null,
          shotLocationY: pendingShotLocation?.shotLocationY ?? null,
        });

        setPendingAction(null);
        setPendingLocation(null);
        setPendingShotLocation(null);
        setSelectedPlayerId(null);

        if (isPendingRemovalOutcome(result)) {
          setConsoleError(
            "Event saved, but automatic player removal failed. Retry removal.",
          );
        }
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

  const retryPendingRemovals = async (): Promise<boolean> => {
    if (isSubmitting || !retryPendingDisciplinaryRemovals) return false;
    setIsSubmitting(true);
    setConsoleError(null);
    try {
      const completed = await retryPendingDisciplinaryRemovals();
      if (!completed) {
        setConsoleError("Player removal is still pending. Please retry again.");
      }
      return completed;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleActionSelect = (
    name: string,
    isPositive: boolean,
    eventDefinitionId?: string,
    isShot?: boolean,
  ) => {
    setConsoleError(null);
    if (!eventDefinitionId) return;
    setPendingAction({ name, isPositive, eventDefinitionId });
    if (!isShot) {
      setPendingShotLocation(null);
    }
  };

  return {
    activeMatchId,
    periodNumber,
    isRecordingEnabled,
    pendingAction,
    pendingLocation,
    pendingShotLocation,
    selectedPlayerId,
    setSelectedPlayerId,
    consoleError,
    isSubmitting,
    hasPendingRemovals,
    retryPendingRemovals,
    handleFinalizeSuccess,
    handleEnter,
    handleActionSelect,
    handleLocationSelect,
    handleShotLocationSelect,
    clearPendingAction,
  };
}
