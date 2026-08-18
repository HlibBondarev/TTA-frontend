import React, { useEffect, useState, useCallback, useMemo } from "react";
import { usePlayerPresence } from "../hooks/usePlayerPresence";
import { db } from "../../../db/ttaDatabase";
import type { MatchLineupLookup } from "../../../db/ttaDatabase";
import { useSelector } from "react-redux";
import type { RootState } from "../../../store";

export const PlayerPresencePanel: React.FC<{
  matchId: string;
  selectedPlayerId: string | null;
  setSelectedPlayerId: (id: string | null) => void;
}> = ({ matchId, selectedPlayerId, setSelectedPlayerId }) => {
  const {
    currentPeriod,
    activeLineupIds,
    benchLineupIds,
    refreshPresenceFromDB,
    executeSubstitution,
    stageStartingLineup,
    selectedStartingIds,
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

    initLoad();

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

  const handleActiveTap = (id: string) => {
    setErrorMessage(null);

    if (isPeriodActive) {
      const newId = selectedPlayerId === id ? null : id;
      setSelectedPlayerId(newId);
    }
  };

  const handleBenchTap = async (benchId: string) => {
    setErrorMessage(null);

    if (isPeriodActive) {
      if (selectedPlayerId) {
        try {
          await executeSubstitution(selectedPlayerId, benchId, currentPeriod);
          setSelectedPlayerId(null);
        } catch {
          setErrorMessage("Substitution failed.");
        }
      } else {
        setErrorMessage(
          "Please select an active player in the water first to substitute out.",
        );
      }
    } else {
      try {
        const newSelection = selectedStartingIds.includes(benchId)
          ? selectedStartingIds.filter((id) => id !== benchId)
          : [...selectedStartingIds, benchId];
        stageStartingLineup(newSelection);
      } catch (e: unknown) {
        setErrorMessage(
          e instanceof Error ? e.message : "An unknown error occurred.",
        );
      }
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
        {sortedActiveLineupIds.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => handleActiveTap(id)}
            aria-pressed={selectedPlayerId === id}
            className={`p-2 min-h-11 rounded text-xs font-bold transition-colors ${
              selectedPlayerId === id ? "bg-blue-600" : "bg-blue-950"
            }`}
          >
            {`#${lineupsMap[id]?.number || ""}`}
          </button>
        ))}
      </div>

      <h4 className="text-[10px] uppercase text-gray-400 mb-1">Bench</h4>
      <div className="grid grid-cols-4 gap-1">
        {sortedBenchLineupIds.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => void handleBenchTap(id)}
            aria-pressed={selectedStartingIds.includes(id)}
            className={`p-2 min-h-11 rounded text-xs font-bold transition-colors ${
              selectedStartingIds.includes(id)
                ? "bg-emerald-600 text-white"
                : "bg-gray-800 text-gray-300"
            }`}
          >
            {`#${lineupsMap[id]?.number || ""}`}
          </button>
        ))}
      </div>
    </div>
  );
};
