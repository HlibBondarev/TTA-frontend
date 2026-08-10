import { db } from "../../../db/ttaDatabase";
import { getNextSequenceNumber } from "../../../db/eventService";
import { useAppDispatch, useAppSelector } from "../../../hooks/hooks";
import {
  startPeriodState,
  endPeriodState,
  startStoppageState,
  endStoppageState,
  incrementSequence,
  incrementPeriodNumber,
  decrementPeriodNumber,
} from "../store/matchSlice";

export const useMatchLifecycle = () => {
  const dispatch = useAppDispatch();
  const matchState = useAppSelector((state) => state.match);
  const {
    activeMatchId,
    periodNumber,
    isPeriodActive,
    isInsideStoppage,
    globalSequenceNumber,
  } = matchState;

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

        // Array batch payload containing client-generated anchor ID
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
    dispatch(endPeriodState());
  };

  const revertEndPeriod = async (anchorId?: string | null) => {
    if (anchorId) {
      await removeTimeAnchor(anchorId);
    }
    dispatch(startPeriodState());
  };

  const startPeriod = async (): Promise<string | undefined> => {
    if (!activeMatchId?.trim()) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (isPeriodActive) return;

    dispatch(startPeriodState());
    dispatch(incrementSequence());

    try {
      const anchorId = await logTimeAnchor(0);
      return anchorId;
    } catch (error) {
      dispatch(endPeriodState());
      throw error;
    }
  };

  const endPeriod = async (): Promise<string | undefined> => {
    if (!activeMatchId?.trim()) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (!isPeriodActive) return;

    dispatch(endPeriodState());
    dispatch(incrementSequence());

    try {
      const anchorId = await logTimeAnchor(1);
      return anchorId;
    } catch (error) {
      dispatch(startPeriodState());
      throw error;
    }
  };

  const stopTime = async () => {
    if (!activeMatchId?.trim()) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (!isPeriodActive || isInsideStoppage) return;

    dispatch(startStoppageState());
    dispatch(incrementSequence());
    try {
      await logTimeAnchor(2);
    } catch (error) {
      dispatch(endStoppageState());
      throw error;
    }
  };

  const startTime = async () => {
    if (!activeMatchId?.trim()) {
      throw new Error("No active match ID found for logging time anchor.");
    }
    if (!isPeriodActive || !isInsideStoppage) return;

    dispatch(endStoppageState());
    dispatch(incrementSequence());
    try {
      await logTimeAnchor(3);
    } catch (error) {
      dispatch(startStoppageState());
      throw error;
    }
  };

  const nextPeriod = () => {
    if (isPeriodActive) return;
    dispatch(incrementPeriodNumber());
  };

  const prevPeriod = () => {
    if (isPeriodActive) return;
    dispatch(decrementPeriodNumber());
  };

  return {
    periodNumber,
    isPeriodActive,
    isInsideStoppage,
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
  };
};
