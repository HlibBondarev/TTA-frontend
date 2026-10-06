import { apiClient } from "../api/client";
import { db } from "../db/ttaDatabase";
import {
  UNRECOVERABLE_STATUS_CODES,
  extractErrorStatus,
} from "../utils/syncErrorUtils";

let isSyncing = false;

export interface MatchSyncBatchResponse {
  syncedEventIds?: string[];
  syncedAnchorIds?: string[];
  syncedPresenceIds?: string[];
}

interface SyncQueueItem {
  id?: number;
  actionType: string;
  endpoint: string;
  payload: string;
}

interface PresenceItemPayload {
  id: string;
  matchLineupId: string;
}

interface MatchTeamData {
  trackedTeamId?: string;
  selectedTeamId?: string;
  homeTeamId?: string;
  guestTeamId?: string;
}

interface SyncCacheContext {
  lineupTeamCache?: Map<string, string | null>;
  matchRecordCache?: Map<string, MatchTeamData | null>;
}

interface SyncedEntitySets {
  events: Set<string>;
  anchors: Set<string>;
  presences: Set<string>;
}

const MATCH_TEAM_ENDPOINT_REGEX = /\/Matches\/([^/]+)\/teams\/([^/]+)/;

const fetchAndFormatBatchPayloads = async (normalizedMatchId: string) => {
  const lineups = await db.matchlineups
    .where("matchId")
    .equals(normalizedMatchId)
    .toArray();
  const lineupIds = new Set<string>(lineups.map((l) => l.id));

  const unsyncedEvents = await db.gameevents
    .filter((e) => lineupIds.has(e.matchLineupId) && e.isSynced === 0)
    .toArray();

  const unsyncedAnchors = await db.timeanchors
    .where("matchId")
    .equals(normalizedMatchId)
    .filter((a) => a.isSynced === 0)
    .toArray();

  const unsyncedPresences = await db.playerpresences
    .filter((p) => lineupIds.has(p.matchLineupId) && p.isSynced === 0)
    .toArray();

  return {
    events: unsyncedEvents.map((e) => ({
      id: e.id,
      matchLineupId: e.matchLineupId,
      eventDefinitionId: e.eventDefinitionId,
      periodNumber: e.periodNumber,
      eventTimestamp: e.eventTimestamp
        ? new Date(e.eventTimestamp).toISOString()
        : e.eventTimestamp,
      isLeadToGoal: e.isLeadToGoal,
    })),
    anchors: unsyncedAnchors.map((a) => ({
      id: a.id,
      periodNumber: a.periodNumber,
      type: a.type,
      timestamp: a.timestamp
        ? new Date(a.timestamp).toISOString()
        : a.timestamp,
    })),
    presences: unsyncedPresences.map((p) => ({
      id: p.id,
      matchLineupId: p.matchLineupId,
      periodNumber: p.periodNumber,
      ...(p.timeIn ? { timeIn: new Date(p.timeIn).toISOString() } : {}),
      ...(p.timeOut ? { timeOut: new Date(p.timeOut).toISOString() } : {}),
    })),
  };
};

const extractBatchError = (err: unknown): Error | null => {
  if (
    extractErrorStatus(err) !== 400 ||
    typeof err !== "object" ||
    err === null
  ) {
    return null;
  }

  const errObj = err as {
    problemDetails?: { errors?: Record<string, string[] | string> };
    data?: { errors?: Record<string, string[] | string> };
  };

  const apiData = errObj.problemDetails ?? errObj.data;
  if (!apiData?.errors || typeof apiData.errors !== "object") return null;

  const messages = Object.values(apiData.errors)
    .flatMap((val) => (Array.isArray(val) ? val : [val]))
    .filter(Boolean);

  if (messages.length === 0) return null;

  const validationError = new Error(messages.join("; "));
  (validationError as unknown as Record<string, unknown>).status = 400;
  (validationError as unknown as Record<string, unknown>).data = apiData;
  (validationError as unknown as Record<string, unknown>).problemDetails =
    apiData;
  return validationError;
};

