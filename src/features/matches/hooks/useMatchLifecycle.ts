import { db } from "../../../db/ttaDatabase";
import { getNextSequenceNumber } from "../../../db/eventService";
import { useAppDispatch, useAppSelector } from "../../../hooks/hooks";
import { TEST_MATCH_ID } from "../../../App";
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
    periodnumber,
    isPeriodActive,
    isInsideStoppage,
    globalSequenceNumber,
  } = matchState;

  // Internal helper to perform atomic IndexedDB write with rollback support
  const logTimeAnchor = async (type: number): Promise<string> => {
    const matchIdToUse = activeMatchId || TEST_MATCH_ID;
    const anchorId = crypto.randomUUID();

    await db.transaction(
      "rw",
      [db.timeanchors, db.gameevents, db.playerpresences],
      async () => {
        const nextSeq = await getNextSequenceNumber();

        const anchorData = {
          id: anchorId,
          matchid: matchIdToUse,
          periodnumber: periodnumber,
          type,
          timestamp: new Date().toISOString(),
          sequenceNumber: nextSeq,
          isSynced: 0,
        };

        await db.timeanchors.add(anchorData);
      },
    );

    return anchorId;
  };

  const removeTimeAnchor = async (anchorId: string) => {
    await db.timeanchors.delete(anchorId);
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
    periodnumber,
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
