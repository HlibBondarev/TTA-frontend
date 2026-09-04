import { useEffect, useCallback, useRef, useState } from "react";
import { liveQuery } from "dexie";
import {
  db,
  type TimeAnchor,
  type TournamentLookup,
} from "../../../db/ttaDatabase";
import { getNextSequenceNumber } from "../../../db/eventService";
import { apiClient } from "../../../api/client";
import { useAppDispatch, useAppSelector } from "../../../hooks/hooks";
import {
  startPeriodState,
  endPeriodState,
  startStoppageState,
  endStoppageState,
  setPeriodStatePayload,
  incrementSequence,
  incrementPeriodNumber,
  decrementPeriodNumber,
  setGlobalSequenceNumber,
} from "../store/matchSlice";

export interface CalculatedPeriodState {
  isPeriodActive: boolean;
  isInsideStoppage: boolean;
  isPeriodEnded: boolean;
}

export interface EndPeriodResult {
  anchorId: string | undefined;
  isFinal: boolean;
}

/**
 * Helper function to fetch SportConfiguration periodsCount from IndexedDB.
 */
const fetchSportConfigPeriodsCount = async (
  matchId: string,
): Promise<number> => {
  const match = db.matches?.get ? await db.matches.get(matchId) : null;
  if (!match) {
    throw new Error(`Match with ID '${matchId}' not found in local IndexedDB.`);
  }

  let tournament = db.tournaments?.get
    ? await db.tournaments.get(match.tournamentId)
    : null;

  if (!tournament && match.tournamentId) {
    try {
      tournament = await apiClient.get<TournamentLookup>(
        `/Tournaments/${match.tournamentId}`,
      );
      if (tournament && db.tournaments) {
        await db.tournaments.put(tournament);
      }
    } catch (err) {
      console.error(
        `[useMatchLifecycle] Tournament fallback fetch failed for '${match.tournamentId}':`,
        err,
      );
    }
  }

  if (!tournament) {
    throw new Error(
      `Tournament with ID '${match.tournamentId}' not found for match '${matchId}'.`,
    );
  }

  const config = db.sportconfigurations?.get
    ? await db.sportconfigurations.get(tournament.configurationId)
    : null;

  if (
    !config ||
    typeof config.periodsCount !== "number" ||
    !Number.isInteger(config.periodsCount) ||
    config.periodsCount <= 0
  ) {
    throw new Error(
      `Invalid or missing periodsCount in SportConfiguration ('${tournament.configurationId}') for match '${matchId}'.`,
    );
  }

  return config.periodsCount;
};

/**
 * Calculates period flags from a list of period time anchors according to state machine transition rules.
 */
export const calculatePeriodState = (
  anchors: TimeAnchor[],
): CalculatedPeriodState => {
  let isStarted = false;
  let isEnded = false;
  let isStoppageActive = false;

  const sortedAnchors = [...anchors].sort((a, b) => {
    if (a.sequenceNumber !== b.sequenceNumber) {
      return a.sequenceNumber - b.sequenceNumber;
    }
    return a.timestamp.localeCompare(b.timestamp);
  });

  for (const anchor of sortedAnchors) {
    switch (anchor.type) {
      case 0: // PeriodStart
        isStarted = true;
        isEnded = false;
        break;
      case 1: // PeriodEnd
        isStarted = false;
        isEnded = true;
        isStoppageActive = false;
        break;
      case 2: // StoppageStart
        if (isStarted && !isEnded) {
          isStoppageActive = true;
        }
        break;
      case 3: // StoppageEnd
        if (isStarted && !isEnded) {
          isStoppageActive = false;
        }
        break;
    }
  }

  return {
    isPeriodActive: isStarted && !isEnded,
    isInsideStoppage: isStoppageActive,
    isPeriodEnded: isEnded,
  };
};

/**
 * Validates whether starting a target period is allowed given current period state.
 */
