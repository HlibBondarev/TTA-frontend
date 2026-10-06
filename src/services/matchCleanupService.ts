import { db } from "../db/ttaDatabase";

export interface DeleteMatchLocallyOptions {
  preserveDeleteQueueItems?: boolean;
  force?: boolean;
}

const isMatchEndpoint = (endpoint: string | undefined, id: string): boolean =>
  typeof endpoint === "string" &&
  (endpoint === `/Matches/${id}` || endpoint.startsWith(`/Matches/${id}/`));

const deleteMatchEvents = async (lineupIds: Set<string>): Promise<void> => {
  if (lineupIds.size === 0 || !db.gameevents) return;
  const eventsToDelete = await db.gameevents
    .filter((e) => lineupIds.has(e.matchLineupId))
    .toArray();
  const eventIds = eventsToDelete
    .map((e) => e.id)
    .filter((id): id is string => Boolean(id));
  if (eventIds.length > 0) {
    await db.gameevents.bulkDelete(eventIds);
  }
};

const deleteMatchPresences = async (lineupIds: Set<string>): Promise<void> => {
  if (lineupIds.size === 0 || !db.playerpresences) return;
  const presencesToDelete = await db.playerpresences
    .filter((p) => lineupIds.has(p.matchLineupId))
    .toArray();
  const presenceIds = presencesToDelete
    .map((p) => p.id)
    .filter((id): id is string => Boolean(id));
  if (presenceIds.length > 0) {
    await db.playerpresences.bulkDelete(presenceIds);
  }
};

const deleteMatchAnchors = async (normalizedMatchId: string): Promise<void> => {
  if (!db.timeanchors) return;
  const anchorsToDelete = await db.timeanchors
    .where("matchId")
    .equals(normalizedMatchId)
    .toArray();
  const anchorIds = anchorsToDelete
    .map((a) => a.id)
    .filter((id): id is string => Boolean(id));
  if (anchorIds.length > 0) {
    await db.timeanchors.bulkDelete(anchorIds);
  }
};

const deleteMatchSyncQueueItems = async (
  normalizedMatchId: string,
  options?: DeleteMatchLocallyOptions,
): Promise<void> => {
  if (!db.syncQueue) return;
  const queueItems = await db.syncQueue.toArray();
  const queueIdsToDelete = queueItems
    .filter((item) => {
      if (!isMatchEndpoint(item.endpoint, normalizedMatchId)) {
        return false;
      }
      return !(
        options?.preserveDeleteQueueItems && item.actionType === "DELETE"
      );
    })
    .map((item) => item.id)
    .filter((id): id is number => id !== undefined);

  if (queueIdsToDelete.length > 0) {
    await db.syncQueue.bulkDelete(queueIdsToDelete);
  }
};

/**
 * Validates that all records for a match are fully synchronized before allowing local deletion.
 * Throws an error if any unsynced entities or pending sync queue items are found.
 */
const assertMatchCanBeDeleted = async (
  normalizedMatchId: string,
  lineupIds: Set<string>,
): Promise<void> => {
  let unsyncedEvents = 0;
  if (lineupIds.size > 0 && db.gameevents) {
    const events = await db.gameevents
      .filter((e) => lineupIds.has(e.matchLineupId) && e.isSynced === 0)
      .toArray();
    unsyncedEvents = events.length;
  }

  let unsyncedPresences = 0;
  if (lineupIds.size > 0 && db.playerpresences) {
    const presences = await db.playerpresences
      .filter((p) => lineupIds.has(p.matchLineupId) && p.isSynced === 0)
      .toArray();
    unsyncedPresences = presences.length;
  }

  let unsyncedAnchors = 0;
  if (db.timeanchors) {
    const matchAnchors = await db.timeanchors
      .where("matchId")
      .equals(normalizedMatchId)
      .toArray();
    unsyncedAnchors = matchAnchors.filter((a) => a.isSynced === 0).length;
  }

  let pendingQueueItems = 0;
  if (db.syncQueue) {
    const queueItems = await db.syncQueue.toArray();
    pendingQueueItems = queueItems.filter((item) =>
      isMatchEndpoint(item.endpoint, normalizedMatchId),
    ).length;
  }

  if (
    unsyncedEvents > 0 ||
    unsyncedPresences > 0 ||
    unsyncedAnchors > 0 ||
    pendingQueueItems > 0
  ) {
    throw new Error(
      `Cannot delete match ${
        normalizedMatchId
      } locally: synchronization is incomplete. Unsynced items exist (events: ${
        unsyncedEvents
      }, anchors: ${unsyncedAnchors}, presences: ${unsyncedPresences}, queue: ${
        pendingQueueItems
      }).`,
    );
  }
};

/**
 * Deletes all local IndexedDB records associated with a specific match ID.
 * Aborts cleanup if unsynced entities or pending sync queue items exist, unless force option is true.
 */
export const deleteMatchLocally = async (
  matchId: string,
  options?: DeleteMatchLocallyOptions,
): Promise<void> => {
  if (!matchId?.trim()) {
    throw new Error("Match ID is required for local cleanup.");
  }

  const normalizedMatchId = matchId.trim();

  await db.transaction(
    "rw",
    [
      db.matches,
      db.matchlineups,
      db.gameevents,
      db.timeanchors,
      db.playerpresences,
      db.syncQueue,
    ],
    async () => {
      const lineups = await db.matchlineups
        .where("matchId")
        .equals(normalizedMatchId)
        .toArray();

      const lineupIds = new Set(lineups.map((l) => l.id));

      if (!options?.force) {
        await assertMatchCanBeDeleted(normalizedMatchId, lineupIds);
      }

      await deleteMatchEvents(lineupIds);
      await deleteMatchPresences(lineupIds);
      await deleteMatchAnchors(normalizedMatchId);

      if (db.matchlineups && lineupIds.size > 0) {
        await db.matchlineups.bulkDelete(Array.from(lineupIds));
      }

      if (db.matches) {
        await db.matches.delete(normalizedMatchId);
      }

      await deleteMatchSyncQueueItems(normalizedMatchId, options);
    },
  );
};

/**
 * Clears all local match-related data across all Dexie tables.
 */
export const clearAllLocalMatchData = async (): Promise<void> => {
  await db.transaction(
    "rw",
    [
      db.matches,
      db.matchlineups,
      db.gameevents,
      db.timeanchors,
      db.playerpresences,
      db.syncQueue,
    ],
    async () => {
      await Promise.all([
        db.gameevents?.clear(),
        db.playerpresences?.clear(),
        db.timeanchors?.clear(),
        db.matchlineups?.clear(),
        db.matches?.clear(),
      ]);

      if (db.syncQueue) {
        const queueItems = await db.syncQueue.toArray();
        const matchQueueIds = queueItems
          .filter((item) => item.endpoint?.includes("/Matches/"))
          .map((item) => item.id)
          .filter((id): id is number => id !== undefined);

        if (matchQueueIds.length > 0) {
          await db.syncQueue.bulkDelete(matchQueueIds);
        }
      }
    },
  );
};
