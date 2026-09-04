import { apiClient } from "../api/client";
import { db, type TimeAnchor } from "../db/ttaDatabase";
import { processSyncQueue } from "./syncService";
import { userMatchService } from "./userMatchService";
import { getNextSequenceNumber } from "../db/eventService";

export interface FinalizeMatchParams {
  matchId: string;
  activeTeamId: string;
  homeScore: number;
  guestScore: number;
  temperature: number | null;
}

/**
 * Auto-closes any currently open period anchors and active player presences in IndexedDB
 * prior to flushing sync queue during finalization.
 */
const autoCloseOpenPeriodAndPresences = async (
  matchId: string,
): Promise<void> => {
  if (!db?.timeanchors || !db?.playerpresences) return;

  await db.transaction(
    "rw",
    [
      db.timeanchors,
      db.playerpresences,
      db.matchlineups,
      db.syncQueue,
      db.gameevents, // Included gameevents to grant read permission for getNextSequenceNumber()
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
   * sending match results, linking user tracking, normalizing event times, and purging local DB.
   */
  async finalizeMatch(params: FinalizeMatchParams): Promise<void> {
    const { matchId, activeTeamId, homeScore, guestScore, temperature } =
      params;

    if (!matchId || !activeTeamId) {
      throw new Error(
        "Missing required matchId or activeTeamId for match finalization.",
      );
    }

    // Step 0: Auto-close any active open period or player presence sessions in IndexedDB
    await autoCloseOpenPeriodAndPresences(matchId);

    // Step 1: Flush all pending offline sync queue items to backend
    await processSyncQueue();

    const remainingQueueCount = await db.syncQueue.count();
    if (remainingQueueCount > 0) {
      throw new Error(
        "Cannot finalize match: offline sync queue is not empty. Please ensure all pending actions are synchronized.",
      );
    }

    // Step 2: Record match result scores and weather/water temperature
    await apiClient.put(`/Matches/${matchId}/result`, {
      homeScore,
      guestScore,
      temperature,
    });

    // Step 3: Link current user to this match context upon successful result record
    try {
      await userMatchService.catchMatch(matchId, activeTeamId);
    } catch (catchErr) {
      const errMessage =
        catchErr instanceof Error ? catchErr.message : String(catchErr);
      const isAlreadyExists =
        errMessage.includes("409") ||
        errMessage.toLowerCase().includes("conflict") ||
        errMessage.toLowerCase().includes("already exists");

      if (isAlreadyExists) {
        console.warn(
          "User match catch link already exists (idempotent step):",
          catchErr,
        );
      } else {
        throw catchErr;
      }
    }

    // Step 4: Trigger event time normalization for the active tracking team
    await apiClient.put(
      `/Matches/${matchId}/teams/${activeTeamId}/events/normalize`,
    );

    // Step 5: Conditionally purge local IndexedDB tables ONLY after 100% success of steps 1-4
    await db.transaction(
      "rw",
      [
        db.gameevents,
        db.timeanchors,
        db.playerpresences,
        db.matchlineups,
        db.syncQueue,
        db.matches,
        db.teams,
        db.players,
        db.playerrosters,
        db.tournaments,
        db.sportconfigurations,
        db.eventdefinitions,
        db.sports,
      ],
      async () => {
        await Promise.all([
          db.gameevents.clear(),
          db.timeanchors.clear(),
          db.playerpresences.clear(),
          db.matchlineups.clear(),
          db.syncQueue.clear(),
          db.matches.clear(),
          db.teams.clear(),
          db.players.clear(),
          db.playerrosters.clear(),
          db.tournaments.clear(),
          db.sportconfigurations.clear(),
          db.eventdefinitions.clear(),
          db.sports.clear(),
        ]);
      },
    );
  },
};
