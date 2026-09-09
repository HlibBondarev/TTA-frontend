import { apiClient } from "../api/client";
import { sportService } from "./sportService";
import { db } from "../db/ttaDatabase";
import type {
  MatchLookup,
  MatchLineupLookup,
  TimeAnchor,
  PlayerPresence,
  GameEvent,
  EventDefinitionLookup,
  TournamentLookup,
  SportConfigurationLookup,
} from "../db/ttaDatabase";
import { seedTestData } from "../db/seed";

export class StaleUserError extends Error {
  constructor(message = "Operation aborted due to user account change.") {
    super(message);
    this.name = "StaleUserError";
  }
}

const syncLineups = async (matchId: string, lineups?: MatchLineupLookup[]) => {
  if (!lineups) return;
  await db.matchlineups.where("matchId").equals(matchId).delete();
  if (lineups.length > 0) {
    await db.matchlineups.bulkPut(lineups);
  }
};

const syncAnchors = async (matchId: string, anchors?: TimeAnchor[]) => {
  if (!anchors) return;
  await db.timeanchors
    .where("matchId")
    .equals(matchId)
    .and((a) => a.isSynced === 1)
    .delete();
  if (anchors.length > 0) {
    const syncedAnchors = anchors.map((a) => ({ ...a, isSynced: 1 }));
    await db.timeanchors.bulkPut(syncedAnchors);
  }
};

const syncPresence = async (
  matchLineupIds: Set<string>,
  presence?: PlayerPresence[],
) => {
  if (!presence) return;

  const syncedKeys = await db.playerpresences
    .filter((p) => matchLineupIds.has(p.matchLineupId) && p.isSynced === 1)
    .primaryKeys();

  if (syncedKeys.length > 0) {
    await db.playerpresences.bulkDelete(syncedKeys as string[]);
  }

  if (presence.length > 0) {
    const pendingPresenceIds = new Set(
      (await db.playerpresences
        .filter((p) => p.isSynced === 0)
        .primaryKeys()) as string[],
    );
    const syncedPresence = presence
      .filter((p) => !pendingPresenceIds.has(p.id))
      .map((p) => ({ ...p, isSynced: 1 }));
    if (syncedPresence.length > 0) {
      await db.playerpresences.bulkPut(syncedPresence);
    }
  }
};

const syncEvents = async (
  matchLineupIds: Set<string>,
  events?: GameEvent[],
) => {
  if (!events) return;

  const syncedKeys = await db.gameevents
    .filter((e) => matchLineupIds.has(e.matchLineupId) && e.isSynced === 1)
    .primaryKeys();

  if (syncedKeys.length > 0) {
    await db.gameevents.bulkDelete(syncedKeys as string[]);
  }

  if (events.length > 0) {
    const pendingEventIds = new Set(
      (await db.gameevents
        .filter((e) => e.isSynced === 0)
        .primaryKeys()) as string[],
    );
    const syncedEvents = events
      .filter((e) => !pendingEventIds.has(e.id))
      .map((e) => ({ ...e, isSynced: 1 }));
    if (syncedEvents.length > 0) {
      await db.gameevents.bulkPut(syncedEvents);
    }
  }
};

const fetchTournamentMetadata = async (
  tournamentId: string,
): Promise<{
  tournament: TournamentLookup;
  sportConfig: SportConfigurationLookup;
}> => {
  let tournament: TournamentLookup | null;
  try {
    tournament = await apiClient.get<TournamentLookup>(
      `/Tournaments/${tournamentId}`,
    );
  } catch (tErr) {
    throw new Error(
      `Hydration Metadata Error: Failed to fetch tournament '${tournamentId}' during hydration: ${
        tErr instanceof Error ? tErr.message : String(tErr)
      }`,
      { cause: tErr },
    );
  }

  if (!tournament) {
    throw new Error(
      `Hydration Metadata Error: Tournament '${tournamentId}' returned null during hydration.`,
    );
  }

  const targetSportId = tournament.sportId;
  const targetConfigId = tournament.configurationId;

  if (!targetSportId || !targetConfigId) {
    throw new Error(
      `Hydration Metadata Error: Tournament '${tournamentId}' is missing sportId or configurationId.`,
    );
  }

  let sportConfig: SportConfigurationLookup | null;
  try {
    const configs = await sportService.getSportConfigurations(targetSportId);
    sportConfig = configs.find((c) => c.id === targetConfigId) ?? null;
  } catch (cErr) {
    throw new Error(
      `Hydration Metadata Error: Failed to fetch sport configurations for sport '${targetSportId}': ${
        cErr instanceof Error ? cErr.message : String(cErr)
      }`,
      { cause: cErr },
    );
  }

  if (!sportConfig) {
    throw new Error(
      `Hydration Metadata Error: SportConfiguration '${targetConfigId}' not found for sport '${targetSportId}'.`,
    );
  }

  return { tournament, sportConfig };
};

/**
 * Checks IndexedDB for an unfinished active match draft associated with the current authenticated user.
 */
