import Dexie from "dexie";
import {
  db,
  type GameEvent,
  type PlayerPresence,
  type EventDefinitionLookup,
  type SportConfigurationLookup,
  type UserEventPresetLookup,
  type SyncQueueItem,
} from "./ttaDatabase";
import { matchLockService } from "../services/matchLockService";
import {
  areTimestampsEqual,
  findLatestClosedPresenceForPlayerInTx,
  findLatestClosedPresenceInPeriodInTx,
  resolveEffectiveTimeOut,
  revertSinglePlayerAutoExitInTx,
  terminateSinglePlayerPresenceInTx,
} from "./presenceService";
import {
  resolveEffectiveDisciplinaryRule,
  type EffectiveDisciplinaryRule,
} from "../features/playerpresences/utils/disciplinaryUtils";

const PERIOD_END_ANCHOR_TYPE = 1;

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
    isShot: def.isShot ?? false,
    score: def.score ?? 0,
    ...(def.foulImpact !== undefined ? { foulImpact: def.foulImpact } : {}),
    ...(def.penaltyDurationSeconds !== undefined
      ? { penaltyDurationSeconds: def.penaltyDurationSeconds }
      : {}),
    isCustom: def.isCustom,
    ownerId: def.ownerId ?? (def.isCustom ? (normalizedUserId ?? null) : null),
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

        await Promise.all(
          presetsToDelete.map((p) =>
            db.usereventpresets.delete([p.userId, p.eventDefinitionId]),
          ),
        );

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

  await Promise.all(
    Array.from(bySport.entries()).map(([sId, defs]) =>
      replaceSportEventDefinitionsInDb(sId, defs, userId),
    ),
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
  locationX?: number | null;
  locationY?: number | null;
  shotLocationX?: number | null;
  shotLocationY?: number | null;
}

export interface UpdateGameEventParams {
  eventId: string;
  matchLineupId: string;
  eventDefinitionId: string;
  expectedSportId?: string;
  isLeadToGoal: boolean;
  locationX?: number | null;
  locationY?: number | null;
  shotLocationX?: number | null;
  shotLocationY?: number | null;
  userId?: string;
}

