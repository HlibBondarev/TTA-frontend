import React, { useEffect, useState } from "react";
import { usePlayerPresence } from "../hooks/usePlayerPresence";
import { db } from "../../../db/ttaDatabase";
import type { MatchLineupLookup } from "../../../db/ttaDatabase";
import { useSelector } from "react-redux";
import type { RootState } from "../../../store";

export const PlayerPresencePanel: React.FC<{
  matchId: string;
  onPlayerSelect?: (lineupId: string | null) => void;
}> = ({ matchId, onPlayerSelect }) => {
  const {
    currentPeriod,
    activeLineupIds,
    benchLineupIds,
    refreshPresenceFromDB,
    executeSubstitution,
    stageStartingLineup,
    selectedStartingIds,
  } = usePlayerPresence(matchId);

  // Check if the match is currently active
  const isPeriodActive = useSelector(
    (state: RootState) => state.match.isPeriodActive,
  );

  const [lineupsMap, setLineupsMap] = useState<
    Record<string, MatchLineupLookup>
  >({});
  const [selectedActiveId, setSelectedActiveId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const lineups = await db.matchlineups
          .where("matchid")
          .equals(matchId)
          .toArray();
        const map: Record<string, MatchLineupLookup> = {};
        lineups.forEach((l) => (map[l.id] = l));
        setLineupsMap(map);
        await refreshPresenceFromDB();
      } catch {
        setErrorMessage("Failed to fetch fresh roster data.");
      }
    };
    load();
  }, [matchId, refreshPresenceFromDB]);

  const handleActiveTap = (id: string) => {
    // Only allow selection if the period is active
    if (isPeriodActive) {
      const newId = selectedActiveId === id ? null : id;
      setSelectedActiveId(newId);
      if (onPlayerSelect) onPlayerSelect(newId);
    }
  };

  const handleBenchTap = async (benchId: string) => {
    setErrorMessage(null);

    if (isPeriodActive) {
      // Handle substitution logic during an active period
      if (selectedActiveId) {
        try {
          await executeSubstitution(selectedActiveId, benchId);
          setSelectedActiveId(null);
        } catch {
          setErrorMessage("Substitution failed.");
        }
      } else {
        setErrorMessage(
          "Please select an active player in the water first to substitute out.",
        );
      }
    } else {
      // Handle starting lineup selection before the period starts
      try {
        const newSelection = selectedStartingIds.includes(benchId)
          ? selectedStartingIds.filter((id) => id !== benchId)
          : [...selectedStartingIds, benchId];
        stageStartingLineup(newSelection);
      } catch (e: unknown) {
        // Correctly handle the error type to satisfy ESLint
        const errorMessage =
          e instanceof Error ? e.message : "An unknown error occurred.";
        setErrorMessage(errorMessage);
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
        {activeLineupIds.map((id) => (
          <button
            key={id}
            onClick={() => handleActiveTap(id)}
            className={`p-2 rounded text-xs ${selectedActiveId === id ? "bg-blue-600" : "bg-blue-950"}`}
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
            onClick={() => handleBenchTap(id)}
            className={`p-2 rounded text-xs ${selectedStartingIds.includes(id) ? "bg-emerald-600" : "bg-gray-800"}`}
          >
            {`#${lineupsMap[id]?.number || ""}`}
          </button>
        ))}
      </div>
    </div>
  );
};
