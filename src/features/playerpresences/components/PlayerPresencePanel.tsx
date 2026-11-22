import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { usePlayerPresence } from "../hooks/usePlayerPresence";
import { db } from "../../../db/ttaDatabase";
import type { MatchLineupLookup } from "../../../db/ttaDatabase";
import { useSelector } from "react-redux";
import type { RootState } from "../../../store";
import type { PlayerDisciplinaryStatus } from "../utils/disciplinaryUtils";

interface PlayerTileBadgesProps {
  status?: PlayerDisciplinaryStatus;
  maxPersonalFouls?: number | null;
  hasEffectiveTimedExclusion?: boolean;
}

const PlayerTileBadges: React.FC<PlayerTileBadgesProps> = ({
  status,
  maxPersonalFouls,
  hasEffectiveTimedExclusion,
}) => {
  const showFouls =
    maxPersonalFouls !== null && (status?.personalFoulCount ?? 0) > 0;
  const isDisqualified = Boolean(status?.isDisqualified);
  const hasTimedExclusion =
    hasEffectiveTimedExclusion ?? Boolean(status?.hasActiveTimedExclusion);

  if (!showFouls && !isDisqualified && !hasTimedExclusion) {
    return null;
  }

  return (
    <span className="inline-flex items-center gap-0.5 ml-1 align-middle">
      {showFouls && (
        <span
          data-testid="foul-count-badge"
          className={`px-1 rounded text-[9px] font-extrabold leading-tight ${
            status?.hasFoulWarning
              ? "bg-amber-500 text-gray-950"
              : "bg-gray-700 text-gray-200"
          }`}
        >
          {`F${status?.personalFoulCount ?? 0}`}
        </span>
      )}
      {hasTimedExclusion && (
        <span
          data-testid="timed-exclusion-badge"
          className="px-1 rounded text-[9px] font-extrabold leading-tight bg-amber-600 text-white"
        >
          EX
        </span>
      )}
      {isDisqualified && (
        <span
          data-testid="dq-badge"
          className="px-1 rounded text-[9px] font-extrabold leading-tight bg-rose-600 text-white"
        >
          DQ
        </span>
      )}
    </span>
  );
};

const getActivePlayerButtonClass = (
  isSelected: boolean,
  status?: PlayerDisciplinaryStatus,
): string => {
  if (isSelected) {
    return "bg-blue-600 ring-1 ring-blue-300";
  }
  if (status?.hasFoulWarning) {
    return "bg-blue-950 ring-1 ring-amber-400";
  }
  return "bg-blue-950";
};

interface BenchPlayerButtonClassParams {
  isSelectedStarter: boolean;
  isPeriodActive: boolean;
  isHighlightedCarryover: boolean;
  hasEffectiveTimedExclusion: boolean;
  isShorthandedEntryArmed: boolean;
  status?: PlayerDisciplinaryStatus;
}

const getBenchPlayerButtonClass = ({
  isSelectedStarter,
  isPeriodActive,
  isHighlightedCarryover,
  hasEffectiveTimedExclusion,
  isShorthandedEntryArmed,
  status,
}: BenchPlayerButtonClassParams): string => {
  if (!isPeriodActive && isSelectedStarter) {
    return "bg-emerald-600 text-white";
  }
  if (!isPeriodActive && isHighlightedCarryover) {
    return "bg-amber-900/70 text-amber-100 ring-1 ring-amber-400";
  }
  if (status?.isDisqualified) {
    return "bg-rose-950/60 text-rose-300 opacity-60 cursor-not-allowed";
  }
  if (hasEffectiveTimedExclusion) {
    return isShorthandedEntryArmed
      ? "bg-amber-950/80 text-amber-200 ring-2 ring-emerald-400"
      : "bg-amber-950/80 text-amber-200 ring-1 ring-amber-500/70";
  }
  if (isShorthandedEntryArmed) {
    return "bg-emerald-950/70 text-emerald-100 ring-1 ring-emerald-400";
  }
  if (status?.hasFoulWarning) {
    return "bg-gray-800 text-gray-200 ring-1 ring-amber-400/80";
  }
  return "bg-gray-800 text-gray-300";
};

const getShorthandedControlClass = (
  isArmed: boolean,
  canEnterShorthanded: boolean,
): string => {
  if (!canEnterShorthanded) {
    return "bg-amber-900/70 border-amber-600 text-amber-200 cursor-default";
  }
  if (isArmed) {
    return "bg-emerald-700 hover:bg-emerald-600 border-emerald-300 text-white ring-1 ring-emerald-300 cursor-pointer";
  }
  return "bg-amber-900/80 hover:bg-amber-800/90 border-amber-500 text-amber-100 cursor-pointer";
};

