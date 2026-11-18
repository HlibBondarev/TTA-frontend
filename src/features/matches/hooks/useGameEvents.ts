import { useRef } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useAppDispatch, useAppSelector } from "../../../hooks/hooks";
import {
  setGlobalSequenceNumber,
  addRecentAction,
  updateRecentAction,
  deleteRecentAction,
} from "../store/matchSlice";
import {
  createGameEventTx,
  updateGameEventTx,
  deleteGameEventTx,
} from "../../../db/eventService";
import { exitPlayerPresenceTx } from "../../../db/presenceService";
import {
  db,
  type EventDefinitionLookup,
  type GameEvent,
} from "../../../db/ttaDatabase";
import { optimisticRemoveFromActive } from "../../playerpresences/store/presenceSlice";
import { shouldAutoRemoveActivePlayer } from "../../../utils/disciplinaryUtils";
import type { AppDispatch } from "../../../store";

export type GameEventMutationResult =
  | true
  | {
      eventSaved: true;
      removalPending: true;
      eventId: string;
    };

interface PendingDisciplinaryRemoval {
  event: GameEvent;
  periodNumber: number;
}

const loadDisciplinaryContext = async (
  matchId: string,
  event: GameEvent,
): Promise<{
  maxPersonalFouls: number | null;
  playerGameEvents: GameEvent[];
  eventDefinitionsById: Map<string, EventDefinitionLookup>;
}> => {
  let maxPersonalFouls: number | null = null;
  if (db.matches?.get && db.tournaments?.get && db.sportconfigurations?.get) {
    const match = await db.matches.get(matchId);
    const tournament = match?.tournamentId
      ? await db.tournaments.get(match.tournamentId)
      : undefined;
    const config = tournament?.configurationId
      ? await db.sportconfigurations.get(tournament.configurationId)
      : undefined;
    if (typeof config?.maxPersonalFouls === "number") {
      maxPersonalFouls = config.maxPersonalFouls;
    }
  }

  const loadedEvents = db.gameevents?.where
    ? await db.gameevents
        .where("matchLineupId")
        .equals(event.matchLineupId)
        .toArray()
    : [];
  const playerGameEvents = loadedEvents.some((e) => e.id === event.id)
    ? loadedEvents
    : [...loadedEvents, event];

  const eventDefinitionsById = new Map<string, EventDefinitionLookup>();
  const defIds = Array.from(
    new Set(playerGameEvents.map((e) => e.eventDefinitionId).filter(Boolean)),
  );
  if (defIds.length > 0 && db.eventdefinitions) {
    if (typeof db.eventdefinitions.bulkGet === "function") {
      const defs = await db.eventdefinitions.bulkGet(defIds);
      for (const def of defs) {
        if (def) {
          eventDefinitionsById.set(def.id, def);
        }
      }
    } else if (typeof db.eventdefinitions.get === "function") {
      const defs = await Promise.all(
        defIds.map((id) => db.eventdefinitions.get(id)),
      );
      for (const def of defs) {
        if (def) {
          eventDefinitionsById.set(def.id, def);
        }
      }
    }
  }

  return { maxPersonalFouls, playerGameEvents, eventDefinitionsById };
};

const applyDisciplinaryAutoRemovalIfNeeded = async (
  matchId: string,
  event: GameEvent,
  currentPeriod: number,
  isPeriodActive: boolean,
  dispatch: AppDispatch,
): Promise<boolean> => {
  if (!isPeriodActive) return true;

  try {
    const { maxPersonalFouls, playerGameEvents, eventDefinitionsById } =
      await loadDisciplinaryContext(matchId, event);

    const shouldRemove = shouldAutoRemoveActivePlayer({
      event,
      eventDefinition: eventDefinitionsById.get(event.eventDefinitionId),
      playerGameEvents,
      eventDefinitionsById,
      maxPersonalFouls,
      currentPeriod,
      isPeriodActive,
    });

    if (!shouldRemove) return true;

    const didExit = await exitPlayerPresenceTx(
      matchId,
      currentPeriod,
      event.matchLineupId,
      event.eventTimestamp,
    );

    if (didExit) {
      dispatch(optimisticRemoveFromActive(event.matchLineupId));
    }

    return true;
  } catch (error) {
    console.error(
      `Disciplinary auto-removal failed for committed event ${event.id}:`,
      error,
    );
    return false;
  }
};

export interface RecordGameEventParams {
  selectedPlayerId: string;
  actionName: string;
  isPositive: boolean;
  isLeadToGoal: boolean;
  eventDefinitionId: string;
  locationX?: number | null;
  locationY?: number | null;
  shotLocationX?: number | null;
  shotLocationY?: number | null;
}

