import { db, type PlayerPresence, type SyncQueueItem } from "./ttaDatabase";
import { getNextSequenceNumber } from "./eventService";

export interface PeriodEndTerminationRecord {
  matchId: string;
  periodNumber: number;
  timeOut: string;
  closedPresenceIds: string[];
  closedLineupIds: string[];
  queueItemId?: number;
}

const PERIOD_END_STORAGE_PREFIX = "tta:periodEndTermination:";
const periodEndTerminations = new Map<string, PeriodEndTerminationRecord>();

const getPeriodEndTerminationKey = (
  matchId: string,
  periodNumber: number,
): string => `${matchId.trim()}:${periodNumber}`;

const getLocalStorageSafe = (): Storage | null => {
  try {
    return typeof globalThis.localStorage !== "undefined"
      ? globalThis.localStorage
      : null;
  } catch {
    return null;
  }
};

const readPersistedTermination = (
  key: string,
): PeriodEndTerminationRecord | undefined => {
  const storage = getLocalStorageSafe();
  if (!storage) return undefined;

  try {
    const raw = storage.getItem(`${PERIOD_END_STORAGE_PREFIX}${key}`);
    if (!raw) return undefined;

    const parsed = JSON.parse(raw) as Partial<PeriodEndTerminationRecord>;
    if (
      typeof parsed.matchId !== "string" ||
      typeof parsed.periodNumber !== "number" ||
      typeof parsed.timeOut !== "string" ||
      !Array.isArray(parsed.closedPresenceIds) ||
      !Array.isArray(parsed.closedLineupIds)
    ) {
      return undefined;
    }

    return {
      matchId: parsed.matchId,
      periodNumber: parsed.periodNumber,
      timeOut: parsed.timeOut,
      closedPresenceIds: [...parsed.closedPresenceIds],
      closedLineupIds: [...parsed.closedLineupIds],
      queueItemId:
        typeof parsed.queueItemId === "number" ? parsed.queueItemId : undefined,
    };
  } catch {
    return undefined;
  }
};

const writePersistedTermination = (
  key: string,
  record: PeriodEndTerminationRecord,
): void => {
  const storage = getLocalStorageSafe();
  if (!storage) return;

  try {
    storage.setItem(
      `${PERIOD_END_STORAGE_PREFIX}${key}`,
      JSON.stringify(record),
    );
  } catch {
    // Ignore storage quota or privacy-mode errors; in-memory map still holds the record
  }
};

const removePersistedTermination = (key: string): void => {
  const storage = getLocalStorageSafe();
  if (!storage) return;

  try {
    storage.removeItem(`${PERIOD_END_STORAGE_PREFIX}${key}`);
  } catch {
    // Ignore storage errors
  }
};

const clearPersistedTerminations = (): void => {
  const storage = getLocalStorageSafe();
  if (!storage) return;

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(PERIOD_END_STORAGE_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => storage.removeItem(k));
  } catch {
    // Ignore storage errors
  }
};

export const getPeriodEndTermination = (
  matchId: string,
  periodNumber: number,
): PeriodEndTerminationRecord | undefined => {
  const normalizedMatchId = matchId.trim();
  if (!normalizedMatchId) return undefined;
  const key = getPeriodEndTerminationKey(normalizedMatchId, periodNumber);

  const inMemory = periodEndTerminations.get(key);
  if (inMemory) return inMemory;

  const persisted = readPersistedTermination(key);
  if (persisted) {
    periodEndTerminations.set(key, persisted);
    return persisted;
  }

  return undefined;
};

export const clearPeriodEndTermination = (
  matchId: string,
  periodNumber: number,
): void => {
  const normalizedMatchId = matchId.trim();
  if (!normalizedMatchId) return;
  const key = getPeriodEndTerminationKey(normalizedMatchId, periodNumber);
  periodEndTerminations.delete(key);
  removePersistedTermination(key);
};

/**
 * Clears only the in-memory cache while preserving persisted storage entries
 * (used to simulate a full page reload in tests).
 */
export const clearInMemoryPeriodEndTerminations = (): void => {
  periodEndTerminations.clear();
};

export const clearAllPeriodEndTerminations = (): void => {
  periodEndTerminations.clear();
  clearPersistedTerminations();
};

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
 * Enqueues the period-end synchronization payload in db.syncQueue and persists
 * the exact closed presence IDs and queue item ID for scoped period-end undo across reloads.
 */
