import Dexie from "dexie";
import {
  db,
  type GameEvent,
  type EventDefinitionLookup,
  type UserEventPresetLookup,
  type SyncQueueItem,
} from "./ttaDatabase";

let eventDefinitionsCache: Map<string, EventDefinitionLookup> | null = null;
let cachedSportId: string | undefined = undefined;
let cachedUserId: string | undefined = undefined;

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

/**
 * Verifies if user event presets exist in IndexedDB for the given sportId and userId.
 */
export const isSportHydratedForUser = async (
  sportId: string,
  userId?: string,
): Promise<boolean> => {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId || !sportId) return false;

  if (hydratedUserIdBySport.get(sportId) === normalizedUserId) {
    return true;
  }

  if (db?.usereventpresets) {
    try {
      const presetsCount = await db.usereventpresets
        .where({ userId: normalizedUserId, sportId })
        .count();

      if (presetsCount > 0) {
        hydratedUserIdBySport.set(sportId, normalizedUserId);
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
};

export type DefinitionInput = EventDefinitionLookup & {
  sortOrder?: number;
  isEnabled?: boolean;
};

/**
 * Atomically upserts definitions into the global dictionary and replaces user-specific presets.
 * Global definition records are preserved to prevent historical game events lookup failures.
 */
export const replaceSportEventDefinitionsInDb = async (
  sportId: string,
  definitions: DefinitionInput[],
  userId?: string,
): Promise<void> => {
  if (!db.eventdefinitions || !db.usereventpresets || !sportId) return;

  const normalizedUserId = userId?.trim();

  const eventDefsToSave: EventDefinitionLookup[] = definitions.map((def) => ({
    id: def.id,
    sportId: def.sportId || sportId,
    name: def.name,
    shortName: def.shortName,
    isPositive: def.isPositive,
    isCustom: def.isCustom,
    ownerId: def.ownerId || normalizedUserId || null,
  }));

  await db.transaction(
    "rw",
    [db.eventdefinitions, db.usereventpresets],
    async () => {
      await db.eventdefinitions.bulkPut(eventDefsToSave);

      if (normalizedUserId) {
        const existingPresets = await db.usereventpresets
          .where({ userId: normalizedUserId, sportId })
          .toArray();

        const incomingDefIds = new Set(definitions.map((d) => d.id));
        const presetsToDelete = existingPresets.filter(
          (p) => !incomingDefIds.has(p.eventDefinitionId),
        );

        for (const p of presetsToDelete) {
          await db.usereventpresets.delete([p.userId, p.eventDefinitionId]);
        }

        const presetsToSave: UserEventPresetLookup[] = definitions.map(
          (def, index) => ({
            userId: normalizedUserId,
            eventDefinitionId: def.id,
            sportId,
            sortOrder:
              typeof def.sortOrder === "number" ? def.sortOrder : index,
            isEnabled: def.isEnabled !== false,
          }),
        );

        await db.usereventpresets.bulkPut(presetsToSave);
      }

      const currentTx = Dexie.currentTransaction;
      if (currentTx && typeof currentTx.on === "function") {
        currentTx.on("complete", () => {
          if (normalizedUserId) {
            hydratedUserIdBySport.set(sportId, normalizedUserId);
          }
          clearEventDefinitionsCache();
        });
      } else {
        if (normalizedUserId) {
          hydratedUserIdBySport.set(sportId, normalizedUserId);
        }
        clearEventDefinitionsCache();
      }
    },
  );
};

/**
 * Loads user-enabled event definitions ordered by preset sort order for the active console panel.
 */
export const loadEventDefinitionsCache = async (
  sportId?: string,
  userId?: string,
): Promise<Map<string, EventDefinitionLookup>> => {
  const normalizedUserId = userId?.trim();
  if (sportId && normalizedUserId) {
    const isHydrated = await isSportHydratedForUser(sportId, normalizedUserId);
    if (!isHydrated) {
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

  let activeDefinitions: EventDefinitionLookup[];

  if (sportId && normalizedUserId && db.usereventpresets) {
    const userPresets = await db.usereventpresets
      .where({ userId: normalizedUserId, sportId })
      .toArray();

    const enabledPresets = userPresets
      .filter((p) => p.isEnabled)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const defIds = enabledPresets.map((p) => p.eventDefinitionId);
    const defs = await db.eventdefinitions.bulkGet(defIds);
    activeDefinitions = defs.filter(
      (d): d is EventDefinitionLookup => d !== undefined,
    );
  } else {
    const rawDefs =
      sportId && typeof db.eventdefinitions?.where === "function"
        ? await db.eventdefinitions.where("sportId").equals(sportId).toArray()
        : await db.eventdefinitions.toArray();
    activeDefinitions = rawDefs;
  }

  const map = new Map<string, EventDefinitionLookup>();
  activeDefinitions.forEach((def) => {
    map.set(def.name.toLowerCase(), def);
  });

  eventDefinitionsCache = map;
  cachedSportId = sportId;
  cachedUserId = userId;
  return map;
};

export const clearEventDefinitionsCache = () => {
  eventDefinitionsCache = null;
  cachedSportId = undefined;
  cachedUserId = undefined;
};

export const saveEventDefinitionsToDb = async (
  definitions: DefinitionInput[],
  sportId?: string,
  userId?: string,
): Promise<void> => {
  if (!db.eventdefinitions) return;

  if (sportId) {
    await replaceSportEventDefinitionsInDb(sportId, definitions, userId);
    return;
  }

  if (definitions.length === 0) return;

  const bySport = new Map<string, DefinitionInput[]>();
  for (const def of definitions) {
    if (!def.sportId) continue;
    const list = bySport.get(def.sportId) ?? [];
    list.push(def);
    bySport.set(def.sportId, list);
  }

  for (const [sId, defs] of bySport.entries()) {
    await replaceSportEventDefinitionsInDb(sId, defs, userId);
  }
};

/**
 * Resolves an event definition directly from the persistent global dictionary.
 * Guaranteed to resolve historical action names even if excluded from user presets.
 */
export const getEventDefinitionByName = async (
  actionName: string,
  sportId?: string,
  userId?: string,
): Promise<EventDefinitionLookup | undefined> => {
  const normalizedName = actionName.trim().toLowerCase();
  const cache = await loadEventDefinitionsCache(sportId, userId);
  const cachedDef = cache.get(normalizedName);
  if (cachedDef) return cachedDef;

  const candidates = sportId
    ? await db.eventdefinitions.where("sportId").equals(sportId).toArray()
    : await db.eventdefinitions.toArray();

  return candidates.find(
    (def) => def.name.trim().toLowerCase() === normalizedName,
  );
};

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
  expectedSportId?: string;
  isLeadToGoal: boolean;
  userId?: string;
}

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

const validateLineupAndMatchOwnership = async (
  existingLineupId: string,
  params: UpdateGameEventParams,
): Promise<string | undefined> => {
  const targetLineup = await db.matchlineups.get(params.matchLineupId);
  if (!targetLineup) {
    throw new Error(`Target lineup record not found: ${params.matchLineupId}`);
  }

  const existingLineup = await db.matchlineups.get(existingLineupId);
  if (!existingLineup) {
    throw new Error(`Existing lineup record not found: ${existingLineupId}`);
  }

  if (targetLineup.matchId?.trim() !== existingLineup.matchId?.trim()) {
    throw new Error(
      `Lineup ${params.matchLineupId} does not belong to event match: ${
        existingLineup.matchId
      }`,
    );
  }

  return targetLineup.matchId || existingLineup.matchId;
};

const validateMatchUserOwnership = async (
  matchId: string | undefined,
  eventId: string,
  userId?: string,
): Promise<void> => {
  if (!matchId) return;

  const normalizedUserId = userId?.trim();
  if (!normalizedUserId) return;

  const match = await db.matches.get(matchId);
  if (match?.userId && match.userId !== normalizedUserId) {
    throw new Error(`Event ${eventId} belongs to another user.`);
  }
};

const validateEventDefinitionContext = async (
  existingDefId: string,
  params: UpdateGameEventParams,
): Promise<void> => {
  if (!params.eventDefinitionId) return;

  const isNewDefinition = params.eventDefinitionId !== existingDefId;
  if (!isNewDefinition && !params.expectedSportId) return;

  const eventDef = await db.eventdefinitions.get(params.eventDefinitionId);

  if (!eventDef && isNewDefinition) {
    throw new Error(
      `Event definition record not found for ID: ${params.eventDefinitionId}`,
    );
  }

  if (
    eventDef &&
    params.expectedSportId &&
    eventDef.sportId !== params.expectedSportId
  ) {
    throw new Error(
      `Event definition ${params.eventDefinitionId} does not belong to sport: ${
        params.expectedSportId
      }`,
    );
  }
};

const validateEventUpdateContext = async (
  existing: GameEvent,
  params: UpdateGameEventParams,
): Promise<void> => {
  const matchId = await validateLineupAndMatchOwnership(
    existing.matchLineupId,
    params,
  );

  await validateMatchUserOwnership(matchId, params.eventId, params.userId);

  await validateEventDefinitionContext(existing.eventDefinitionId, params);
};

const updateSyncQueueForEvent = async (
  params: UpdateGameEventParams,
): Promise<void> => {
  const queueItems = await db.syncQueue
    .filter((item) => item.endpoint.includes("/events"))
    .toArray();

  for (const item of queueItems) {
    if (await processQueueItemUpdate(item, params)) {
      return;
    }
  }

  throw new Error(
    `Matching sync queue payload not found for event ID: ${params.eventId}`,
  );
};

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
        endpoint: `/Matches/${normalizedMatchId}/teams/${
          normalizedTeamId
        }/events`,
        payload,
        createdAt: params.eventTimestamp,
      };

      await db.syncQueue.add(syncItem);
    },
  );

  return createdEvent!;
};

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

      await validateEventUpdateContext(existing, params);

      updatedEvent = {
        ...existing,
        matchLineupId: params.matchLineupId,
        eventDefinitionId: params.eventDefinitionId,
        isLeadToGoal: params.isLeadToGoal,
      };

      await db.gameevents.put(updatedEvent);

      await updateSyncQueueForEvent(params);
    },
  );

  return updatedEvent!;
};

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
