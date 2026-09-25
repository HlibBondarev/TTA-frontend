import { apiClient } from "../api/client";
import { db, type TimeAnchor } from "../db/ttaDatabase";
import { processSyncQueue } from "./syncService";
import { getNextSequenceNumber } from "../db/eventService";
import { matchLockService } from "./matchLockService";

export interface FinalizeMatchParams {
  matchId: string;
  activeTeamId: string;
  homeScore: number;
  guestScore: number;
  temperature: number | null;
  userId?: string;
}

/**
 * Auto-closes any currently open period anchors and active player presences in IndexedDB
 * prior to flushing sync queue during finalization.
 */
const autoCloseOpenPeriodAndPresences = async (
  matchId: string,
): Promise<void> => {
  await db.transaction(
    "rw",
    [
      db.timeanchors,
      db.playerpresences,
      db.matchlineups,
      db.syncQueue,
      db.gameevents,
    ],
    async () => {
      const timestamp = new Date().toISOString();

      const anchors = await db.timeanchors
        .where("matchId")
        .equals(matchId)
        .toArray();

      const sortedAnchors = [...anchors].sort((a, b) => {
        if (a.sequenceNumber !== b.sequenceNumber) {
          return a.sequenceNumber - b.sequenceNumber;
        }
        return a.timestamp.localeCompare(b.timestamp);
      });

      const lastAnchor = sortedAnchors.at(-1) ?? null;

      const isPeriodActive =
        lastAnchor !== null &&
        (lastAnchor.type === 0 ||
          lastAnchor.type === 2 ||
          lastAnchor.type === 3);

      if (isPeriodActive) {
        const periodNumber = lastAnchor.periodNumber;

        // 1. If currently inside stoppage, close stoppage anchor first
        if (lastAnchor.type === 2) {
          const stoppageSeq = await getNextSequenceNumber();
          const stoppageEndAnchor: TimeAnchor = {
            id: crypto.randomUUID(),
            matchId,
            periodNumber,
            type: 3, // StoppageEnd
            timestamp,
            sequenceNumber: stoppageSeq,
            isSynced: 0,
          };
          await db.timeanchors.add(stoppageEndAnchor);
          await db.syncQueue.add({
            actionType: "POST",
            endpoint: `/Matches/${matchId}/anchors`,
            payload: JSON.stringify([
              {
                id: stoppageEndAnchor.id,
                periodNumber,
                type: 3,
                timestamp,
              },
            ]),
            createdAt: timestamp,
          });
        }

        // 2. Add PeriodEnd anchor
        const periodEndSeq = await getNextSequenceNumber();
        const periodEndAnchor: TimeAnchor = {
          id: crypto.randomUUID(),
          matchId,
          periodNumber,
          type: 1, // PeriodEnd
          timestamp,
          sequenceNumber: periodEndSeq,
          isSynced: 0,
        };
        await db.timeanchors.add(periodEndAnchor);
        await db.syncQueue.add({
          actionType: "POST",
          endpoint: `/Matches/${matchId}/anchors`,
          payload: JSON.stringify([
            {
              id: periodEndAnchor.id,
              periodNumber,
              type: 1,
              timestamp,
            },
          ]),
          createdAt: timestamp,
        });

        // 3. Auto-close open player presences for active period
        const lineups = await db.matchlineups
          .where("matchId")
          .equals(matchId)
          .toArray();
        const lineupIds = new Set(lineups.map((l) => l.id));

        const activePresences = await db.playerpresences
          .where("periodNumber")
          .equals(periodNumber)
          .filter((p) => p.timeOut === null && lineupIds.has(p.matchLineupId))
          .toArray();

        if (activePresences.length > 0) {
          const activeLineupIds = activePresences.map((p) => p.matchLineupId);
          for (const p of activePresences) {
            await db.playerpresences.update(p.id, {
              timeOut: timestamp,
              isSynced: 0,
            });
          }

          await db.syncQueue.add({
            actionType: "PUT",
            endpoint: `/Matches/${matchId}/presence/terminate`,
            payload: JSON.stringify({
              periodNumber,
              timeOut: timestamp,
              playerLineupIds: activeLineupIds,
            }),
            createdAt: timestamp,
          });
        }
      }
    },
  );
};