interface PlayerEventsOverride {
  upsert?: GameEvent;
  removeEventId?: string;
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
      locationX: params.locationX ?? null,
      locationY: params.locationY ?? null,
      shotLocationX: params.shotLocationX ?? null,
      shotLocationY: params.shotLocationY ?? null,
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

const resolveCoordinateValue = (
  paramVal: number | null | undefined,
  existingVal: number | null | undefined,
): number | null => {
  if (paramVal !== undefined) {
    return paramVal;
  }
  return existingVal ?? null;
};

const resolveMatchConfigInTx = async (
  matchId: string | undefined,
): Promise<SportConfigurationLookup | undefined> => {
  const normalizedMatchId = matchId?.trim();
  if (
    !normalizedMatchId ||
    typeof db.matches?.get !== "function" ||
    typeof db.tournaments?.get !== "function" ||
    typeof db.sportconfigurations?.get !== "function"
  ) {
    return undefined;
  }

  const match = await db.matches.get(normalizedMatchId);
  if (!match?.tournamentId) return undefined;

  const tournament = await db.tournaments.get(match.tournamentId);
  if (!tournament?.configurationId) return undefined;

  return db.sportconfigurations.get(tournament.configurationId);
};

const fetchPlayerEventsInTx = async (
  matchLineupId: string,
  override?: PlayerEventsOverride,
): Promise<GameEvent[]> => {
  let rows: GameEvent[] = [];
  if (typeof db.gameevents?.where === "function") {
    const equalsChain = db.gameevents
      .where("matchLineupId")
      ?.equals?.(matchLineupId);
    if (typeof equalsChain?.toArray === "function") {
      rows = await equalsChain.toArray();
    }
  }

  if (!override) return rows;

  const byId = new Map<string, GameEvent>(rows.map((evt) => [evt.id, evt]));
  if (override.removeEventId) {
    byId.delete(override.removeEventId);
  }
  if (override.upsert) {
    if (override.upsert.matchLineupId === matchLineupId) {
      byId.set(override.upsert.id, override.upsert);
    } else {
      byId.delete(override.upsert.id);
    }
  }
  return Array.from(byId.values());
};

const buildDefinitionsMapForEventsInTx = async (
  events: readonly GameEvent[],
  knownDef?: EventDefinitionLookup,
): Promise<Map<string, EventDefinitionLookup>> => {
  const map = new Map<string, EventDefinitionLookup>();
  if (knownDef) {
    map.set(knownDef.id, knownDef);
  }
  if (typeof db.eventdefinitions?.get !== "function") return map;

  const missingDefIds = Array.from(
    new Set(
      events
        .filter(
          (e) => e.foulImpact === undefined && !map.has(e.eventDefinitionId),
        )
        .map((e) => e.eventDefinitionId),
    ),
  );

  const resolvedDefs = await Promise.all(
    missingDefIds.map((defId) => db.eventdefinitions.get(defId)),
  );
  for (const def of resolvedDefs) {
    if (def) {
      map.set(def.id, def);
    }
  }
  return map;
};

const isDirectDisqualificationImpact = (foulImpact: string): boolean =>
  foulImpact === "DisqualificationWithSub" ||
  foulImpact === "DisqualificationNoSub";

const hasPlayerReachedFoulLimitInTx = async (
  matchId: string | undefined,
  matchLineupId: string,
  targetDef?: EventDefinitionLookup,
  override?: PlayerEventsOverride,
): Promise<boolean> => {
  const config = await resolveMatchConfigInTx(matchId);
  const maxPersonalFouls = config?.maxPersonalFouls;
  if (
    typeof maxPersonalFouls !== "number" ||
    !Number.isFinite(maxPersonalFouls) ||
    maxPersonalFouls <= 0
  ) {
    return false;
  }

  const limit = Math.floor(maxPersonalFouls);
  const playerEvents = await fetchPlayerEventsInTx(matchLineupId, override);
  const defsById = await buildDefinitionsMapForEventsInTx(
    playerEvents,
    targetDef,
  );

  let personalFoulCount = 0;
  for (const evt of playerEvents) {
    const rule = resolveEffectiveDisciplinaryRule(evt, defsById);
    if (rule.foulImpact === "PersonalFoul") {
      personalFoulCount += 1;
    }
  }

  return personalFoulCount >= limit;
};

const evaluateDisciplinaryExitTriggerInTx = async (
  matchId: string | undefined,
  event: GameEvent,
  targetDef?: EventDefinitionLookup,
  override?: PlayerEventsOverride,
): Promise<{ shouldExit: boolean; isMatchWideDisqualification: boolean }> => {
  const defsMap = targetDef
    ? new Map<string, EventDefinitionLookup>([[targetDef.id, targetDef]])
    : undefined;
  const rule = resolveEffectiveDisciplinaryRule(event, defsMap);

  if (isDirectDisqualificationImpact(rule.foulImpact)) {
    return { shouldExit: true, isMatchWideDisqualification: true };
  }

  if (
    rule.foulImpact === "PersonalFoul" &&
    (await hasPlayerReachedFoulLimitInTx(
      matchId,
      event.matchLineupId,
      targetDef,
      override,
    ))
  ) {
    return { shouldExit: true, isMatchWideDisqualification: true };
  }

  const isTimedExclusion =
    rule.penaltyDurationSeconds !== null && rule.penaltyDurationSeconds > 0;
  if (isTimedExclusion) {
    return { shouldExit: true, isMatchWideDisqualification: false };
  }

  return { shouldExit: false, isMatchWideDisqualification: false };
};

const resolveEventDisciplinaryRuleInTx = async (
  event: GameEvent,
): Promise<EffectiveDisciplinaryRule> => {
  let defsMap: Map<string, EventDefinitionLookup> | undefined;
  if (
    event.foulImpact === undefined &&
    typeof db.eventdefinitions?.get === "function"
  ) {
    const def = await db.eventdefinitions.get(event.eventDefinitionId);
    if (def) {
      defsMap = new Map([[def.id, def]]);
    }
  }
  return resolveEffectiveDisciplinaryRule(event, defsMap);
};

const hasTimedExclusionDuration = (rule: EffectiveDisciplinaryRule): boolean =>
  rule.penaltyDurationSeconds !== null && rule.penaltyDurationSeconds > 0;

const hasDisciplinaryImpact = (rule: EffectiveDisciplinaryRule): boolean =>
  rule.foulImpact !== "None" || hasTimedExclusionDuration(rule);

const computePreChangePersonalFoulCount = (
  existing: GameEvent,
  existingRule: EffectiveDisciplinaryRule,
  override: PlayerEventsOverride,
  postChangePersonalFoulCount: number,
  defsById: ReadonlyMap<string, EventDefinitionLookup>,
): number => {
  if (existingRule.foulImpact !== "PersonalFoul") {
    return postChangePersonalFoulCount;
  }
  const upsertedForSamePlayer =
    override.upsert && override.upsert.matchLineupId === existing.matchLineupId
      ? override.upsert
      : undefined;
  if (upsertedForSamePlayer) {
    const nextRule = resolveEffectiveDisciplinaryRule(
      upsertedForSamePlayer,
      defsById,
    );
    if (nextRule.foulImpact === "PersonalFoul") {
      return postChangePersonalFoulCount;
    }
  }
  return postChangePersonalFoulCount + 1;
};

const wasEventDisqualifyingBeforeChange = (
  existing: GameEvent,
  existingRule: EffectiveDisciplinaryRule,
  override: PlayerEventsOverride,
  postChangePersonalFoulCount: number,
  defsById: ReadonlyMap<string, EventDefinitionLookup>,
  config: SportConfigurationLookup | undefined,
): boolean => {
  if (isDirectDisqualificationImpact(existingRule.foulImpact)) {
    return true;
  }
  const maxPersonalFouls = config?.maxPersonalFouls;
  const hasFoulLimit =
    typeof maxPersonalFouls === "number" &&
    Number.isFinite(maxPersonalFouls) &&
    maxPersonalFouls > 0;
  if (existingRule.foulImpact !== "PersonalFoul" || !hasFoulLimit) {
    return false;
  }
  const preCount = computePreChangePersonalFoulCount(
    existing,
    existingRule,
    override,
    postChangePersonalFoulCount,
    defsById,
  );
  return preCount >= Math.floor(maxPersonalFouls);
};

const isTimestampAtOrAfter = (
  candidate?: string | null,
  reference?: string | null,
): boolean => {
  if (!candidate || !reference) return true;
  const parsedCandidate = Date.parse(candidate);
  const parsedReference = Date.parse(reference);
  if (!Number.isNaN(parsedCandidate) && !Number.isNaN(parsedReference)) {
    return parsedCandidate >= parsedReference;
  }
  return candidate.localeCompare(reference) >= 0;
};

const hasConflictingTimedExclusionInPeriod = (
  playerEvents: readonly GameEvent[],
  defsById: ReadonlyMap<string, EventDefinitionLookup>,
  closedPresence: PlayerPresence,
): boolean =>
  playerEvents.some((evt) => {
    if (evt.periodNumber !== closedPresence.periodNumber) return false;
    const rule = resolveEffectiveDisciplinaryRule(evt, defsById);
    if (!hasTimedExclusionDuration(rule)) return false;
    if (isTimestampAtOrAfter(evt.eventTimestamp, closedPresence.timeIn)) {
      return true;
    }
    if (!closedPresence.timeOut) return false;
    const clampedExit = resolveEffectiveTimeOut(
      closedPresence.timeIn,
      evt.eventTimestamp,
    );
    return areTimestampsEqual(clampedExit, closedPresence.timeOut);
  });

const matchesDisqualificationExitCause = (
  closedPresence: PlayerPresence,
  existing: GameEvent,
  existingRule: EffectiveDisciplinaryRule,
  playerEvents: readonly GameEvent[],
  defsById: ReadonlyMap<string, EventDefinitionLookup>,
): boolean => {
  const closedTimeOut = closedPresence.timeOut;
  if (!closedTimeOut) return false;

  if (isDirectDisqualificationImpact(existingRule.foulImpact)) {
    const expectedTimeOut = resolveEffectiveTimeOut(
      closedPresence.timeIn,
      existing.eventTimestamp,
    );
    return areTimestampsEqual(closedTimeOut, expectedTimeOut);
  }

  if (existingRule.foulImpact !== "PersonalFoul") {
    return false;
  }

  const candidateFouls: GameEvent[] = [
    existing,
    ...playerEvents.filter((evt) => {
      const rule = resolveEffectiveDisciplinaryRule(evt, defsById);
      return rule.foulImpact === "PersonalFoul";
    }),
  ];

  return candidateFouls.some((foul) => {
    const expectedTimeOut = resolveEffectiveTimeOut(
      closedPresence.timeIn,
      foul.eventTimestamp,
    );
    return areTimestampsEqual(closedTimeOut, expectedTimeOut);
  });
};

const evaluatePlayerPostChangeStatusInTx = async (
  matchId: string,
  matchLineupId: string,
  override: PlayerEventsOverride,
): Promise<{
  isStillDisqualified: boolean;
  personalFoulCount: number;
  playerEvents: GameEvent[];
  defsById: Map<string, EventDefinitionLookup>;
  config: SportConfigurationLookup | undefined;
}> => {
  const playerEvents = await fetchPlayerEventsInTx(matchLineupId, override);
  const config = await resolveMatchConfigInTx(matchId);
  if (playerEvents.length === 0) {
    return {
      isStillDisqualified: false,
      personalFoulCount: 0,
      playerEvents,
      defsById: new Map(),
      config,
    };
  }

  const defsById = await buildDefinitionsMapForEventsInTx(playerEvents);
  const maxPersonalFouls = config?.maxPersonalFouls;
  const hasLimit =
    typeof maxPersonalFouls === "number" &&
    Number.isFinite(maxPersonalFouls) &&
    maxPersonalFouls > 0;
  const limit = hasLimit
    ? Math.floor(maxPersonalFouls)
    : Number.POSITIVE_INFINITY;

  let personalFoulCount = 0;
  let isStillDisqualified = false;
  for (const evt of playerEvents) {
    const rule = resolveEffectiveDisciplinaryRule(evt, defsById);
    if (isDirectDisqualificationImpact(rule.foulImpact)) {
      isStillDisqualified = true;
      break;
    }
    if (rule.foulImpact === "PersonalFoul") {
      personalFoulCount += 1;
    }
  }

  if (!isStillDisqualified && personalFoulCount >= limit) {
    isStillDisqualified = true;
  }

  return {
    isStillDisqualified,
    personalFoulCount,
    playerEvents,
    defsById,
    config,
  };
};

const isPeriodEndedInTx = async (
  matchId: string,
  periodNumber: number,
): Promise<boolean> => {
  if (typeof db.timeanchors?.where !== "function") return false;
  const byMatch = db.timeanchors.where("matchId")?.equals?.(matchId);
  const filtered =
    typeof byMatch?.filter === "function"
      ? byMatch.filter(
          (a) =>
            a.periodNumber === periodNumber &&
            a.type === PERIOD_END_ANCHOR_TYPE,
        )
      : undefined;
  if (typeof filtered?.first !== "function") return false;
  const endAnchor = await filtered.first();
  return Boolean(endAnchor);
};

const resolveMatchLineupIdsInTx = async (
  matchId: string,
): Promise<Set<string> | undefined> => {
  if (typeof db.matchlineups?.where !== "function") {
    return undefined;
  }
  const equalsChain = db.matchlineups.where("matchId")?.equals?.(matchId);
  if (typeof equalsChain?.toArray !== "function") {
    return undefined;
  }
  const lineups = await equalsChain.toArray();
  if (!Array.isArray(lineups) || lineups.length === 0) {
    return undefined;
  }
  return new Set(lineups.map((l) => l.id));
};

const fetchMatchEventsInTx = async (
  matchLineupIds: ReadonlySet<string> | undefined,
  override?: PlayerEventsOverride,
): Promise<GameEvent[]> => {
  if (!matchLineupIds || matchLineupIds.size === 0) {
    return override?.upsert ? [override.upsert] : [];
  }

  const perLineupEvents = await Promise.all(
    Array.from(matchLineupIds).map((lineupId) =>
      fetchPlayerEventsInTx(lineupId, override),
    ),
  );
  return perLineupEvents.flat();
};

const countPermanentNoSubPlayersInTx = async (
  matchId: string,
  override?: PlayerEventsOverride,
): Promise<number> => {
  const matchLineupIds = await resolveMatchLineupIdsInTx(matchId);
  const matchEvents = await fetchMatchEventsInTx(matchLineupIds, override);
  if (matchEvents.length === 0) {
    return 0;
  }

  const defsById = await buildDefinitionsMapForEventsInTx(matchEvents);
  const permanentNoSubIds = new Set<string>();
  for (const evt of matchEvents) {
    const rule = resolveEffectiveDisciplinaryRule(evt, defsById);
    const isPermanentNoSub =
      rule.foulImpact === "DisqualificationNoSub" &&
      (rule.penaltyDurationSeconds === null ||
        rule.penaltyDurationSeconds <= 0);
    if (isPermanentNoSub) {
      permanentNoSubIds.add(evt.matchLineupId);
    }
  }
  return permanentNoSubIds.size;
};

const countOpenPresencesInPeriodInTx = async (
  matchId: string,
  periodNumber: number,
): Promise<number> => {
  if (typeof db.playerpresences?.where !== "function") {
    return 0;
  }

  const matchLineupIds = await resolveMatchLineupIdsInTx(matchId);
  const byPeriod = db.playerpresences
    .where("periodNumber")
    ?.equals?.(periodNumber);
  const filtered =
    typeof byPeriod?.filter === "function"
      ? byPeriod.filter(
          (p) =>
            p.timeOut === null &&
            (!matchLineupIds || matchLineupIds.has(p.matchLineupId)),
        )
      : undefined;
  if (typeof filtered?.toArray !== "function") {
    return 0;
  }

  const openRows = await filtered.toArray();
  return Array.isArray(openRows) ? openRows.length : 0;
};

const hasCapacityToReopenInTx = async (
  matchId: string,
  periodNumber: number,
  override?: PlayerEventsOverride,
  preResolvedConfig?: SportConfigurationLookup,
): Promise<boolean> => {
  const config = preResolvedConfig ?? (await resolveMatchConfigInTx(matchId));
  const limit = config?.activePlayersLimit;
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return true;
  }
  const permanentNoSubCount = await countPermanentNoSubPlayersInTx(
    matchId,
    override,
  );
  const effectiveCap = Math.max(0, Math.floor(limit) - permanentNoSubCount);
  const openCount = await countOpenPresencesInPeriodInTx(matchId, periodNumber);
  return openCount < effectiveCap;
};