const postSyncBatch = async (
  normalizedMatchId: string,
  requestPayload: unknown,
): Promise<MatchSyncBatchResponse> => {
  try {
    const res = await apiClient.post<MatchSyncBatchResponse>(
      `/Matches/${normalizedMatchId}/sync-batch`,
      requestPayload,
    );
    return typeof res === "object" && res !== null && "data" in res
      ? (res.data as MatchSyncBatchResponse)
      : res;
  } catch (err) {
    const validationError = extractBatchError(err);
    if (validationError) throw validationError;
    throw err;
  }
};

const shouldDeleteQueueItem = (
  item: SyncQueueItem,
  syncedSets: SyncedEntitySets,
): boolean => {
  const payload = parsePayload(item.payload);
  if (payload === null) return false;

  if (item.endpoint.includes("/events")) {
    const ids = extractEventIds(item.endpoint, payload);
    return ids.length > 0 && ids.every((id) => syncedSets.events.has(id));
  }
  if (item.endpoint.includes("/anchors")) {
    const ids = extractAnchorIds(item.endpoint, payload);
    return ids.length > 0 && ids.every((id) => syncedSets.anchors.has(id));
  }
  if (item.endpoint.includes("/presence")) {
    const ids = extractPresenceIds(payload);
    return ids.length > 0 && ids.every((id) => syncedSets.presences.has(id));
  }
  return false;
};

const cleanupBatchQueue = async (
  normalizedMatchId: string,
  batchData: MatchSyncBatchResponse,
): Promise<void> => {
  if (!db.syncQueue) return;

  const queueItems = await db.syncQueue.toArray();
  const prefix = `/Matches/${normalizedMatchId}/`;
  const syncedSets: SyncedEntitySets = {
    events: new Set(batchData?.syncedEventIds ?? []),
    anchors: new Set(batchData?.syncedAnchorIds ?? []),
    presences: new Set(batchData?.syncedPresenceIds ?? []),
  };

  const idsToDelete: number[] = [];

  for (const item of queueItems) {
    if (
      item.id === undefined ||
      item.actionType !== "POST" ||
      !item.endpoint.startsWith(prefix)
    ) {
      continue;
    }

    if (shouldDeleteQueueItem(item, syncedSets)) {
      idsToDelete.push(item.id);
    }
  }

  if (idsToDelete.length > 0) {
    await Promise.all(idsToDelete.map((id) => db.syncQueue.delete(id)));
  }
};

/**
 * Synchronizes un-synced events, anchors, and presence intervals for a match in a single batch.
 */
export const syncMatchBatch = async (
  matchId: string,
): Promise<MatchSyncBatchResponse> => {
  if (!matchId?.trim()) {
    throw new Error("Match ID is required for batch synchronization.");
  }
  const normalizedMatchId = matchId.trim();

  const requestPayload = await fetchAndFormatBatchPayloads(normalizedMatchId);
  const batchData = await postSyncBatch(normalizedMatchId, requestPayload);

  const syncedEventIds = batchData?.syncedEventIds ?? [];
  const syncedAnchorIds = batchData?.syncedAnchorIds ?? [];
  const syncedPresenceIds = batchData?.syncedPresenceIds ?? [];

  await db.transaction(
    "rw",
    [db.gameevents, db.timeanchors, db.playerpresences, db.syncQueue],
    async () => {
      if (syncedEventIds.length > 0) {
        await db.gameevents
          .where("id")
          .anyOf(syncedEventIds)
          .modify({ isSynced: 1 });
      }
      if (syncedAnchorIds.length > 0) {
        await db.timeanchors
          .where("id")
          .anyOf(syncedAnchorIds)
          .modify({ isSynced: 1 });
      }
      if (syncedPresenceIds.length > 0) {
        await db.playerpresences
          .where("id")
          .anyOf(syncedPresenceIds)
          .modify({ isSynced: 1 });
      }

      await cleanupBatchQueue(normalizedMatchId, batchData);
    },
  );

  return batchData;
};

