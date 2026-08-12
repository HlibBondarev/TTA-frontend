import { useEffect, useCallback, useRef } from "react";
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

  const syncRequestIdRef = useRef(0);

  const syncPeriodStateWithDB = useCallback(async () => {
    const currentRequestId = ++syncRequestIdRef.current;
    const normalizedMatchId = activeMatchId?.trim();
    if (!normalizedMatchId || !db?.timeanchors) return;

    try {
      const anchors = await db.timeanchors
        .where("matchId")
        .equals(normalizedMatchId)
        .filter((a) => a.periodNumber === periodNumber)
        .toArray();

      if (currentRequestId === syncRequestIdRef.current) {
        const computedState = calculatePeriodState(anchors);
        dispatch(setPeriodStatePayload(computedState));
      }
    } catch (err) {
      console.error(
        "Failed to sync period state with IndexedDB timeanchors:",
        err,
      );
    }
  }, [activeMatchId, periodNumber, dispatch]);

  useEffect(() => {
    void syncPeriodStateWithDB();
  }, [syncPeriodStateWithDB]);

  // Internal helper to perform atomic IndexedDB write with rollback support and sync queue enqueuing
  const logTimeAnchor = async (type: number): Promise<string> => {
    const normalizedMatchId = activeMatchId?.trim();
    if (!normalizedMatchId) {
      throw new Error("No active match ID found for logging time anchor.");
    }

    const anchorId = crypto.randomUUID();

    await db.transaction(
      "rw",
      [db.timeanchors, db.gameevents, db.playerpresences, db.syncQueue],
      async () => {
        const nextSeq = await getNextSequenceNumber();
        const timestamp = new Date().toISOString();

        const anchorData = {
          id: anchorId,
          matchId: normalizedMatchId,
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
          endpoint: `/Matches/${normalizedMatchId}/anchors`,
          payload,
          createdAt: timestamp,
        };

        await db.syncQueue.add(syncItem);
      },
    );

    return anchorId;
  };

  /**
   * Atomically deletes the time anchor record from IndexedDB and purges its unsent sync queue payload.
   */
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
    if (anchorId) {
      await removeTimeAnchor(anchorId);
    }
    dispatch(
      setPeriodStatePayload({
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: false,
      }),
    );
    await syncPeriodStateWithDB();
  };

  const revertEndPeriod = async (anchorId?: string | null) => {
    if (anchorId) {
      await removeTimeAnchor(anchorId);
    }
    dispatch(startPeriodState());
    await syncPeriodStateWithDB();
  };

  const startPeriod = async (): Promise<string | undefined> => {
    if (!activeMatchId?.trim()) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (isPeriodActive || isPeriodEnded) return;

    const priorSequence = globalSequenceNumber;
    dispatch(startPeriodState());
    dispatch(incrementSequence());

    try {
      const anchorId = await logTimeAnchor(0);
      await syncPeriodStateWithDB();
      return anchorId;
    } catch (error) {
      dispatch(
        setPeriodStatePayload({
          isPeriodActive: false,
          isInsideStoppage: false,
          isPeriodEnded: false,
        }),
      );
      dispatch(setGlobalSequenceNumber(priorSequence));
      await syncPeriodStateWithDB();
      throw error;
    }
  };

  const endPeriod = async (): Promise<string | undefined> => {
    if (!activeMatchId?.trim()) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (!isPeriodActive || isInsideStoppage) return;

    const priorSequence = globalSequenceNumber;
    dispatch(endPeriodState());
    dispatch(incrementSequence());

    try {
      const anchorId = await logTimeAnchor(1);
      await syncPeriodStateWithDB();
      return anchorId;
    } catch (error) {
      dispatch(startPeriodState());
      dispatch(setGlobalSequenceNumber(priorSequence));
      await syncPeriodStateWithDB();
      throw error;
    }
  };

  const stopTime = async () => {
    if (!activeMatchId?.trim()) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (!isPeriodActive || isInsideStoppage) return;

    const priorSequence = globalSequenceNumber;
    dispatch(startStoppageState());
    dispatch(incrementSequence());
    try {
      await logTimeAnchor(2);
      await syncPeriodStateWithDB();
    } catch (error) {
      dispatch(endStoppageState());
      dispatch(setGlobalSequenceNumber(priorSequence));
      await syncPeriodStateWithDB();
      throw error;
    }
  };

  const startTime = async () => {
    if (!activeMatchId?.trim()) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (!isPeriodActive || !isInsideStoppage) return;

    const priorSequence = globalSequenceNumber;
    dispatch(endStoppageState());
    dispatch(incrementSequence());
    try {
      await logTimeAnchor(3);
      await syncPeriodStateWithDB();
    } catch (error) {
      dispatch(startStoppageState());
      dispatch(setGlobalSequenceNumber(priorSequence));
      await syncPeriodStateWithDB();
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
