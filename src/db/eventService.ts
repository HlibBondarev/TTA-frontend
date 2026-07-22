import { db, type GameEvent, type EventDefinitionLookup } from "./ttaDatabase";

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

export interface CreateGameEventParams {
  matchlineupid: string;
  eventdefinitionid: string;
  periodnumber: number;
  eventtimestamp: string;
  isleadtogoal: boolean;
}

/**
 * Atomically persists a new GameEvent entity to IndexedDB with serial sequence reservation.
 */
export const createGameEventTx = async (
  params: CreateGameEventParams,
): Promise<GameEvent> => {
  let createdEvent: GameEvent | null = null;

  await db.transaction(
    "rw",
    [db.gameevents, db.timeanchors, db.playerpresences],
    async () => {
      const lastEvent = await db.gameevents.orderBy("sequenceNumber").last();
      const lastAnchor = await db.timeanchors.orderBy("sequenceNumber").last();
      const lastPresence = await db.playerpresences
        .orderBy("sequenceNumber")
        .last();

      const maxSeq = Math.max(
        lastEvent?.sequenceNumber ?? 0,
        lastAnchor?.sequenceNumber ?? 0,
        lastPresence?.sequenceNumber ?? 0,
      );

      createdEvent = {
        id: crypto.randomUUID(),
        matchlineupid: params.matchlineupid,
        eventdefinitionid: params.eventdefinitionid,
        periodnumber: params.periodnumber,
        eventtimestamp: params.eventtimestamp,
        isleadtogoal: params.isleadtogoal,
        createdat: new Date().toISOString(),
        sequenceNumber: maxSeq + 1,
        isSynced: 0,
      };

      await db.gameevents.add(createdEvent);
    },
  );

  return createdEvent!;
};
