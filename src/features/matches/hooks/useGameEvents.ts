import { useAuth0 } from "@auth0/auth0-react";
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

export interface UpdateGameEventHookParams {
  eventId: string;
  selectedPlayerId: string;
  actionName: string;
  isPositive: boolean;
  isLeadToGoal: boolean;
  eventDefinitionId?: string;
}

export const useGameEvents = (matchId: string, userId?: string) => {
  const dispatch = useAppDispatch();
  const { periodNumber, activeTeamId } = useAppSelector((state) => state.match);
  const { user } = useAuth0();
  const auth0UserId = user?.sub ?? user?.email;
  const reduxUserId = useAppSelector(
    (state) =>
      (
        state as unknown as {
          auth?: { user?: { id?: string }; currentUserId?: string };
        }
      ).auth?.currentUserId ??
      (
        state as unknown as {
          auth?: { user?: { id?: string }; currentUserId?: string };
        }
      ).auth?.user?.id,
  );
  const currentUserId = userId?.trim() || auth0UserId || reduxUserId;

  /**
   * Helper to resolve sportId for the active match and verify user ownership.
   */
  const resolveSportId = async (normalizedMatchId: string): Promise<string> => {
    const match = await db.matches.get(normalizedMatchId);
    if (!match?.tournamentId) {
      throw new Error(`Tournament is missing for match: ${normalizedMatchId}`);
    }

    if (currentUserId && match.userId && match.userId !== currentUserId) {
      throw new Error(`Match ${normalizedMatchId} belongs to another user.`);
    }

    const tournament = await db.tournaments.get(match.tournamentId);
    if (!tournament?.sportId?.trim()) {
      throw new Error(`Sport is missing for match: ${normalizedMatchId}`);
    }

    return tournament.sportId.trim();
  };

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

    const sportId = await resolveSportId(normalizedMatchId);
    const eventDef = await getEventDefinitionByName(
      actionName,
      sportId,
      currentUserId,
    );
    if (!eventDef) {
      throw new Error(`Event definition not found for action: "${actionName}"`);
    }

    const timestamp = new Date().toISOString();

    const createdEvent = await createGameEventTx({
      matchId: normalizedMatchId,
      teamId: normalizedTeamId,
      matchLineupId: lineup.id,
      eventDefinitionId: eventDef.id,
      periodNumber,
      eventTimestamp: timestamp,
      isLeadToGoal,
    });

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
    params: UpdateGameEventHookParams,
  ): Promise<boolean> => {
    const {
      eventId,
      selectedPlayerId,
      actionName,
      isPositive,
      isLeadToGoal,
      eventDefinitionId,
    } = params;

    const normalizedMatchId = matchId?.trim();
    if (!normalizedMatchId) {
      throw new Error("Active match ID is missing or empty.");
    }

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

    const sportId = await resolveSportId(normalizedMatchId);

    let resolvedEventDefId = eventDefinitionId;
    if (!resolvedEventDefId) {
      const eventDef = await getEventDefinitionByName(
        actionName,
        sportId,
        currentUserId,
      );
      if (!eventDef) {
        throw new Error(
          `Event definition not found for action: "${actionName}"`,
        );
      }
      resolvedEventDefId = eventDef.id;
    }

    const updatedEvent = await updateGameEventTx({
      eventId,
      matchLineupId: lineup.id,
      eventDefinitionId: resolvedEventDefId,
      expectedSportId: sportId,
      isLeadToGoal,
      userId: currentUserId,
    });

    dispatch(
      updateRecentAction({
        id: updatedEvent.id,
        playerNumber: lineup.number,
        actionName,
        isPositive,
        matchLineupId: lineup.id,
        eventDefinitionId: resolvedEventDefId,
        isLeadToGoal: updatedEvent.isLeadToGoal,
      }),
    );

    return true;
  };

  /**
   * Deletes an unsynchronized game event from Dexie DB and syncQueue, then removes it from Redux store.
   */
  const deleteGameEvent = async (eventId: string): Promise<boolean> => {
    const normalizedMatchId = matchId?.trim();
    if (!normalizedMatchId) {
      throw new Error("Active match ID is missing or empty.");
    }

    const event = await db.gameevents.get(eventId);
    if (!event) {
      throw new Error(`Game event record not found for ID: ${eventId}`);
    }

    const lineup = await db.matchlineups.get(event.matchLineupId);
    if (!lineup) {
      throw new Error(
        `Player lineup record not found for ID: ${event.matchLineupId}`,
      );
    }

    if (lineup.matchId?.trim() !== normalizedMatchId) {
      throw new Error(
        `Game event ${eventId} does not belong to match: ${normalizedMatchId}`,
      );
    }

    await resolveSportId(normalizedMatchId);

    await deleteGameEventTx(eventId);
    dispatch(deleteRecentAction(eventId));
    return true;
  };

  return { recordGameEvent, updateGameEvent, deleteGameEvent };
};
