import { apiClient } from "../api/client";
import { db } from "../db/ttaDatabase";

let isSyncing = false;

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

interface SyncCacheContext {
  lineupTeamCache?: Map<string, string | null>;
  matchRecordCache?: Map<string, Record<string, unknown> | null>;
}

const UNRECOVERABLE_STATUS_CODES = new Set([400, 403, 404, 409, 410]);

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
  return [
    presencePayload.playerOutLineupId,
    presencePayload.playerInLineupId,
  ].filter(Boolean) as string[];
};

const syncPresences = async (payload: unknown): Promise<void> => {
  const presencePayload = payload as Record<string, unknown>;
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
    .modify({ isSynced: 1 });
};

const syncEvents = async (payload: unknown): Promise<void> => {
  if (!db?.gameevents) return;

  const eventsList = Array.isArray(payload) ? payload : [payload];
  const eventIds = eventsList
    .map((item) => (item as { id?: string })?.id)
    .filter((id): id is string => Boolean(id));

  if (eventIds.length > 0) {
    await db.gameevents.where("id").anyOf(eventIds).modify({ isSynced: 1 });
  }
};

const syncAnchors = async (payload: unknown): Promise<void> => {
  if (!db?.timeanchors) return;

  const anchorsList = Array.isArray(payload) ? payload : [payload];
  const anchorIds = anchorsList
    .map((item) => (item as { id?: string })?.id)
    .filter((id): id is string => Boolean(id));

  if (anchorIds.length > 0) {
    await db.timeanchors.where("id").anyOf(anchorIds).modify({ isSynced: 1 });
  }
};

/**
 * Updates local IndexedDB entities (playerpresences, gameevents, timeanchors) to isSynced = 1 upon successful server sync.
 */
export const markEntitiesSynced = async (
  endpoint: string,
  payload: unknown,
): Promise<void> => {
  if (!endpoint || !payload) return;

  if (endpoint.includes("/presence") || endpoint.includes("/substitutions")) {
    await syncPresences(payload);
  } else if (endpoint.includes("/events")) {
    await syncEvents(payload);
  } else if (endpoint.includes("/anchors")) {
    await syncAnchors(payload);
  }
};

/**
 * Backward-compatible alias for presences sync marker.
 */
export const markPresencesSynced = markEntitiesSynced;

/**
 * Determines whether an HTTP operation endpoint supports array payload batching.
 */
const isBatchableEndpoint = (actionType: string, endpoint: string): boolean => {
  if (actionType !== "POST") return false;
  return endpoint.endsWith("/events") || endpoint.endsWith("/anchors");
};