const tryRevertExactTimestampExitInTx = async (
  matchId: string,
  existing: GameEvent,
  override: PlayerEventsOverride,
  playerEvents: readonly GameEvent[],
  defsById: ReadonlyMap<string, EventDefinitionLookup>,
  config: SportConfigurationLookup | undefined,
  existingPeriodEnded: boolean,
): Promise<boolean> => {
  if (existingPeriodEnded) {
    return false;
  }
  const latestClosed = await findLatestClosedPresenceInPeriodInTx(
    existing.matchLineupId,
    existing.periodNumber,
  );
  if (!latestClosed) {
    return false;
  }
  if (
    hasConflictingTimedExclusionInPeriod(playerEvents, defsById, latestClosed)
  ) {
    return false;
  }
  if (
    !(await hasCapacityToReopenInTx(
      matchId,
      existing.periodNumber,
      override,
      config,
    ))
  ) {
    return false;
  }
  return revertSinglePlayerAutoExitInTx(
    matchId,
    existing.matchLineupId,
    existing.periodNumber,
    existing.eventTimestamp,
  );
};

const tryRevertCrossPeriodDisqualificationExitInTx = async (
  matchId: string,
  existing: GameEvent,
  existingRule: EffectiveDisciplinaryRule,
  override: PlayerEventsOverride,
  playerEvents: readonly GameEvent[],
  defsById: ReadonlyMap<string, EventDefinitionLookup>,
  config: SportConfigurationLookup | undefined,
  existingPeriodEnded: boolean,
): Promise<boolean> => {
  const latestClosed = await findLatestClosedPresenceForPlayerInTx(
    existing.matchLineupId,
  );
  if (!latestClosed) {
    return false;
  }

  const targetPeriodEnded =
    latestClosed.periodNumber === existing.periodNumber
      ? existingPeriodEnded
      : await isPeriodEndedInTx(matchId, latestClosed.periodNumber);
  if (targetPeriodEnded) {
    return false;
  }

  if (
    hasConflictingTimedExclusionInPeriod(playerEvents, defsById, latestClosed)
  ) {
    return false;
  }

  if (
    !matchesDisqualificationExitCause(
      latestClosed,
      existing,
      existingRule,
      playerEvents,
      defsById,
    )
  ) {
    return false;
  }

  if (
    !(await hasCapacityToReopenInTx(
      matchId,
      latestClosed.periodNumber,
      override,
      config,
    ))
  ) {
    return false;
  }

  return revertSinglePlayerAutoExitInTx(
    matchId,
    existing.matchLineupId,
    latestClosed.periodNumber,
  );
};

