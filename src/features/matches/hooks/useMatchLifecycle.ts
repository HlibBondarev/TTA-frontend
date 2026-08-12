import { useEffect, useCallback, useRef, useState } from "react";
import { liveQuery } from "dexie";
import { db, type TimeAnchor } from "../../../db/ttaDatabase";
import { getNextSequenceNumber } from "../../../db/eventService";
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

  const syncRequestIdRef = useRef(0);
  const activeMatchIdRef = useRef(activeMatchId);
  const periodNumberRef = useRef(periodNumber);

  useEffect(() => {
    activeMatchIdRef.current = activeMatchId;
    periodNumberRef.current = periodNumber;
  }, [activeMatchId, periodNumber]);

  useEffect(() => {
    const normalizedMatchId = activeMatchId?.trim();

    const subscription = liveQuery(async () => {
      if (
        !normalizedMatchId ||
        !isPeriodEnded ||
        !db?.syncQueue ||
        !db?.timeanchors
      ) {
        return false;
      }

      const endAnchors = await db.timeanchors
        .where("matchId")
        .equals(normalizedMatchId)
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
    }).subscribe({
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
    const normalizedMatchId = activeMatchId?.trim();
    if (!normalizedMatchId) {
      throw new Error("No active match ID found for logging time anchor.");
    }

    const anchorPeriod = targetPeriodNumber ?? periodNumber;
    const anchorId = crypto.randomUUID();

    await db.transaction(
      "rw",
      [db.timeanchors, db.gameevents, db.playerpresences, db.syncQueue],
      async () => {
        if (type === 0) {
          const existingAnchors = await db.timeanchors
            .where("matchId")
            .equals(normalizedMatchId)
            .filter((a) => a.periodNumber === anchorPeriod)
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
          matchId: normalizedMatchId,
          periodNumber: anchorPeriod,
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
          endpoint: `/Matches/${normalizedMatchId}/anchors`,
          payload,
          createdAt: timestamp,
        };

        await db.syncQueue.add(syncItem);
      },
    );

    return anchorId;
  };

  const removeTimeAnchor = async (anchorId: string) => {
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

  const revertStartPeriod = async (anchorId?: string | null) => {
    const normalizedMatchId = activeMatchId?.trim();
    const currentPeriod = periodNumber;
    if (anchorId) {
      await removeTimeAnchor(anchorId);
    }
    if (!isCurrentContext(normalizedMatchId, currentPeriod)) {
      return;
    }
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
    const normalizedMatchId = activeMatchId?.trim();
    const currentPeriod = periodNumber;

    let targetAnchorId = anchorId;
    if (!targetAnchorId && normalizedMatchId && db?.timeanchors) {
      const endAnchors = await db.timeanchors
        .where("matchId")
        .equals(normalizedMatchId)
        .filter((a) => a.periodNumber === currentPeriod && a.type === 1)
        .toArray();

      if (endAnchors.length > 0) {
        targetAnchorId = endAnchors[0].id;
      }
    }

    if (targetAnchorId) {
      await removeTimeAnchor(targetAnchorId);
    }

    if (normalizedMatchId && db?.playerpresences) {
      await db.transaction(
        "rw",
        [db.playerpresences, db.syncQueue],
        async () => {
          const presences = await db.playerpresences
            .where("periodNumber")
            .equals(currentPeriod)
            .filter((p) => p.timeOut !== null)
            .toArray();

          for (const p of presences) {
            await db.playerpresences.update(p.id, {
              timeOut: null,
              isSynced: 0,
            });
          }
        },
      );
    }

    if (!isCurrentContext(normalizedMatchId, currentPeriod)) {
      return;
    }
    dispatch(startPeriodState());
    await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
  };

  const startPeriod = async (
    targetPeriodNumber?: number,
  ): Promise<string | undefined> => {
    const normalizedMatchId = activeMatchId?.trim();
    if (!normalizedMatchId) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (
      isPeriodActive ||
      (isPeriodEnded &&
        (!targetPeriodNumber || targetPeriodNumber === periodNumber))
    ) {
      return;
    }

    const currentPeriod = targetPeriodNumber ?? periodNumber;
    if (targetPeriodNumber && targetPeriodNumber !== periodNumber) {
      dispatch(incrementPeriodNumber());
    }

    const priorSequence = globalSequenceNumber;
    dispatch(startPeriodState());
    dispatch(incrementSequence());

    try {
      const anchorId = await logTimeAnchor(0, currentPeriod);
      await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
      return anchorId;
    } catch (error) {
      if (isCurrentContext(normalizedMatchId, currentPeriod)) {
        dispatch(
          setPeriodStatePayload({
            isPeriodActive: false,
            isInsideStoppage: false,
            isPeriodEnded: false,
          }),
        );
        dispatch(setGlobalSequenceNumber(priorSequence));
        await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
      }
      throw error;
    }
  };

  const endPeriod = async (): Promise<string | undefined> => {
    const normalizedMatchId = activeMatchId?.trim();
    if (!normalizedMatchId) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (!isPeriodActive || isInsideStoppage) return;

    const currentPeriod = periodNumber;
    const priorSequence = globalSequenceNumber;
    dispatch(endPeriodState());
    dispatch(incrementSequence());

    try {
      const anchorId = await logTimeAnchor(1, currentPeriod);
      await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
      return anchorId;
    } catch (error) {
      if (isCurrentContext(normalizedMatchId, currentPeriod)) {
        dispatch(startPeriodState());
        dispatch(setGlobalSequenceNumber(priorSequence));
        await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
      }
      throw error;
    }
  };

  const stopTime = async () => {
    const normalizedMatchId = activeMatchId?.trim();
    if (!normalizedMatchId) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (!isPeriodActive || isInsideStoppage) return;

    const currentPeriod = periodNumber;
    const priorSequence = globalSequenceNumber;
    dispatch(startStoppageState());
    dispatch(incrementSequence());
    try {
      await logTimeAnchor(2, currentPeriod);
      await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
    } catch (error) {
      if (isCurrentContext(normalizedMatchId, currentPeriod)) {
        dispatch(endStoppageState());
        dispatch(setGlobalSequenceNumber(priorSequence));
        await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
      }
      throw error;
    }
  };

  const startTime = async () => {
    const normalizedMatchId = activeMatchId?.trim();
    if (!normalizedMatchId) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (!isPeriodActive || !isInsideStoppage) return;

    const currentPeriod = periodNumber;
    const priorSequence = globalSequenceNumber;
    dispatch(endStoppageState());
    dispatch(incrementSequence());
    try {
      await logTimeAnchor(3, currentPeriod);
      await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
    } catch (error) {
      if (isCurrentContext(normalizedMatchId, currentPeriod)) {
        dispatch(startStoppageState());
        dispatch(setGlobalSequenceNumber(priorSequence));
        await syncPeriodStateWithDB(normalizedMatchId, currentPeriod);
      }
      throw error;
    }
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
    startPeriod,
    endPeriod,
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
