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

/**
 * Determines whether an HTTP operation endpoint supports array payload batching.
 */
const isBatchableEndpoint = (actionType: string, endpoint: string): boolean => {
  if (actionType !== "POST") return false;
  return endpoint.endsWith("/events") || endpoint.endsWith("/anchors");
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

  try {
    const pendingItems = await db.syncQueue.orderBy("id").toArray();
    let i = 0;

    while (i < pendingItems.length) {
      if (!navigator.onLine) break;

      const currentItem = pendingItems[i];
      let currentPayload: unknown;

      try {
        currentPayload = JSON.parse(currentItem.payload);
      } catch (err) {
        console.error(
          `Invalid JSON payload in syncQueue item ${currentItem.id}:`,
          err,
        );
        break;
      }

      const batchable = isBatchableEndpoint(
        currentItem.actionType,
        currentItem.endpoint,
      );
      const batchItems = [currentItem];
      let effectivePayload: unknown = currentPayload;

      if (batchable) {
        const aggregatedArray: unknown[] = Array.isArray(currentPayload)
          ? [...currentPayload]
          : [currentPayload];

        let j = i + 1;
        while (j < pendingItems.length) {
          const nextItem = pendingItems[j];
          if (
            nextItem.actionType === currentItem.actionType &&
            nextItem.endpoint === currentItem.endpoint
          ) {
            try {
              const nextPayload = JSON.parse(nextItem.payload);
              if (Array.isArray(nextPayload)) {
                aggregatedArray.push(...nextPayload);
              } else {
                aggregatedArray.push(nextPayload);
              }
              batchItems.push(nextItem);
              j++;
            } catch {
              break;
            }
          } else {
            break;
          }
        }
        effectivePayload = aggregatedArray;
      }

      try {
        let response: { status?: number } | undefined;

        if (currentItem.actionType === "POST") {
          response = await apiClient.post(
            currentItem.endpoint,
            effectivePayload,
          );
        } else if (currentItem.actionType === "PUT") {
          response = await apiClient.put(
            currentItem.endpoint,
            effectivePayload,
          );
        } else if (currentItem.actionType === "DELETE") {
          response = await apiClient.delete(currentItem.endpoint);
        } else {
          throw new Error(
            `Unsupported sync actionType: ${currentItem.actionType}`,
          );
        }

        if (response?.status === 200 || response?.status === 201) {
          for (const item of batchItems) {
            const itemPayload = JSON.parse(item.payload);
            await markEntitiesSynced(item.endpoint, itemPayload);
            if (item.id !== undefined) {
              await db.syncQueue.delete(item.id);
              processedCount++;
            }
          }
          i += batchItems.length;
        } else {
          break;
        }
      } catch (err) {
        console.error(
          `Sync batch execution failed for endpoint ${currentItem.endpoint}:`,
          err,
        );
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
