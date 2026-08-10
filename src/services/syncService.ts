import { apiClient } from "../api/client";
import { db } from "../db/ttaDatabase";

let isSyncing = false;

interface PresenceItemPayload {
  id: string;
  matchLineupId: string;
}

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

export const processSyncQueue = async (): Promise<number> => {
  if (isSyncing || !navigator.onLine || !db?.syncQueue) {
    return 0;
  }

  isSyncing = true;
  let processedCount = 0;

  try {
    const pendingItems = await db.syncQueue.orderBy("id").toArray();

    for (const item of pendingItems) {
      if (!navigator.onLine) break;

      try {
        const payload = JSON.parse(item.payload);

        if (item.actionType === "POST") {
          await apiClient.post(item.endpoint, payload);
        } else if (item.actionType === "PUT") {
          await apiClient.put(item.endpoint, payload);
        } else if (item.actionType === "DELETE") {
          await apiClient.delete(item.endpoint);
        } else {
          throw new Error(`Unsupported sync actionType: ${item.actionType}`);
        }

        // Update local IndexedDB records according to entity-specific synchronization rules
        await markEntitiesSynced(item.endpoint, payload);

        if (item.id !== undefined) {
          await db.syncQueue.delete(item.id);
          processedCount++;
        }
      } catch (err) {
        console.error(`Sync item ${item.id} execution failed:`, err);
        break;
      }
    }
  } finally {
    isSyncing = false;
  }

  return processedCount;
};

export const initSyncEngine = () => {
  window.addEventListener("online", () => {
    processSyncQueue();
  });
};