const getShorthandedControlLabel = (
  isArmed: boolean,
  activeCount: number,
  maxAllowedCount: number,
): string => {
  const ratio = `${activeCount}/${maxAllowedCount}`;
  return isArmed
    ? `Enter Player ${ratio} · Cancel`
    : `Shorthanded ${ratio}`;
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
    selectedStartingIds,
    activePlayersLimit,
    maxPersonalFouls,
    disciplinaryState,
    carryoverState,
    requiredStartingPlayers,
    maxAllowedActive,
    isShorthanded,
    refreshPresenceFromDB,
    executeSubstitution,
    enterShorthandedPlayer,
    stageStartingLineup,
    handlePrePeriodBenchTap,
    resetPrePeriodClearedPenalties,
  } = usePlayerPresence(matchId);

  const isPeriodActive = useSelector(
    (state: RootState) => state.match.isPeriodActive,
  );
  const isPeriodEnded = useSelector(
    (state: RootState) => state.match.isPeriodEnded,
  );

  const [lineupsMap, setLineupsMap] = useState<
    Record<string, MatchLineupLookup>
  >({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isShorthandedEntryArmed, setIsShorthandedEntryArmed] = useState(false);

  const effectiveMaxAllowedActive =
    typeof maxAllowedActive === "number"
      ? maxAllowedActive
      : (disciplinaryState?.maxAllowedActive ?? activePlayersLimit);

  const effectiveIsShorthanded =
    typeof isShorthanded === "boolean"
      ? isShorthanded
      : Boolean(
          disciplinaryState?.isShorthanded ??
            (effectiveMaxAllowedActive > 0 &&
              activeLineupIds.length < effectiveMaxAllowedActive),
        );

  const canEnterShorthanded =
    isPeriodActive &&
    effectiveIsShorthanded &&
    typeof enterShorthandedPlayer === "function";

  const [prevLifecycle, setPrevLifecycle] = useState({
    matchId,
    currentPeriod,
    isPeriodActive,
    isPeriodEnded,
  });

  if (
    prevLifecycle.matchId !== matchId ||
    prevLifecycle.currentPeriod !== currentPeriod ||
    prevLifecycle.isPeriodActive !== isPeriodActive ||
    prevLifecycle.isPeriodEnded !== isPeriodEnded
  ) {
    setPrevLifecycle({ matchId, currentPeriod, isPeriodActive, isPeriodEnded });
    setErrorMessage(null);
    setIsShorthandedEntryArmed(false);
  }

  if (
    isShorthandedEntryArmed &&
    (!canEnterShorthanded || selectedPlayerId !== null)
  ) {
    setIsShorthandedEntryArmed(false);
  }

  const selectedPlayerIdRef = useRef(selectedPlayerId);

  useEffect(() => {
    selectedPlayerIdRef.current = selectedPlayerId;
  }, [selectedPlayerId]);

  useEffect(() => {
    if (
      selectedPlayerId !== null &&
      !activeLineupIds.includes(selectedPlayerId)
    ) {
      setSelectedPlayerId(null);
    }
  }, [selectedPlayerId, activeLineupIds, setSelectedPlayerId]);

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
        setTimeout(() => {
          loadRosterData(ignore).catch(() => {});
        }, 300);
      }
    };

    initLoad().catch(() => {});

    return () => {
      ignore = true;
    };
  }, [matchId, currentPeriod, isPeriodActive, isPeriodEnded, loadRosterData]);

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

  const playersById = isPeriodActive
    ? disciplinaryState?.playersById
    : (carryoverState?.playersById ?? disciplinaryState?.playersById);

  const highlightedSet = useMemo(
    () => new Set(carryoverState?.highlightedLineupIds ?? []),
    [carryoverState?.highlightedLineupIds],
  );

  const effectiveRequiredStarters =
    typeof requiredStartingPlayers === "number"
      ? requiredStartingPlayers
      : (carryoverState?.requiredStartingPlayers ?? activePlayersLimit);

  const handleShorthandedToggle = () => {
    if (!canEnterShorthanded) {
      return;
    }
    setErrorMessage(null);
    const nextArmed = !isShorthandedEntryArmed;
    setIsShorthandedEntryArmed(nextArmed);
    if (nextArmed && selectedPlayerId !== null) {
      setSelectedPlayerId(null);
    }
  };

  const handleActiveTap = (id: string) => {
    setErrorMessage(null);
    setIsShorthandedEntryArmed(false);

    if (isPeriodActive) {
      const newId = selectedPlayerId === id ? null : id;
      setSelectedPlayerId(newId);
    }
  };

  const handleActivePeriodBenchTap = async (benchId: string) => {
    const status = playersById?.[benchId];
    if (status?.isDisqualified) {
      setErrorMessage("Disqualified player cannot enter the game.");
      return;
    }

    if (selectedPlayerId) {
      const outPlayerId = selectedPlayerId;
      try {
        await executeSubstitution(outPlayerId, benchId, currentPeriod);
        if (selectedPlayerIdRef.current === outPlayerId) {
          setSelectedPlayerId(null);
        }
      } catch {
        setErrorMessage("Substitution failed.");
      }
      return;
    }

    if (canEnterShorthanded && enterShorthandedPlayer) {
      if (isShorthandedEntryArmed) {
        setIsShorthandedEntryArmed(false);
        try {
          await enterShorthandedPlayer(benchId, currentPeriod);
        } catch {
          setErrorMessage("Failed to enter player.");
        }
        return;
      }

      setErrorMessage(
        "Select an active player to substitute, or tap Shorthanded to enter a player.",
      );
      return;
    }

    setErrorMessage(
      "Please select an active player in the water first to substitute out.",
    );
  };

  const handleInactivePeriodBenchTap = (benchId: string) => {
    try {
      if (typeof handlePrePeriodBenchTap === "function" && carryoverState) {
        handlePrePeriodBenchTap(benchId);
        return;
      }
      const newSelection = selectedStartingIds.includes(benchId)
        ? selectedStartingIds.filter((id) => id !== benchId)
        : [...selectedStartingIds, benchId];
      stageStartingLineup(newSelection);
    } catch (e: unknown) {
      setErrorMessage(
        e instanceof Error ? e.message : "An unknown error occurred.",
      );
    }
  };

  const handleBenchTap = async (benchId: string) => {
    setErrorMessage(null);

    if (isPeriodActive) {
      await handleActivePeriodBenchTap(benchId);
    } else {
      handleInactivePeriodBenchTap(benchId);
    }
  };

  return (
    <div className="w-full p-2 bg-gray-900 text-white rounded-xl border border-gray-800">
      <div className="flex items-center justify-between mb-2 gap-1">
        <h3 className="text-sm font-bold">Period {currentPeriod} Roster</h3>

        {isPeriodActive && effectiveIsShorthanded && (
          <button
            type="button"
            data-testid="shorthanded-indicator"
            aria-pressed={canEnterShorthanded && isShorthandedEntryArmed}
            disabled={!canEnterShorthanded}
            onClick={handleShorthandedToggle}
            className={`px-2 py-1 min-h-6 rounded border text-[10px] font-bold uppercase transition-colors ${getShorthandedControlClass(
              isShorthandedEntryArmed,
              canEnterShorthanded,
            )}`}
          >
            {getShorthandedControlLabel(
              canEnterShorthanded && isShorthandedEntryArmed,
              activeLineupIds.length,
              effectiveMaxAllowedActive,
            )}
          </button>
        )}

        {!isPeriodActive && (
          <div className="flex items-center gap-1.5">
            {effectiveRequiredStarters > 0 && (
              <span
                data-testid="starting-counter"
                className="text-[10px] font-mono font-bold text-gray-300"
              >
                {`${selectedStartingIds.length}/${effectiveRequiredStarters}`}
              </span>
            )}
            {carryoverState?.canResetClearedPenalties &&
              typeof resetPrePeriodClearedPenalties === "function" && (
                <button
                  type="button"
                  onClick={resetPrePeriodClearedPenalties}
                  className="px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-600 text-[9px] font-bold uppercase text-amber-300"
                >
                  Reset
                </button>
              )}
          </div>
        )}
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="px-2 py-1 mb-2 rounded bg-amber-950/90 border border-amber-500/80 text-amber-100 text-[11px] font-semibold leading-tight"
        >
          {errorMessage}
        </div>
      )}

      <h4 className="text-[10px] uppercase text-gray-400 mb-1">
        Active Players
      </h4>
      <div className="grid grid-cols-4 gap-1 mb-2">
        {sortedActiveLineupIds.map((id) => {
          const status = playersById?.[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleActiveTap(id)}
              aria-pressed={selectedPlayerId === id}
              className={`p-2 min-h-11 rounded text-xs font-bold transition-colors ${getActivePlayerButtonClass(
                selectedPlayerId === id,
                status,
              )}`}
            >
              {`#${lineupsMap[id]?.number || ""}`}
              <PlayerTileBadges
                status={status}
                maxPersonalFouls={maxPersonalFouls}
              />
            </button>
          );
        })}
      </div>

      <h4 className="text-[10px] uppercase text-gray-400 mb-1">Bench</h4>
      <div className="grid grid-cols-4 gap-1">
        {sortedBenchLineupIds.map((id) => {
          const status = playersById?.[id];
          const isSelectedStarter =
            !isPeriodActive && selectedStartingIds.includes(id);
          const isHighlightedCarryover =
            !isPeriodActive && highlightedSet.has(id);
          const isLockedDq =
            Boolean(status?.isDisqualified) &&
            !isHighlightedCarryover &&
            !isSelectedStarter;
          const hasEffectiveTimedExclusion = isPeriodActive
            ? Boolean(status?.hasActiveTimedExclusion)
            : isHighlightedCarryover;

          return (
            <button
              key={id}
              type="button"
              disabled={isLockedDq}
              onClick={() => {
                handleBenchTap(id).catch(() => {});
              }}
              aria-pressed={isSelectedStarter}
              className={`p-2 min-h-11 rounded text-xs font-bold transition-colors ${getBenchPlayerButtonClass(
                {
                  isSelectedStarter,
                  isPeriodActive,
                  isHighlightedCarryover,
                  hasEffectiveTimedExclusion,
                  isShorthandedEntryArmed:
                    canEnterShorthanded && isShorthandedEntryArmed,
                  status,
                },
              )}`}
            >
              {`#${lineupsMap[id]?.number || ""}`}
              <PlayerTileBadges
                status={status}
                maxPersonalFouls={maxPersonalFouls}
                hasEffectiveTimedExclusion={hasEffectiveTimedExclusion}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};
