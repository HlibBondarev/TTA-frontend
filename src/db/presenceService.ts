import { db, type PlayerPresence, type SyncQueueItem } from "./ttaDatabase";
import { getNextSequenceNumber } from "./eventService";

/**
 * Bulk initializes active player presence at the exact moment the period starts.
 * Uses the timestamp provided by the match lifecycle timer.
 * Align sync queue payload with backend InitializePresenceRequest DTO contract.
 */
export async function initializePeriodPresenceTx(
  matchId: string,
  periodNumber: number,
  playerLineupIds: string[],
  startTimestamp: string,
): Promise<void> {
  await db.transaction(
    "rw",
    [db.playerpresences, db.gameevents, db.timeanchors, db.syncQueue],
    async () => {
      let currentSeq = await getNextSequenceNumber();

      const newPresences: PlayerPresence[] = playerLineupIds.map(
        (lineupId) => ({
          id: crypto.randomUUID(),
          matchLineupId: lineupId,
          periodNumber: periodNumber,
          timeIn: startTimestamp,
          timeOut: null,
          sequenceNumber: currentSeq++,
          isSynced: 0,
        }),
      );

      await db.playerpresences.bulkAdd(newPresences);

      const payload = JSON.stringify({
        periodNumber,
        timeIn: startTimestamp,
        presenceItems: newPresences.map((p) => ({
          id: p.id,
          matchLineupId: p.matchLineupId,
        })),
      });

      const syncItem: SyncQueueItem = {
        actionType: "POST",
        endpoint: `/Matches/${matchId}/presence/initialize`,
        payload,
        createdAt: startTimestamp,
      };

      await db.syncQueue.add(syncItem);
    },
  );
}

/**
 * Atomically closes all active player presence sessions when the period ends.
 * Uses the timestamp provided by the match lifecycle timer.
 * Enqueues the period-end synchronization payload in db.syncQueue.
 */
export async function terminatePeriodPresenceTx(
  matchId: string,
  periodNumber: number,
  playerLineupIds: string[],
  endTimestamp: string,
): Promise<void> {
  await db.transaction("rw", [db.playerpresences, db.syncQueue], async () => {
    // 1. Find all active presences (where timeOut is null) for this period
    const activePresences = await db.playerpresences
      .where("periodNumber")
      .equals(periodNumber)
      .filter(
        (p) => p.timeOut === null && playerLineupIds.includes(p.matchLineupId),
      )
      .toArray();

    // 2. Update each active player session with the end timestamp
    for (const presence of activePresences) {
      await db.playerpresences.update(presence.id, {
        timeOut: endTimestamp,
        isSynced: 0,
      });
    }

    // 3. Enqueue the period-end synchronization payload matching TerminatePresenceRequest DTO
    const payload = JSON.stringify({
      periodNumber,
      playerLineupIds,
      timeOut: endTimestamp,
    });

    const syncItem: SyncQueueItem = {
      actionType: "PUT",
      endpoint: `/Matches/${matchId}/presence/terminate`,
      payload,
      createdAt: endTimestamp,
    };

    await db.syncQueue.add(syncItem);
  });
}

/**
 * Executes an atomic player substitution.
 * Throws an error if no active presence is found for the outgoing player.
 * Aligned with the backend SubstitutePlayerRequest DTO contract.
 */
export async function substitutePlayerTx(
  matchId: string,
  periodNumber: number,
  playerOutLineupId: string,
  playerInLineupId: string,
): Promise<string> {
  let newPresenceId = "";

  await db.transaction(
    "rw",
    [db.playerpresences, db.gameevents, db.timeanchors, db.syncQueue],
    async () => {
      const timestamp = new Date().toISOString();

      const activePresence = await db.playerpresences
        .where({ matchLineupId: playerOutLineupId, periodNumber })
        .filter((p) => p.timeOut === null)
        .first();

      if (activePresence) {
        await db.playerpresences.update(activePresence.id, {
          timeOut: timestamp,
          isSynced: 0,
        });
      } else {
        throw new Error("No active presence found for the outgoing player.");
      }

      const nextSeq = await getNextSequenceNumber();
      newPresenceId = crypto.randomUUID();

      const incomingPresence: PlayerPresence = {
        id: newPresenceId,
        matchLineupId: playerInLineupId,
        periodNumber: periodNumber,
        timeIn: timestamp,
        timeOut: null,
        sequenceNumber: nextSeq,
        isSynced: 0,
      };

      await db.playerpresences.add(incomingPresence);

      const payload = JSON.stringify({
        periodNumber,
        playerOutLineupId,
        playerInLineupId,
        incomingPresenceId: newPresenceId,
        substitutionTime: timestamp,
      });

      const syncItem: SyncQueueItem = {
        actionType: "POST",
        endpoint: `/Matches/${matchId}/substitutions`,
        payload,
        createdAt: timestamp,
      };

      await db.syncQueue.add(syncItem);
    },
  );

  return newPresenceId;
}