export async function terminatePeriodPresenceTx(
  matchId: string,
  periodNumber: number,
  playerLineupIds: string[],
  endTimestamp: string,
): Promise<void> {
  let closedPresenceIds: string[] = [];
  let queueItemId: number | undefined;

  await db.transaction("rw", [db.playerpresences, db.syncQueue], async () => {
    // 1. Find all active presences (where timeOut is null) for this period
    const activePresences = await db.playerpresences
      .where("periodNumber")
      .equals(periodNumber)
      .filter(
        (p) => p.timeOut === null && playerLineupIds.includes(p.matchLineupId),
      )
      .toArray();

    closedPresenceIds = activePresences.map((presence) => presence.id);

    // 2. Update each active player session with the end timestamp in parallel
    await Promise.all(
      activePresences.map((presence) =>
        db.playerpresences.update(presence.id, {
          timeOut: endTimestamp,
          isSynced: 0,
        }),
      ),
    );

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

    const addedId = await db.syncQueue.add(syncItem);
    if (typeof addedId === "number") {
      queueItemId = addedId;
    }
  });

  const normalizedMatchId = matchId.trim();
  if (normalizedMatchId) {
    const key = getPeriodEndTerminationKey(normalizedMatchId, periodNumber);
    const record: PeriodEndTerminationRecord = {
      matchId: normalizedMatchId,
      periodNumber,
      timeOut: endTimestamp,
      closedPresenceIds,
      closedLineupIds: [...playerLineupIds],
      queueItemId,
    };
    periodEndTerminations.set(key, record);
    writePersistedTermination(key, record);
  }
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

/**
 * Closes a single active player's presence session without pairing an incoming substitute
 * (e.g., timed exclusion or disqualification). Safe no-op returning false if the player
 * is not currently active in the specified period.
 */
export async function exitPlayerPresenceTx(
  matchId: string,
  periodNumber: number,
  playerOutLineupId: string,
  exitTimestamp: string,
): Promise<boolean> {
  let didExit = false;

  await db.transaction("rw", [db.playerpresences, db.syncQueue], async () => {
    const activePresence = await db.playerpresences
      .where({ matchLineupId: playerOutLineupId, periodNumber })
      .filter((p) => p.timeOut === null)
      .first();

    if (!activePresence) {
      return;
    }

    const effectiveTimeOut =
      exitTimestamp >= activePresence.timeIn
        ? exitTimestamp
        : new Date().toISOString();

    await db.playerpresences.update(activePresence.id, {
      timeOut: effectiveTimeOut,
      isSynced: 0,
    });

    const payload = JSON.stringify({
      periodNumber,
      playerLineupIds: [playerOutLineupId],
      timeOut: effectiveTimeOut,
    });

    const syncItem: SyncQueueItem = {
      actionType: "PUT",
      endpoint: `/Matches/${matchId}/presence/terminate`,
      payload,
      createdAt: effectiveTimeOut,
    };

    await db.syncQueue.add(syncItem);
    didExit = true;
  });

  return didExit;
}

/**
 * Opens a standalone presence session for an eligible bench player entering a shorthanded
 * active roster without pairing an outgoing player.
 * Aligned with backend InitializePresenceRequest DTO contract.
 */
export async function enterPlayerPresenceTx(
  matchId: string,
  periodNumber: number,
  playerInLineupId: string,
  entryTimestamp?: string,
): Promise<string> {
  let newPresenceId = "";

  await db.transaction(
    "rw",
    [db.playerpresences, db.gameevents, db.timeanchors, db.syncQueue],
    async () => {
      const existingActive = await db.playerpresences
        .where({ matchLineupId: playerInLineupId, periodNumber })
        .filter((p) => p.timeOut === null)
        .first();

      if (existingActive) {
        throw new Error(
          "Player already has an active presence in this period.",
        );
      }

      const timestamp = entryTimestamp ?? new Date().toISOString();
      const nextSeq = await getNextSequenceNumber();
      newPresenceId = crypto.randomUUID();

      const incomingPresence: PlayerPresence = {
        id: newPresenceId,
        matchLineupId: playerInLineupId,
        periodNumber,
        timeIn: timestamp,
        timeOut: null,
        sequenceNumber: nextSeq,
        isSynced: 0,
      };

      await db.playerpresences.add(incomingPresence);

      const payload = JSON.stringify({
        periodNumber,
        timeIn: timestamp,
        presenceItems: [
          {
            id: newPresenceId,
            matchLineupId: playerInLineupId,
          },
        ],
      });

      const syncItem: SyncQueueItem = {
        actionType: "POST",
        endpoint: `/Matches/${matchId}/presence/initialize`,
        payload,
        createdAt: timestamp,
      };

      await db.syncQueue.add(syncItem);
    },
  );

  return newPresenceId;
}
