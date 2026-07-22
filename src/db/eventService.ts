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
  sequenceNumber: number;
}

/**
 * Atomically persists a new GameEvent entity to IndexedDB.
 */
export const createGameEventTx = async (
  params: CreateGameEventParams,
): Promise<GameEvent> => {
  const newEvent: GameEvent = {
    id: crypto.randomUUID(),
    matchlineupid: params.matchlineupid,
    eventdefinitionid: params.eventdefinitionid,
    periodnumber: params.periodnumber,
    eventtimestamp: params.eventtimestamp,
    isleadtogoal: params.isleadtogoal,
    createdat: new Date().toISOString(),
    sequenceNumber: params.sequenceNumber,
    isSynced: 0,
  };

  await db.transaction("rw", [db.gameevents], async () => {
    await db.gameevents.add(newEvent);
  });

  return newEvent;
};