export interface UpdateGameEventHookParams {
  eventId: string;
  selectedPlayerId: string;
  actionName: string;
  isPositive: boolean;
  isLeadToGoal: boolean;
  eventDefinitionId: string;
  locationX?: number | null;
  locationY?: number | null;
  shotLocationX?: number | null;
  shotLocationY?: number | null;
}

export const useGameEvents = (matchId: string, userId?: string) => {
  const dispatch = useAppDispatch();
  const { periodNumber, activeTeamId, isPeriodActive } = useAppSelector(
    (state) => state.match,
  );
  const initialPendingRemovals: Record<string, PendingDisciplinaryRemoval> = {};
  const pendingRemovalsRef = useRef(initialPendingRemovals);
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

  const retryPendingDisciplinaryRemovals = async (): Promise<boolean> => {
    const normalizedMatchId = matchId?.trim();
    const entries = Object.entries(pendingRemovalsRef.current);
    if (!normalizedMatchId || entries.length === 0) {
      return true;
    }

    for (const [eventId, pending] of entries) {
      const completed = await applyDisciplinaryAutoRemovalIfNeeded(
        normalizedMatchId,
        pending.event,
        pending.periodNumber,
        isPeriodActive,
        dispatch,
      );
      if (completed) {
        delete pendingRemovalsRef.current[eventId];
      }
    }

    return Object.keys(pendingRemovalsRef.current).length === 0;
  };

  const finalizeDisciplinaryRemoval = async (
    normalizedMatchId: string,
    committedEvent: GameEvent,
  ): Promise<GameEventMutationResult> => {
    await retryPendingDisciplinaryRemovals();

    const removalCompleted = await applyDisciplinaryAutoRemovalIfNeeded(
      normalizedMatchId,
      committedEvent,
      periodNumber,
      isPeriodActive,
      dispatch,
    );

    if (!removalCompleted) {
      pendingRemovalsRef.current[committedEvent.id] = {
        event: committedEvent,
        periodNumber,
      };
      return {
        eventSaved: true,
        removalPending: true,
        eventId: committedEvent.id,
      };
    }

    delete pendingRemovalsRef.current[committedEvent.id];
    return true;
  };

  const recordGameEvent = async (
    params: RecordGameEventParams,
  ): Promise<GameEventMutationResult> => {
    const {
      selectedPlayerId,
      actionName,
      isPositive,
      isLeadToGoal,
      eventDefinitionId,
      locationX,
      locationY,
      shotLocationX,
      shotLocationY,
    } = params;

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
        `Player lineup ${selectedPlayerId} does not belong to match: ${
          matchId
        }`,
      );
    }

    await resolveSportId(normalizedMatchId);

    const resolvedEventDefId = eventDefinitionId;
    const timestamp = new Date().toISOString();

    const createdEvent = await createGameEventTx({
      matchId: normalizedMatchId,
      teamId: normalizedTeamId,
      matchLineupId: lineup.id,
      eventDefinitionId: resolvedEventDefId,
      periodNumber,
      eventTimestamp: timestamp,
      isLeadToGoal,
      locationX: locationX ?? null,
      locationY: locationY ?? null,
      shotLocationX: shotLocationX ?? null,
      shotLocationY: shotLocationY ?? null,
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
        eventDefinitionId: resolvedEventDefId,
        isLeadToGoal: createdEvent.isLeadToGoal,
        isSynced: createdEvent.isSynced,
      }),
    );

    return finalizeDisciplinaryRemoval(normalizedMatchId, createdEvent);
  };

  const updateGameEvent = async (
    params: UpdateGameEventHookParams,
  ): Promise<GameEventMutationResult> => {
    const {
      eventId,
      selectedPlayerId,
      actionName,
      isPositive,
      isLeadToGoal,
      eventDefinitionId,
      locationX,
      locationY,
      shotLocationX,
      shotLocationY,
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
        `Player lineup ${selectedPlayerId} does not belong to match: ${
          matchId
        }`,
      );
    }

    const sportId = await resolveSportId(normalizedMatchId);
    const resolvedEventDefId = eventDefinitionId;

    const updatedEvent = await updateGameEventTx({
      eventId,
      matchLineupId: lineup.id,
      eventDefinitionId: resolvedEventDefId,
      expectedSportId: sportId,
      isLeadToGoal,
      locationX,
      locationY,
      shotLocationX,
      shotLocationY,
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

    return finalizeDisciplinaryRemoval(normalizedMatchId, updatedEvent);
  };

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
    delete pendingRemovalsRef.current[eventId];
    dispatch(deleteRecentAction(eventId));
    return true;
  };

  return {
    recordGameEvent,
    updateGameEvent,
    deleteGameEvent,
    retryPendingDisciplinaryRemovals,
  };
};
