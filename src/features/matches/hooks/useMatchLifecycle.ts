import { db } from "../../../db/ttaDatabase";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import {
  startPeriodState,
  endPeriodState,
  startStoppageState,
  endStoppageState,
  incrementSequence,
  incrementPeriodNumber,
  decrementPeriodNumber,
} from "../matchSlice";

export const useMatchLifecycle = () => {
  const dispatch = useAppDispatch();
  const {
    activeMatchId,
    periodnumber,
    isPeriodActive,
    isInsideStoppage,
    globalSequenceNumber,
  } = useAppSelector((state) => state.match);

  const logTimeAnchor = async (type: number) => {
    if (!activeMatchId) {
      console.warn("[Lifecycle] Cancelled: activeMatchId is missing.");
      return;
    }

    const nextSeq = globalSequenceNumber + 1;
    dispatch(incrementSequence());

    // Object maps 100% strictly to TimeAnchor interface in ttaDatabase.ts
    const anchorData = {
      id: crypto.randomUUID(),
      matchid: activeMatchId,
      periodnumber: periodnumber,
      type, // 0: PeriodStart, 1: PeriodEnd, 2: StoppageStart, 3: StoppageEnd
      timestamp: new Date().toISOString(),
      sequenceNumber: nextSeq,
      isSynced: 0,
    };

    await db.timeanchors.add(anchorData);
    console.log(
      `[IndexedDB] Stored TimeAnchor | Type: ${type} | Seq: ${nextSeq}`,
    );
  };

  const startPeriod = async () => {
    if (isPeriodActive) return;
    dispatch(startPeriodState());
    await logTimeAnchor(0);
  };

  const endPeriod = async () => {
    if (!isPeriodActive) return;
    dispatch(endPeriodState());
    await logTimeAnchor(1);
  };

  const stopTime = async () => {
    if (!isPeriodActive || isInsideStoppage) return;
    dispatch(startStoppageState());
    await logTimeAnchor(2);
  };

  const startTime = async () => {
    if (!isPeriodActive || !isInsideStoppage) return;
    dispatch(endStoppageState());
    await logTimeAnchor(3);
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