export const checkUnfinishedMatch = async (
  userId?: string,
): Promise<MatchLookup | null> => {
  if (!db?.matches || !userId) return null;
  const matches = await db.matches.toArray();
  return (
    matches.find(
      (m) => m.homeScore == null && m.guestScore == null && m.userId === userId,
    ) ?? null
  );
};

/**
 * Computes recovery parameters (last active period and active player presence limit)
 * from hydrated IndexedDB tables.
 */
export const getMatchRecoveryState = async (
  matchId: string,
): Promise<{ recoveredPeriod: number; activePlayersLimit: number }> => {
  let recoveredPeriod = 1;
  let activePlayersLimit = 7;

  try {
    if (db?.timeanchors) {
      const anchors = await db.timeanchors
        .where("matchId")
        .equals(matchId)
        .toArray();
      if (anchors.length > 0) {
        recoveredPeriod = Math.max(...anchors.map((a) => a.periodNumber));
      }
    }

    if (db?.matches && db?.tournaments && db?.sportconfigurations) {
      const match = await db.matches.get(matchId);
      if (match?.tournamentId) {
        const tournament = await db.tournaments.get(match.tournamentId);
        if (tournament?.configurationId) {
          const config = await db.sportconfigurations.get(
            tournament.configurationId,
          );
          if (config?.activePlayersLimit) {
            activePlayersLimit = config.activePlayersLimit;
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to calculate match recovery state:", err);
  }

  return { recoveredPeriod, activePlayersLimit };
};

const uncatchMatchOnServerOrQueue = async (
  matchId: string,
  teamId: string,
): Promise<void> => {
  const catchEndpoint = `/Matches/${matchId}/teams/${teamId.trim()}/catch`;
  let uncatchSuccess = false;

  if (navigator.onLine) {
    try {
      await apiClient.delete(catchEndpoint);
      uncatchSuccess = true;
    } catch (err) {
      if (err instanceof StaleUserError) throw err;
      console.warn(
        "Uncatch match API call failed online, fallback to syncQueue:",
        err,
      );
    }
  }

  if (!uncatchSuccess && db.syncQueue) {
    await db.syncQueue.put({
      actionType: "DELETE",
      endpoint: catchEndpoint,
      payload: "{}",
      createdAt: new Date().toISOString(),
    });
  }
};

const deleteLocalMatchRecords = async (matchId: string): Promise<void> => {
  const tables = [
    db.matches,
    db.matchlineups,
    db.playerpresences,
    db.gameevents,
    db.timeanchors,
    db.syncQueue,
  ].filter(Boolean);

  await db.transaction("rw", tables, async () => {
    const match = await db.matches.get(matchId);
    if (match && match.homeScore == null && match.guestScore == null) {
      if (db.syncQueue) {
        const endpointPrefix = `/Matches/${matchId}`;
        const itemsToPurge = await db.syncQueue
          .filter(
            (item) =>
              item.endpoint.includes(endpointPrefix) &&
              (item.actionType === "POST" || item.actionType === "PUT"),
          )
          .toArray();

        for (const item of itemsToPurge) {
          if (item.id !== undefined) {
            await db.syncQueue.delete(item.id);
          }
        }
      }

      const lineups = await db.matchlineups
        .where("matchId")
        .equals(matchId)
        .toArray();
      const lineupIds = lineups.map((l) => l.id);

      if (lineupIds.length > 0) {
        await db.playerpresences
          .where("matchLineupId")
          .anyOf(lineupIds)
          .delete();
        await db.gameevents.where("matchLineupId").anyOf(lineupIds).delete();
      }

      await db.matches.delete(matchId);
      await db.matchlineups.where("matchId").equals(matchId).delete();
      await db.timeanchors.where("matchId").equals(matchId).delete();
    }
  });
};

/**
 * Permanently deletes an unfinished match draft and all associated records from IndexedDB.
 * Issues UncatchMatch request to server when teamId is supplied (with syncQueue offline fallback)
 * only if the match exists and is unfinished (both scores are null).
 * Also purges pending mutation items (POST/PUT) for this match from syncQueue within the same transaction.
 */
export const discardUnfinishedMatch = async (
  matchId: string,
  teamId?: string,
): Promise<void> => {
  if (!db?.matches) return;

  const initialMatch = await db.matches.get(matchId);
  if (
    !initialMatch ||
    initialMatch.homeScore != null ||
    initialMatch.guestScore != null
  ) {
    return;
  }

  if (teamId?.trim()) {
    await uncatchMatchOnServerOrQueue(matchId, teamId);
  }

  await deleteLocalMatchRecords(matchId);
};

const verifyAndStoreMatch = async (
  matchId: string,
  match: MatchLookup | undefined,
  userId?: string,
): Promise<void> => {
  if (!match || !db.matches) return;
  const existingMatch = await db.matches.get(matchId);
  if (
    userId?.trim() &&
    existingMatch?.userId &&
    existingMatch.userId !== userId.trim()
  ) {
    throw new Error("Match draft belongs to another user.");
  }
  const effectiveUserId = userId?.trim()
    ? userId.trim()
    : existingMatch?.userId;
  const matchToStore = effectiveUserId
    ? { ...match, userId: effectiveUserId }
    : match;
  await db.matches.put(matchToStore);
};

interface HydrationPayloads {
  lineups?: MatchLineupLookup[];
  anchors?: TimeAnchor[];
  presence?: PlayerPresence[];
  events?: GameEvent[];
  definitions?: EventDefinitionLookup[];
}

const persistHydrationPayloads = async (
  matchId: string,
  payloads: HydrationPayloads,
): Promise<void> => {
  const existingLineups = await db.matchlineups
    .where("matchId")
    .equals(matchId)
    .toArray();

  const matchLineupIds = new Set([
    ...existingLineups.map((lineup) => lineup.id),
    ...(payloads.lineups ?? []).map((lineup) => lineup.id),
  ]);

  await syncLineups(matchId, payloads.lineups);
  await syncAnchors(matchId, payloads.anchors);
  await syncPresence(matchLineupIds, payloads.presence);
  await syncEvents(matchId ? matchLineupIds : new Set(), payloads.events);

  if (payloads.definitions && payloads.definitions.length > 0) {
    await db.eventdefinitions.bulkPut(payloads.definitions);
  }
};

interface MatchHydrationContext {
  matchId: string;
  match?: MatchLookup;
  tournament?: TournamentLookup | null;
  sportConfig?: SportConfigurationLookup | null;
  payloads: HydrationPayloads;
  userId?: string;
  checkFreshness?: () => void;
}

const executeMatchTransaction = async (
  context: MatchHydrationContext,
): Promise<void> => {
  const {
    matchId,
    match,
    tournament,
    sportConfig,
    payloads,
    userId,
    checkFreshness,
  } = context;

  await db.transaction(
    "rw",
    [
      db.matches,
      db.tournaments,
      db.sportconfigurations,
      db.matchlineups,
      db.timeanchors,
      db.playerpresences,
      db.gameevents,
      db.eventdefinitions,
    ],
    async () => {
      checkFreshness?.();

      await verifyAndStoreMatch(matchId, match, userId);
      if (tournament) await db.tournaments.put(tournament);
      if (sportConfig) await db.sportconfigurations.put(sportConfig);

      await persistHydrationPayloads(matchId, payloads);

      checkFreshness?.();
    },
  );
};

const shouldRethrowError = (err: unknown): boolean => {
  if (
    err instanceof StaleUserError ||
    (err instanceof Error && err.name === "StaleUserError")
  ) {
    return true;
  }

  const errorMessage = err instanceof Error ? err.message : String(err);
  return (
    errorMessage.includes("401") ||
    errorMessage.includes("403") ||
    errorMessage.includes("Hydration Metadata Error:") ||
    errorMessage.includes("Match draft belongs to another user.")
  );
};

const getTournamentAndConfig = async (match?: MatchLookup) => {
  if (!match?.tournamentId) {
    return { tournament: null, sportConfig: null };
  }
  const metadata = await fetchTournamentMetadata(match.tournamentId);
  return { tournament: metadata.tournament, sportConfig: metadata.sportConfig };
};

const persistMatchWithRollback = async (
  matchId: string,
  match: MatchLookup | undefined,
  tournament: TournamentLookup | null | undefined,
  sportConfig: SportConfigurationLookup | null | undefined,
  payloads: HydrationPayloads,
  userId?: string,
  checkFreshness?: () => void,
) => {
  await executeMatchTransaction({
    matchId,
    match,
    tournament,
    sportConfig,
    payloads,
    userId,
    checkFreshness,
  });
};

export const hydrateMatchData = async (
  matchId: string,
  teamId: string,
  userId?: string,
  checkFreshness?: () => void,
): Promise<{ success: boolean; isOfflineFallback: boolean }> => {
  try {
    const [match, lineups, anchors, presence, events, definitions] =
      await Promise.all([
        apiClient.get<MatchLookup>(`/Matches/${matchId}`),
        apiClient.get<MatchLineupLookup[]>(
          `/Matches/${matchId}/teams/${teamId}/lineup`,
        ),
        apiClient.get<TimeAnchor[]>(`/Matches/${matchId}/anchors`),
        apiClient.get<PlayerPresence[]>(`/Matches/${matchId}/presence`),
        apiClient.get<GameEvent[]>(`/Matches/${matchId}/events`),
        apiClient.get<EventDefinitionLookup[]>(
          `/Matches/${matchId}/eventdefinitions`,
        ),
      ]);

    checkFreshness?.();
    const { tournament, sportConfig } = await getTournamentAndConfig(match);
    checkFreshness?.();

    await persistMatchWithRollback(
      matchId,
      match,
      tournament,
      sportConfig,
      { lineups, anchors, presence, events, definitions },
      userId,
      checkFreshness,
    );

    return { success: true, isOfflineFallback: false };
  } catch (err) {
    if (shouldRethrowError(err)) {
      throw err;
    }

    console.warn(
      "Backend or network unavailable. Hydrating via local seed fallback:",
      err,
    );
    await seedTestData();
    return { success: true, isOfflineFallback: true };
  }
};