const extractPresenceIds = (payload: unknown): string[] => {
  if (typeof payload !== "object" || payload === null) return [];

  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.presenceItems)) {
    return (obj.presenceItems as PresenceItemPayload[])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string");
  }

  const items = Array.isArray(payload) ? payload : [payload];
  const ids: string[] = [];
  for (const item of items) {
    if (
      typeof item === "object" &&
      item !== null &&
      "id" in item &&
      typeof (item as { id?: string }).id === "string"
    ) {
      ids.push((item as { id: string }).id);
    }
  }
  return ids;
};

const extractPresenceLineupIds = (
  presencePayload: Record<string, unknown>,
): string[] => {
  if (Array.isArray(presencePayload.presenceItems)) {
    return (presencePayload.presenceItems as PresenceItemPayload[]).map(
      (item) => item.matchLineupId,
    );
  }
  if (Array.isArray(presencePayload.playerLineupIds)) {
    return presencePayload.playerLineupIds as string[];
  }
  const result: string[] = [];
  const playerOut = presencePayload.playerOutLineupId;
  if (typeof playerOut === "string") {
    result.push(playerOut);
  }
  const playerIn = presencePayload.playerInLineupId;
  if (typeof playerIn === "string") {
    result.push(playerIn);
  }
  return result;
};

const extractEntityIds = (
  segment: "events" | "anchors",
  endpoint: string,
  payload: unknown,
): string[] => {
  const ids = new Set<string>();
  const items = Array.isArray(payload) ? payload : [payload];
  for (const item of items) {
    if (
      typeof item === "object" &&
      item !== null &&
      "id" in item &&
      typeof (item as { id?: string }).id === "string"
    ) {
      ids.add((item as { id: string }).id);
    }
  }

  const match = new RegExp(`/${segment}/([^/]+)`).exec(endpoint);
  if (match?.[1] && match[1] !== "batch" && !match[1].startsWith("?")) {
    ids.add(match[1]);
  }

  return Array.from(ids);
};

const extractEventIds = (endpoint: string, payload: unknown): string[] =>
  extractEntityIds("events", endpoint, payload);

const extractAnchorIds = (endpoint: string, payload: unknown): string[] =>
  extractEntityIds("anchors", endpoint, payload);

const syncPresences = async (
  payload: unknown,
  targetStatus: number = 1,
): Promise<void> => {
  const presencePayload = (payload ?? {}) as Record<string, unknown>;
  if (
    typeof presencePayload.periodNumber !== "number" ||
    !db?.playerpresences
  ) {
    return;
  }

  const affectedLineupIds = new Set<string>(
    extractPresenceLineupIds(presencePayload),
  );

  await db.playerpresences
    .where("periodNumber")
    .equals(presencePayload.periodNumber)
    .filter(
      (p) =>
        affectedLineupIds.has(p.matchLineupId) &&
        p.timeIn !== null &&
        p.timeOut !== null,
    )
    .modify({ isSynced: targetStatus });
};

const syncEvents = async (
  endpoint: string,
  payload: unknown,
  targetStatus: number = 1,
): Promise<void> => {
  if (!db?.gameevents) return;

  const eventIds = extractEventIds(endpoint, payload);

  if (eventIds.length > 0) {
    await db.gameevents
      .where("id")
      .anyOf(eventIds)
      .modify({ isSynced: targetStatus });
  }
};

const syncAnchors = async (
  endpoint: string,
  payload: unknown,
  targetStatus: number = 1,
): Promise<void> => {
  if (!db?.timeanchors) return;

  const anchorIds = extractAnchorIds(endpoint, payload);

  if (anchorIds.length > 0) {
    await db.timeanchors
      .where("id")
      .anyOf(anchorIds)
      .modify({ isSynced: targetStatus });
  }
};

