import { db, type PlayerPresence, type SyncQueueItem } from "./ttaDatabase";
import { getNextSequenceNumber } from "./eventService";
import type { components } from "../api/types";

type InitializePresenceRequest =
  components["schemas"]["InitializePresenceRequest"];
type TerminatePresenceRequest =
  components["schemas"]["TerminatePresenceRequest"];
type SubstitutePlayerRequest =
  components["schemas"]["SubstitutePlayerRequest"];

const resolveEffectiveTimeOut = (
  timeIn: string | undefined,
  candidateTimeOut: string,
): string => {
  if (!timeIn) return candidateTimeOut;
  const parsedIn = Date.parse(timeIn);
  const parsedOut = Date.parse(candidateTimeOut);
  if (!Number.isNaN(parsedIn) && !Number.isNaN(parsedOut)) {
    return parsedOut >= parsedIn ? candidateTimeOut : timeIn;
  }
  return candidateTimeOut.localeCompare(timeIn) >= 0
    ? candidateTimeOut
    : timeIn;
};

const findOpenPresenceForPlayer = async (
  matchLineupId: string,
  periodNumber?: number,
): Promise<PlayerPresence | undefined> => {
  if (typeof db.playerpresences?.where !== "function") {
    return undefined;
  }

  if (typeof periodNumber === "number") {
    const query = db.playerpresences.where({ matchLineupId, periodNumber });
    if (typeof query?.filter === "function") {
      return query.filter((p) => p.timeOut === null).first();
    }
  }

  const byLineup = db.playerpresences.where("matchLineupId");
  if (typeof byLineup?.equals === "function") {
    const equalsChain = byLineup.equals(matchLineupId);
    if (typeof equalsChain?.filter === "function") {
      return equalsChain
        .filter(
          (p) =>
            p.timeOut === null &&
            (periodNumber === undefined || p.periodNumber === periodNumber),
        )
        .first();
    }
  }

  return undefined;
};

/**
 * Atomically closes an open presence for a single player inside an active Dexie transaction
 * and enqueues a single-player PUT /presence/terminate syncQueue item.
 * Guarantees timeOut >= openPresence.timeIn.
 */
export async function terminateSinglePlayerPresenceInTx(
  matchId: string,
  matchLineupId: string,
  exitTimestamp: string,
  periodNumber?: number,
): Promise<boolean> {
  const openPresence = await findOpenPresenceForPlayer(
    matchLineupId,
    periodNumber,
  );
  if (!openPresence) {
    return false;
  }

  const effectiveTimeOut = resolveEffectiveTimeOut(
    openPresence.timeIn,
    exitTimestamp,
  );
  const effectivePeriod = openPresence.periodNumber;

  await db.playerpresences.update(openPresence.id, {
    timeOut: effectiveTimeOut,
    isSynced: 0,
  });

  const terminatePayload: TerminatePresenceRequest = {
    periodNumber: effectivePeriod,
    playerLineupIds: [matchLineupId],
    timeOut: effectiveTimeOut,
  };

  const syncItem: SyncQueueItem = {
    actionType: "PUT",
    endpoint: `/Matches/${matchId}/presence/terminate`,
    payload: JSON.stringify(terminatePayload),
    createdAt: effectiveTimeOut,
  };

  await db.syncQueue.add(syncItem);
  return true;
}

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

      const requestDto: InitializePresenceRequest = {
        periodNumber,
        timeIn: startTimestamp,
        presenceItems: newPresences.map((p) => ({
          id: p.id,
          matchLineupId: p.matchLineupId,
        })),
      };

      const syncItem: SyncQueueItem = {
        actionType: "POST",
        endpoint: `/Matches/${matchId}/presence/initialize`,
        payload: JSON.stringify(requestDto),
        createdAt: startTimestamp,
      };

      await db.syncQueue.add(syncItem);
    },
  );
}

const resolveMatchLineupIdSet = async (
  matchId: string,
  fallbackLineupIds: string[],
): Promise<Set<string>> => {
  if (typeof db.matchlineups?.where === "function") {
    const equalsChain = db.matchlineups.where("matchId")?.equals?.(matchId);
    if (typeof equalsChain?.toArray === "function") {
      const matchLineups = await equalsChain.toArray();
      if (Array.isArray(matchLineups) && matchLineups.length > 0) {
        return new Set(matchLineups.map((l) => l.id));
      }
    }
  }
  return new Set(fallbackLineupIds);
};

