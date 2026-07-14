import React, { useEffect, useState } from "react";
import { usePlayerPresence } from "../hooks/usePlayerPresence";
import { db } from "../../../db/ttaDatabase";
import type { MatchLineupLookup } from "../../../db/ttaDatabase";

interface PlayerPresencePanelProps {
  matchId: string;
}

export const PlayerPresencePanel: React.FC<PlayerPresencePanelProps> = ({
  matchId,
}) => {
  const {
    currentPeriod,
    activeLineupIds,
    benchLineupIds,
    selectedStartingIds,
    activePlayersLimit,
    refreshPresenceFromDB,
    stageStartingLineup,
    executeSubstitution,
  } = usePlayerPresence(matchId);

  const [lineupsMap, setLineupsMap] = useState<
    Record<string, MatchLineupLookup>
  >({});
  const [selectedActiveId, setSelectedActiveId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadLineupsMetadata = async () => {
      try {
        const lineups = await db.matchlineups
          .where("matchid")
          .equals(matchId)
          .toArray();

        const map: Record<string, MatchLineupLookup> = {};
        lineups.forEach((l) => {
          map[l.id] = l;
        });
        setLineupsMap(map);
      } catch (error) {
        console.error("Failed to load lineups metadata:", error);
      }
    };

    loadLineupsMetadata();
    refreshPresenceFromDB();
  }, [matchId, currentPeriod, refreshPresenceFromDB]);

  const handleActivePlayerTap = (lineupId: string) => {
    setSelectedActiveId(selectedActiveId === lineupId ? null : lineupId);
  };

  const handleBenchPlayerTap = async (benchLineupId: string) => {
    setErrorMessage(null);

    // If active lineup is empty, we are preparing the starting lineup before "START PERIOD"
    if (activeLineupIds.length === 0) {
      if (selectedStartingIds.includes(benchLineupId)) {
        stageStartingLineup(
          selectedStartingIds.filter((id) => id !== benchLineupId),
        );
      } else {
        if (selectedStartingIds.length >= activePlayersLimit) {
          setErrorMessage(
            `You can only select up to ${activePlayersLimit} starting players.`,
          );
          return;
        }
        stageStartingLineup([...selectedStartingIds, benchLineupId]);
      }
      return;
    }

    // Runtime substitution swap
    if (selectedActiveId) {
      try {
        await executeSubstitution(selectedActiveId, benchLineupId);
        setSelectedActiveId(null);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to perform substitution. Please try again.";
        setErrorMessage(message);
      }
    } else {
      setErrorMessage(
        "Please select an active player in the water first to substitute out.",
      );
    }
  };

  const getJerseyNumber = (lineupId: string): string => {
    const lineup = lineupsMap[lineupId];
    if (!lineup) return "#??";
    return lineup.number === -1 ? "GK" : `#${lineup.number}`;
  };

  return (
    <div className="w-full max-w-md mx-auto p-4 bg-gray-900 text-white rounded-xl shadow-lg border border-gray-800">
      <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-800">
        <h3 className="text-lg font-bold tracking-wide">
          Period {currentPeriod} Roster
        </h3>
        <span className="text-xs bg-blue-900 text-blue-200 px-2 py-1 rounded font-mono">
          Limit: {activePlayersLimit} Active
        </span>
      </div>

      {errorMessage && (
        <div className="mb-4 p-2 text-xs bg-red-900/50 border border-red-700 text-red-200 rounded">
          {errorMessage}
        </div>
      )}

      {/* Sector 2: Active Players (In Water) */}
      <div className="mb-6">
        <h4 className="text-xs font-semibold uppercase text-gray-400 tracking-wider mb-2">
          Sector 2: Active Players (In Water)
        </h4>

        {activeLineupIds.length === 0 ? (
          <div className="p-4 bg-gray-800/40 border border-dashed border-gray-700 rounded-lg text-center text-sm text-gray-400">
            No active lineup defined for Period {currentPeriod}.
            <div className="mt-2 text-xs text-blue-400">
              Select {activePlayersLimit} players from the bench below. They
              will enter the game once the period starts.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {activeLineupIds.map((id) => {
              const isSelected = selectedActiveId === id;
              return (
                <button
                  key={id}
                  onClick={() => handleActivePlayerTap(id)}
                  className={`p-3 rounded-lg flex flex-col items-center justify-center border font-bold transition-all ${
                    isSelected
                      ? "bg-blue-600 border-blue-400 text-white shadow-md scale-95"
                      : "bg-blue-950/40 border-blue-900/50 text-blue-200 hover:bg-blue-900/20"
                  }`}
                >
                  <span className="text-xl font-mono">
                    {getJerseyNumber(id)}
                  </span>
                  <span className="text-[10px] font-normal text-blue-300 uppercase tracking-tight mt-1">
                    Active
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Sector 1: Substitute Players (Bench) */}
      <div className="mb-4">
        <h4 className="text-xs font-semibold uppercase text-gray-400 tracking-wider mb-2">
          Sector 1: Substitute Players (Bench){" "}
          {activeLineupIds.length === 0 &&
            `(${selectedStartingIds.length}/${activePlayersLimit})`}
        </h4>
        <div className="grid grid-cols-4 gap-2">
          {benchLineupIds.map((id) => {
            const isSelectedInStart = selectedStartingIds.includes(id);
            return (
              <button
                key={id}
                onClick={() => handleBenchPlayerTap(id)}
                className={`p-3 rounded-lg flex flex-col items-center justify-center border transition-all ${
                  isSelectedInStart
                    ? "bg-green-700 border-green-500 text-white scale-95 font-bold"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
                }`}
              >
                <span className="text-lg font-mono font-bold">
                  {getJerseyNumber(id)}
                </span>
                <span className="text-[9px] text-gray-400 mt-1">
                  {isSelectedInStart ? "Selected" : "Bench"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
