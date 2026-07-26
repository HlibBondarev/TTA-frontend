import { apiClient } from "../api/client";
import { db } from "../db/ttaDatabase";

let isSyncing = false;

/**
 * Updates local IndexedDB player presences to isSynced = 1 upon successful server sync.
 * Strictly adheres to the rule: presences are marked synced only if both timeIn and timeOut are set
 * and match the lineup IDs involved in the synced payload.
 */
const markPresencesSynced = async (
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  const isPresenceEndpoint =
    endpoint.includes("/presence") || endpoint.includes("/substitutions");

  if (
    !isPresenceEndpoint ||
    !payload ||
    typeof payload.periodNumber !== "number" ||
    !db?.playerpresences
  ) {
    return;
  }

  const affectedLineupIds = new Set<string>(
    Array.isArray(payload.playerLineupIds)
      ? (payload.playerLineupIds as string[])
      : ([payload.playerOutLineupId, payload.playerInLineupId].filter(
          Boolean,
        ) as string[]),
  );

  await db.playerpresences
    .where("periodNumber")
    .equals(payload.periodNumber)
    .filter(
      (p) =>
        affectedLineupIds.has(p.matchLineupId) &&
        p.timeIn !== null &&
        p.timeOut !== null,
    )
    .modify({ isSynced: 1 });
};

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
        }

        // Update local IndexedDB records according to synchronization rules
        await markPresencesSynced(item.endpoint, payload);

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
