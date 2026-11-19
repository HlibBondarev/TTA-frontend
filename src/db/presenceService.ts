import {
  db,
  type EventDefinitionLookup,
  type PlayerPresence,
  type SyncQueueItem,
} from "./ttaDatabase";
import { getNextSequenceNumber } from "./eventService";
import { computePlayerDisciplinaryMap } from "../utils/disciplinaryUtils";

const DISQUALIFIED_STARTER_ERROR =
  "Cannot start period with disqualified players in the starting lineup.";
const DISQUALIFIED_ENTRY_ERROR =
  "Cannot enter a disqualified player into the active lineup.";

const parseTimestampMs = (value: string): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const resolveEffectiveExitTimestamp = (
  timeIn: string,
  exitTimestamp: string,
): string => {
  const timeInMs = parseTimestampMs(timeIn);
  const exitMs = parseTimestampMs(exitTimestamp);

  if (timeInMs !== null && exitMs !== null) {
    if (exitMs >= timeInMs) {
      return exitTimestamp;
    }
    const nowIso = new Date().toISOString();
    return Date.parse(nowIso) >= timeInMs ? nowIso : timeIn;
  }

  if (exitMs !== null && exitTimestamp >= timeIn) {
    return exitTimestamp;
  }

  const nowIso = new Date().toISOString();
  if (timeInMs !== null) {
    return Date.parse(nowIso) >= timeInMs ? nowIso : timeIn;
  }
  return nowIso >= timeIn ? nowIso : timeIn;
};

const loadMatchMaxPersonalFouls = async (
  matchId: string,
): Promise<number | null> => {
  if (
    !db.matches?.get ||
    !db.tournaments?.get ||
    !db.sportconfigurations?.get
  ) {
    return null;
  }

  const match = await db.matches.get(matchId);
  const tournament = match?.tournamentId
    ? await db.tournaments.get(match.tournamentId)
    : undefined;
  const config = tournament?.configurationId
    ? await db.sportconfigurations.get(tournament.configurationId)
    : undefined;

  return typeof config?.maxPersonalFouls === "number"
    ? config.maxPersonalFouls
    : null;
};

const loadEventDefinitionsById = async (
  definitionIds: string[],
): Promise<Map<string, EventDefinitionLookup>> => {
  const definitionsById = new Map<string, EventDefinitionLookup>();
  if (definitionIds.length === 0 || !db.eventdefinitions) {
    return definitionsById;
  }

  let defs: Array<EventDefinitionLookup | undefined> = [];
  if (typeof db.eventdefinitions.bulkGet === "function") {
    defs = await db.eventdefinitions.bulkGet(definitionIds);
  } else if (typeof db.eventdefinitions.get === "function") {
    defs = await Promise.all(
      definitionIds.map((id) => db.eventdefinitions.get(id)),
    );
  }

  for (const def of defs) {
    if (def) {
      definitionsById.set(def.id, def);
    }
  }
  return definitionsById;
};

/**
 * Returns any lineup IDs from the provided list that are currently disqualified
 * based on persisted game events and match sport configuration.
 */
export async function findDisqualifiedLineupIds(
  matchId: string,
  lineupIds: string[],
): Promise<string[]> {
  if (lineupIds.length === 0 || !db.gameevents?.where) {
    return [];
  }

  const whereClause = db.gameevents.where("matchLineupId");
  if (!whereClause || typeof whereClause.anyOf !== "function") {
    return [];
  }

  const events = await whereClause.anyOf(lineupIds).toArray();
  if (events.length === 0) {
    return [];
  }

  const defIds = Array.from(
    new Set(events.map((e) => e.eventDefinitionId).filter(Boolean)),
  );
  const [maxPersonalFouls, eventDefinitionsById] = await Promise.all([
    loadMatchMaxPersonalFouls(matchId),
    loadEventDefinitionsById(defIds),
  ]);

  const disciplinaryMap = computePlayerDisciplinaryMap({
    lineupIds,
    gameEvents: events,
    eventDefinitionsById,
    periodPresences: [],
    currentPeriod: 1,
    isPeriodActive: false,
    activeLineupIds: [],
    activePlayersLimit: 0,
    maxPersonalFouls,
  });

  return lineupIds.filter((id) => disciplinaryMap[id]?.isDisqualified);
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
    [
      db.playerpresences,
      db.gameevents,
      db.timeanchors,
      db.syncQueue,
      db.matches,
      db.tournaments,
      db.sportconfigurations,
      db.eventdefinitions,
    ],
    async () => {
      const disqualifiedIds = await findDisqualifiedLineupIds(
        matchId,
        playerLineupIds,
      );
      if (disqualifiedIds.length > 0) {
        throw new Error(DISQUALIFIED_STARTER_ERROR);
      }

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
 * Enqueues the period-end synchronization payload in db.syncQueue alongside
 * client-only undo metadata in the same IndexedDB transaction.
 */
export async function terminatePeriodPresenceTx(
  matchId: string,
  periodNumber: number,
  playerLineupIds: string[],
  endTimestamp: string,
): Promise<void> {
  const normalizedMatchId = matchId.trim();

  await db.transaction("rw", [db.playerpresences, db.syncQueue], async () => {
    // 1. Find all active presences (where timeOut is null) for this period
    const activePresences = await db.playerpresences
      .where("periodNumber")
      .equals(periodNumber)
      .filter(
        (p) => p.timeOut === null && playerLineupIds.includes(p.matchLineupId),
      )
      .toArray();

    const closedPresenceIds = activePresences.map((presence) => presence.id);

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
    //    alongside atomic client-only undo metadata in the same IndexedDB transaction.
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
      periodEndMeta: {
        matchId: normalizedMatchId,
        periodNumber,
        timeOut: endTimestamp,
        closedPresenceIds,
        closedLineupIds: [...playerLineupIds],
      },
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

    const effectiveTimeOut = resolveEffectiveExitTimestamp(
      activePresence.timeIn,
      exitTimestamp,
    );

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
      closedPresenceIds: [activePresence.id],
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
    [
      db.playerpresences,
      db.gameevents,
      db.timeanchors,
      db.syncQueue,
      db.matches,
      db.tournaments,
      db.sportconfigurations,
      db.eventdefinitions,
    ],
    async () => {
      const disqualifiedIds = await findDisqualifiedLineupIds(matchId, [
        playerInLineupId,
      ]);
      if (disqualifiedIds.length > 0) {
        throw new Error(DISQUALIFIED_ENTRY_ERROR);
      }

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
