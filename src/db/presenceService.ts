import { db, type PlayerPresence, type SyncQueueItem } from "./ttaDatabase";
import { getNextSequenceNumber } from "./eventService";
import type { components } from "../api/types";

type InitializePresenceRequest =
  components["schemas"]["InitializePresenceRequest"];
type TerminatePresenceRequest =
  components["schemas"]["TerminatePresenceRequest"];
type SubstitutePlayerRequest = components["schemas"]["SubstitutePlayerRequest"];

export const resolveEffectiveTimeOut = (
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

export const areTimestampsEqual = (
  first?: string | null,
  second?: string | null,
): boolean => {
  if (!first || !second) return false;
  const parsedA = Date.parse(first);
  const parsedB = Date.parse(second);
  if (!Number.isNaN(parsedA) && !Number.isNaN(parsedB)) {
    return parsedA === parsedB;
  }
  return first.trim() === second.trim();
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

const listPlayerPresencesInPeriod = async (
  matchLineupId: string,
  periodNumber: number,
): Promise<PlayerPresence[]> => {
  if (typeof db.playerpresences?.where !== "function") {
    return [];
  }

  const compoundQuery = db.playerpresences.where({
    matchLineupId,
    periodNumber,
  });
  if (typeof compoundQuery?.toArray === "function") {
    const rows = await compoundQuery.toArray();
    if (Array.isArray(rows)) {
      return rows;
    }
  }

  const byLineup = db.playerpresences.where("matchLineupId");
  const equalsChain =
    typeof byLineup?.equals === "function"
      ? byLineup.equals(matchLineupId)
      : undefined;
  if (typeof equalsChain?.toArray === "function") {
    const rows = await equalsChain.toArray();
    return Array.isArray(rows)
      ? rows.filter((p) => p.periodNumber === periodNumber)
      : [];
  }

  return [];
};

const isPresenceLater = (
  candidate: PlayerPresence,
  currentLatest: PlayerPresence,
): boolean => {
  if (candidate.sequenceNumber !== currentLatest.sequenceNumber) {
    return candidate.sequenceNumber > currentLatest.sequenceNumber;
  }
  return candidate.timeIn.localeCompare(currentLatest.timeIn) > 0;
};

const isPresenceLaterAcrossPeriods = (
  candidate: PlayerPresence,
  currentLatest: PlayerPresence,
): boolean => {
  if (candidate.periodNumber !== currentLatest.periodNumber) {
    return candidate.periodNumber > currentLatest.periodNumber;
  }
  return isPresenceLater(candidate, currentLatest);
};

const findLatestPresenceInPeriod = (
  presences: readonly PlayerPresence[],
): PlayerPresence | undefined => {
  let latest: PlayerPresence | undefined;
  for (const p of presences) {
    if (!latest || isPresenceLater(p, latest)) {
      latest = p;
    }
  }
  return latest;
};

/**
 * Finds the player's latest unsynced closed presence in a specific period.
 * Returns undefined if the player has an open presence in that period or if
 * the latest presence is already synced.
 */
export async function findLatestClosedPresenceInPeriodInTx(
  matchLineupId: string,
  periodNumber: number,
): Promise<PlayerPresence | undefined> {
  const playerPresences = await listPlayerPresencesInPeriod(
    matchLineupId,
    periodNumber,
  );
  if (playerPresences.some((p) => p.timeOut === null)) {
    return undefined;
  }
  const latest = findLatestPresenceInPeriod(playerPresences);
  return latest && latest.timeOut !== null && latest.isSynced === 0
    ? latest
    : undefined;
}

/**
 * Finds the player's latest unsynced closed presence across all periods in Dexie.
 * Returns undefined if the player currently has any open presence or if the
 * latest presence is already synced.
 */
export async function findLatestClosedPresenceForPlayerInTx(
  matchLineupId: string,
): Promise<PlayerPresence | undefined> {
  if (typeof db.playerpresences?.where !== "function") {
    return undefined;
  }

  const byLineup = db.playerpresences.where("matchLineupId");
  const equalsChain =
    typeof byLineup?.equals === "function"
      ? byLineup.equals(matchLineupId)
      : undefined;
  if (typeof equalsChain?.toArray !== "function") {
    return undefined;
  }

  const rows = await equalsChain.toArray();
  if (!Array.isArray(rows) || rows.length === 0) {
    return undefined;
  }
  if (rows.some((p) => p.timeOut === null)) {
    return undefined;
  }

  let latest: PlayerPresence | undefined;
  for (const p of rows) {
    if (!latest || isPresenceLaterAcrossPeriods(p, latest)) {
      latest = p;
    }
  }

  return latest && latest.timeOut !== null && latest.isSynced === 0
    ? latest
    : undefined;
}

const matchesSinglePlayerTerminateItem = (
  item: SyncQueueItem,
  matchLineupId: string,
  periodNumber: number,
  closedTimeOut: string,
): boolean => {
  if (item.id === undefined || item.actionType !== "PUT") {
    return false;
  }

  try {
    const parsed = JSON.parse(item.payload) as TerminatePresenceRequest;
    const lineupIds = parsed.playerLineupIds;
    if (
      parsed.periodNumber !== periodNumber ||
      !Array.isArray(lineupIds) ||
      lineupIds.length !== 1 ||
      lineupIds[0] !== matchLineupId
    ) {
      return false;
    }
    return areTimestampsEqual(parsed.timeOut, closedTimeOut);
  } catch {
    return false;
  }
};

/**
 * Reverts a previous unsynced single-player disciplinary auto-exit inside an
 * active Dexie transaction by deleting the matching single-player
 * PUT /presence/terminate queue item and reopening the closed presence.
 * When eventTimestamp is provided, enforces exact timestamp matching against
 * the closed presence's timeOut; when omitted, matches the player's latest
 * unsynced single-player auto-exit in that period.
 */
export async function revertSinglePlayerAutoExitInTx(
  matchId: string,
  matchLineupId: string,
  periodNumber: number,
  eventTimestamp?: string,
): Promise<boolean> {
  const playerPresences = await listPlayerPresencesInPeriod(
    matchLineupId,
    periodNumber,
  );
  if (playerPresences.some((p) => p.timeOut === null)) {
    return false;
  }

  const latestPresence = findLatestPresenceInPeriod(playerPresences);
  const closedTimeOut = latestPresence?.timeOut;
  if (!latestPresence || !closedTimeOut || latestPresence.isSynced !== 0) {
    return false;
  }

  if (eventTimestamp && !areTimestampsEqual(closedTimeOut, eventTimestamp)) {
    return false;
  }

  const terminateEndpoint = `/Matches/${matchId}/presence/terminate`;
  const queueItems = await db.syncQueue
    .filter((item) => item.endpoint === terminateEndpoint)
    .toArray();

  const matchingItem = queueItems.find((item) =>
    matchesSinglePlayerTerminateItem(
      item,
      matchLineupId,
      periodNumber,
      closedTimeOut,
    ),
  );
  if (matchingItem?.id === undefined) {
    return false;
  }

  await db.syncQueue.delete(matchingItem.id);
  await db.playerpresences.update(latestPresence.id, {
    timeOut: null,
    isSynced: 0,
  });

  return true;
}

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

const resolveOptionalMatchLineupIdSet = async (
  matchId: string,
): Promise<Set<string> | undefined> => {
  if (typeof db.matchlineups?.where !== "function") {
    return undefined;
  }
  const equalsChain = db.matchlineups.where("matchId")?.equals?.(matchId);
  if (typeof equalsChain?.toArray !== "function") {
    return undefined;
  }
  const matchLineups = await equalsChain.toArray();
  if (!Array.isArray(matchLineups) || matchLineups.length === 0) {
    return undefined;
  }
  return new Set(matchLineups.map((l) => l.id));
};

const resolveMatchLineupIdSet = async (
  matchId: string,
  fallbackLineupIds: string[],
): Promise<Set<string>> =>
  (await resolveOptionalMatchLineupIdSet(matchId)) ??
  new Set(fallbackLineupIds);

const countOpenPresencesInPeriodInTx = async (
  matchId: string,
  periodNumber: number,
): Promise<number> => {
  if (typeof db.playerpresences?.where !== "function") {
    return 0;
  }

  const matchLineupIds = await resolveOptionalMatchLineupIdSet(matchId);
  const byPeriod = db.playerpresences
    .where("periodNumber")
    ?.equals?.(periodNumber);
  const filtered =
    typeof byPeriod?.filter === "function"
      ? byPeriod.filter(
          (p) =>
            p.timeOut === null &&
            (!matchLineupIds || matchLineupIds.has(p.matchLineupId)),
        )
      : undefined;
  if (typeof filtered?.toArray !== "function") {
    return 0;
  }

  const openRows = await filtered.toArray();
  return Array.isArray(openRows) ? openRows.length : 0;
};

const assertShorthandedCapacityInTx = async (
  matchId: string,
  periodNumber: number,
  maxAllowedActive?: number,
): Promise<void> => {
  if (
    typeof maxAllowedActive !== "number" ||
    !Number.isFinite(maxAllowedActive)
  ) {
    return;
  }

  const effectiveCap = Math.max(0, Math.floor(maxAllowedActive));
  const openCount =
    effectiveCap > 0
      ? await countOpenPresencesInPeriodInTx(matchId, periodNumber)
      : 0;
  if (openCount >= effectiveCap) {
    throw new Error(
      `Cannot exceed the limit of ${effectiveCap} active players.`,
    );
  }
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
        (p) => p.timeOut === null && candidateLineupIds.has(p.matchLineupId),
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
  maxAllowedActive?: number,
): Promise<string> {
  let newPresenceId = "";
  const tables = [
    db.playerpresences,
    db.gameevents,
    db.timeanchors,
    db.syncQueue,
    ...(db.matchlineups ? [db.matchlineups] : []),
  ];

  await db.transaction("rw", tables, async () => {
    const existingOpenPresence = await findOpenPresenceForPlayer(
      playerInLineupId,
      periodNumber,
    );
    if (existingOpenPresence) {
      throw new Error("Player already has an active presence in this period.");
    }

    await assertShorthandedCapacityInTx(
      matchId,
      periodNumber,
      maxAllowedActive,
    );

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
  });

  return newPresenceId;
}
