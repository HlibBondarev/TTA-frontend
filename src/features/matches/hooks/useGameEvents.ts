import { useAppDispatch, useAppSelector } from "../../../hooks/hooks";
import {
  setGlobalSequenceNumber,
  addRecentAction,
  updateRecentAction,
  deleteRecentAction,
} from "../store/matchSlice";
import {
  getEventDefinitionByName,
  createGameEventTx,
  updateGameEventTx,
  deleteGameEventTx,
} from "../../../db/eventService";
import { db } from "../../../db/ttaDatabase";

export interface RecordGameEventParams {
  selectedPlayerId: string;
  actionName: string;
  isPositive: boolean;
  isLeadToGoal: boolean;
}

export interface UpdateGameEventParams {
  eventId: string;
  selectedPlayerId: string;
  actionName: string;
  isPositive: boolean;
  isLeadToGoal: boolean;
}

export const useGameEvents = (matchId: string) => {
  const dispatch = useAppDispatch();
  const { periodNumber, activeTeamId } = useAppSelector((state) => state.match);

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

    const normalizedTeamId = activeTeamId?.trim();
    if (!normalizedTeamId) {
      throw new Error("Active team ID is missing or empty in Redux store.");
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

    // 2. Resolve Event Definition by action name
    const eventDef = await getEventDefinitionByName(actionName);
    if (!eventDef) {
      throw new Error(`Event definition not found for action: "${actionName}"`);
    }

    const timestamp = new Date().toISOString();

    // 3. Atomically persist GameEvent entity with serialized sequence reservation and sync queue payload
    const createdEvent = await createGameEventTx({
      matchId: normalizedMatchId,
      teamId: normalizedTeamId,
      matchLineupId: lineup.id,
      eventDefinitionId: eventDef.id,
      periodNumber,
      eventTimestamp: timestamp,
      isLeadToGoal,
    });

    // 4. Update Redux store with transactionally computed sequence and full event metadata
    dispatch(setGlobalSequenceNumber(createdEvent.sequenceNumber));
    dispatch(
      addRecentAction({
        id: createdEvent.id,
        playerNumber: lineup.number,
        actionName,
        isPositive,
        timestamp,
        matchLineupId: lineup.id,
        eventDefinitionId: eventDef.id,
        isLeadToGoal: createdEvent.isLeadToGoal,
        isSynced: createdEvent.isSynced,
      }),
    );

    return true;
  };

  /**
   * Updates an existing unsynchronized game event in Dexie DB and syncQueue, then updates Redux store.
   */
  const updateGameEvent = async (
    params: UpdateGameEventParams,
  ): Promise<boolean> => {
    const { eventId, selectedPlayerId, actionName, isPositive, isLeadToGoal } =
      params;

    const lineup = await db.matchlineups.get(selectedPlayerId);
    if (!lineup) {
      throw new Error(
        `Player lineup record not found for ID: ${selectedPlayerId}`,
      );
    }

    const eventDef = await getEventDefinitionByName(actionName);
    if (!eventDef) {
      throw new Error(`Event definition not found for action: "${actionName}"`);
    }

    const updatedEvent = await updateGameEventTx({
      eventId,
      matchLineupId: lineup.id,
      eventDefinitionId: eventDef.id,
      isLeadToGoal,
    });

    dispatch(
      updateRecentAction({
        id: updatedEvent.id,
        playerNumber: lineup.number,
        actionName,
        isPositive,
        matchLineupId: lineup.id,
        eventDefinitionId: eventDef.id,
        isLeadToGoal: updatedEvent.isLeadToGoal,
      }),
    );

    return true;
  };

  /**
   * Deletes an unsynchronized game event from Dexie DB and syncQueue, then removes it from Redux store.
   */
  const deleteGameEvent = async (eventId: string): Promise<boolean> => {
    await deleteGameEventTx(eventId);
    dispatch(deleteRecentAction(eventId));
    return true;
  };

  return { recordGameEvent, updateGameEvent, deleteGameEvent };
};
