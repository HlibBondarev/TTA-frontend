import { apiClient } from "../api/client";
import { db, type PlayerPresence, type SyncQueueItem } from "../db/ttaDatabase";
import { anchorClaimService } from "./anchorClaimService";
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
const ALLOWED_BATCH_CLEANUP_ACTIONS = new Set(["POST", "PUT"]);

interface ClaimedAnchorHandle {
  anchorId: string;
  token: string | null;
}

const claimBatchAnchorsForSync = async (
  anchorIds: string[],
): Promise<ClaimedAnchorHandle[]> => {
  const claimed: ClaimedAnchorHandle[] = [];
  for (const id of Array.from(new Set(anchorIds))) {
    const result = await anchorClaimService.claimAcrossTabs([id], "sync");
    if (result.allClaimed && result.claimedIds.length > 0) {
      claimed.push({ anchorId: id, token: result.token });
    }
  }
  return claimed;
};

const releaseBatchAnchorClaims = async (
  handles: ClaimedAnchorHandle[],
): Promise<void> => {
  await Promise.all(
    handles.map(({ anchorId, token }) =>
      anchorClaimService.releaseAcrossTabs([anchorId], token, "sync"),
    ),
  );
};

const areQueueItemsStillPending = async (
  batchItems: SyncQueueItem[],
): Promise<boolean> => {
  if (typeof db?.syncQueue?.get !== "function") {
    return true;
  }

  const ids = batchItems
    .map((item) => item.id)
    .filter((id): id is number => id !== undefined);
  if (ids.length === 0) return true;

  const records = await Promise.all(ids.map((id) => db.syncQueue.get(id)));
  return records.every(Boolean);
};

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
    requestPayload: {
      events: unsyncedEvents.map((e) => ({
        id: e.id,
        matchLineupId: e.matchLineupId,
        eventDefinitionId: e.eventDefinitionId,
        periodNumber: e.periodNumber,
        eventTimestamp: e.eventTimestamp
          ? new Date(e.eventTimestamp).toISOString()
          : e.eventTimestamp,
        isLeadToGoal: e.isLeadToGoal,
        locationX: e.locationX ?? null,
        locationY: e.locationY ?? null,
        shotLocationX: e.shotLocationX ?? null,
        shotLocationY: e.shotLocationY ?? null,
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
    },
    unsyncedPresences,
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

const extractPresenceIds = (payload: unknown): string[] => {
  if (typeof payload !== "object" || payload === null) return [];

  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.presenceItems)) {
    return (obj.presenceItems as PresenceItemPayload[])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string");
  }

  if (typeof obj.incomingPresenceId === "string") {
    return [obj.incomingPresenceId];
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

const isSyncedEventItem = (
  item: SyncQueueItem,
  payload: unknown,
  syncedEvents: Set<string>,
): boolean => {
  if (item.actionType !== "POST") return false;
  const ids = extractEventIds(item.endpoint, payload);
  return ids.length > 0 && ids.every((id) => syncedEvents.has(id));
};

const isSyncedAnchorItem = (
  item: SyncQueueItem,
  payload: unknown,
  syncedAnchors: Set<string>,
): boolean => {
  if (item.actionType !== "POST") return false;
  const ids = extractAnchorIds(item.endpoint, payload);
  return ids.length > 0 && ids.every((id) => syncedAnchors.has(id));
};

const normalizeIsoTimestamp = (value: unknown): string | null => {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
};

const matchesSubmittedPresenceVersion = (
  current: PlayerPresence,
  submitted: PlayerPresence,
): boolean =>
  current.matchLineupId === submitted.matchLineupId &&
  current.periodNumber === submitted.periodNumber &&
  normalizeIsoTimestamp(current.timeIn) ===
    normalizeIsoTimestamp(submitted.timeIn) &&
  normalizeIsoTimestamp(current.timeOut) ===
    normalizeIsoTimestamp(submitted.timeOut);

const loadLocalPresencesByIds = async (
  ids: string[],
): Promise<PlayerPresence[]> => {
  if (ids.length === 0) return [];

  const whereClause = db.playerpresences.where("id");
  const anyOfClause =
    typeof whereClause?.anyOf === "function"
      ? whereClause.anyOf(ids)
      : undefined;

  if (typeof anyOfClause?.toArray === "function") {
    return anyOfClause.toArray();
  }

  const idSet = new Set(ids);
  return db.playerpresences.filter((p) => idSet.has(p.id)).toArray();
};

const isLocalPeriodEndAnchorSynced = async (
  matchId: string,
  periodNumber: number,
): Promise<boolean> => {
  const periodEndAnchors = await db.timeanchors
    .where("matchId")
    .equals(matchId)
    .filter((a) => a.type === 1 && a.periodNumber === periodNumber)
    .toArray();

  if (periodEndAnchors.some((anchor) => anchor.isSynced === 0)) {
    return false;
  }

  return periodEndAnchors.some((anchor) => anchor.isSynced === 1);
};

const isLocalPresenceClosedAndSyncedForPeriodEnd = (
  localPresence: PlayerPresence | undefined,
  periodNumber: number,
  targetTimeOut: string | null,
  submittedPresencesById: Map<string, PlayerPresence>,
): boolean => {
  if (localPresence?.isSynced !== 1) return false;
  if (localPresence.periodNumber !== periodNumber) return false;

  const submitted = submittedPresencesById.get(localPresence.id);
  if (submitted && !matchesSubmittedPresenceVersion(localPresence, submitted)) {
    return false;
  }

  if (!targetTimeOut) return localPresence.timeOut !== null;
  return normalizeIsoTimestamp(localPresence.timeOut) === targetTimeOut;
};

const isPeriodEndTerminationSynced = async (
  normalizedMatchId: string,
  periodEndMeta: NonNullable<SyncQueueItem["periodEndMeta"]>,
  unsyncedPresences: PlayerPresence[],
): Promise<boolean> => {
  const { closedPresenceIds, periodNumber, timeOut } = periodEndMeta;
  const anchorMatchId = periodEndMeta.matchId?.trim() || normalizedMatchId;

  // Retain period-end termination and its undo metadata while any PeriodEnd anchor
  // for this period is still unsynced (undoable) or no synced PeriodEnd anchor exists locally.
  const anchorSynced = await isLocalPeriodEndAnchorSynced(
    anchorMatchId,
    periodNumber,
  );
  if (!anchorSynced) {
    return false;
  }

  if (closedPresenceIds.length === 0) {
    return true;
  }

  const targetTimeOut = normalizeIsoTimestamp(timeOut);
  const submittedPresencesById = new Map(
    unsyncedPresences.map((presence) => [presence.id, presence]),
  );
  const localPresences = await loadLocalPresencesByIds(closedPresenceIds);
  const localPresencesById = new Map(
    localPresences.map((presence) => [presence.id, presence]),
  );

  return closedPresenceIds.every((id) =>
    isLocalPresenceClosedAndSyncedForPeriodEnd(
      localPresencesById.get(id),
      periodNumber,
      targetTimeOut,
      submittedPresencesById,
    ),
  );
};

const isTerminateQueueItemSynced = async (
  normalizedMatchId: string,
  item: SyncQueueItem,
  payload: unknown,
  syncedSets: SyncedEntitySets,
  unsyncedPresences: PlayerPresence[],
): Promise<boolean> => {
  if (item.periodEndMeta) {
    return isPeriodEndTerminationSynced(
      normalizedMatchId,
      item.periodEndMeta,
      unsyncedPresences,
    );
  }

  if (syncedSets.presences.size === 0) return false;
  if (typeof payload !== "object" || payload === null) return true;

  const terminatePayload = payload as {
    periodNumber?: number;
    playerLineupIds?: string[];
    timeOut?: string;
  };
  const lineupIds = Array.isArray(terminatePayload.playerLineupIds)
    ? new Set(terminatePayload.playerLineupIds)
    : null;
  const targetTimeOut = normalizeIsoTimestamp(terminatePayload.timeOut);

  if (
    typeof terminatePayload.periodNumber !== "number" ||
    !lineupIds ||
    lineupIds.size === 0
  ) {
    return true;
  }

  const targetPresenceIds = Array.isArray(item.closedPresenceIds)
    ? new Set(item.closedPresenceIds)
    : null;

  const matchingPresences = unsyncedPresences.filter((p) => {
    if (targetPresenceIds && !targetPresenceIds.has(p.id)) {
      return false;
    }
    if (
      p.periodNumber !== terminatePayload.periodNumber ||
      !lineupIds.has(p.matchLineupId)
    ) {
      return false;
    }
    if (!targetTimeOut) return p.timeOut !== null;
    return normalizeIsoTimestamp(p.timeOut) === targetTimeOut;
  });

  if (matchingPresences.length === 0) {
    return false;
  }

  return matchingPresences.every((p) => syncedSets.presences.has(p.id));
};

const isSyncedPresenceItem = async (
  normalizedMatchId: string,
  item: SyncQueueItem,
  payload: unknown,
  syncedSets: SyncedEntitySets,
  unsyncedPresences: PlayerPresence[],
): Promise<boolean> => {
  if (item.endpoint.includes("/presence/terminate")) {
    return (
      item.actionType === "PUT" &&
      (await isTerminateQueueItemSynced(
        normalizedMatchId,
        item,
        payload,
        syncedSets,
        unsyncedPresences,
      ))
    );
  }

  if (item.actionType !== "POST") return false;
  const ids = extractPresenceIds(payload);
  return ids.length > 0 && ids.every((id) => syncedSets.presences.has(id));
};

const shouldDeleteQueueItem = async (
  normalizedMatchId: string,
  item: SyncQueueItem,
  syncedSets: SyncedEntitySets,
  unsyncedPresences: PlayerPresence[],
): Promise<boolean> => {
  const payload = parsePayload(item.payload);
  if (payload === null) return false;

  if (item.endpoint.includes("/events")) {
    return isSyncedEventItem(item, payload, syncedSets.events);
  }

  if (item.endpoint.includes("/anchors")) {
    return isSyncedAnchorItem(item, payload, syncedSets.anchors);
  }

  if (
    item.endpoint.includes("/presence") ||
    item.endpoint.includes("/substitutions")
  ) {
    return isSyncedPresenceItem(
      normalizedMatchId,
      item,
      payload,
      syncedSets,
      unsyncedPresences,
    );
  }

  return false;
};

const cleanupBatchQueue = async (
  normalizedMatchId: string,
  batchData: MatchSyncBatchResponse,
  unsyncedPresences: PlayerPresence[],
): Promise<void> => {
  if (!db.syncQueue) return;

  const queueItems = await db.syncQueue.toArray();
  const prefix = `/Matches/${normalizedMatchId}/`;
  const syncedSets: SyncedEntitySets = {
    events: new Set(batchData?.syncedEventIds ?? []),
    anchors: new Set(batchData?.syncedAnchorIds ?? []),
    presences: new Set(batchData?.syncedPresenceIds ?? []),
  };

  const candidateItems = queueItems.filter(
    (item): item is SyncQueueItem & { id: number } =>
      item.id !== undefined &&
      ALLOWED_BATCH_CLEANUP_ACTIONS.has(item.actionType) &&
      item.endpoint.startsWith(prefix),
  );

  const deletionFlags = await Promise.all(
    candidateItems.map((item) =>
      shouldDeleteQueueItem(
        normalizedMatchId,
        item,
        syncedSets,
        unsyncedPresences,
      ),
    ),
  );

  const idsToDelete = candidateItems
    .filter((_, index) => deletionFlags[index])
    .map((item) => item.id);

  if (idsToDelete.length > 0) {
    await Promise.all(idsToDelete.map((id) => db.syncQueue.delete(id)));
  }
};

const markSyncedPresencesIfUnchanged = async (
  syncedPresenceIds: string[],
  unsyncedPresences: PlayerPresence[],
): Promise<void> => {
  if (syncedPresenceIds.length === 0) return;

  const submittedPresencesById = new Map(
    unsyncedPresences.map((presence) => [presence.id, presence]),
  );

  await db.playerpresences
    .where("id")
    .anyOf(syncedPresenceIds)
    .modify((presence) => {
      const submitted = submittedPresencesById.get(presence.id);
      if (submitted && matchesSubmittedPresenceVersion(presence, submitted)) {
        presence.isSynced = 1;
      }
    });
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

  const { requestPayload, unsyncedPresences } =
    await fetchAndFormatBatchPayloads(normalizedMatchId);

  const claimedAnchorHandles = await claimBatchAnchorsForSync(
    requestPayload.anchors.map((a) => a.id),
  );
  const claimedAnchorSet = new Set(
    claimedAnchorHandles.map((handle) => handle.anchorId),
  );

  const effectiveRequestPayload =
    claimedAnchorHandles.length === requestPayload.anchors.length
      ? requestPayload
      : {
          ...requestPayload,
          anchors: requestPayload.anchors.filter((a) =>
            claimedAnchorSet.has(a.id),
          ),
        };

  try {
    await anchorClaimService.markAmbiguousAcrossTabs(
      Array.from(claimedAnchorSet),
    );
    const batchData = await postSyncBatch(
      normalizedMatchId,
      effectiveRequestPayload,
    );

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
            .modify({ isSynced: 1, syncOutcomeAmbiguous: undefined });
        }
        await markSyncedPresencesIfUnchanged(
          syncedPresenceIds,
          unsyncedPresences,
        );

        await cleanupBatchQueue(
          normalizedMatchId,
          batchData,
          unsyncedPresences,
        );
      },
    );

    if (syncedAnchorIds.length > 0) {
      await anchorClaimService.clearAmbiguousAcrossTabs(syncedAnchorIds);
    }

    return batchData;
  } finally {
    await releaseBatchAnchorClaims(claimedAnchorHandles);
  }
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

const matchesInitializePresencePayload = (
  presence: PlayerPresence,
  presenceItems: PresenceItemPayload[],
  targetTimeIn: string | null,
): boolean => {
  const matchesItem = presenceItems.some(
    (item) =>
      typeof item.id === "string" &&
      item.id === presence.id &&
      item.matchLineupId === presence.matchLineupId,
  );
  if (!matchesItem || presence.timeOut !== null) {
    return false;
  }
  if (!targetTimeIn) {
    return presence.timeIn !== null;
  }
  return normalizeIsoTimestamp(presence.timeIn) === targetTimeIn;
};

const matchesOutgoingSubstitutionPresence = (
  presence: PlayerPresence,
  targetClosedPresenceIds: Set<string> | null,
  targetSubTime: string | null,
): boolean => {
  if (targetClosedPresenceIds && !targetClosedPresenceIds.has(presence.id)) {
    return false;
  }
  if (presence.timeIn === null || presence.timeOut === null) {
    return false;
  }
  return targetSubTime
    ? normalizeIsoTimestamp(presence.timeOut) === targetSubTime
    : true;
};

const matchesIncomingSubstitutionPresence = (
  presence: PlayerPresence,
  incomingPresenceId: string | null,
  targetSubTime: string | null,
): boolean => {
  if (presence.timeOut !== null) {
    return false;
  }
  if (incomingPresenceId && presence.id !== incomingPresenceId) {
    return false;
  }
  return targetSubTime
    ? normalizeIsoTimestamp(presence.timeIn) === targetSubTime
    : presence.timeIn !== null;
};

const matchesSubstitutionPresencePayload = (
  presence: PlayerPresence,
  presencePayload: Record<string, unknown>,
  targetClosedPresenceIds: Set<string> | null,
): boolean => {
  const playerOutId =
    typeof presencePayload.playerOutLineupId === "string"
      ? presencePayload.playerOutLineupId
      : null;
  const playerInId =
    typeof presencePayload.playerInLineupId === "string"
      ? presencePayload.playerInLineupId
      : null;
  const incomingPresenceId =
    typeof presencePayload.incomingPresenceId === "string"
      ? presencePayload.incomingPresenceId
      : null;
  const targetSubTime = normalizeIsoTimestamp(presencePayload.substitutionTime);

  if (playerOutId && presence.matchLineupId === playerOutId) {
    return matchesOutgoingSubstitutionPresence(
      presence,
      targetClosedPresenceIds,
      targetSubTime,
    );
  }

  if (playerInId && presence.matchLineupId === playerInId) {
    return matchesIncomingSubstitutionPresence(
      presence,
      incomingPresenceId,
      targetSubTime,
    );
  }

  return false;
};

const matchesTerminatePresencePayload = (
  presence: PlayerPresence,
  affectedLineupIds: Set<string>,
  targetTimeOut: string | null,
  targetPresenceIds: Set<string> | null,
): boolean => {
  if (targetPresenceIds && !targetPresenceIds.has(presence.id)) {
    return false;
  }
  if (
    !affectedLineupIds.has(presence.matchLineupId) ||
    presence.timeIn === null ||
    presence.timeOut === null
  ) {
    return false;
  }
  if (!targetTimeOut) {
    return true;
  }
  return normalizeIsoTimestamp(presence.timeOut) === targetTimeOut;
};

const buildManualPresenceFilter = (
  presencePayload: Record<string, unknown>,
  closedPresenceIds?: string[],
): ((presence: PlayerPresence) => boolean) => {
  if (Array.isArray(presencePayload.presenceItems)) {
    const presenceItems =
      presencePayload.presenceItems as PresenceItemPayload[];
    const targetTimeIn = normalizeIsoTimestamp(presencePayload.timeIn);
    return (presence) =>
      matchesInitializePresencePayload(presence, presenceItems, targetTimeIn);
  }

  const targetClosedPresenceIds = Array.isArray(closedPresenceIds)
    ? new Set(closedPresenceIds)
    : null;

  if (
    typeof presencePayload.playerOutLineupId === "string" ||
    typeof presencePayload.playerInLineupId === "string"
  ) {
    return (presence) =>
      matchesSubstitutionPresencePayload(
        presence,
        presencePayload,
        targetClosedPresenceIds,
      );
  }

  const affectedLineupIds = new Set<string>(
    extractPresenceLineupIds(presencePayload),
  );
  const targetTimeOut = normalizeIsoTimestamp(presencePayload.timeOut);
  return (presence) =>
    matchesTerminatePresencePayload(
      presence,
      affectedLineupIds,
      targetTimeOut,
      targetClosedPresenceIds,
    );
};

const syncPresences = async (
  payload: unknown,
  targetStatus: number = 1,
  closedPresenceIds?: string[],
): Promise<void> => {
  const presencePayload = (payload ?? {}) as Record<string, unknown>;
  if (
    typeof presencePayload.periodNumber !== "number" ||
    !db?.playerpresences
  ) {
    return;
  }

  const matchesPresence = buildManualPresenceFilter(
    presencePayload,
    closedPresenceIds,
  );

  await db.playerpresences
    .where("periodNumber")
    .equals(presencePayload.periodNumber)
    .filter(matchesPresence)
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
  closedPresenceIds?: string[],
): Promise<void> => {
  if (!endpoint || payload === null || payload === undefined) return;

  if (endpoint.includes("/presence") || endpoint.includes("/substitutions")) {
    await syncPresences(payload, targetStatus, closedPresenceIds);
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

const extractClosedPresenceIdsFromBatch = (
  batchItems: SyncQueueItem[],
): string[] | undefined => {
  let hasMetadata = false;
  const ids = new Set<string>();

  for (const item of batchItems) {
    const itemIds =
      item.closedPresenceIds ?? item.periodEndMeta?.closedPresenceIds;
    if (Array.isArray(itemIds)) {
      hasMetadata = true;
      for (const id of itemIds) {
        if (typeof id === "string") {
          ids.add(id);
        }
      }
    }
  }

  return hasMetadata ? Array.from(ids) : undefined;
};

const purgeBatchFromSyncQueue = async (
  batchItems: SyncQueueItem[],
  endpoint: string,
  payload: unknown,
): Promise<void> => {
  if (!db) return;

  const closedPresenceIds = extractClosedPresenceIdsFromBatch(batchItems);

  const performPurge = async (): Promise<void> => {
    await markEntitiesSynced(endpoint, payload, -1, closedPresenceIds);

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

  const closedPresenceIds = extractClosedPresenceIdsFromBatch(batchItems);

  const performFinalization = async (): Promise<number> => {
    await markEntitiesSynced(endpoint, payload, 1, closedPresenceIds);
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

const getAnchorIdsToClaim = (
  currentItem: SyncQueueItem,
  effectivePayload: unknown,
): string[] => {
  if (
    currentItem.actionType !== "POST" ||
    !currentItem.endpoint.includes("/anchors")
  ) {
    return [];
  }
  return extractAnchorIds(currentItem.endpoint, effectivePayload);
};

const clearClaimedAmbiguousIfNeeded = async (
  claimedIds: string[],
  result: BatchResult,
): Promise<void> => {
  if (claimedIds.length > 0 && result.shouldContinue) {
    await anchorClaimService.clearAmbiguousAcrossTabs(claimedIds);
  }
};

const handleBatchExecutionError = async (
  err: unknown,
  currentItem: SyncQueueItem,
  effectivePayload: unknown,
  batchItems: SyncQueueItem[],
  claimedIds: string[],
): Promise<BatchResult> => {
  const status = extractErrorStatus(err);

  if (isUnrecoverableStatus(status)) {
    const purgeResult = await handleUnrecoverableError(
      batchItems,
      currentItem.endpoint,
      effectivePayload,
      status,
    );
    await clearClaimedAmbiguousIfNeeded(claimedIds, purgeResult);
    return purgeResult;
  }

  console.error(
    `Sync batch execution failed for endpoint ${currentItem.endpoint}:`,
    err,
  );
  return { syncedCount: 0, shouldContinue: false };
};

const processSyncBatch = async (
  currentItem: SyncQueueItem,
  effectivePayload: unknown,
  batchItems: SyncQueueItem[],
  cache?: SyncCacheContext,
): Promise<BatchResult> => {
  const anchorIdsToClaim = getAnchorIdsToClaim(currentItem, effectivePayload);

  const {
    claimedIds,
    allClaimed,
    token: claimToken,
  } = await anchorClaimService.claimAcrossTabs(anchorIdsToClaim, "sync");
  if (!allClaimed) {
    return { syncedCount: 0, shouldContinue: false };
  }

  try {
    if (
      anchorIdsToClaim.length > 0 &&
      !(await areQueueItemsStillPending(batchItems))
    ) {
      return { syncedCount: 0, shouldContinue: true };
    }

    const targetEndpoint = await normalizeTeamEndpoint(
      currentItem.endpoint,
      effectivePayload,
      currentItem.actionType,
      cache,
    );

    if (targetEndpoint === "UNRESOLVED") {
      return { syncedCount: 0, shouldContinue: false };
    }

    if (claimedIds.length > 0) {
      await anchorClaimService.markAmbiguousAcrossTabs(claimedIds);
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
      await clearClaimedAmbiguousIfNeeded(claimedIds, evaluatedResult);
      return evaluatedResult;
    }

    return { syncedCount: 0, shouldContinue: false };
  } catch (err) {
    return handleBatchExecutionError(
      err,
      currentItem,
      effectivePayload,
      batchItems,
      claimedIds,
    );
  } finally {
    await anchorClaimService.releaseAcrossTabs(claimedIds, claimToken, "sync");
  }
};

/**
 * Processes pending syncQueue items with batching for consecutive identical POST endpoints.
 * Optionally scopes execution to a specific match via targetMatchId.
 */
export const processSyncQueue = async (
  targetMatchId?: string,
): Promise<number> => {
  if (isSyncing || !navigator.onLine || !db?.syncQueue) {
    return 0;
  }

  isSyncing = true;
  let processedCount = 0;

  const lineupTeamCache = new Map<string, string | null>();
  const matchRecordCache = new Map<string, MatchTeamData | null>();
  const cache: SyncCacheContext = { lineupTeamCache, matchRecordCache };

  try {
    let pendingItems = (await db.syncQueue
      .orderBy("id")
      .toArray()) as SyncQueueItem[];

    if (targetMatchId?.trim()) {
      const prefix = `/Matches/${targetMatchId.trim()}/`;
      pendingItems = pendingItems.filter((item) =>
        item.endpoint?.startsWith(prefix),
      );
    }

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
