import {
  db,
  type GameEvent,
  type EventDefinitionLookup,
  type SyncQueueItem,
} from "./ttaDatabase";

// In-memory cache for event definitions to avoid repeated IndexedDB reads during rapid recording
let eventDefinitionsCache: Map<string, EventDefinitionLookup> | null = null;

/**
 * Loads all event definitions from IndexedDB into memory map for fast lookup by name.
 */
export const loadEventDefinitionsCache = async (): Promise<
  Map<string, EventDefinitionLookup>
> => {
  if (eventDefinitionsCache && eventDefinitionsCache.size > 0) {
    return eventDefinitionsCache;
  }

  const definitions = await db.eventdefinitions.toArray();
  const map = new Map<string, EventDefinitionLookup>();

  definitions.forEach((def) => {
    map.set(def.name.toLowerCase(), def);
  });

  eventDefinitionsCache = map;
  return map;
};

/**
 * Clears the in-memory cache (useful for test resets or dynamic configuration changes).
 */
export const clearEventDefinitionsCache = () => {
  eventDefinitionsCache = null;
};

/**
 * Resolves event definition ID by name (case-insensitive).
 */
export const getEventDefinitionByName = async (
  actionName: string,
): Promise<EventDefinitionLookup | undefined> => {
  const cache = await loadEventDefinitionsCache();
  return cache.get(actionName.trim().toLowerCase());
};

/**
 * Calculates the next available global sequence number across events, anchors, and presences.
 */
export const getNextSequenceNumber = async (): Promise<number> => {
  const lastEvent = await db.gameevents.orderBy("sequenceNumber").last();
  const lastAnchor = await db.timeanchors.orderBy("sequenceNumber").last();
  const lastPresence = await db.playerpresences
    .orderBy("sequenceNumber")
    .last();

  return (
    Math.max(
      lastEvent?.sequenceNumber ?? 0,
      lastAnchor?.sequenceNumber ?? 0,
      lastPresence?.sequenceNumber ?? 0,
    ) + 1
  );
};

export interface CreateGameEventParams {
  matchId: string;
  teamId: string;
  matchLineupId: string;
  eventDefinitionId: string;
  periodNumber: number;
  eventTimestamp: string;
  isLeadToGoal: boolean;
}

export interface UpdateGameEventParams {
  eventId: string;
  matchLineupId: string;
  eventDefinitionId: string;
  isLeadToGoal: boolean;
}

/**
 * Atomically persists a new GameEvent entity to IndexedDB and enqueues the team-scoped sync payload.
 */
export const createGameEventTx = async (
  params: CreateGameEventParams,
): Promise<GameEvent> => {
  const normalizedMatchId = params.matchId?.trim();
  if (!normalizedMatchId) {
    throw new Error("Missing or empty matchId for creating game event.");
  }

  const normalizedTeamId = params.teamId?.trim();
  if (!normalizedTeamId) {
    throw new Error("Missing or empty teamId for creating game event.");
  }

  let createdEvent: GameEvent | null = null;

  await db.transaction(
    "rw",
    [db.gameevents, db.timeanchors, db.playerpresences, db.syncQueue],
    async () => {
      const nextSeq = await getNextSequenceNumber();

      createdEvent = {
        id: crypto.randomUUID(),
        matchLineupId: params.matchLineupId,
        eventDefinitionId: params.eventDefinitionId,
        periodNumber: params.periodNumber,
        eventTimestamp: params.eventTimestamp,
        isLeadToGoal: params.isLeadToGoal,
        createdAt: new Date().toISOString(),
        sequenceNumber: nextSeq,
        isSynced: 0,
      };

      await db.gameevents.add(createdEvent);

      // Array batch payload containing client-generated event ID
      const payload = JSON.stringify([
        {
          id: createdEvent.id,
          matchLineupId: params.matchLineupId,
          eventDefinitionId: params.eventDefinitionId,
          periodNumber: params.periodNumber,
          isLeadToGoal: params.isLeadToGoal,
          eventTimestamp: params.eventTimestamp,
        },
      ]);

      const syncItem: SyncQueueItem = {
        actionType: "POST",
        endpoint: `/Matches/${normalizedMatchId}/teams/${normalizedTeamId}/events`,
        payload,
        createdAt: params.eventTimestamp,
      };

      await db.syncQueue.add(syncItem);
    },
  );

  return createdEvent!;
};

/**
 * Atomically updates an existing unsynchronized GameEvent entity in IndexedDB and syncQueue.
 * Throws an error if the event is already synchronized (isSynced === 1).
 */
export const updateGameEventTx = async (
  params: UpdateGameEventParams,
): Promise<GameEvent> => {
  let updatedEvent: GameEvent | null = null;

  await db.transaction("rw", [db.gameevents, db.syncQueue], async () => {
    const existing = await db.gameevents.get(params.eventId);
    if (!existing) {
      throw new Error(`Game event not found for ID: ${params.eventId}`);
    }

    if (existing.isSynced === 1) {
      throw new Error("Cannot edit a synchronized event.");
    }

    updatedEvent = {
      ...existing,
      matchLineupId: params.matchLineupId,
      eventDefinitionId: params.eventDefinitionId,
      isLeadToGoal: params.isLeadToGoal,
    };

    await db.gameevents.put(updatedEvent);

    // Update pending payload inside syncQueue
    const queueItems = await db.syncQueue
      .filter((item) => item.endpoint.includes("/events"))
      .toArray();

    for (const item of queueItems) {
      try {
        const parsed = JSON.parse(item.payload);
        if (Array.isArray(parsed)) {
          const targetIndex = parsed.findIndex(
            (e: { id: string }) => e.id === params.eventId,
          );
          if (targetIndex !== -1) {
            parsed[targetIndex] = {
              ...parsed[targetIndex],
              matchLineupId: params.matchLineupId,
              eventDefinitionId: params.eventDefinitionId,
              isLeadToGoal: params.isLeadToGoal,
            };
            await db.syncQueue.update(item.id!, {
              payload: JSON.stringify(parsed),
            });
            break;
          }
        }
      } catch {
        // Ignore unparseable non-matching payloads
      }
    }
  });

  return updatedEvent!;
};

/**
 * Atomically removes an unsynchronized GameEvent entity from IndexedDB and syncQueue.
 * Throws an error if the event is already synchronized (isSynced === 1).
 */
export const deleteGameEventTx = async (eventId: string): Promise<void> => {
  await db.transaction("rw", [db.gameevents, db.syncQueue], async () => {
    const existing = await db.gameevents.get(eventId);
    if (!existing) {
      throw new Error(`Game event not found for ID: ${eventId}`);
    }

    if (existing.isSynced === 1) {
      throw new Error("Cannot delete a synchronized event.");
    }

    await db.gameevents.delete(eventId);

    // Remove or adjust item inside syncQueue
    const queueItems = await db.syncQueue
      .filter((item) => item.endpoint.includes("/events"))
      .toArray();

    for (const item of queueItems) {
      try {
        const parsed = JSON.parse(item.payload);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter(
            (e: { id: string }) => e.id !== eventId,
          );
          if (filtered.length === 0) {
            await db.syncQueue.delete(item.id!);
          } else if (filtered.length !== parsed.length) {
            await db.syncQueue.update(item.id!, {
              payload: JSON.stringify(filtered),
            });
          }
        }
      } catch {
        // Ignore unparseable non-matching payloads
      }
    }
  });
};