const validateTargetPeriod = (
  periodNumber: number,
  isPeriodEnded: boolean,
  targetPeriodNumber?: number,
): boolean => {
  if (isPeriodEnded) {
    return targetPeriodNumber === periodNumber + 1;
  }
  return (
    targetPeriodNumber === undefined || targetPeriodNumber === periodNumber
  );
};

/**
 * Executes Dexie transaction to persist a new time anchor and enqueue its sync item.
 */
const createAndSaveTimeAnchor = async (
  matchId: string,
  periodNumber: number,
  type: number,
): Promise<string> => {
  const anchorId = crypto.randomUUID();

  await db.transaction(
    "rw",
    [db.timeanchors, db.gameevents, db.playerpresences, db.syncQueue],
    async () => {
      if (type === 0) {
        const existingAnchors = await db.timeanchors
          .where("matchId")
          .equals(matchId)
          .filter((a) => a.periodNumber === periodNumber)
          .toArray();

        const existingState = calculatePeriodState(existingAnchors);
        if (existingState.isPeriodActive || existingState.isPeriodEnded) {
          throw new Error(
            "Cannot start period: period is already active or ended.",
          );
        }
      }

      const nextSeq = await getNextSequenceNumber();
      const timestamp = new Date().toISOString();

      const anchorData = {
        id: anchorId,
        matchId,
        periodNumber,
        type,
        timestamp,
        sequenceNumber: nextSeq,
        isSynced: 0,
      };

      await db.timeanchors.add(anchorData);

      const payload = JSON.stringify([
        {
          id: anchorData.id,
          periodNumber: anchorData.periodNumber,
          type: anchorData.type,
          timestamp: anchorData.timestamp,
        },
      ]);

      const syncItem = {
        actionType: "POST" as const,
        endpoint: `/Matches/${matchId}/anchors`,
        payload,
        createdAt: timestamp,
      };

      await db.syncQueue.add(syncItem);
    },
  );

  return anchorId;
};

/**
 * Deletes time anchor and matching sync queue items.
 */
const deleteTimeAnchorWithQueue = async (anchorId: string): Promise<void> => {
  await db.transaction("rw", [db.timeanchors, db.syncQueue], async () => {
    await db.timeanchors.delete(anchorId);
    const matchingQueueItems = await db.syncQueue
      .filter((item) => item.payload.includes(anchorId))
      .toArray();

    for (const item of matchingQueueItems) {
      if (item.id !== undefined) {
        await db.syncQueue.delete(item.id);
      }
    }
  });
};

/**
 * Checks if there are unsynced PeriodEnd anchors for liveQuery subscription.
 */
const checkUnsyncedEndAnchorExists = async (
  matchId: string,
  periodNumber: number,
): Promise<boolean> => {
  if (!matchId || !db?.syncQueue || !db?.timeanchors) {
    return false;
  }

  const endAnchors = await db.timeanchors
    .where("matchId")
    .equals(matchId)
    .filter(
      (a) =>
        a.periodNumber === periodNumber && a.type === 1 && a.isSynced === 0,
    )
    .toArray();

  if (endAnchors.length === 0) return false;

  const endAnchorId = endAnchors[0].id;
  const pendingItems = await db.syncQueue
    .filter((item) => item.payload.includes(endAnchorId))
    .toArray();

  return pendingItems.length > 0;
};

/**
 * Resolves and deletes the period end time anchor along with its matching sync queue entry.
 */
const deleteEndAnchorAndSyncQueue = async (
  matchId: string,
  periodNumber: number,
  anchorId?: string | null,
): Promise<void> => {
  let targetAnchorId = anchorId;
  if (!targetAnchorId && matchId && db?.timeanchors) {
    const endAnchors = await db.timeanchors
      .where("matchId")
      .equals(matchId)
      .filter((a) => a.periodNumber === periodNumber && a.type === 1)
      .toArray();

    if (endAnchors.length > 0) {
      endAnchors.sort(
        (a, b) =>
          b.sequenceNumber - a.sequenceNumber ||
          b.timestamp.localeCompare(a.timestamp),
      );
      targetAnchorId = endAnchors[0].id;
    }
  }

  if (!targetAnchorId) return;

  await deleteTimeAnchorWithQueue(targetAnchorId);
};