/**
 * Updates local IndexedDB entities (playerpresences, gameevents, timeanchors) to targetStatus upon sync finalization or purge.
 */
export const markEntitiesSynced = async (
  endpoint: string,
  payload: unknown,
  targetStatus: number = 1,
): Promise<void> => {
  if (!endpoint || payload === null || payload === undefined) return;

  if (endpoint.includes("/presence") || endpoint.includes("/substitutions")) {
    await syncPresences(payload, targetStatus);
  } else if (endpoint.includes("/events")) {
    await syncEvents(endpoint, payload, targetStatus);
  } else if (endpoint.includes("/anchors")) {
    await syncAnchors(endpoint, payload, targetStatus);
  }
};

export const markPresencesSynced = markEntitiesSynced;

const isBatchableEndpoint = (actionType: string, endpoint: string): boolean => {
  if (actionType !== "POST") return false;
  return endpoint.endsWith("/events") || endpoint.endsWith("/anchors");
};

const parsePayload = (payloadStr: string): unknown => {
  try {
    return JSON.parse(payloadStr);
  } catch {
    return null;
  }
};

const resolveEventTeamId = async (
  event: Record<string, unknown>,
  lineupTeamCache?: Map<string, string | null>,
): Promise<string> => {
  const lineupId = event?.matchLineupId;
  if (typeof lineupId === "string" && db?.matchlineups && db?.playerrosters) {
    if (lineupTeamCache?.has(lineupId)) {
      const cached = lineupTeamCache.get(lineupId);
      return cached ?? "UNRESOLVED";
    }

    const lineup = await db.matchlineups.get(lineupId);
    if (lineup?.playerRosterId) {
      const roster = await db.playerrosters.get(lineup.playerRosterId);
      if (roster?.teamId) {
        lineupTeamCache?.set(lineupId, roster.teamId);
        return roster.teamId;
      }
    }
    lineupTeamCache?.set(lineupId, null);
    return "UNRESOLVED";
  }

  if ("matchLineupId" in event && event.matchLineupId !== undefined) {
    return "UNRESOLVED";
  }

  return "NO_LINEUP";
};

const resolveSingleEventTeamId = async (
  item: unknown,
  lineupTeamCache?: Map<string, string | null>,
): Promise<string> => {
  if (typeof item !== "object" || item === null) {
    return "UNRESOLVED";
  }
  return resolveEventTeamId(item as Record<string, unknown>, lineupTeamCache);
};

const resolveBatchTeamId = async (
  payload: unknown,
  lineupTeamCache?: Map<string, string | null>,
): Promise<string> => {
  const eventsList = Array.isArray(payload) ? payload : [payload];
  if (eventsList.length === 0) return "NO_LINEUP";

  let commonTeamId: string | null = null;

  for (const item of eventsList) {
    const result = await resolveSingleEventTeamId(item, lineupTeamCache);
    if (result === "UNRESOLVED") return "UNRESOLVED";
    if (result === "NO_LINEUP") continue;

    if (commonTeamId === null) {
      commonTeamId = result;
    } else if (commonTeamId !== result) {
      return "UNRESOLVED";
    }
  }

  return commonTeamId ?? "NO_LINEUP";
};

const isNextItemCompatible = async (
  currentItem: SyncQueueItem,
  currentTeamResult: string,
  nextItem: SyncQueueItem,
  lineupTeamCache?: Map<string, string | null>,
): Promise<{ compatible: boolean; payload: unknown }> => {
  if (
    nextItem.actionType !== currentItem.actionType ||
    nextItem.endpoint !== currentItem.endpoint
  ) {
    return { compatible: false, payload: null };
  }

  const nextPayload = parsePayload(nextItem.payload);
  if (nextPayload === null) {
    return { compatible: false, payload: null };
  }

  if (currentItem.endpoint.includes("/teams/")) {
    let nextTeamResult: string;
    try {
      nextTeamResult = await resolveBatchTeamId(nextPayload, lineupTeamCache);
    } catch {
      nextTeamResult = "UNRESOLVED";
    }

    if (
      currentTeamResult === "UNRESOLVED" ||
      nextTeamResult === "UNRESOLVED" ||
      currentTeamResult !== nextTeamResult
    ) {
      return { compatible: false, payload: null };
    }
  }

  return { compatible: true, payload: nextPayload };
};

