import { db, type PlayerPresence, type SyncQueueItem } from "./ttaDatabase";

/**
 * Bulk initializes active player presence at the exact moment the period starts.
 * Uses the timestamp provided by the match lifecycle timer.
 */
export async function initializePeriodPresenceTx(
  matchId: string,
  periodNumber: number,
  playerLineupIds: string[],
  startTimestamp: string,
): Promise<void> {
  await db.transaction("rw", [db.playerpresences, db.syncQueue], async () => {
    const newPresences: PlayerPresence[] = playerLineupIds.map((lineupId) => ({
      id: crypto.randomUUID(),
      matchlineupid: lineupId,
      periodnumber: periodNumber,
      timein: startTimestamp,
      timeout: null,
      sequenceNumber: Date.now(),
      isSynced: 0,
    }));

    await db.playerpresences.bulkAdd(newPresences);

    const payload = JSON.stringify({
      periodNumber,
      playerLineupIds,
    });

    const syncItem: SyncQueueItem = {
      actionType: "POST",
      endpoint: `matches/${matchId}/presence/initialize`,
      payload,
      createdAt: startTimestamp,
    };

    await db.syncQueue.add(syncItem);
  });
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
    // 1. Find all active presences (where timeout is null) for this period
    const activePresences = await db.playerpresences
      .where("periodnumber")
      .equals(periodNumber)
      .filter(
        (p) => p.timeout === null && playerLineupIds.includes(p.matchlineupid),
      )
      .toArray();

    // 2. Update each active player session with the end timestamp
    for (const presence of activePresences) {
      await db.playerpresences.update(presence.id, {
        timeout: endTimestamp,
        isSynced: 0,
      });
    }

    // 3. Enqueue the period-end synchronization payload
    const payload = JSON.stringify({
      periodNumber,
      playerLineupIds,
    });

    const syncItem: SyncQueueItem = {
      actionType: "PUT",
      endpoint: `matches/${matchId}/presence/terminate`,
      payload,
      createdAt: endTimestamp,
    };

    await db.syncQueue.add(syncItem);
  });
}

/**
 * Executes an atomic player substitution.
 * Throws an error if no active presence is found for the outgoing player.
 */
export async function substitutePlayerTx(
  matchId: string,
  periodNumber: number,
  playerOutLineupId: string,
  playerInLineupId: string,
): Promise<string> {
  let newPresenceId = "";

  await db.transaction("rw", [db.playerpresences, db.syncQueue], async () => {
    const timestamp = new Date().toISOString();

    const activePresence = await db.playerpresences
      .where({ matchlineupid: playerOutLineupId, periodnumber: periodNumber })
      .filter((p) => p.timeout === null)
      .first();

    if (activePresence) {
      await db.playerpresences.update(activePresence.id, {
        timeout: timestamp,
        isSynced: 0,
      });
    } else {
      throw new Error("No active presence found for the outgoing player.");
    }

    newPresenceId = crypto.randomUUID();
    const incomingPresence: PlayerPresence = {
      id: newPresenceId,
      matchlineupid: playerInLineupId,
      periodnumber: periodNumber,
      timein: timestamp,
      timeout: null,
      sequenceNumber: Date.now(),
      isSynced: 0,
    };

    await db.playerpresences.add(incomingPresence);

    const payload = JSON.stringify({
      periodNumber,
      playerOutLineupId,
      playerInLineupId,
    });

    const syncItem: SyncQueueItem = {
      actionType: "POST",
      endpoint: `matches/${matchId}/substitutions`,
      payload,
      createdAt: timestamp,
    };

    await db.syncQueue.add(syncItem);
  });

  return newPresenceId;
}