/**
 * Removes pending /presence/terminate sync requests from queue for a given period.
 */
const purgeTerminateSyncQueueItems = async (
  matchId: string,
  periodNumber: number,
): Promise<void> => {
  if (!matchId || !db?.syncQueue) return;

  const terminateEndpoint = `/Matches/${matchId}/presence/terminate`;
  const pendingTerminateItems = await db.syncQueue
    .filter((item) => {
      if (item.endpoint !== terminateEndpoint) return false;
      try {
        const data = JSON.parse(item.payload);
        return data.periodNumber === periodNumber;
      } catch {
        return false;
      }
    })
    .toArray();

  for (const item of pendingTerminateItems) {
    if (item.id !== undefined) {
      await db.syncQueue.delete(item.id);
    }
  }
};

/**
 * Reopens player presences closed at period termination by clearing their timeOut timestamp.
 */
const reopenClosedPlayerPresences = async (
  matchId: string,
  periodNumber: number,
): Promise<void> => {
  if (!matchId || !db?.playerpresences || !db?.matchlineups) return;

  const lineups = await db.matchlineups
    .where("matchId")
    .equals(matchId)
    .toArray();
  const lineupIds = new Set(lineups.map((l) => l.id));

  const presences = await db.playerpresences
    .where("periodNumber")
    .equals(periodNumber)
    .filter((p) => p.timeOut !== null && lineupIds.has(p.matchLineupId))
    .toArray();

  if (presences.length === 0) return;

  const maxTimeOut = presences.reduce(
    (max, p) => {
      if (!p.timeOut) return max;
      return !max || p.timeOut > max ? p.timeOut : max;
    },
    null as string | null,
  );

  if (!maxTimeOut) return;

  const presencesToReopen = presences.filter((p) => p.timeOut === maxTimeOut);

  for (const p of presencesToReopen) {
    await db.playerpresences.update(p.id, {
      timeOut: null,
      isSynced: 0,
    });
  }
};

