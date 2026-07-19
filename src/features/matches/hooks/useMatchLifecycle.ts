import { db } from "../../../db/ttaDatabase";
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
  const {
    activeMatchId,
    periodnumber,
    isPeriodActive,
    isInsideStoppage,
    globalSequenceNumber,
  } = useAppSelector((state) => state.match);

  // Internal helper to perform atomic IndexedDB write
  const logTimeAnchor = async (type: number, currentSeq: number) => {
    if (!activeMatchId) throw new Error("Active match ID is missing.");

    const anchorData = {
      id: crypto.randomUUID(),
      matchid: activeMatchId,
      periodnumber: periodnumber,
      type,
      timestamp: new Date().toISOString(),
      sequenceNumber: currentSeq,
      isSynced: 0,
    };

    await db.timeanchors.add(anchorData);
  };

  const startPeriod = async () => {
    if (isPeriodActive) return;
    const nextSeq = globalSequenceNumber + 1;

    // Optimistic dispatch
    dispatch(startPeriodState());
    dispatch(incrementSequence());

    try {
      await logTimeAnchor(0, nextSeq);
    } catch (error) {
      // Revert Redux state if DB write fails
      dispatch(endPeriodState());
      // Sequence is not rolled back to prevent potential reuse of ID,
      // ensuring strict monotonicity in the sequence
      throw error;
    }
  };

  const endPeriod = async () => {
    if (!isPeriodActive) return;
    const nextSeq = globalSequenceNumber + 1;

    dispatch(endPeriodState());
    dispatch(incrementSequence());

    try {
      await logTimeAnchor(1, nextSeq);
    } catch (error) {
      dispatch(startPeriodState());
      throw error;
    }
  };

  const stopTime = async () => {
    if (!isPeriodActive || isInsideStoppage) return;
    const nextSeq = globalSequenceNumber + 1;
    dispatch(startStoppageState());
    dispatch(incrementSequence());
    await logTimeAnchor(2, nextSeq);
  };

  const startTime = async () => {
    if (!isPeriodActive || !isInsideStoppage) return;
    const nextSeq = globalSequenceNumber + 1;
    dispatch(endStoppageState());
    dispatch(incrementSequence());
    await logTimeAnchor(3, nextSeq);
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
    stopTime,
    startTime,
    nextPeriod,
    prevPeriod,
  };
};
