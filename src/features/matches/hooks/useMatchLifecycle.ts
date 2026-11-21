import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { liveQuery } from "dexie";
import {
  db,
  type PlayerPresence,
  type TimeAnchor,
  type TournamentLookup,
} from "../../../db/ttaDatabase";
import { getNextSequenceNumber } from "../../../db/eventService";
import { apiClient } from "../../../api/client";
import { matchLockService } from "../../../services/matchLockService";
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
  endTimestamp?: string;
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
        `[useMatchLifecycle] Tournament fallback fetch failed for '${
          match.tournamentId
        }':`,
        err,
      );
    }
  }

  if (!tournament) {
    throw new Error(
      `Tournament with ID '${match.tournamentId}' not found for match '${
        matchId
      }'.`,
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
      `Invalid or missing periodsCount in SportConfiguration ('${
        tournament.configurationId
      }') for match '${matchId}'.`,
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
  explicitTimestamp?: string,
): Promise<string> => {
  if (matchLockService.isMatchLocked(matchId)) {
    throw new Error(
      `Cannot log time anchor: match ${matchId} is locked for finalization.`,
    );
  }

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
      const timestamp = explicitTimestamp ?? new Date().toISOString();

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
    const anchor = await db.timeanchors.get(anchorId);
    if (anchor?.matchId && matchLockService.isMatchLocked(anchor.matchId)) {
      throw new Error(
        `Cannot remove time anchor: match ${
          anchor.matchId
        } is locked for finalization.`,
      );
    }

    await db.timeanchors.delete(anchorId);
    const matchingQueueItems = await db.syncQueue
      .filter((item) => item.payload.includes(anchorId))
      .toArray();

    await Promise.all(
      matchingQueueItems.map(async (item) => {
        if (item.id !== undefined) {
          await db.syncQueue.delete(item.id);
        }
      }),
    );
  });
};

/**
 * Checks if there are unsynced PeriodEnd anchors for liveQuery subscription.
 */