export const useMatchLifecycle = () => {
  const dispatch = useAppDispatch();
  const matchState = useAppSelector((state) => state.match);
  const {
    activeMatchId,
    periodNumber,
    isPeriodActive,
    isInsideStoppage,
    isPeriodEnded,
    globalSequenceNumber,
  } = matchState;

  const [canUndoEndPeriod, setCanUndoEndPeriod] = useState(false);
  const [periodsCount, setPeriodsCount] = useState<number | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState<boolean>(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [isResultModalOpen, setIsResultModalOpen] = useState<boolean>(false);

  const syncRequestIdRef = useRef(0);
  const activeMatchIdRef = useRef(activeMatchId);
  const periodNumberRef = useRef(periodNumber);
  const isPeriodActiveRef = useRef(isPeriodActive);
  const isInsideStoppageRef = useRef(isInsideStoppage);
  const isPeriodEndedRef = useRef(isPeriodEnded);
  const globalSequenceNumberRef = useRef(globalSequenceNumber);

  useEffect(() => {
    activeMatchIdRef.current = activeMatchId;
    periodNumberRef.current = periodNumber;
    isPeriodActiveRef.current = isPeriodActive;
    isInsideStoppageRef.current = isInsideStoppage;
    isPeriodEndedRef.current = isPeriodEnded;
    globalSequenceNumberRef.current = globalSequenceNumber;
  }, [
    activeMatchId,
    periodNumber,
    isPeriodActive,
    isInsideStoppage,
    isPeriodEnded,
    globalSequenceNumber,
  ]);

  // Strict Dynamic Period Resolution from Dexie IndexedDB
  useEffect(() => {
    let isMounted = true;

    const resolvePeriodsCount = async () => {
      const normalizedMatchId = activeMatchId?.trim();
      if (!normalizedMatchId) {
        if (isMounted) {
          setPeriodsCount(null);
          setIsLoadingConfig(false);
          setConfigError(null);
        }
        return;
      }

      try {
        setIsLoadingConfig(true);
        setConfigError(null);

        const count = await fetchSportConfigPeriodsCount(normalizedMatchId);
        if (isMounted) {
          setPeriodsCount(count);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          "[useMatchLifecycle] Configuration Resolution Error:",
          msg,
        );
        if (isMounted) {
          setConfigError(msg);
          setPeriodsCount(null);
        }
      } finally {
        if (isMounted) {
          setIsLoadingConfig(false);
        }
      }
    };

    void resolvePeriodsCount();

    return () => {
      isMounted = false;
    };
  }, [activeMatchId]);

  useEffect(() => {
    const normalizedMatchId = activeMatchId?.trim();

    const subscription = liveQuery(() =>
      checkUnsyncedEndAnchorExists(normalizedMatchId ?? "", periodNumber),
    ).subscribe({
      next: (canUndo) => setCanUndoEndPeriod(canUndo),
      error: () => setCanUndoEndPeriod(false),
    });

    return () => subscription.unsubscribe();
  }, [activeMatchId, periodNumber, isPeriodEnded]);

  const isCurrentContext = useCallback(
    (targetMatchId?: string, targetPeriodNumber?: number) => {
      const norm = targetMatchId?.trim();
      return (
        !!norm &&
        norm === activeMatchIdRef.current?.trim() &&
        targetPeriodNumber === periodNumberRef.current
      );
    },
    [],
  );

  const isFinalPeriod = useCallback(
    (targetPeriod?: number): boolean => {
      const checkPeriod = targetPeriod ?? periodNumberRef.current;
      if (periodsCount === null) {
        throw new Error(
          `Cannot evaluate isFinalPeriod: periodsCount is not resolved for active match. ${configError ?? ""}`.trim(),
        );
      }
      return checkPeriod === periodsCount;
    },
    [periodsCount, configError],
  );

  const syncPeriodStateWithDB = useCallback(
    async (overrideMatchId?: string, overridePeriodNumber?: number) => {
      const currentRequestId = ++syncRequestIdRef.current;
      const targetMatchId = (
        overrideMatchId ?? activeMatchIdRef.current
      )?.trim();
      const targetPeriodNumber =
        overridePeriodNumber ?? periodNumberRef.current;

      if (!targetMatchId || !db?.timeanchors) return;

      try {
        const anchors = await db.timeanchors
          .where("matchId")
          .equals(targetMatchId)
          .filter((a) => a.periodNumber === targetPeriodNumber)
          .toArray();

        if (
          currentRequestId === syncRequestIdRef.current &&
          targetMatchId === activeMatchIdRef.current?.trim() &&
          targetPeriodNumber === periodNumberRef.current
        ) {
          const computedState = calculatePeriodState(anchors);
          isPeriodActiveRef.current = computedState.isPeriodActive;
          isInsideStoppageRef.current = computedState.isInsideStoppage;
          isPeriodEndedRef.current = computedState.isPeriodEnded;
          dispatch(setPeriodStatePayload(computedState));
        }
      } catch (err) {
        console.error(
          "Failed to sync period state with IndexedDB timeanchors:",
          err,
        );
      }
    },
    [dispatch],
  );

  useEffect(() => {
    void syncPeriodStateWithDB();
  }, [activeMatchId, periodNumber, syncPeriodStateWithDB]);

  const logTimeAnchor = async (
    type: number,
    targetPeriodNumber?: number,
  ): Promise<string> => {
    const normalizedMatchId = activeMatchIdRef.current?.trim();
    if (!normalizedMatchId) {
      throw new Error("No active match ID found for logging time anchor.");
    }

    const anchorPeriod = targetPeriodNumber ?? periodNumberRef.current;
    return createAndSaveTimeAnchor(normalizedMatchId, anchorPeriod, type);
  };

  const removeTimeAnchor = async (anchorId: string) => {
    await deleteTimeAnchorWithQueue(anchorId);
  };

  const revertStartPeriod = async (anchorId?: string | null) => {
    const normalizedMatchId = activeMatchIdRef.current?.trim();
    const currentPeriod = periodNumberRef.current;
    if (anchorId) {
      await removeTimeAnchor(anchorId);
    }
    if (!isCurrentContext(normalizedMatchId, currentPeriod)) {
      return;
    }
    isPeriodActiveRef.current = false;
    isInsideStoppageRef.current = false;
    isPeriodEndedRef.current = false;
    dispatch(
      setPeriodStatePayload({
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: false,
      }),
    );
    await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
  };

  const revertEndPeriod = async (anchorId?: string | null) => {
    const normalizedMatchId = activeMatchIdRef.current?.trim();
    const currentPeriod = periodNumberRef.current;

    await db.transaction(
      "rw",
      [db.timeanchors, db.syncQueue, db.playerpresences, db.matchlineups],
      async () => {
        if (!normalizedMatchId) return;
        await deleteEndAnchorAndSyncQueue(
          normalizedMatchId,
          currentPeriod,
          anchorId,
        );
        await purgeTerminateSyncQueueItems(normalizedMatchId, currentPeriod);
        await reopenClosedPlayerPresences(normalizedMatchId, currentPeriod);
      },
    );

    if (!isCurrentContext(normalizedMatchId, currentPeriod)) {
      return;
    }
    setIsResultModalOpen(false);
    isPeriodActiveRef.current = true;
    isPeriodEndedRef.current = false;
    dispatch(startPeriodState());
    await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
  };

  const startPeriod = async (
    targetPeriodNumber?: number,
  ): Promise<string | undefined> => {
    const normalizedMatchId = activeMatchIdRef.current?.trim();
    if (!normalizedMatchId) {
      throw new Error("No active match ID found for logging time anchor.");
    }

    const isTargetValid = validateTargetPeriod(
      periodNumberRef.current,
      isPeriodEndedRef.current,
      targetPeriodNumber,
    );

    if (isPeriodActiveRef.current || !isTargetValid) {
      return;
    }

    const priorPeriod = periodNumberRef.current;
    const priorIsPeriodEnded = isPeriodEndedRef.current;
    const priorSequence = globalSequenceNumberRef.current;

    const currentPeriod = targetPeriodNumber ?? periodNumberRef.current;
    if (targetPeriodNumber && targetPeriodNumber !== periodNumberRef.current) {
      dispatch(incrementPeriodNumber());
    }

    isPeriodActiveRef.current = true;
    isPeriodEndedRef.current = false;

    dispatch(startPeriodState());
    dispatch(incrementSequence());
    globalSequenceNumberRef.current = priorSequence + 1;

    try {
      const anchorId = await logTimeAnchor(0, currentPeriod);
      await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
      return anchorId;
    } catch (error) {
      if (isCurrentContext(normalizedMatchId, currentPeriod)) {
        if (targetPeriodNumber && targetPeriodNumber !== priorPeriod) {
          dispatch(decrementPeriodNumber());
        }
        isPeriodActiveRef.current = false;
        isPeriodEndedRef.current = priorIsPeriodEnded;
        dispatch(
          setPeriodStatePayload({
            isPeriodActive: false,
            isInsideStoppage: false,
            isPeriodEnded: priorIsPeriodEnded,
          }),
        );
        dispatch(setGlobalSequenceNumber(priorSequence));
        globalSequenceNumberRef.current = priorSequence;
        await syncPeriodStateWithDB(normalizedMatchId, priorPeriod);
      }
      throw error;
    }
  };

  const endPeriod = async (): Promise<EndPeriodResult | undefined> => {
    const normalizedMatchId = activeMatchIdRef.current?.trim();
    if (!normalizedMatchId) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (!isPeriodActiveRef.current || isInsideStoppageRef.current) return;

    const currentPeriod = periodNumberRef.current;
    const isFinal = isFinalPeriod(currentPeriod);
    const priorSequence = globalSequenceNumberRef.current;

    isPeriodActiveRef.current = false;
    isPeriodEndedRef.current = true;

    dispatch(endPeriodState());
    dispatch(incrementSequence());
    globalSequenceNumberRef.current = priorSequence + 1;

    try {
      const anchorId = await logTimeAnchor(1, currentPeriod);
      await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);

      return { anchorId, isFinal };
    } catch (error) {
      if (isCurrentContext(normalizedMatchId, currentPeriod)) {
        isPeriodActiveRef.current = true;
        isPeriodEndedRef.current = false;
        dispatch(startPeriodState());
        dispatch(setGlobalSequenceNumber(priorSequence));
        globalSequenceNumberRef.current = priorSequence;
        await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
      }
      throw error;
    }
  };

  const stopTime = async () => {
    const normalizedMatchId = activeMatchIdRef.current?.trim();
    if (!normalizedMatchId) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (!isPeriodActiveRef.current || isInsideStoppageRef.current) return;

    const currentPeriod = periodNumberRef.current;
    const priorSequence = globalSequenceNumberRef.current;

    isInsideStoppageRef.current = true;

    dispatch(startStoppageState());
    dispatch(incrementSequence());
    globalSequenceNumberRef.current = priorSequence + 1;

    try {
      await logTimeAnchor(2, currentPeriod);
      await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
    } catch (error) {
      if (isCurrentContext(normalizedMatchId, currentPeriod)) {
        isInsideStoppageRef.current = false;
        dispatch(endStoppageState());
        dispatch(setGlobalSequenceNumber(priorSequence));
        globalSequenceNumberRef.current = priorSequence;
        await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
      }
      throw error;
    }
  };

  const startTime = async () => {
    const normalizedMatchId = activeMatchIdRef.current?.trim();
    if (!normalizedMatchId) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (!isPeriodActiveRef.current || !isInsideStoppageRef.current) return;

    const currentPeriod = periodNumberRef.current;
    const priorSequence = globalSequenceNumberRef.current;

    isInsideStoppageRef.current = false;

    dispatch(endStoppageState());
    dispatch(incrementSequence());
    globalSequenceNumberRef.current = priorSequence + 1;

    try {
      await logTimeAnchor(3, currentPeriod);
      await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
    } catch (error) {
      if (isCurrentContext(normalizedMatchId, currentPeriod)) {
        isInsideStoppageRef.current = true;
        dispatch(startStoppageState());
        dispatch(setGlobalSequenceNumber(priorSequence));
        globalSequenceNumberRef.current = priorSequence;
        await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
      }
      throw error;
    }
  };

  const autoCloseActivePeriod = async (): Promise<string | undefined> => {
    const normalizedMatchId = activeMatchIdRef.current?.trim();
    if (!normalizedMatchId || !isPeriodActiveRef.current) return;

    if (isInsideStoppageRef.current) {
      await startTime();
    }
    const endRes = await endPeriod();
    return endRes?.anchorId;
  };

  const nextPeriod = () => {
    dispatch(incrementPeriodNumber());
  };

  const prevPeriod = () => {
    dispatch(decrementPeriodNumber());
  };

  return {
    periodNumber,
    isPeriodActive,
    isInsideStoppage,
    isPeriodEnded,
    canUndoEndPeriod,
    globalSequenceNumber,
    periodsCount,
    isLoadingConfig,
    configError,
    isResultModalOpen,
    setIsResultModalOpen,
    isFinalPeriod,
    startPeriod,
    endPeriod,
    autoCloseActivePeriod,
    removeTimeAnchor,
    revertStartPeriod,
    revertEndPeriod,
    stopTime,
    startTime,
    nextPeriod,
    prevPeriod,
    syncPeriodStateWithDB,
  };
};