const revertPreviousAutoExitIfEligibleInTx = async (
  matchId: string | undefined,
  existing: GameEvent,
  override: PlayerEventsOverride,
  preResolvedRule?: EffectiveDisciplinaryRule,
): Promise<void> => {
  const normalizedMatchId = matchId?.trim();
  if (
    !normalizedMatchId ||
    !existing.matchLineupId ||
    typeof existing.periodNumber !== "number" ||
    !existing.eventTimestamp
  ) {
    return;
  }

  const {
    isStillDisqualified,
    personalFoulCount,
    playerEvents,
    defsById,
    config,
  } = await evaluatePlayerPostChangeStatusInTx(
    normalizedMatchId,
    existing.matchLineupId,
    override,
  );
  if (isStillDisqualified) {
    return;
  }

  const existingRule =
    preResolvedRule ?? (await resolveEventDisciplinaryRuleInTx(existing));
  const wasDisqualifying = wasEventDisqualifyingBeforeChange(
    existing,
    existingRule,
    override,
    personalFoulCount,
    defsById,
    config,
  );
  if (!hasTimedExclusionDuration(existingRule) && !wasDisqualifying) {
    return;
  }

  const existingPeriodEnded = await isPeriodEndedInTx(
    normalizedMatchId,
    existing.periodNumber,
  );

  const revertedExact = await tryRevertExactTimestampExitInTx(
    normalizedMatchId,
    existing,
    override,
    playerEvents,
    defsById,
    config,
    existingPeriodEnded,
  );
  if (revertedExact || !wasDisqualifying) {
    return;
  }

  await tryRevertCrossPeriodDisqualificationExitInTx(
    normalizedMatchId,
    existing,
    existingRule,
    override,
    playerEvents,
    defsById,
    config,
    existingPeriodEnded,
  );
};

