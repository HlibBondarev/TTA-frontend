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
  matchId?: string;
  teamId?: string;
  matchLineupId: string;
  eventDefinitionId: string;
  periodNumber: number;
  eventTimestamp: string;
  isLeadToGoal: boolean;
}

/**
 * Atomically persists a new GameEvent entity to IndexedDB and enqueues the team-scoped sync payload.
 */
export const createGameEventTx = async (
  params: CreateGameEventParams,
): Promise<GameEvent> => {
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

      const matchId = params.matchId || "unknown-match";
      const teamId = params.teamId || "unknown-team";

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
        endpoint: `/Matches/${matchId}/teams/${teamId}/events`,
        payload,
        createdAt: params.eventTimestamp,
      };

      await db.syncQueue.add(syncItem);
    },
  );

  return createdEvent!;
};
