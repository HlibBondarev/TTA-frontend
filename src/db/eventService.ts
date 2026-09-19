import {
  db,
  type GameEvent,
  type EventDefinitionLookup,
  type SyncQueueItem,
} from "./ttaDatabase";

// In-memory cache for event definitions to avoid repeated IndexedDB reads during rapid recording
let eventDefinitionsCache: Map<string, EventDefinitionLookup> | null = null;
let cachedSportId: string | undefined = undefined;
let cachedUserId: string | undefined = undefined;

// In-memory map tracking which userId last hydrated event definitions for each sportId
const hydratedUserIdBySport = new Map<string, string>();

export const setHydratedUserIdForSport = (sportId: string, userId?: string) => {
  if (sportId && userId?.trim()) {
    hydratedUserIdBySport.set(sportId, userId.trim());
  }
};

export const getHydratedUserIdForSport = (
  sportId: string,
): string | undefined => {
  return hydratedUserIdBySport.get(sportId);
};

export const isSportHydratedForUser = (
  sportId: string,
  userId?: string,
): boolean => {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId) return false;
  return hydratedUserIdBySport.get(sportId) === normalizedUserId;
};

/**
 * Loads event definitions from IndexedDB into memory map for fast lookup by name, filtered by sportId and userId if provided.
 */
export const loadEventDefinitionsCache = async (
  sportId?: string,
  userId?: string,
): Promise<Map<string, EventDefinitionLookup>> => {
  const normalizedUserId = userId?.trim();
  if (sportId && normalizedUserId) {
    const hydratedUser = hydratedUserIdBySport.get(sportId);
    if (hydratedUser !== normalizedUserId) {
      return new Map();
    }
  }

  if (
    eventDefinitionsCache &&
    eventDefinitionsCache.size > 0 &&
    cachedSportId === sportId &&
    cachedUserId === userId
  ) {
    return eventDefinitionsCache;
  }

  const definitions =
    sportId && typeof db.eventdefinitions?.where === "function"
      ? await db.eventdefinitions.where("sportId").equals(sportId).toArray()
      : await db.eventdefinitions.toArray();

  const map = new Map<string, EventDefinitionLookup>();

  definitions
    .filter((def) => def.isEnabled !== false)
    .forEach((def) => {
      map.set(def.name.toLowerCase(), def);
    });

  eventDefinitionsCache = map;
  cachedSportId = sportId;
  cachedUserId = userId;
  return map;
};

/**
 * Clears the in-memory cache (useful for test resets, account switches, or dynamic configuration changes).
 */
export const clearEventDefinitionsCache = () => {
  eventDefinitionsCache = null;
  cachedSportId = undefined;
  cachedUserId = undefined;
};

/**
 * Persists event definition records to IndexedDB for a sport, replacing obsolete definitions with the hydrated snapshot.
 */
export const saveEventDefinitionsToDb = async (
  definitions: EventDefinitionLookup[],
  sportId?: string,
  userId?: string,
): Promise<void> => {
  if (!db.eventdefinitions) return;

  if (sportId) {
    await replaceSportEventDefinitionsInDb(sportId, definitions, userId);
    return;
  }

  if (definitions.length === 0) return;

  const bySport = new Map<string, EventDefinitionLookup[]>();
  for (const def of definitions) {
    if (!def.sportId) continue;
    const list = bySport.get(def.sportId) ?? [];
    list.push(def);
    bySport.set(def.sportId, list);
  }

  if (bySport.size === 0) {
    if (typeof db.eventdefinitions.bulkPut === "function") {
      await db.eventdefinitions.bulkPut(definitions);
    }
    clearEventDefinitionsCache();
    return;
  }

  for (const [sId, defs] of bySport.entries()) {
    await replaceSportEventDefinitionsInDb(sId, defs, userId);
  }
};

/**
 * Resolves event definition ID by name (case-insensitive) and optional sportId/userId.
 */
export const getEventDefinitionByName = async (
  actionName: string,
  sportId?: string,
  userId?: string,
): Promise<EventDefinitionLookup | undefined> => {
  const cache = await loadEventDefinitionsCache(sportId, userId);
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
  userId?: string;
}

/**
 * Helper to update a matching event payload inside a syncQueue item.
 */
