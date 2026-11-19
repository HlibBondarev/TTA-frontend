import { useCallback, useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "../../../hooks/hooks";
import { db } from "../../../db/ttaDatabase";
import {
  findDisqualifiedLineupIds,
  initializePeriodPresenceTx,
  terminatePeriodPresenceTx,
  substitutePlayerTx,
  exitPlayerPresenceTx,
  enterPlayerPresenceTx,
} from "../../../db/presenceService";
import {
  loadRosterState,
  setSelectedStartingIds,
  commitStartingLineup,
  clearActiveRosterToBench,
  optimisticSubstitute,
  optimisticRemoveFromActive,
  optimisticEnterFromBench,
  setLoading,
} from "../store/presenceSlice";

export function usePlayerPresence(matchId: string) {
  const dispatch = useAppDispatch();
  const currentPeriod = useAppSelector((state) => state.match.periodNumber);

  // Safeguard: guarantees up-to-date periodNumber inside async callbacks
  const currentPeriodRef = useRef(currentPeriod);
  const refreshRequestRef = useRef(0);

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
      const requestId = ++refreshRequestRef.current;
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

        if (
          requestId === refreshRequestRef.current &&
          periodToFetch === currentPeriodRef.current
        ) {
          dispatch(
            loadRosterState({ active: activeLineups, bench: benchLineups }),
          );
        }
      } catch (error) {
        console.error("Failed to load local presence state:", error);
      } finally {
        if (requestId === refreshRequestRef.current) {
          dispatch(setLoading(false));
        }
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
      if (activePlayersLimit <= 0) {
        throw new Error("The active players limit is not configured.");
      }
      if (selectedStartingIds.length !== activePlayersLimit) {
        throw new Error(
          `Starting lineup must contain exactly ${activePlayersLimit} players.`,
        );
      }
      if (typeof findDisqualifiedLineupIds === "function") {
        const disqualifiedIds = await findDisqualifiedLineupIds(
          matchId,
          selectedStartingIds,
        );
        if (disqualifiedIds.length > 0) {
          const disqualifiedSet = new Set(disqualifiedIds);
          dispatch(
            setSelectedStartingIds(
              selectedStartingIds.filter((id) => !disqualifiedSet.has(id)),
            ),
          );
          throw new Error(
            "Cannot start period with disqualified players in the starting lineup.",
          );
        }
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
    async (
      endTimestamp: string,
      overridePeriodNumber?: number,
      periodEndAnchorId?: string,
    ) => {
      const targetPeriod = overridePeriodNumber ?? currentPeriodRef.current;
      const activeIdsToClose = [...activeLineupIds];
      dispatch(clearActiveRosterToBench());
      try {
        if (periodEndAnchorId) {
          await terminatePeriodPresenceTx(
            matchId,
            targetPeriod,
            activeIdsToClose,
            endTimestamp,
            periodEndAnchorId,
          );
        } else {
          await terminatePeriodPresenceTx(
            matchId,
            targetPeriod,
            activeIdsToClose,
            endTimestamp,
          );
        }
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

  const removePlayerFromActive = useCallback(
    async (
      outLineupId: string,
      exitTimestamp: string,
      overridePeriodNumber?: number,
    ): Promise<boolean> => {
      const targetPeriod = overridePeriodNumber ?? currentPeriodRef.current;
      dispatch(optimisticRemoveFromActive(outLineupId));
      try {
        const didExit = await exitPlayerPresenceTx(
          matchId,
          targetPeriod,
          outLineupId,
          exitTimestamp,
        );
        if (!didExit) {
          await refreshPresenceFromDB(targetPeriod);
        }
        return didExit;
      } catch (error) {
        console.error("Failed to remove player from active roster in DB:", error);
        await refreshPresenceFromDB(targetPeriod);
        throw error;
      }
    },
    [matchId, dispatch, refreshPresenceFromDB],
  );

  const enterPlayerFromBench = useCallback(
    async (
      inLineupId: string,
      overridePeriodNumber?: number,
    ): Promise<string> => {
      const targetPeriod = overridePeriodNumber ?? currentPeriodRef.current;
      if (activePlayersLimit <= 0) {
        throw new Error("The active players limit is not configured.");
      }
      if (activeLineupIds.length >= activePlayersLimit) {
        throw new Error(
          `Cannot exceed the limit of ${activePlayersLimit} active players.`,
        );
      }
      if (activeLineupIds.includes(inLineupId)) {
        throw new Error("Player is already active.");
      }

      dispatch(optimisticEnterFromBench(inLineupId));
      try {
        return await enterPlayerPresenceTx(matchId, targetPeriod, inLineupId);
      } catch (error) {
        console.error("Failed to enter player from bench in DB:", error);
        await refreshPresenceFromDB(targetPeriod);
        throw error;
      }
    },
    [matchId, activePlayersLimit, activeLineupIds, dispatch, refreshPresenceFromDB],
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
    removePlayerFromActive,
    enterPlayerFromBench,
  };
}
