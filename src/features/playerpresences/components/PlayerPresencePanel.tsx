import React, { useEffect, useState } from "react";
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

  const [lineupsMap, setLineupsMap] = useState<
    Record<string, MatchLineupLookup>
  >({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    const load = async () => {
      try {
        const lineups = await db.matchlineups
          .where("matchid")
          .equals(matchId)
          .toArray();

        // Only update state if this request is still relevant
        if (!ignore) {
          const map: Record<string, MatchLineupLookup> = {};
          lineups.forEach((l) => (map[l.id] = l));
          setLineupsMap(map);
          await refreshPresenceFromDB();
        }
      } catch {
        if (!ignore) {
          setErrorMessage("Failed to fetch fresh roster data.");
        }
      }
    };

    load();

    // Cleanup function to invalidate outdated requests
    return () => {
      ignore = true;
    };
  }, [matchId, refreshPresenceFromDB]);

  const handleActiveTap = (id: string) => {
    // Clear any previous error messages before processing the new selection
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
          await executeSubstitution(selectedPlayerId, benchId);
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
      <div className="grid grid-cols-4 gap1 mb-2">
        {activeLineupIds.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => handleActiveTap(id)}
            aria-pressed={selectedPlayerId === id}
            className={`p-2 min-h-11 rounded text-xs ${selectedPlayerId === id ? "bg-blue-600" : "bg-blue-950"}`}
          >
            {`#${lineupsMap[id]?.number || ""}`}
          </button>
        ))}
      </div>

      <h4 className="text-[10px] uppercase text-gray-400 mb-1">Bench</h4>
      <div className="grid grid-cols-4 gap-1">
        {benchLineupIds.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => handleBenchTap(id)}
            aria-pressed={selectedStartingIds.includes(id)}
            className={`p-2 min-h-11 rounded text-xs ${selectedStartingIds.includes(id) ? "bg-emerald-600" : "bg-gray-800"}`}
          >
            {`#${lineupsMap[id]?.number || ""}`}
          </button>
        ))}
      </div>
    </div>
  );
};
