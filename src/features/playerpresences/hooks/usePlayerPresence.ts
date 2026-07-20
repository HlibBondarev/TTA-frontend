import { useCallback } from "react";
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
  const currentPeriod = useAppSelector((state) => state.match.periodnumber);

  const {
    activeLineupIds,
    benchLineupIds,
    selectedStartingIds,
    activePlayersLimit,
  } = useAppSelector((state) => state.presence);

  const refreshPresenceFromDB = useCallback(async () => {
    dispatch(setLoading(true));
    try {
      const matchLineups = await db.matchlineups
        .where("matchid")
        .equals(matchId)
        .toArray();

      const lineupIds = matchLineups.map((l) => l.id);
      const rawPresences = await db.playerpresences
        .where("periodnumber")
        .equals(currentPeriod)
        .toArray();

      const sortedPresences = [...rawPresences].sort((a, b) =>
        a.timein.localeCompare(b.timein),
      );

      const activeLineups = sortedPresences
        .filter(
          (p) => p.timeout === null && lineupIds.includes(p.matchlineupid),
        )
        .map((p) => p.matchlineupid);

      const benchLineups = lineupIds.filter(
        (id) => !activeLineups.includes(id),
      );

      dispatch(loadRosterState({ active: activeLineups, bench: benchLineups }));
    } catch (error) {
      console.error("Failed to load local presence state:", error);
    } finally {
      dispatch(setLoading(false));
    }
  }, [matchId, currentPeriod, dispatch]);

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
    async (startTimestamp: string) => {
      if (selectedStartingIds.length !== activePlayersLimit) {
        throw new Error(
          `Starting lineup must contain exactly ${activePlayersLimit} players.`,
        );
      }
      dispatch(commitStartingLineup(selectedStartingIds));
      try {
        await initializePeriodPresenceTx(
          matchId,
          currentPeriod,
          selectedStartingIds,
          startTimestamp,
        );
      } catch (error) {
        await refreshPresenceFromDB();
        throw error;
      }
    },
    [
      matchId,
      currentPeriod,
      selectedStartingIds,
      activePlayersLimit,
      dispatch,
      refreshPresenceFromDB,
    ],
  );

  const endPeriodWithRoster = useCallback(
    async (endTimestamp: string) => {
      const activeIdsToClose = [...activeLineupIds];
      dispatch(clearActiveRosterToBench());
      try {
        await terminatePeriodPresenceTx(
          matchId,
          currentPeriod,
          activeIdsToClose,
          endTimestamp,
        );
      } catch (error) {
        await refreshPresenceFromDB();
        throw error;
      }
    },
    [matchId, currentPeriod, activeLineupIds, dispatch, refreshPresenceFromDB],
  );

  const executeSubstitution = useCallback(
    async (outLineupId: string, inLineupId: string) => {
      dispatch(optimisticSubstitute({ outId: outLineupId, inId: inLineupId }));
      try {
        await substitutePlayerTx(
          matchId,
          currentPeriod,
          outLineupId,
          inLineupId,
        );
      } catch (error) {
        await refreshPresenceFromDB();
        throw error;
      }
    },
    [matchId, currentPeriod, dispatch, refreshPresenceFromDB],
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