/**
 * Safely parses a JSON payload string, returning null on error.
 */
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
): Promise<string | null> => {
  if (
    typeof event?.matchLineupId === "string" &&
    db?.matchlineups &&
    db?.playerrosters
  ) {
    const lineupId = event.matchLineupId;
    if (lineupTeamCache?.has(lineupId)) {
      return lineupTeamCache.get(lineupId) ?? null;
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
  }
  return null;
};

const resolveBatchTeamId = async (
  payload: unknown,
  lineupTeamCache?: Map<string, string | null>,
): Promise<string | null> => {
  const eventsList = Array.isArray(payload) ? payload : [payload];
  if (eventsList.length === 0) return null;

  let commonTeamId: string | null = null;
  for (const item of eventsList) {
    if (typeof item === "object" && item !== null) {
      const teamId = await resolveEventTeamId(
        item as Record<string, unknown>,
        lineupTeamCache,
      );
      if (!teamId) return null;
      if (commonTeamId === null) {
        commonTeamId = teamId;
      } else if (commonTeamId !== teamId) {
        return null;
      }
    } else {
      return null;
    }
  }
  return commonTeamId;
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
  const batchable = isBatchableEndpoint(
    currentItem.actionType,
    currentItem.endpoint,
  );

  if (!batchable) {
    return { batchItems: [currentItem], effectivePayload: currentPayload };
  }

  const currentTeamId = currentItem.endpoint.includes("/teams/")
    ? await resolveBatchTeamId(currentPayload, lineupTeamCache)
    : null;

  const aggregatedArray: unknown[] = Array.isArray(currentPayload)
    ? [...currentPayload]
    : [currentPayload];
  const batchItems = [currentItem];

  for (let j = startIndex + 1; j < pendingItems.length; j++) {
    const nextItem = pendingItems[j];
    if (
      nextItem.actionType !== currentItem.actionType ||
      nextItem.endpoint !== currentItem.endpoint
    ) {
      break;
    }

    const nextPayload = parsePayload(nextItem.payload);
    if (nextPayload === null) break;

    if (currentItem.endpoint.includes("/teams/")) {
      const nextTeamId = await resolveBatchTeamId(nextPayload, lineupTeamCache);
      if (currentTeamId !== nextTeamId) {
        break;
      }
    }

    if (Array.isArray(nextPayload)) {
      aggregatedArray.push(...nextPayload);
    } else {
      aggregatedArray.push(nextPayload);
    }
    batchItems.push(nextItem);
  }

  return { batchItems, effectivePayload: aggregatedArray };
};

/**
 * Executes the appropriate HTTP method for a sync queue batch/item with an X-Idempotency-Key header.
 */
const executeHttpRequest = async (
  actionType: string,
  endpoint: string,
  payload: unknown,
  batchItems: SyncQueueItem[],
  cache?: SyncCacheContext,
): Promise<{ status?: number }> => {
  let targetEndpoint = endpoint;

  // Dynamically resolve and normalize the correct teamId in the endpoint URL
  if (targetEndpoint.includes("/teams/") && db) {
    try {
      // Strategy 1: Resolve teamId precisely from all events' matchLineupId and player rosters
      const resolvedTeamId = await resolveBatchTeamId(
        payload,
        cache?.lineupTeamCache,
      );
      if (resolvedTeamId) {
        targetEndpoint = targetEndpoint.replace(
          /\/teams\/[^/]+/,
          `/teams/${resolvedTeamId}`,
        );
      } else if (db.matches) {
        // Strategy 2: Fallback to match record lookup if lineup resolution did not apply
        const matchIdMatch = targetEndpoint.match(
          /\/Matches\/([^/]+)\/teams\/([^/]+)/,
        );
        if (matchIdMatch && matchIdMatch[1] && matchIdMatch[2]) {
          const matchId = matchIdMatch[1];
          const queuedTeamId = matchIdMatch[2];

          let matchData:
            | (Record<string, unknown> & {
                trackedTeamId?: string;
                selectedTeamId?: string;
                homeTeamId?: string;
                guestTeamId?: string;
              })
            | undefined;

          if (cache?.matchRecordCache?.has(matchId)) {
            matchData = (cache.matchRecordCache.get(matchId) ??
              undefined) as typeof matchData;
          } else {
            const matchRecord = await db.matches.get(matchId);
            matchData = matchRecord as typeof matchData;
            cache?.matchRecordCache?.set(matchId, matchData ?? null);
          }

          const explicitTeamId =
            matchData?.trackedTeamId || matchData?.selectedTeamId;

          if (explicitTeamId) {
            targetEndpoint = targetEndpoint.replace(
              /\/teams\/[^/]+/,
              `/teams/${explicitTeamId}`,
            );
          } else if (
            queuedTeamId === matchData?.homeTeamId ||
            queuedTeamId === matchData?.guestTeamId
          ) {
            // Preserve queued team segment if it matches homeTeamId or guestTeamId
          }
        }
      }
    } catch (err) {
      console.warn(
        "Failed to normalize teamId in sync endpoint, falling back to original:",
        err,
      );
    }
  }

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

/**
 * Validates whether an HTTP response status represents a successful execution (2xx range or unwrapped response).
 */
const isSuccessStatus = (status?: number): boolean => {
  if (status === undefined) return true;
  return status >= 200 && status < 300;
};

/**
 * Checks if an HTTP response status code is an unrecoverable client error (400, 403, 404, 409, 410).
 */
const isUnrecoverableStatus = (status?: number): boolean => {
  if (status === undefined) return false;
  return UNRECOVERABLE_STATUS_CODES.has(status);
};

/**
 * Deletes a batch of queue items from db.syncQueue without marking local entities as synced,
 * executed within a single Dexie transaction for atomicity.
 */
const purgeBatchFromSyncQueue = async (
  batchItems: SyncQueueItem[],
): Promise<void> => {
  if (!db?.syncQueue) return;

  const performPurge = async (): Promise<void> => {
    for (const item of batchItems) {
      if (item.id !== undefined && db.syncQueue) {
        await db.syncQueue.delete(item.id);
      }
    }
  };

  if (typeof db.transaction === "function") {
    await db.transaction("rw", [db.syncQueue], performPurge);
  } else {
    await performPurge();
  }
};

/**
 * Marks local entities as synced and deletes successfully processed queue items within an atomic Dexie transaction.
 */
const finalizeBatchSync = async (
  endpoint: string,
  payload: unknown,
  batchItems: SyncQueueItem[],
): Promise<number> => {
  if (!db) return 0;

  const performFinalization = async (): Promise<number> => {
    await markEntitiesSynced(endpoint, payload);
    let count = 0;
    for (const item of batchItems) {
      if (item.id !== undefined && db.syncQueue) {
        await db.syncQueue.delete(item.id);
        count++;
      }
    }
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

const extractErrorStatus = (err: unknown): number | undefined => {
  return (
    (err as { status?: number; response?: { status?: number } })?.status ??
    (err as { status?: number; response?: { status?: number } })?.response
      ?.status
  );
};

interface BatchResult {
  syncedCount: number;
  shouldContinue: boolean;
}

const processSyncBatch = async (
  currentItem: SyncQueueItem,
  effectivePayload: unknown,
  batchItems: SyncQueueItem[],
  cache?: SyncCacheContext,
): Promise<BatchResult> => {
  try {
    const response = await executeHttpRequest(
      currentItem.actionType,
      currentItem.endpoint,
      effectivePayload,
      batchItems,
      cache,
    );

    if (isSuccessStatus(response?.status)) {
      const syncedCount = await finalizeBatchSync(
        currentItem.endpoint,
        effectivePayload,
        batchItems,
      );
      return { syncedCount, shouldContinue: true };
    }

    if (isUnrecoverableStatus(response?.status)) {
      console.warn(
        `Unrecoverable sync error (${response?.status}) for endpoint ${currentItem.endpoint}. Purging batch from syncQueue.`,
      );
      await purgeBatchFromSyncQueue(batchItems);
      return { syncedCount: 0, shouldContinue: true };
    }

    return { syncedCount: 0, shouldContinue: false };
  } catch (err) {
    const status = extractErrorStatus(err);

    if (isUnrecoverableStatus(status)) {
      console.warn(
        `Unrecoverable sync error (${status}) for endpoint ${currentItem.endpoint}. Purging batch from syncQueue:`,
        err,
      );
      await purgeBatchFromSyncQueue(batchItems);
      return { syncedCount: 0, shouldContinue: true };
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
  const matchRecordCache = new Map<string, Record<string, unknown> | null>();
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