const getInitialTeamResult = async (
  endpoint: string,
  payload: unknown,
  cache?: Map<string, string | null>,
): Promise<string> => {
  if (!endpoint.includes("/teams/")) return "NO_LINEUP";
  try {
    return await resolveBatchTeamId(payload, cache);
  } catch {
    return "UNRESOLVED";
  }
};

/**
 * Aggregates consecutive batchable POST queue items targeting the same endpoint and resolving to the same team.
 */
const collectBatch = async (
  pendingItems: SyncQueueItem[],
  startIndex: number,
  currentItem: SyncQueueItem,
  currentPayload: unknown,
  lineupTeamCache?: Map<string, string | null>,
): Promise<{ batchItems: SyncQueueItem[]; effectivePayload: unknown }> => {
  if (!isBatchableEndpoint(currentItem.actionType, currentItem.endpoint)) {
    return { batchItems: [currentItem], effectivePayload: currentPayload };
  }

  const currentTeamResult = await getInitialTeamResult(
    currentItem.endpoint,
    currentPayload,
    lineupTeamCache,
  );

  const aggregatedArray: unknown[] = Array.isArray(currentPayload)
    ? [...currentPayload]
    : [currentPayload];
  const batchItems = [currentItem];

  for (let j = startIndex + 1; j < pendingItems.length; j++) {
    const nextItem = pendingItems[j];
    const { compatible, payload } = await isNextItemCompatible(
      currentItem,
      currentTeamResult,
      nextItem,
      lineupTeamCache,
    );

    if (!compatible) break;

    if (Array.isArray(payload)) {
      aggregatedArray.push(...payload);
    } else {
      aggregatedArray.push(payload);
    }
    batchItems.push(nextItem);
  }

  return { batchItems, effectivePayload: aggregatedArray };
};

const getCachedMatchRecord = async (
  matchId: string,
  cache?: SyncCacheContext,
): Promise<MatchTeamData | undefined> => {
  if (cache?.matchRecordCache?.has(matchId)) {
    return cache.matchRecordCache.get(matchId) ?? undefined;
  }
  if (!db?.matches) return undefined;
  const matchRecord = await db.matches.get(matchId);
  const matchData = matchRecord as MatchTeamData | undefined;
  cache?.matchRecordCache?.set(matchId, matchData ?? null);
  return matchData;
};

const resolveFallbackTeamEndpoint = async (
  targetEndpoint: string,
  cache?: SyncCacheContext,
): Promise<string> => {
  const matchIdMatch = MATCH_TEAM_ENDPOINT_REGEX.exec(targetEndpoint);
  if (!matchIdMatch?.[1] || !matchIdMatch[2]) {
    return targetEndpoint;
  }

  const matchId = matchIdMatch[1];
  const matchData = await getCachedMatchRecord(matchId, cache);

  const explicitTeamId = matchData?.trackedTeamId ?? matchData?.selectedTeamId;
  if (explicitTeamId) {
    return targetEndpoint.replace(/\/teams\/[^/]+/, `/teams/${explicitTeamId}`);
  }

  return targetEndpoint;
};

