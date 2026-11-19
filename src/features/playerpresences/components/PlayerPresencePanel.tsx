import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSelector } from "react-redux";
import { usePlayerPresence } from "../hooks/usePlayerPresence";
import { useMatchDisciplinaryState } from "../hooks/useMatchDisciplinaryState";
import { db } from "../../../db/ttaDatabase";
import type { MatchLineupLookup } from "../../../db/ttaDatabase";
import {
  EMPTY_DISCIPLINARY_STATUS,
  type PlayerDisciplinaryStatus,
} from "../../../utils/disciplinaryUtils";
import type { RootState } from "../../../store";

const getFilledPipColorClass = (status: PlayerDisciplinaryStatus): string => {
  if (status.isDisqualified) return "bg-red-500";
  if (status.isWarning) return "bg-orange-400";
  return "bg-amber-400";
};

const FoulPips: React.FC<{
  maxPersonalFouls: number | null;
  status: PlayerDisciplinaryStatus;
}> = ({ maxPersonalFouls, status }) => {
  if (maxPersonalFouls === null || maxPersonalFouls <= 0) {
    return null;
  }

  const filledColor = getFilledPipColorClass(status);
  const pipSlots = Array.from({ length: maxPersonalFouls }, (_, idx) => idx);

  return (
    <span
      aria-hidden="true"
      data-testid="foul-pips"
      data-foul-warning={status.isWarning ? "true" : undefined}
      className="flex items-center justify-center gap-0.5 mt-0.5"
    >
      {pipSlots.map((slotIndex) => {
        const isFilled = slotIndex < status.personalFouls;
        return (
          <span
            key={slotIndex}
            data-foul-pip={isFilled ? "filled" : "empty"}
            className={`w-1.5 h-1.5 rounded-full ${
              isFilled ? filledColor : "bg-gray-600/50"
            }`}
          />
        );
      })}
    </span>
  );
};

const getActiveButtonClassName = (
  isSelected: boolean,
  status: PlayerDisciplinaryStatus,
): string => {
  const base =
    "flex flex-col items-center justify-center p-1.5 min-h-11 rounded text-xs font-bold transition-colors";
  const bg = isSelected ? "bg-blue-600" : "bg-blue-950";
  const warningAccent = status.isWarning ? " ring-1 ring-amber-400/80" : "";
  return `${base} ${bg}${warningAccent}`;
};

const getBenchButtonClassName = (
  isStaged: boolean,
  status: PlayerDisciplinaryStatus,
): string => {
  const base =
    "flex flex-col items-center justify-center p-1.5 min-h-11 rounded text-xs font-bold transition-colors";

  if (status.isDisqualified) {
    return `${base} bg-red-950/70 text-red-400/70 border border-red-800/80 line-through opacity-60 cursor-not-allowed`;
  }
  if (status.isServingTimedExclusion) {
    return `${base} border-2 border-orange-400 bg-orange-950/60 text-orange-200 ring-1 ring-orange-400/50`;
  }
  if (isStaged) {
    return `${base} bg-emerald-600 text-white`;
  }
  if (status.isWarning) {
    return `${base} bg-gray-800 text-gray-300 ring-1 ring-amber-400/80`;
  }
  return `${base} bg-gray-800 text-gray-300`;
};

const getPlayerAccessibilityLabel = (
  playerLabel: string,
  maxPersonalFouls: number | null,
  status: PlayerDisciplinaryStatus,
): string | undefined => {
  const details: string[] = [];

  if (status.isDisqualified) {
    details.push("disqualified");
  } else if (status.isServingTimedExclusion) {
    details.push("serving timed exclusion");
  }

  if (maxPersonalFouls !== null && maxPersonalFouls > 0 && status.personalFouls > 0) {
    const warningText = status.isWarning ? ", foul warning" : "";
    details.push(
      `${status.personalFouls} of ${maxPersonalFouls} personal fouls${warningText}`,
    );
  }

  if (details.length === 0) {
    return undefined;
  }

  return `${playerLabel} (${details.join(", ")})`;
};

