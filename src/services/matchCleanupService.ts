import { db } from "../db/ttaDatabase";

export interface DeleteMatchLocallyOptions {
  preserveDeleteQueueItems?: boolean;
}

/**
 * Deletes all local IndexedDB records associated with a specific match ID.
 * This includes game events, time anchors, player presences, match lineups, match metadata,
 * and any pending sync queue items referencing the match.
 */
export const deleteMatchLocally = async (
  matchId: string,
  options?: DeleteMatchLocallyOptions,
): Promise<void> => {
  if (!matchId || !matchId.trim()) {
    throw new Error("Match ID is required for local cleanup.");
  }

  const normalizedMatchId = matchId.trim();

  const lineups = await db.matchlineups
    .where("matchId")
    .equals(normalizedMatchId)
    .toArray();

  const lineupIds = new Set(lineups.map((l) => l.id));

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
      // 1. Delete Game Events associated with match lineups
      if (lineupIds.size > 0 && db.gameevents) {
        const eventsToDelete = await db.gameevents
          .filter((e) => lineupIds.has(e.matchLineupId))
          .toArray();
        const eventIds = eventsToDelete
          .map((e) => e.id)
          .filter((id): id is string => Boolean(id));
        if (eventIds.length > 0) {
          await db.gameevents.bulkDelete(eventIds);
        }
      }

      // 2. Delete Player Presences associated with match lineups
      if (lineupIds.size > 0 && db.playerpresences) {
        const presencesToDelete = await db.playerpresences
          .filter((p) => lineupIds.has(p.matchLineupId))
          .toArray();
        const presenceIds = presencesToDelete
          .map((p) => p.id)
          .filter((id): id is string => Boolean(id));
        if (presenceIds.length > 0) {
          await db.playerpresences.bulkDelete(presenceIds);
        }
      }

      // 3. Delete Time Anchors for the match
      if (db.timeanchors) {
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
      }

      // 4. Delete Lineups for the match
      if (db.matchlineups) {
        const lineupArray = Array.from(lineupIds);
        if (lineupArray.length > 0) {
          await db.matchlineups.bulkDelete(lineupArray);
        }
      }

      // 5. Delete Match Record
      if (db.matches) {
        await db.matches.delete(normalizedMatchId);
      }

      // 6. Delete Sync Queue items related to this match
      if (db.syncQueue) {
        const queueItems = await db.syncQueue.toArray();
        const queueIdsToDelete = queueItems
          .filter((item) => {
            if (!item.endpoint?.includes(`/Matches/${normalizedMatchId}`)) {
              return false;
            }
            if (
              options?.preserveDeleteQueueItems &&
              item.actionType === "DELETE"
            ) {
              return false;
            }
            return true;
          })
          .map((item) => item.id)
          .filter((id): id is number => id !== undefined);

        if (queueIdsToDelete.length > 0) {
          await db.syncQueue.bulkDelete(queueIdsToDelete);
        }
      }
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