const normalizeTeamEndpoint = async (
  endpoint: string,
  payload: unknown,
  actionType?: string,
  cache?: SyncCacheContext,
): Promise<string> => {
  if (!endpoint.includes("/teams/") || !db) {
    return endpoint;
  }

  if (actionType === "DELETE" && endpoint.endsWith("/catch")) {
    return endpoint;
  }

  try {
    const resolvedTeamResult = await resolveBatchTeamId(
      payload,
      cache?.lineupTeamCache,
    );
    if (
      resolvedTeamResult === "UNRESOLVED" ||
      resolvedTeamResult === "NO_LINEUP"
    ) {
      return await resolveFallbackTeamEndpoint(endpoint, cache);
    }

    return endpoint.replace(/\/teams\/[^/]+/, `/teams/${resolvedTeamResult}`);
  } catch (err) {
    console.warn(
      "Failed to normalize teamId in sync endpoint, falling back to match trackedTeamId or original endpoint:",
      err,
    );
    return await resolveFallbackTeamEndpoint(endpoint, cache);
  }
};

const executeHttpRequest = async (
  actionType: string,
  targetEndpoint: string,
  payload: unknown,
  batchItems: SyncQueueItem[],
): Promise<{ status?: number }> => {
  const batchIds = batchItems
    .map((item) => item.id)
    .filter((id): id is number => id !== undefined)
    .join("-");

  const config = batchIds
    ? { headers: { "X-Idempotency-Key": `sync-batch-${batchIds}` } }
    : undefined;

  if (actionType === "POST") {
    return apiClient.post(targetEndpoint, payload, config);
  }
  if (actionType === "PUT") {
    return apiClient.put(targetEndpoint, payload, config);
  }
  if (actionType === "DELETE") {
    return apiClient.delete(targetEndpoint, config);
  }
  throw new Error(`Unsupported sync actionType: ${actionType}`);
};

const isSuccessStatus = (status?: number): boolean => {
  if (status === undefined) return true;
  return status >= 200 && status < 300;
};

const isUnrecoverableStatus = (status?: number): boolean => {
  if (status === undefined) return false;
  return UNRECOVERABLE_STATUS_CODES.has(status);
};

const purgeBatchFromSyncQueue = async (
  batchItems: SyncQueueItem[],
  endpoint: string,
  payload: unknown,
): Promise<void> => {
  if (!db) return;

  const performPurge = async (): Promise<void> => {
    await markEntitiesSynced(endpoint, payload, -1);

    await Promise.all(
      batchItems.map(async (item) => {
        if (item.id !== undefined && db.syncQueue) {
          await db.syncQueue.delete(item.id);
        }
      }),
    );
  };

  if (typeof db.transaction === "function") {
    const tables = [
      db.playerpresences,
      db.gameevents,
      db.timeanchors,
      db.syncQueue,
    ].filter(Boolean);
    await db.transaction("rw", tables, performPurge);
  } else {
    await performPurge();
  }
};

const finalizeBatchSync = async (
  endpoint: string,
  payload: unknown,
  batchItems: SyncQueueItem[],
): Promise<number> => {
  if (!db) return 0;

  const performFinalization = async (): Promise<number> => {
    await markEntitiesSynced(endpoint, payload, 1);
    let count = 0;

    await Promise.all(
      batchItems.map(async (item) => {
        if (item.id !== undefined && db.syncQueue) {
          await db.syncQueue.delete(item.id);
          count++;
        }
      }),
    );

    return count;
  };

  if (typeof db.transaction === "function") {
    const tables = [
      db.playerpresences,
      db.gameevents,
      db.timeanchors,
      db.syncQueue,
    ].filter(Boolean);
    return db.transaction("rw", tables, performFinalization);
  }

  return performFinalization();
};

interface BatchResult {
  syncedCount: number;
  shouldContinue: boolean;
}

const handleUnrecoverableError = async (
  batchItems: SyncQueueItem[],
  endpoint: string,
  payload: unknown,
  status?: number,
): Promise<BatchResult> => {
  console.warn(
    `Unrecoverable sync error (${status ?? "unknown"}) for endpoint ${endpoint}. Purging batch from syncQueue.`,
  );
  try {
    await purgeBatchFromSyncQueue(batchItems, endpoint, payload);
    return { syncedCount: 0, shouldContinue: true };
  } catch (purgeErr) {
    console.error(
      `Failed to purge unrecoverable batch for endpoint ${endpoint}:`,
      purgeErr,
    );
    return { syncedCount: 0, shouldContinue: false };
  }
};