/**
 * Atomically closes all active player presence sessions when the period ends.
 * Uses the timestamp provided by the match lifecycle timer.
 * Enqueues the period-end synchronization payload in db.syncQueue using only
 * the presences that were actually open in Dexie at period end.
 */
export async function terminatePeriodPresenceTx(
  matchId: string,
  periodNumber: number,
  playerLineupIds: string[],
  endTimestamp: string,
): Promise<void> {
  const tables = [
    db.playerpresences,
    db.syncQueue,
    ...(db.matchlineups ? [db.matchlineups] : []),
  ];

  await db.transaction("rw", tables, async () => {
    const candidateLineupIds = await resolveMatchLineupIdSet(
      matchId,
      playerLineupIds,
    );

    const activePresences = await db.playerpresences
      .where("periodNumber")
      .equals(periodNumber)
      .filter(
        (p) =>
          p.timeOut === null && candidateLineupIds.has(p.matchLineupId),
      )
      .toArray();

    await Promise.all(
      activePresences.map((presence) =>
        db.playerpresences.update(presence.id, {
          timeOut: endTimestamp,
          isSynced: 0,
        }),
      ),
    );

    const closedLineupIds = Array.from(
      new Set(activePresences.map((p) => p.matchLineupId)),
    );

    if (closedLineupIds.length === 0) {
      return;
    }

    const requestDto: TerminatePresenceRequest = {
      periodNumber,
      playerLineupIds: closedLineupIds,
      timeOut: endTimestamp,
    };

    const syncItem: SyncQueueItem = {
      actionType: "PUT",
      endpoint: `/Matches/${matchId}/presence/terminate`,
      payload: JSON.stringify(requestDto),
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

      const requestDto: SubstitutePlayerRequest = {
        periodNumber,
        playerOutLineupId,
        playerInLineupId,
        incomingPresenceId: newPresenceId,
        substitutionTime: timestamp,
      };

      const syncItem: SyncQueueItem = {
        actionType: "POST",
        endpoint: `/Matches/${matchId}/substitutions`,
        payload: JSON.stringify(requestDto),
        createdAt: timestamp,
      };

      await db.syncQueue.add(syncItem);
    },
  );

  return newPresenceId;
}

/**
 * Atomically enters an eligible bench player directly into an active period
 * while the team is shorthanded (activeCount < maxAllowedActive), without an
 * outgoing player. Reuses the backend InitializePresenceRequest DTO contract.
 */
export async function enterShorthandedPlayerTx(
  matchId: string,
  periodNumber: number,
  playerInLineupId: string,
  entryTimestamp = new Date().toISOString(),
): Promise<string> {
  let newPresenceId = "";

  await db.transaction(
    "rw",
    [db.playerpresences, db.gameevents, db.timeanchors, db.syncQueue],
    async () => {
      const existingOpenPresence = await findOpenPresenceForPlayer(
        playerInLineupId,
        periodNumber,
      );
      if (existingOpenPresence) {
        throw new Error("Player already has an active presence in this period.");
      }

      const nextSeq = await getNextSequenceNumber();
      newPresenceId = crypto.randomUUID();

      const incomingPresence: PlayerPresence = {
        id: newPresenceId,
        matchLineupId: playerInLineupId,
        periodNumber,
        timeIn: entryTimestamp,
        timeOut: null,
        sequenceNumber: nextSeq,
        isSynced: 0,
      };

      await db.playerpresences.add(incomingPresence);

      const requestDto: InitializePresenceRequest = {
        periodNumber,
        timeIn: entryTimestamp,
        presenceItems: [
          {
            id: newPresenceId,
            matchLineupId: playerInLineupId,
          },
        ],
      };

      const syncItem: SyncQueueItem = {
        actionType: "POST",
        endpoint: `/Matches/${matchId}/presence/initialize`,
        payload: JSON.stringify(requestDto),
        createdAt: entryTimestamp,
      };

      await db.syncQueue.add(syncItem);
    },
  );

  return newPresenceId;
}