const applyDisciplinaryAutoExitInTx = async (
  matchId: string | undefined,
  event: GameEvent,
  exitTimestamp: string,
  targetDef?: EventDefinitionLookup,
  override?: PlayerEventsOverride,
): Promise<boolean> => {
  const normalizedMatchId = matchId?.trim();
  if (!normalizedMatchId) return false;

  const { shouldExit, isMatchWideDisqualification } =
    await evaluateDisciplinaryExitTriggerInTx(
      normalizedMatchId,
      event,
      targetDef,
      override,
    );
  if (!shouldExit) return false;

  const closedInEventPeriod = await terminateSinglePlayerPresenceInTx(
    normalizedMatchId,
    event.matchLineupId,
    exitTimestamp,
    event.periodNumber,
  );
  if (closedInEventPeriod) {
    return true;
  }

  if (isMatchWideDisqualification) {
    return terminateSinglePlayerPresenceInTx(
      normalizedMatchId,
      event.matchLineupId,
      exitTimestamp,
    );
  }

  return false;
};

const syncDisciplinaryAutoExitOnUpdateInTx = async (
  matchId: string | undefined,
  existing: GameEvent,
  nextEvent: GameEvent,
  isNewDefinition: boolean,
  targetDef?: EventDefinitionLookup,
): Promise<void> => {
  const playerChanged = existing.matchLineupId !== nextEvent.matchLineupId;
  if (!playerChanged && !isNewDefinition) {
    return;
  }

  const override: PlayerEventsOverride = { upsert: nextEvent };
  const didCloseNextPresence = await applyDisciplinaryAutoExitInTx(
    matchId,
    nextEvent,
    nextEvent.eventTimestamp,
    targetDef,
    override,
  );

  const shouldCheckRevert =
    playerChanged || (isNewDefinition && !didCloseNextPresence);

  if (shouldCheckRevert) {
    await revertPreviousAutoExitIfEligibleInTx(matchId, existing, override);
  }
};

