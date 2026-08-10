import { useAppDispatch, useAppSelector } from "../../../hooks/hooks";
import { setGlobalSequenceNumber, addRecentAction } from "../store/matchSlice";
import {
  getEventDefinitionByName,
  createGameEventTx,
} from "../../../db/eventService";
import { db } from "../../../db/ttaDatabase";

export interface RecordGameEventParams {
  selectedPlayerId: string;
  actionName: string;
  isPositive: boolean;
  isLeadToGoal: boolean;
}

export const useGameEvents = (matchId: string) => {
  const dispatch = useAppDispatch();
  const { periodNumber } = useAppSelector((state) => state.match);

  /**
   * Resolves player jersey number, event definition ID, persists GameEvent to Dexie DB,
   * and dispatches state updates to Redux.
   */
  const recordGameEvent = async (
    params: RecordGameEventParams,
  ): Promise<boolean> => {
    const { selectedPlayerId, actionName, isPositive, isLeadToGoal } = params;

    const normalizedMatchId = matchId?.trim();
    if (!normalizedMatchId) {
      throw new Error("Active match ID is missing or empty.");
    }

    // 1. Resolve Match Lineup record to get real jersey number and matchLineupId
    const lineup = await db.matchlineups.get(selectedPlayerId);
    if (!lineup) {
      throw new Error(
        `Player lineup record not found for ID: ${selectedPlayerId}`,
      );
    }

    if (lineup.matchId?.trim() !== normalizedMatchId) {
      throw new Error(
        `Player lineup ${selectedPlayerId} does not belong to match: ${matchId}`,
      );
    }

    // 2. Resolve target team ID from player roster association
    if (!lineup.playerRosterId) {
      throw new Error(
        `Player lineup ${selectedPlayerId} does not have an associated playerRosterId.`,
      );
    }

    const roster = await db.playerrosters.get(lineup.playerRosterId);
    const teamId = roster?.teamId?.trim();
    if (!teamId) {
      throw new Error(
        `Player roster or team ID not found for roster ID: ${lineup.playerRosterId}`,
      );
    }

    // 3. Resolve Event Definition by action name
    const eventDef = await getEventDefinitionByName(actionName);
    if (!eventDef) {
      throw new Error(`Event definition not found for action: "${actionName}"`);
    }

    const timestamp = new Date().toISOString();

    // 4. Atomically persist GameEvent entity with serialized sequence reservation and sync queue payload
    const createdEvent = await createGameEventTx({
      matchId: normalizedMatchId,
      teamId,
      matchLineupId: lineup.id,
      eventDefinitionId: eventDef.id,
      periodNumber,
      eventTimestamp: timestamp,
      isLeadToGoal: isLeadToGoal,
    });

    // 5. Update Redux store with transactionally computed sequence and real player jersey number
    dispatch(setGlobalSequenceNumber(createdEvent.sequenceNumber));
    dispatch(
      addRecentAction({
        id: createdEvent.id,
        playerNumber: lineup.number,
        actionName,
        isPositive,
        timestamp,
      }),
    );

    return true;
  };

  return { recordGameEvent };
};