/**
 * Helper to process response status and handle success vs unrecoverable error branches.
 */
const evaluateResponseStatus = async (
  status: number | undefined,
  currentItem: SyncQueueItem,
  effectivePayload: unknown,
  batchItems: SyncQueueItem[],
): Promise<BatchResult | null> => {
  if (isSuccessStatus(status)) {
    const syncedCount = await finalizeBatchSync(
      currentItem.endpoint,
      effectivePayload,
      batchItems,
    );
    return { syncedCount, shouldContinue: true };
  }

  if (isUnrecoverableStatus(status)) {
    return handleUnrecoverableError(
      batchItems,
      currentItem.endpoint,
      effectivePayload,
      status,
    );
  }

  return null;
};

const processSyncBatch = async (
  currentItem: SyncQueueItem,
  effectivePayload: unknown,
  batchItems: SyncQueueItem[],
  cache?: SyncCacheContext,
): Promise<BatchResult> => {
  try {
    const targetEndpoint = await normalizeTeamEndpoint(
      currentItem.endpoint,
      effectivePayload,
      currentItem.actionType,
      cache,
    );

    if (targetEndpoint === "UNRESOLVED") {
      return { syncedCount: 0, shouldContinue: false };
    }

    const response = await executeHttpRequest(
      currentItem.actionType,
      targetEndpoint,
      effectivePayload,
      batchItems,
    );

    const evaluatedResult = await evaluateResponseStatus(
      response?.status,
      currentItem,
      effectivePayload,
      batchItems,
    );

    if (evaluatedResult) {
      return evaluatedResult;
    }

    return { syncedCount: 0, shouldContinue: false };
  } catch (err) {
    const status = extractErrorStatus(err);

    if (isUnrecoverableStatus(status)) {
      return handleUnrecoverableError(
        batchItems,
        currentItem.endpoint,
        effectivePayload,
        status,
      );
    }

    console.error(
      `Sync batch execution failed for endpoint ${currentItem.endpoint}:`,
      err,
    );
    return { syncedCount: 0, shouldContinue: false };
  }
};

/**
 * Processes pending syncQueue items with batching for consecutive identical POST endpoints.
 */
export const processSyncQueue = async (): Promise<number> => {
  if (isSyncing || !navigator.onLine || !db?.syncQueue) {
    return 0;
  }

  isSyncing = true;
  let processedCount = 0;

  const lineupTeamCache = new Map<string, string | null>();
  const matchRecordCache = new Map<string, MatchTeamData | null>();
  const cache: SyncCacheContext = { lineupTeamCache, matchRecordCache };

  try {
    const pendingItems = (await db.syncQueue
      .orderBy("id")
      .toArray()) as SyncQueueItem[];
    let i = 0;

    while (i < pendingItems.length) {
      if (!navigator.onLine) break;

      const currentItem = pendingItems[i];
      const currentPayload = parsePayload(currentItem.payload);

      if (currentPayload === null) {
        console.error(
          `Invalid JSON payload in syncQueue item ${currentItem.id}`,
        );
        break;
      }

      const { batchItems, effectivePayload } = await collectBatch(
        pendingItems,
        i,
        currentItem,
        currentPayload,
        lineupTeamCache,
      );

      const { syncedCount, shouldContinue } = await processSyncBatch(
        currentItem,
        effectivePayload,
        batchItems,
        cache,
      );

      processedCount += syncedCount;
      if (!shouldContinue) {
        break;
      }

      i += batchItems.length;
    }
  } finally {
    isSyncing = false;
  }

  return processedCount;
};