export const matchFinalizationService = {
  /**
   * Sequentially completes match recording by syncing offline queue,
   * sending match results, normalizing event times, and purging local DB.
   */
  async finalizeMatch(params: FinalizeMatchParams): Promise<void> {
    const {
      matchId,
      activeTeamId,
      homeScore,
      guestScore,
      temperature,
      userId,
    } = params;

    const normalizedMatchId = matchId?.trim();
    const normalizedUserId = userId?.trim();

    if (!normalizedMatchId || !activeTeamId?.trim()) {
      throw new Error(
        "Missing required matchId or activeTeamId for match finalization.",
      );
    }

    if (matchLockService.isMatchLocked(normalizedMatchId)) {
      throw new Error(
        `Cannot finalize match ${
          normalizedMatchId
        }: match is currently locked for finalization.`,
      );
    }

    matchLockService.lockMatchForFinalization(normalizedMatchId);

    try {
      if (normalizedUserId) {
        const match = await db.matches.get(normalizedMatchId);
        if (match?.userId && match.userId !== normalizedUserId) {
          throw new Error(
            `Match ${normalizedMatchId} belongs to another user.`,
          );
        }
      }

      // Step 0: Auto-close any active open period or player presence sessions in IndexedDB
      await autoCloseOpenPeriodAndPresences(normalizedMatchId);

      // Step 1: Flush all pending offline sync queue items to backend
      await processSyncQueue();

      const exactEndpoint = `/Matches/${normalizedMatchId}`;
      const endpointPrefix = `/Matches/${normalizedMatchId}/`;

      const remainingQueueCount = await db.syncQueue
        .filter(
          (item) =>
            typeof item.endpoint === "string" &&
            (item.endpoint === exactEndpoint ||
              item.endpoint.startsWith(endpointPrefix)),
        )
        .count();

      if (remainingQueueCount > 0) {
        throw new Error(
          "Cannot finalize match: offline sync queue is not empty. Please ensure all pending actions are synchronized.",
        );
      }

      // Step 2: Record match result scores and weather/water temperature
      await apiClient.put(`/Matches/${normalizedMatchId}/result`, {
        homeScore,
        guestScore,
        temperature,
      });

      // Step 3: Trigger event time normalization for the active tracking team
      await apiClient.put(
        `/Matches/${normalizedMatchId}/teams/${activeTeamId}/events/normalize`,
      );

      // Step 4: Conditionally purge local IndexedDB entities scoped STRICTLY to finalized matchId
      await db.transaction(
        "rw",
        [
          db.gameevents,
          db.timeanchors,
          db.playerpresences,
          db.matchlineups,
          db.syncQueue,
          db.matches,
        ],
        async () => {
          const lineups = await db.matchlineups
            .where("matchId")
            .equals(normalizedMatchId)
            .toArray();
          const lineupIds = lineups.map((l) => l.id);

          if (lineupIds.length > 0) {
            await db.gameevents
              .where("matchLineupId")
              .anyOf(lineupIds)
              .delete();
            await db.playerpresences
              .where("matchLineupId")
              .anyOf(lineupIds)
              .delete();
          }

          await db.timeanchors
            .where("matchId")
            .equals(normalizedMatchId)
            .delete();
          await db.matchlineups
            .where("matchId")
            .equals(normalizedMatchId)
            .delete();
          await db.matches.delete(normalizedMatchId);

          const matchSyncKeys = await db.syncQueue
            .filter(
              (item) =>
                typeof item.endpoint === "string" &&
                (item.endpoint === exactEndpoint ||
                  item.endpoint.startsWith(endpointPrefix)),
            )
            .primaryKeys();

          if (matchSyncKeys.length > 0) {
            await db.syncQueue.bulkDelete(matchSyncKeys as number[]);
          }
        },
      );
    } finally {
      matchLockService.unlockMatchForFinalization(normalizedMatchId);
    }
  },
};
