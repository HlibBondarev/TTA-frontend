import { db, type PlayerPresence, type SyncQueueItem } from "./ttaDatabase";

/**
 * Calculates the next available global sequence number across events, anchors, and presences.
 */
async function getNextSequenceNumber(): Promise<number> {
  const lastEvent = await db.gameevents.orderBy("sequenceNumber").last();
  const lastAnchor = await db.timeanchors.orderBy("sequenceNumber").last();
  const lastPresence = await db.playerpresences
    .orderBy("sequenceNumber")
    .last();

  return (
    Math.max(
      lastEvent?.sequenceNumber ?? 0,
      lastAnchor?.sequenceNumber ?? 0,
      lastPresence?.sequenceNumber ?? 0,
    ) + 1
  );
}

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
  await db.transaction(
    "rw",
    [db.playerpresences, db.gameevents, db.timeanchors, db.syncQueue],
    async () => {
      let currentSeq = await getNextSequenceNumber();

      const newPresences: PlayerPresence[] = playerLineupIds.map(
        (lineupId) => ({
          id: crypto.randomUUID(),
          matchlineupid: lineupId,
          periodnumber: periodNumber,
          timein: startTimestamp,
          timeout: null,
          sequenceNumber: currentSeq++,
          isSynced: 0,
        }),
      );

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

  await db.transaction(
    "rw",
    [db.playerpresences, db.gameevents, db.timeanchors, db.syncQueue],
    async () => {
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

      const nextSeq = await getNextSequenceNumber();
      newPresenceId = crypto.randomUUID();

      const incomingPresence: PlayerPresence = {
        id: newPresenceId,
        matchlineupid: playerInLineupId,
        periodnumber: periodNumber,
        timein: timestamp,
        timeout: null,
        sequenceNumber: nextSeq,
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
    },
  );

  return newPresenceId;
}