export const PlayerPresencePanel: React.FC<{
  matchId: string;
  selectedPlayerId: string | null;
  setSelectedPlayerId: (id: string | null) => void;
}> = ({ matchId, selectedPlayerId, setSelectedPlayerId }) => {
  const {
    currentPeriod,
    activeLineupIds,
    benchLineupIds,
    activePlayersLimit,
    refreshPresenceFromDB,
    executeSubstitution,
    enterPlayerFromBench,
    stageStartingLineup,
    selectedStartingIds,
  } = usePlayerPresence(matchId);

  const isPeriodActive = useSelector(
    (state: RootState) => state.match.isPeriodActive,
  );
  const isPeriodEnded = useSelector(
    (state: RootState) => state.match.isPeriodEnded,
  );

  const { maxPersonalFouls, disciplinaryByLineupId } =
    useMatchDisciplinaryState({
      matchId,
      currentPeriod,
      isPeriodActive,
      activeLineupIds,
      activePlayersLimit,
    });

  const [lineupsMap, setLineupsMap] = useState<
    Record<string, MatchLineupLookup>
  >({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isMutatingPresenceRef = useRef(false);

  const [prevLifecycle, setPrevLifecycle] = useState({
    currentPeriod,
    isPeriodActive,
    isPeriodEnded,
  });

  if (
    prevLifecycle.currentPeriod !== currentPeriod ||
    prevLifecycle.isPeriodActive !== isPeriodActive ||
    prevLifecycle.isPeriodEnded !== isPeriodEnded
  ) {
    setPrevLifecycle({ currentPeriod, isPeriodActive, isPeriodEnded });
    setErrorMessage(null);
  }

  const loadRosterData = useCallback(
    async (ignore: boolean) => {
      try {
        const lineups = await db.matchlineups
          .where("matchId")
          .equals(matchId)
          .toArray();

        if (!ignore) {
          const map: Record<string, MatchLineupLookup> = {};
          lineups.forEach((l) => (map[l.id] = l));
          setLineupsMap(map);
          await refreshPresenceFromDB(currentPeriod);
          return lineups.length > 0;
        }
      } catch {
        if (!ignore) {
          setErrorMessage("Failed to fetch fresh roster data.");
        }
      }
      return false;
    },
    [matchId, currentPeriod, refreshPresenceFromDB],
  );

  useEffect(() => {
    let ignore = false;

    const initLoad = async () => {
      const success = await loadRosterData(ignore);
      if (!success && !ignore) {
        setTimeout(async () => {
          await loadRosterData(ignore);
        }, 300);
      }
    };

    void initLoad();

    return () => {
      ignore = true;
    };
  }, [matchId, currentPeriod, isPeriodActive, isPeriodEnded, loadRosterData]);

  useEffect(() => {
    if (isPeriodActive || selectedStartingIds.length === 0) return;

    const eligibleIds = selectedStartingIds.filter(
      (id) => !disciplinaryByLineupId[id]?.isDisqualified,
    );
    if (eligibleIds.length !== selectedStartingIds.length) {
      try {
        stageStartingLineup(eligibleIds);
      } catch {
        // Ignore staging limit errors while reconciling disqualified players
      }
    }
  }, [
    isPeriodActive,
    selectedStartingIds,
    disciplinaryByLineupId,
    stageStartingLineup,
  ]);

  // Sort active lineup IDs ascending by player shirt/cap number
  const sortedActiveLineupIds = useMemo(() => {
    return [...activeLineupIds].sort((a, b) => {
      const numA = lineupsMap[a]?.number ?? Number.MAX_SAFE_INTEGER;
      const numB = lineupsMap[b]?.number ?? Number.MAX_SAFE_INTEGER;
      return numA - numB;
    });
  }, [activeLineupIds, lineupsMap]);

  // Sort bench lineup IDs ascending by player shirt/cap number
  const sortedBenchLineupIds = useMemo(() => {
    return [...benchLineupIds].sort((a, b) => {
      const numA = lineupsMap[a]?.number ?? Number.MAX_SAFE_INTEGER;
      const numB = lineupsMap[b]?.number ?? Number.MAX_SAFE_INTEGER;
      return numA - numB;
    });
  }, [benchLineupIds, lineupsMap]);

  const handleActiveTap = (id: string) => {
    setErrorMessage(null);

    if (isPeriodActive) {
      const newId = selectedPlayerId === id ? null : id;
      setSelectedPlayerId(newId);
    }
  };

  const handleActivePeriodBenchTap = async (benchId: string) => {
    if (isMutatingPresenceRef.current) return;

    if (selectedPlayerId) {
      isMutatingPresenceRef.current = true;
      try {
        await executeSubstitution(selectedPlayerId, benchId, currentPeriod);
        setSelectedPlayerId(null);
      } catch {
        setErrorMessage("Substitution failed.");
      } finally {
        isMutatingPresenceRef.current = false;
      }
      return;
    }

    const isShorthanded =
      activePlayersLimit > 0 && activeLineupIds.length < activePlayersLimit;

    if (isShorthanded) {
      isMutatingPresenceRef.current = true;
      try {
        await enterPlayerFromBench(benchId, currentPeriod);
      } catch {
        setErrorMessage("Failed to enter player into active roster.");
      } finally {
        isMutatingPresenceRef.current = false;
      }
      return;
    }

    setErrorMessage(
      "Please select an active player in the water first to substitute out.",
    );
  };

  const handleBenchTap = async (benchId: string) => {
    const status = disciplinaryByLineupId[benchId] ?? EMPTY_DISCIPLINARY_STATUS;
    const isStaged = selectedStartingIds.includes(benchId);

    if (status.isDisqualified) {
      if (!isPeriodActive && isStaged) {
        setErrorMessage(null);
        try {
          stageStartingLineup(
            selectedStartingIds.filter((id) => id !== benchId),
          );
        } catch (e: unknown) {
          setErrorMessage(
            e instanceof Error ? e.message : "An unknown error occurred.",
          );
        }
      }
      return;
    }

    setErrorMessage(null);

    if (isPeriodActive) {
      await handleActivePeriodBenchTap(benchId);
      return;
    }

    try {
      const newSelection = isStaged
        ? selectedStartingIds.filter((id) => id !== benchId)
        : [...selectedStartingIds, benchId];
      stageStartingLineup(newSelection);
    } catch (e: unknown) {
      setErrorMessage(
        e instanceof Error ? e.message : "An unknown error occurred.",
      );
    }
  };

  return (
    <div className="w-full p-2 bg-gray-900 text-white rounded-xl border border-gray-800">
      <h3 className="text-sm font-bold mb-2">Period {currentPeriod} Roster</h3>
      {errorMessage && (
        <div role="alert" className="text-red-500 text-[10px] mb-2">
          {errorMessage}
        </div>
      )}

      <h4 className="text-[10px] uppercase text-gray-400 mb-1">
        Active Players
      </h4>
      <div className="grid grid-cols-4 gap-1 mb-2">
        {sortedActiveLineupIds.map((id) => {
          const status =
            disciplinaryByLineupId[id] ?? EMPTY_DISCIPLINARY_STATUS;
          const playerLabel = `#${lineupsMap[id]?.number || ""}`;
          const ariaLabel = getPlayerAccessibilityLabel(
            playerLabel,
            maxPersonalFouls,
            status,
          );

          return (
            <button
              key={id}
              type="button"
              onClick={() => handleActiveTap(id)}
              aria-pressed={selectedPlayerId === id}
              aria-label={ariaLabel}
              title={ariaLabel}
              className={getActiveButtonClassName(
                selectedPlayerId === id,
                status,
              )}
            >
              <span>{playerLabel}</span>
              <FoulPips maxPersonalFouls={maxPersonalFouls} status={status} />
            </button>
          );
        })}
      </div>

      <h4 className="text-[10px] uppercase text-gray-400 mb-1">Bench</h4>
      <div className="grid grid-cols-4 gap-1">
        {sortedBenchLineupIds.map((id) => {
          const status =
            disciplinaryByLineupId[id] ?? EMPTY_DISCIPLINARY_STATUS;
          const isStaged = selectedStartingIds.includes(id);
          const playerLabel = `#${lineupsMap[id]?.number || ""}`;
          const ariaLabel = getPlayerAccessibilityLabel(
            playerLabel,
            maxPersonalFouls,
            status,
          );

          return (
            <button
              key={id}
              type="button"
              disabled={status.isDisqualified && (isPeriodActive || !isStaged)}
              onClick={() => void handleBenchTap(id)}
              aria-pressed={isStaged}
              aria-label={ariaLabel}
              title={ariaLabel}
              data-disqualified={status.isDisqualified ? "true" : undefined}
              data-exclusion-active={
                status.isServingTimedExclusion ? "true" : undefined
              }
              className={getBenchButtonClassName(isStaged, status)}
            >
              <span>{playerLabel}</span>
              <FoulPips maxPersonalFouls={maxPersonalFouls} status={status} />
            </button>
          );
        })}
      </div>
    </div>
  );
};
