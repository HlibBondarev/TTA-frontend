import { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { RootState } from "../../../store";
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
  const dispatch = useDispatch();

  // Single source of truth for the active period from match slice
  const currentPeriod = useSelector(
    (state: RootState) => state.match.periodnumber,
  );

  const {
    activeLineupIds,
    benchLineupIds,
    selectedStartingIds,
    activePlayersLimit,
  } = useSelector((state: RootState) => state.presence);

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

      // 1. Sort presences chronologically by timein (ISO String comparison)
      const sortedPresences = [...rawPresences].sort((a, b) =>
        a.timein.localeCompare(b.timein),
      );

      // 2. Filter using the chronologically sorted array
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

  // Saves the prepared starting lineup temporarily in Redux before match start
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

  // Triggers when "START PERIOD" is clicked, writing to DB with the precise start timestamp
  const startPeriodWithRoster = useCallback(
    async (startTimestamp: string) => {
      if (selectedStartingIds.length === 0) {
        throw new Error("Cannot start period without a selected lineup.");
      }
      dispatch(commitStartingLineup(selectedStartingIds));
      await initializePeriodPresenceTx(
        matchId,
        currentPeriod,
        selectedStartingIds,
        startTimestamp,
      );
    },
    [matchId, currentPeriod, selectedStartingIds, dispatch],
  );

  // Triggers when "END PERIOD" is clicked, closing all active DB presence sessions and cleaning UI
  const endPeriodWithRoster = useCallback(
    async (endTimestamp: string) => {
      const activeIdsToClose = [...activeLineupIds];
      dispatch(clearActiveRosterToBench());
      await terminatePeriodPresenceTx(
        currentPeriod,
        activeIdsToClose,
        endTimestamp,
      );
    },
    [currentPeriod, activeLineupIds, dispatch],
  );

  const executeSubstitution = useCallback(
    async (outLineupId: string, inLineupId: string) => {
      dispatch(optimisticSubstitute({ outId: outLineupId, inId: inLineupId }));
      await substitutePlayerTx(matchId, currentPeriod, outLineupId, inLineupId);
    },
    [matchId, currentPeriod, dispatch],
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