const processQueueItemUpdate = async (
  item: SyncQueueItem,
  params: UpdateGameEventParams,
): Promise<boolean> => {
  try {
    const parsed = JSON.parse(item.payload);
    if (!Array.isArray(parsed)) return false;

    const targetIndex = parsed.findIndex(
      (e: { id: string }) => e.id === params.eventId,
    );
    if (targetIndex === -1) return false;

    parsed[targetIndex] = {
      ...parsed[targetIndex],
      matchLineupId: params.matchLineupId,
      eventDefinitionId: params.eventDefinitionId,
      isLeadToGoal: params.isLeadToGoal,
    };

    await db.syncQueue.update(item.id!, {
      payload: JSON.stringify(parsed),
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * Helper to remove a matching event payload inside a syncQueue item.
 */
const processQueueItemDelete = async (
  item: SyncQueueItem,
  eventId: string,
): Promise<boolean> => {
  try {
    const parsed = JSON.parse(item.payload);
    if (!Array.isArray(parsed)) return false;

    const filtered = parsed.filter((e: { id: string }) => e.id !== eventId);
    if (filtered.length === parsed.length) return false;

    if (filtered.length === 0) {
      await db.syncQueue.delete(item.id!);
    } else {
      await db.syncQueue.update(item.id!, {
        payload: JSON.stringify(filtered),
      });
    }
    return true;
  } catch {
    return false;
  }
};

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
 * Validates lineup, match, user ownership, and definition existence inside the transaction.
 * Throws an error if the event is already synchronized (isSynced === 1) or matching syncQueue item is missing.
 */
export const updateGameEventTx = async (
  params: UpdateGameEventParams,
): Promise<GameEvent> => {
  let updatedEvent: GameEvent | null = null;

  await db.transaction(
    "rw",
    [
      db.gameevents,
      db.matchlineups,
      db.matches,
      db.eventdefinitions,
      db.syncQueue,
    ],
    async () => {
      const existing = await db.gameevents.get(params.eventId);
      if (!existing) {
        throw new Error(`Game event not found for ID: ${params.eventId}`);
      }

      if (existing.isSynced === 1) {
        throw new Error("Cannot edit a synchronized event.");
      }

      // 1. Validate lineup & user ownership if matchlineups table is accessible
      if (typeof db.matchlineups?.get === "function") {
        const targetLineup = await db.matchlineups.get(params.matchLineupId);
        const existingLineup = await db.matchlineups.get(
          existing.matchLineupId,
        );

        if (
          targetLineup &&
          existingLineup &&
          targetLineup.matchId?.trim() !== existingLineup.matchId?.trim()
        ) {
          throw new Error(
            `Lineup ${params.matchLineupId} does not belong to event match: ${existingLineup.matchId}`,
          );
        }

        const targetMatchId = targetLineup?.matchId || existingLineup?.matchId;
        if (targetMatchId && typeof db.matches?.get === "function") {
          const match = await db.matches.get(targetMatchId);
          const normalizedUserId = params.userId?.trim();
          if (
            normalizedUserId &&
            match?.userId &&
            match.userId !== normalizedUserId
          ) {
            throw new Error(`Event ${params.eventId} belongs to another user.`);
          }
        }
      }

      // 2. Validate event definition exists if definition table is accessible
      if (
        params.eventDefinitionId &&
        typeof db.eventdefinitions?.get === "function"
      ) {
        const eventDef = await db.eventdefinitions.get(
          params.eventDefinitionId,
        );
        if (!eventDef) {
          throw new Error(
            `Event definition not found: ${params.eventDefinitionId}`,
          );
        }
      }

      updatedEvent = {
        ...existing,
        matchLineupId: params.matchLineupId,
        eventDefinitionId: params.eventDefinitionId,
        isLeadToGoal: params.isLeadToGoal,
      };

      await db.gameevents.put(updatedEvent);

      const queueItems = await db.syncQueue
        .filter((item) => item.endpoint.includes("/events"))
        .toArray();

      let payloadUpdated = false;
      for (const item of queueItems) {
        if (await processQueueItemUpdate(item, params)) {
          payloadUpdated = true;
          break;
        }
      }

      if (!payloadUpdated) {
        throw new Error(
          `Matching sync queue payload not found for event ID: ${params.eventId}`,
        );
      }
    },
  );

  return updatedEvent!;
};

/**
 * Atomically removes an unsynchronized GameEvent entity from IndexedDB and syncQueue.
 * Throws an error if the event is already synchronized (isSynced === 1) or matching syncQueue item is missing.
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

    const queueItems = await db.syncQueue
      .filter((item) => item.endpoint.includes("/events"))
      .toArray();

    let payloadRemoved = false;
    for (const item of queueItems) {
      if (await processQueueItemDelete(item, eventId)) {
        payloadRemoved = true;
        break;
      }
    }

    if (!payloadRemoved) {
      throw new Error(
        `Matching sync queue payload not found for event ID: ${eventId}`,
      );
    }
  });
};

/**
 * Atomically replaces event definitions for a specific sportId in IndexedDB:
 * removes existing records for sportId whose IDs are absent from incoming items,
 * performs bulkPut for updated records, and clears the in-memory cache.
 */
export const replaceSportEventDefinitionsInDb = async (
  sportId: string,
  definitions: EventDefinitionLookup[],
  userId?: string,
): Promise<void> => {
  if (!db.eventdefinitions || !sportId) return;

  const incomingIds = new Set(definitions.map((def) => def.id));

  await db.transaction("rw", [db.eventdefinitions], async () => {
    let existingForSport: EventDefinitionLookup[] = [];

    if (typeof db.eventdefinitions.where === "function") {
      existingForSport = await db.eventdefinitions
        .where("sportId")
        .equals(sportId)
        .toArray();
    } else if (typeof db.eventdefinitions.toArray === "function") {
      const all = await db.eventdefinitions.toArray();
      existingForSport = (all || []).filter((def) => def.sportId === sportId);
    }

    const idsToDelete = existingForSport
      .filter((def) => !incomingIds.has(def.id))
      .map((def) => def.id);

    if (
      idsToDelete.length > 0 &&
      typeof db.eventdefinitions.bulkDelete === "function"
    ) {
      await db.eventdefinitions.bulkDelete(idsToDelete);
    }

    if (
      definitions.length > 0 &&
      typeof db.eventdefinitions.bulkPut === "function"
    ) {
      await db.eventdefinitions.bulkPut(definitions);
    }
  });

  if (userId?.trim()) {
    hydratedUserIdBySport.set(sportId, userId.trim());
  }

  clearEventDefinitionsCache();
};