const buildAdditionalDisciplinaryTxTables = () => {
  const hasFullDisciplinaryTables = Boolean(
    db.matches && db.tournaments && db.sportconfigurations,
  );
  if (!hasFullDisciplinaryTables) {
    return [];
  }
  return [
    ...(db.matchlineups ? [db.matchlineups] : []),
    db.matches,
    db.tournaments,
    db.sportconfigurations,
  ];
};

export const createGameEventTx = async (
  params: CreateGameEventParams,
): Promise<GameEvent> => {
  const normalizedMatchId = params.matchId?.trim();
  if (!normalizedMatchId) {
    throw new Error("Missing or empty matchId for creating game event.");
  }

  if (matchLockService.isMatchLocked(normalizedMatchId)) {
    throw new Error(
      `Cannot create event: match ${
        normalizedMatchId
      } is locked for finalization.`,
    );
  }

  const normalizedTeamId = params.teamId?.trim();
  if (!normalizedTeamId) {
    throw new Error("Missing or empty teamId for creating game event.");
  }

  let createdEvent: GameEvent | null = null;

  const transactionTables = [
    db.gameevents,
    db.timeanchors,
    db.playerpresences,
    db.syncQueue,
    ...(db.eventdefinitions ? [db.eventdefinitions] : []),
    ...buildAdditionalDisciplinaryTxTables(),
  ];

  await db.transaction("rw", transactionTables, async () => {
    const nextSeq = await getNextSequenceNumber();
    const targetDef = await db.eventdefinitions?.get(params.eventDefinitionId);
    if (!targetDef) {
      throw new Error(
        `Event definition record not found for ID: ${params.eventDefinitionId}`,
      );
    }

    const nextCreatedEvent: GameEvent = {
      id: crypto.randomUUID(),
      matchLineupId: params.matchLineupId,
      eventDefinitionId: params.eventDefinitionId,
      periodNumber: params.periodNumber,
      eventTimestamp: params.eventTimestamp,
      isLeadToGoal: params.isLeadToGoal,
      locationX: params.locationX ?? null,
      locationY: params.locationY ?? null,
      shotLocationX: params.shotLocationX ?? null,
      shotLocationY: params.shotLocationY ?? null,
      foulImpact: targetDef.foulImpact ?? "None",
      penaltyDurationSeconds: targetDef.penaltyDurationSeconds ?? null,
      createdAt: new Date().toISOString(),
      sequenceNumber: nextSeq,
      isSynced: 0,
    };
    createdEvent = nextCreatedEvent;

    await db.gameevents.add(nextCreatedEvent);

    const payload = JSON.stringify([
      {
        id: nextCreatedEvent.id,
        matchLineupId: params.matchLineupId,
        eventDefinitionId: params.eventDefinitionId,
        periodNumber: params.periodNumber,
        isLeadToGoal: params.isLeadToGoal,
        eventTimestamp: params.eventTimestamp,
        locationX: nextCreatedEvent.locationX,
        locationY: nextCreatedEvent.locationY,
        shotLocationX: nextCreatedEvent.shotLocationX,
        shotLocationY: nextCreatedEvent.shotLocationY,
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

    await applyDisciplinaryAutoExitInTx(
      normalizedMatchId,
      nextCreatedEvent,
      params.eventTimestamp,
      targetDef,
      { upsert: nextCreatedEvent },
    );
  });

  return createdEvent!;
};

const stripDisciplinarySnapshot = (
  event: GameEvent,
): Omit<GameEvent, "foulImpact" | "penaltyDurationSeconds"> => {
  const copy = { ...event };
  delete copy.foulImpact;
  delete copy.penaltyDurationSeconds;
  return copy;
};

const resolveUpdatedEventSnapshot = (
  existing: GameEvent,
  isNewDefinition: boolean,
  targetDef: EventDefinitionLookup | undefined,
): Pick<GameEvent, "foulImpact" | "penaltyDurationSeconds"> => {
  if (!isNewDefinition) {
    return {
      ...(existing.foulImpact !== undefined
        ? { foulImpact: existing.foulImpact }
        : {}),
      ...(existing.penaltyDurationSeconds !== undefined
        ? { penaltyDurationSeconds: existing.penaltyDurationSeconds }
        : {}),
    };
  }
  return targetDef
    ? {
        foulImpact: targetDef.foulImpact ?? "None",
        penaltyDurationSeconds: targetDef.penaltyDurationSeconds ?? null,
      }
    : {};
};

export const updateGameEventTx = async (
  params: UpdateGameEventParams,
): Promise<GameEvent> => {
  let updatedEvent: GameEvent | null = null;

  const updateTransactionTables = [
    db.gameevents,
    db.matchlineups,
    db.matches,
    db.eventdefinitions,
    db.syncQueue,
    ...(db.timeanchors ? [db.timeanchors] : []),
    ...(db.playerpresences ? [db.playerpresences] : []),
    ...(db.tournaments ? [db.tournaments] : []),
    ...(db.sportconfigurations ? [db.sportconfigurations] : []),
  ];

  await db.transaction("rw", updateTransactionTables, async () => {
    const existing = await db.gameevents.get(params.eventId);
    if (!existing) {
      throw new Error(`Game event not found for ID: ${params.eventId}`);
    }

    if (existing.isSynced === 1) {
      throw new Error("Cannot edit a synchronized event.");
    }

    await validateEventUpdateContext(existing, params);

    const lineup = await db.matchlineups.get(existing.matchLineupId);
    const targetLineup =
      params.matchLineupId === existing.matchLineupId
        ? lineup
        : await db.matchlineups.get(params.matchLineupId);
    const resolvedMatchId = targetLineup?.matchId ?? lineup?.matchId;

    if (resolvedMatchId && matchLockService.isMatchLocked(resolvedMatchId)) {
      throw new Error(
        `Cannot update event: match ${
          resolvedMatchId
        } is locked for finalization.`,
      );
    }

    const isNewDefinition =
      params.eventDefinitionId !== existing.eventDefinitionId;
    let isShot = true;
    let targetDef: EventDefinitionLookup | undefined;
    if (isNewDefinition) {
      targetDef = await db.eventdefinitions.get(params.eventDefinitionId);
      if (targetDef) {
        isShot = Boolean(targetDef.isShot);
      }
    }

    const locationX = resolveCoordinateValue(
      params.locationX,
      existing.locationX,
    );
    const locationY = resolveCoordinateValue(
      params.locationY,
      existing.locationY,
    );
    const shotLocationX = isShot
      ? resolveCoordinateValue(params.shotLocationX, existing.shotLocationX)
      : null;
    const shotLocationY = isShot
      ? resolveCoordinateValue(params.shotLocationY, existing.shotLocationY)
      : null;

    const restExisting = stripDisciplinarySnapshot(existing);

    const nextEvent: GameEvent = {
      ...restExisting,
      matchLineupId: params.matchLineupId,
      eventDefinitionId: params.eventDefinitionId,
      isLeadToGoal: params.isLeadToGoal,
      locationX,
      locationY,
      shotLocationX,
      shotLocationY,
      ...resolveUpdatedEventSnapshot(existing, isNewDefinition, targetDef),
    };
    updatedEvent = nextEvent;

    await db.gameevents.put(nextEvent);

    await updateSyncQueueForEvent({
      ...params,
      locationX,
      locationY,
      shotLocationX,
      shotLocationY,
    });

    if (
      !targetDef &&
      nextEvent.foulImpact === undefined &&
      params.matchLineupId !== existing.matchLineupId
    ) {
      targetDef = await db.eventdefinitions?.get(nextEvent.eventDefinitionId);
    }

    await syncDisciplinaryAutoExitOnUpdateInTx(
      resolvedMatchId,
      existing,
      nextEvent,
      isNewDefinition,
      targetDef,
    );
  });

  return updatedEvent!;
};

export const deleteGameEventTx = async (eventId: string): Promise<void> => {
  const deleteTransactionTables = [
    db.gameevents,
    db.matchlineups,
    db.syncQueue,
    ...(db.timeanchors ? [db.timeanchors] : []),
    ...(db.playerpresences ? [db.playerpresences] : []),
    ...(db.eventdefinitions ? [db.eventdefinitions] : []),
    ...(db.matches ? [db.matches] : []),
    ...(db.tournaments ? [db.tournaments] : []),
    ...(db.sportconfigurations ? [db.sportconfigurations] : []),
  ];

  await db.transaction("rw", deleteTransactionTables, async () => {
    const existing = await db.gameevents.get(eventId);
    if (!existing) {
      throw new Error(`Game event not found for ID: ${eventId}`);
    }

    if (existing.isSynced === 1) {
      throw new Error("Cannot delete a synchronized event.");
    }

    const lineup = await db.matchlineups.get(existing.matchLineupId);
    const resolvedMatchId = lineup?.matchId;
    if (resolvedMatchId && matchLockService.isMatchLocked(resolvedMatchId)) {
      throw new Error(
        `Cannot delete event: match ${
          resolvedMatchId
        } is locked for finalization.`,
      );
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

    const existingRule = await resolveEventDisciplinaryRuleInTx(existing);
    if (hasDisciplinaryImpact(existingRule)) {
      await revertPreviousAutoExitIfEligibleInTx(
        resolvedMatchId,
        existing,
        { removeEventId: existing.id },
        existingRule,
      );
    }
  });
};
