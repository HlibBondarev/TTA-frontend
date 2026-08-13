import { useCallback, useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "../../../hooks/hooks";
import { db } from "../../../db/ttaDatabase";
import {
  initializePeriodPresenceTx,
  terminatePeriodPresenceTx,
  substitutePlayerTx,
} from "../../../db/presenceService";
import {
  loadRosterState,
  setSelectedStartingIds,
  commitStartingLineup,
  clearActiveRosterToBench,
  optimisticSubstitute,
  setLoading,
} from "../store/presenceSlice";

export function usePlayerPresence(matchId: string) {
  const dispatch = useAppDispatch();
  const currentPeriod = useAppSelector((state) => state.match.periodNumber);

  // Safeguard: guarantees up-to-date periodNumber inside async callbacks
  const currentPeriodRef = useRef(currentPeriod);
  useEffect(() => {
    currentPeriodRef.current = currentPeriod;
  }, [currentPeriod]);

  const {
    activeLineupIds,
    benchLineupIds,
    selectedStartingIds,
    activePlayersLimit,
  } = useAppSelector((state) => state.presence);

  const refreshPresenceFromDB = useCallback(
    async (overridePeriodNumber?: number) => {
      const periodToFetch = overridePeriodNumber ?? currentPeriodRef.current;
      dispatch(setLoading(true));
      try {
        const matchLineups = await db.matchlineups
          .where("matchId")
          .equals(matchId)
          .toArray();

        const lineupIds = matchLineups.map((l) => l.id);
        const rawPresences = await db.playerpresences
          .where("periodNumber")
          .equals(periodToFetch)
          .toArray();

        const sortedPresences = [...rawPresences].sort((a, b) =>
          a.timeIn.localeCompare(b.timeIn),
        );

        const activeLineups = Array.from(
          new Set(
            sortedPresences
              .filter(
                (p) =>
                  p.timeOut === null && lineupIds.includes(p.matchLineupId),
              )
              .map((p) => p.matchLineupId),
          ),
        );

        const benchLineups = lineupIds.filter(
          (id) => !activeLineups.includes(id),
        );

        dispatch(
          loadRosterState({ active: activeLineups, bench: benchLineups }),
        );
      } catch (error) {
        console.error("Failed to load local presence state:", error);
      } finally {
        dispatch(setLoading(false));
      }
    },
    [matchId, dispatch],
  );

  const stageStartingLineup = useCallback(
    (lineupIds: string[]) => {
      if (lineupIds.length > activePlayersLimit) {
        throw new Error(
          `Cannot exceed the limit of ${activePlayersLimit} active players.`,
        );
      }
      dispatch(setSelectedStartingIds(lineupIds));
    },
    [activePlayersLimit, dispatch],
  );

  const startPeriodWithRoster = useCallback(
    async (startTimestamp: string, overridePeriodNumber?: number) => {
      const targetPeriod = overridePeriodNumber ?? currentPeriodRef.current;
      if (selectedStartingIds.length !== activePlayersLimit) {
        throw new Error(
          `Starting lineup must contain exactly ${activePlayersLimit} players.`,
        );
      }
      try {
        await initializePeriodPresenceTx(
          matchId,
          targetPeriod,
          selectedStartingIds,
          startTimestamp,
        );
        dispatch(commitStartingLineup(selectedStartingIds));
        await refreshPresenceFromDB(targetPeriod);
      } catch (error) {
        console.error("Failed to initialize period presence in DB:", error);
        await refreshPresenceFromDB(targetPeriod);
        throw error;
      }
    },
    [
      matchId,
      selectedStartingIds,
      activePlayersLimit,
      dispatch,
      refreshPresenceFromDB,
    ],
  );

  const endPeriodWithRoster = useCallback(
    async (endTimestamp: string, overridePeriodNumber?: number) => {
      const targetPeriod = overridePeriodNumber ?? currentPeriodRef.current;
      const activeIdsToClose = [...activeLineupIds];
      dispatch(clearActiveRosterToBench());
      try {
        await terminatePeriodPresenceTx(
          matchId,
          targetPeriod,
          activeIdsToClose,
          endTimestamp,
        );
      } catch (error) {
        console.error("Failed to terminate period presence in DB:", error);
        await refreshPresenceFromDB(targetPeriod);
        throw error;
      }
    },
    [matchId, activeLineupIds, dispatch, refreshPresenceFromDB],
  );

  const executeSubstitution = useCallback(
    async (
      outLineupId: string,
      inLineupId: string,
      overridePeriodNumber?: number,
    ) => {
      const targetPeriod = overridePeriodNumber ?? currentPeriodRef.current;
      dispatch(optimisticSubstitute({ outId: outLineupId, inId: inLineupId }));
      try {
        await substitutePlayerTx(
          matchId,
          targetPeriod,
          outLineupId,
          inLineupId,
        );
      } catch (error) {
        console.error("Failed to execute substitution in DB:", error);
        await refreshPresenceFromDB(targetPeriod);
        throw error;
      }
    },
    [matchId, dispatch, refreshPresenceFromDB],
  );

  return {
    currentPeriod,
    activeLineupIds,
    benchLineupIds,
    selectedStartingIds,
    activePlayersLimit,
    refreshPresenceFromDB,
    stageStartingLineup,
    startPeriodWithRoster,
    endPeriodWithRoster,
    executeSubstitution,
  };
}