const checkUnsyncedEndAnchorExists = async (
  matchId: string,
  periodNumber: number,
): Promise<boolean> => {
  if (
    !matchId ||
    !db?.syncQueue ||
    !db?.timeanchors ||
    matchLockService.isMatchLocked(matchId)
  ) {
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

const findTargetEndAnchor = async (
  matchId: string,
  periodNumber: number,
  anchorId?: string | null,
): Promise<TimeAnchor | undefined> => {
  if (!matchId || !db?.timeanchors) return undefined;

  if (anchorId && typeof db.timeanchors.get === "function") {
    const directAnchor = await db.timeanchors.get(anchorId);
    if (directAnchor) {
      return directAnchor;
    }
  }

  const endAnchors = await db.timeanchors
    .where("matchId")
    .equals(matchId)
    .filter((a) => a.periodNumber === periodNumber && a.type === 1)
    .toArray();

  if (endAnchors.length === 0) return undefined;

  endAnchors.sort(
    (a, b) =>
      b.sequenceNumber - a.sequenceNumber ||
      b.timestamp.localeCompare(a.timestamp),
  );
  if (anchorId) {
    return endAnchors.find((a) => a.id === anchorId) ?? endAnchors[0];
  }
  return endAnchors[0];
};

interface ParsedTerminateQueueItem {
  id: number | undefined;
  periodNumber: number | undefined;
  playerLineupIds: string[];
  timeOut: string | undefined;
}

interface RevertEndPeriodPlan {
  terminateQueueItemIds: number[];
  presencesToReopen: PlayerPresence[];
}

const timestampsMatch = (a?: string | null, b?: string | null): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  const parsedA = Date.parse(a);
  const parsedB = Date.parse(b);
  return (
    !Number.isNaN(parsedA) && !Number.isNaN(parsedB) && parsedA === parsedB
  );
};

const isTimestampAtOrAfter = (
  candidate?: string | null,
  reference?: string | null,
): boolean => {
  if (!candidate || !reference) return false;
  const parsedCandidate = Date.parse(candidate);
  const parsedReference = Date.parse(reference);
  return (
    !Number.isNaN(parsedCandidate) &&
    !Number.isNaN(parsedReference) &&
    parsedCandidate >= parsedReference
  );
};

const hasSingleDistinctTimestamp = (
  presences: readonly PlayerPresence[],
): boolean => {
  if (presences.length <= 1) return true;
  const firstTimeOut = presences[0].timeOut;
  return presences.every((p) => timestampsMatch(p.timeOut, firstTimeOut));
};

const parseTerminateQueueItem = (item: {
  id?: number;
  payload: string;
}): ParsedTerminateQueueItem | null => {
  try {
    const data = JSON.parse(item.payload) as {
      periodNumber?: unknown;
      playerLineupIds?: unknown;
      timeOut?: unknown;
    };
    const periodNumber =
      typeof data.periodNumber === "number" ? data.periodNumber : undefined;
    const playerLineupIds = Array.isArray(data.playerLineupIds)
      ? data.playerLineupIds.filter((id): id is string => typeof id === "string")
      : [];
    const timeOut =
      typeof data.timeOut === "string" && data.timeOut.trim().length > 0
        ? data.timeOut
        : undefined;
    return { id: item.id, periodNumber, playerLineupIds, timeOut };
  } catch {
    return null;
  }
};

const loadPendingTerminateQueueItems = async (
  matchId: string,
  periodNumber: number,
): Promise<ParsedTerminateQueueItem[]> => {
  if (!matchId || !db?.syncQueue) return [];

  const terminateEndpoint = `/Matches/${matchId}/presence/terminate`;
  const rawItems = await db.syncQueue
    .filter((item) => item.endpoint === terminateEndpoint)
    .toArray();

  return rawItems
    .map((item) => parseTerminateQueueItem(item))
    .filter(
      (parsed): parsed is ParsedTerminateQueueItem =>
        parsed !== null && parsed.periodNumber === periodNumber,
    );
};

const loadClosedPlayerPresences = async (
  matchId: string,
  periodNumber: number,
): Promise<PlayerPresence[]> => {
  if (!matchId || !db?.playerpresences || !db?.matchlineups) return [];

  const lineups = await db.matchlineups
    .where("matchId")
    .equals(matchId)
    .toArray();
  const lineupIds = new Set(lineups.map((l) => l.id));

  return db.playerpresences
    .where("periodNumber")
    .equals(periodNumber)
    .filter(
      (p) =>
        p.timeOut !== null &&
        p.isSynced !== 1 &&
        p.isSynced !== -1 &&
        lineupIds.has(p.matchLineupId),
    )
    .toArray();
};

const filterPresencesForTerminateItem = (
  closedPresences: readonly PlayerPresence[],
  item: ParsedTerminateQueueItem,
): PlayerPresence[] => {
  if (!item.timeOut) return [];
  const lineupSet =
    item.playerLineupIds.length > 0 ? new Set(item.playerLineupIds) : null;
  return closedPresences.filter(
    (p) =>
      timestampsMatch(p.timeOut, item.timeOut) &&
      (lineupSet === null || lineupSet.has(p.matchLineupId)),
  );
};

const findEndAnchorSyncQueueId = async (
  anchorId?: string,
): Promise<number | undefined> => {
  if (!anchorId || !db?.syncQueue) return undefined;
  const matchingItems = await db.syncQueue
    .filter((item) => item.payload.includes(anchorId))
    .toArray();
  const ids = matchingItems
    .map((item) => item.id)
    .filter((id): id is number => id !== undefined);
  return ids.length > 0 ? Math.max(...ids) : undefined;
};

const isPreAnchorQueueItem = (
  item: ParsedTerminateQueueItem,
  endAnchorQueueItemId?: number,
): boolean =>
  endAnchorQueueItemId !== undefined &&
  item.id !== undefined &&
  item.id < endAnchorQueueItemId;

const excludePreAnchorPresences = (
  postAnchorPresences: readonly PlayerPresence[],
  preAnchorQueueItems: readonly ParsedTerminateQueueItem[],
  endAnchorTimestamp: string,
): PlayerPresence[] => {
  const preAnchorAtOrAfter = preAnchorQueueItems.filter((item) =>
    isTimestampAtOrAfter(item.timeOut, endAnchorTimestamp),
  );
  if (preAnchorAtOrAfter.length === 0) {
    return [...postAnchorPresences];
  }
  if (preAnchorAtOrAfter.some((item) => item.playerLineupIds.length === 0)) {
    throw new Error(
      "Cannot undo period end: a pre-anchor termination at period end has no playerLineupIds to disambiguate.",
    );
  }
  return postAnchorPresences.filter(
    (p) =>
      !preAnchorAtOrAfter.some(
        (item) =>
          timestampsMatch(p.timeOut, item.timeOut) &&
          item.playerLineupIds.includes(p.matchLineupId),
      ),
  );
};

const resolvePresencesWithoutAnchor = (
  closedPresences: readonly PlayerPresence[],
): PlayerPresence[] => {
  if (hasSingleDistinctTimestamp(closedPresences)) {
    return [...closedPresences];
  }
  throw new Error(
    "Cannot undo period end: multiple closed presence timestamps exist without an anchor timestamp.",
  );
};

const resolvePlanWithAnchorTimestamp = (
  pendingTerminateItems: readonly ParsedTerminateQueueItem[],
  closedPresences: readonly PlayerPresence[],
  endAnchorTimestamp: string,
  endAnchorQueueItemId?: number,
): RevertEndPeriodPlan => {
  const hasInvalidTimestamp = pendingTerminateItems.some(
    (item) => !item.timeOut || Number.isNaN(Date.parse(item.timeOut)),
  );
  if (hasInvalidTimestamp) {
    throw new Error(
      "Cannot undo period end: pending termination queue item is missing a valid timestamp.",
    );
  }

  const preAnchorQueueItems = pendingTerminateItems.filter((item) =>
    isPreAnchorQueueItem(item, endAnchorQueueItemId),
  );
  const postAnchorQueueItems = pendingTerminateItems.filter(
    (item) =>
      !isPreAnchorQueueItem(item, endAnchorQueueItemId) &&
      isTimestampAtOrAfter(item.timeOut, endAnchorTimestamp),
  );
  if (postAnchorQueueItems.length > 1) {
    throw new Error(
      "Cannot undo period end: multiple pending termination requests exist at or after period end.",
    );
  }

  const rawPostAnchorPresences = closedPresences.filter((p) =>
    isTimestampAtOrAfter(p.timeOut, endAnchorTimestamp),
  );
  const postAnchorPresences = excludePreAnchorPresences(
    rawPostAnchorPresences,
    preAnchorQueueItems,
    endAnchorTimestamp,
  );
  if (!hasSingleDistinctTimestamp(postAnchorPresences)) {
    throw new Error(
      "Cannot undo period end: multiple post-anchor closed presence timestamps are ambiguous.",
    );
  }

  if (postAnchorQueueItems.length === 1) {
    const candidate = postAnchorQueueItems[0];
    const hasConflictingPresenceTimestamp = postAnchorPresences.some(
      (p) => !timestampsMatch(p.timeOut, candidate.timeOut),
    );
    if (hasConflictingPresenceTimestamp) {
      throw new Error(
        "Cannot undo period end: closed presences have conflicting post-anchor timestamps.",
      );
    }
    return {
      terminateQueueItemIds: candidate.id !== undefined ? [candidate.id] : [],
      presencesToReopen: filterPresencesForTerminateItem(
        postAnchorPresences,
        candidate,
      ),
    };
  }

  return {
    terminateQueueItemIds: [],
    presencesToReopen: postAnchorPresences,
  };
};

/**
 * Resolves the exact period-end termination queue item(s) and closed presences to revert,
 * preserving earlier mid-period disciplinary exits and rejecting ambiguous states before anchor deletion.
 */
const resolveRevertEndPeriodPlan = (
  pendingTerminateItems: readonly ParsedTerminateQueueItem[],
  closedPresences: readonly PlayerPresence[],
  endAnchorTimestamp?: string,
  endAnchorQueueItemId?: number,
): RevertEndPeriodPlan => {
  if (endAnchorTimestamp) {
    return resolvePlanWithAnchorTimestamp(
      pendingTerminateItems,
      closedPresences,
      endAnchorTimestamp,
      endAnchorQueueItemId,
    );
  }

  if (pendingTerminateItems.length > 1) {
    throw new Error(
      "Cannot undo period end: multiple pending termination requests exist without an anchor timestamp.",
    );
  }

  if (pendingTerminateItems.length === 1) {
    const singleItem = pendingTerminateItems[0];
    return {
      terminateQueueItemIds: singleItem.id !== undefined ? [singleItem.id] : [],
      presencesToReopen: singleItem.timeOut
        ? filterPresencesForTerminateItem(closedPresences, singleItem)
        : resolvePresencesWithoutAnchor(closedPresences),
    };
  }

  return {
    terminateQueueItemIds: [],
    presencesToReopen: resolvePresencesWithoutAnchor(closedPresences),
  };
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
  const lastSyncedMatchIdRef = useRef<string | null>(null);
  const activeMatchIdRef = useRef(activeMatchId);
  const periodNumberRef = useRef(periodNumber);
  const isPeriodActiveRef = useRef(isPeriodActive);
  const isInsideStoppageRef = useRef(isInsideStoppage);
  const isPeriodEndedRef = useRef(isPeriodEnded);
  const globalSequenceNumberRef = useRef(globalSequenceNumber);

  useLayoutEffect(() => {
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

  const subscribeToMatchLock = useCallback((callback: () => void) => {
    return matchLockService.subscribe(callback);
  }, []);

  const getMatchLockSnapshot = useCallback(() => {
    return activeMatchId
      ? matchLockService.isMatchLocked(activeMatchId.trim())
      : false;
  }, [activeMatchId]);

  const isMatchLocked = useSyncExternalStore(
    subscribeToMatchLock,
    getMatchLockSnapshot,
    () => false,
  );

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
          `[useMatchLifecycle] Configuration Resolution Error:`,
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
  }, [activeMatchId, periodNumber, isPeriodEnded, isMatchLocked]);

  const isCurrentContext = useCallback(
    (targetMatchId?: string, targetPeriodNumber?: number) => {
      const norm = targetMatchId?.trim();
      return (
        !!norm &&
        norm === activeMatchIdRef.current?.trim() &&
        (targetPeriodNumber === undefined ||
          targetPeriodNumber === periodNumberRef.current)
      );
    },
    [],
  );

  const isFinalPeriod = useCallback(
    (targetPeriod?: number): boolean => {
      const checkPeriod = targetPeriod ?? periodNumberRef.current;
      if (periodsCount === null) {
        throw new Error(
          `Cannot evaluate isFinalPeriod: periodsCount is not resolved for active match. ${
            configError ?? ""
          }`.trim(),
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
      const requestPeriodNumber = periodNumberRef.current;

      if (!targetMatchId || !db?.timeanchors) return;

      try {
        const allAnchors = await db.timeanchors
          .where("matchId")
          .equals(targetMatchId)
          .toArray();

        if (
          currentRequestId !== syncRequestIdRef.current ||
          targetMatchId !== activeMatchIdRef.current?.trim() ||
          (overridePeriodNumber !== undefined &&
            overridePeriodNumber !== periodNumberRef.current) ||
          (overridePeriodNumber === undefined &&
            requestPeriodNumber !== periodNumberRef.current)
        ) {
          return;
        }

        let resolvedPeriodNumber = 1;
        let periodAnchors: TimeAnchor[] = [];

        const isMatchSwitch = lastSyncedMatchIdRef.current !== targetMatchId;

        if (overridePeriodNumber !== undefined) {
          resolvedPeriodNumber = overridePeriodNumber;
          periodAnchors = allAnchors.filter(
            (a) => a.periodNumber === resolvedPeriodNumber,
          );
        } else if (allAnchors.length > 0) {
          const maxPeriod = Math.max(...allAnchors.map((a) => a.periodNumber));
          resolvedPeriodNumber = isMatchSwitch
            ? maxPeriod
            : Math.max(requestPeriodNumber, maxPeriod);

          periodAnchors = allAnchors.filter(
            (a) => a.periodNumber === resolvedPeriodNumber,
          );
        } else {
          resolvedPeriodNumber = isMatchSwitch
            ? 1
            : Math.max(1, requestPeriodNumber);
          periodAnchors = [];
        }

        const computedState = calculatePeriodState(periodAnchors);

        if (
          currentRequestId !== syncRequestIdRef.current ||
          targetMatchId !== activeMatchIdRef.current?.trim() ||
          (overridePeriodNumber !== undefined &&
            overridePeriodNumber !== periodNumberRef.current) ||
          (overridePeriodNumber === undefined &&
            requestPeriodNumber !== periodNumberRef.current)
        ) {
          return;
        }

        periodNumberRef.current = resolvedPeriodNumber;
        isPeriodActiveRef.current = computedState.isPeriodActive;
        isInsideStoppageRef.current = computedState.isInsideStoppage;
        isPeriodEndedRef.current = computedState.isPeriodEnded;

        lastSyncedMatchIdRef.current = targetMatchId;

        dispatch(
          setPeriodStatePayload({
            ...computedState,
            periodNumber: resolvedPeriodNumber,
          }),
        );
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
    const normalizedMatchId = activeMatchId?.trim() || null;
    const isMatchChange = lastSyncedMatchIdRef.current !== normalizedMatchId;

    if (isMatchChange) {
      if (!normalizedMatchId) {
        lastSyncedMatchIdRef.current = null;
      }
      void syncPeriodStateWithDB();
    } else {
      void syncPeriodStateWithDB(normalizedMatchId ?? undefined, periodNumber);
    }
  }, [activeMatchId, periodNumber, syncPeriodStateWithDB]);

  const logTimeAnchor = async (
    type: number,
    targetPeriodNumber?: number,
    explicitTimestamp?: string,
  ): Promise<string> => {
    const normalizedMatchId = activeMatchIdRef.current?.trim();
    if (!normalizedMatchId) {
      throw new Error("No active match ID found for logging time anchor.");
    }

    const anchorPeriod = targetPeriodNumber ?? periodNumberRef.current;
    return createAndSaveTimeAnchor(
      normalizedMatchId,
      anchorPeriod,
      type,
      explicitTimestamp,
    );
  };

  const removeTimeAnchor = async (anchorId: string) => {
    await deleteTimeAnchorWithQueue(anchorId);
  };

  const revertStartPeriod = async (anchorId?: string | null) => {
    ++syncRequestIdRef.current;
    const normalizedMatchId = activeMatchIdRef.current?.trim();
    if (
      normalizedMatchId &&
      matchLockService.isMatchLocked(normalizedMatchId)
    ) {
      throw new Error(
        `Cannot revert period start: match ${
          normalizedMatchId
        } is locked for finalization.`,
      );
    }

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
    ++syncRequestIdRef.current;
    const normalizedMatchId = activeMatchIdRef.current?.trim();
    if (
      normalizedMatchId &&
      matchLockService.isMatchLocked(normalizedMatchId)
    ) {
      throw new Error(
        `Cannot revert period end: match ${
          normalizedMatchId
        } is locked for finalization.`,
      );
    }

    const currentPeriod = periodNumberRef.current;

    await db.transaction(
      "rw",
      [db.timeanchors, db.syncQueue, db.playerpresences, db.matchlineups],
      async () => {
        if (!normalizedMatchId) return;

        const targetAnchor = await findTargetEndAnchor(
          normalizedMatchId,
          currentPeriod,
          anchorId,
        );
        const targetAnchorId = targetAnchor?.id ?? anchorId ?? undefined;
        const endAnchorTimestamp = targetAnchor?.timestamp;

        const [pendingTerminateItems, closedPresences, endAnchorQueueItemId] =
          await Promise.all([
            loadPendingTerminateQueueItems(normalizedMatchId, currentPeriod),
            loadClosedPlayerPresences(normalizedMatchId, currentPeriod),
            findEndAnchorSyncQueueId(targetAnchorId),
          ]);

        const revertPlan = resolveRevertEndPeriodPlan(
          pendingTerminateItems,
          closedPresences,
          endAnchorTimestamp,
          endAnchorQueueItemId,
        );

        if (targetAnchorId) {
          await deleteTimeAnchorWithQueue(targetAnchorId);
        }

        if (
          normalizedMatchId &&
          matchLockService.isMatchLocked(normalizedMatchId)
        ) {
          throw new Error(
            `Cannot complete period end revert: match ${
              normalizedMatchId
            } is locked for finalization.`,
          );
        }

        await Promise.all(
          revertPlan.terminateQueueItemIds.map((id) =>
            db.syncQueue.delete(id),
          ),
        );

        await Promise.all(
          revertPlan.presencesToReopen.map((p) =>
            db.playerpresences.update(p.id, {
              timeOut: null,
              isSynced: 0,
            }),
          ),
        );
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
    ++syncRequestIdRef.current;
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
      periodNumberRef.current = targetPeriodNumber;
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
          periodNumberRef.current = priorPeriod;
        }
        isPeriodActiveRef.current = false;
        isPeriodEndedRef.current = priorIsPeriodEnded;
        dispatch(
          setPeriodStatePayload({
            isPeriodActive: false,
            isInsideStoppage: false,
            isPeriodEnded: priorIsPeriodEnded,
            periodNumber: priorPeriod,
          }),
        );
        dispatch(setGlobalSequenceNumber(priorSequence));
        globalSequenceNumberRef.current = priorSequence;
        await syncPeriodStateWithDB(normalizedMatchId, priorPeriod);
      }
      throw error;
    }
  };

  const endPeriod = async (
    explicitTimestamp?: string,
  ): Promise<EndPeriodResult | undefined> => {
    ++syncRequestIdRef.current;
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
      const anchorId = await logTimeAnchor(1, currentPeriod, explicitTimestamp);
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
    ++syncRequestIdRef.current;
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
    ++syncRequestIdRef.current;
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
    const currentPeriod = periodNumberRef.current;
    if (!normalizedMatchId || !isPeriodActiveRef.current) return;

    if (isInsideStoppageRef.current) {
      await startTime();
      if (!isCurrentContext(normalizedMatchId, currentPeriod)) {
        return;
      }
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
    canUndoEndPeriod: canUndoEndPeriod && !isMatchLocked,
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
