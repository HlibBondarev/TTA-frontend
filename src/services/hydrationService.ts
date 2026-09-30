import { apiClient } from "../api/client";
import { sportService } from "./sportService";
import { saveEventDefinitionsToDb } from "../db/eventService";
import { db } from "../db/ttaDatabase";
import { store } from "../store";
import {
  incrementHydrationVersion,
  type ActionEntry,
} from "../features/matches/store/matchSlice";
import type {
  MatchLookup,
  TrackedMatch,
  MatchLineupLookup,
  TimeAnchor,
  PlayerPresence,
  GameEvent,
  TournamentLookup,
  SportConfigurationLookup,
} from "../db/ttaDatabase";
import type { EventDefinitionResponse } from "./eventDefinitionService";
import {
  UNRECOVERABLE_STATUS_CODES,
  extractErrorStatus,
} from "../utils/syncErrorUtils";

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
    .and((a) => a.isSynced === 1 || a.isSynced === -1)
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
    .filter(
      (p) =>
        matchLineupIds.has(p.matchLineupId) &&
        (p.isSynced === 1 || p.isSynced === -1),
    )
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
    .filter(
      (e) =>
        matchLineupIds.has(e.matchLineupId) &&
        (e.isSynced === 1 || e.isSynced === -1),
    )
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

export const checkUnfinishedMatch = async (
  userId?: string,
): Promise<TrackedMatch | null> => {
  if (!db?.matches || !userId) return null;
  const matches = await db.matches.toArray();
  const match = matches.find(
    (m) => m.homeScore == null && m.guestScore == null && m.userId === userId,
  );
  if (!match) return null;

  const extendedMatch = match as TrackedMatch;
  let trackedTeamId =
    extendedMatch.trackedTeamId || extendedMatch.selectedTeamId;

  if (!trackedTeamId && db.syncQueue) {
    try {
      const syncItems = await db.syncQueue.toArray();
      const matchPrefix = `/Matches/${match.id}/teams/`;
      const catchItem = syncItems.find(
        (item) =>
          item.actionType === "POST" &&
          item.endpoint?.startsWith(matchPrefix) &&
          item.endpoint?.endsWith("/catch"),
      );
      if (catchItem) {
        const parts = catchItem.endpoint.split("/");
        const teamsIndex = parts.indexOf("teams");
        if (teamsIndex !== -1 && parts[teamsIndex + 1]) {
          trackedTeamId = parts[teamsIndex + 1];
        }
      }
    } catch (err) {
      console.error("Failed to recover trackedTeamId from syncQueue:", err);
    }
  }

  return {
    ...match,
    trackedTeamId,
  };
};

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

export const recoverRecentActions = async (
  matchId: string,
): Promise<ActionEntry[]> => {
  if (!db?.gameevents || !db?.matchlineups || !matchId) return [];

  try {
    const lineups = await db.matchlineups
      .where("matchId")
      .equals(matchId)
      .toArray();

    if (lineups.length === 0) return [];

    const lineupMap = new Map<string, number>();
    for (const l of lineups) {
      lineupMap.set(l.id, l.number);
    }

    const lineupIds = Array.from(lineupMap.keys());

    const events = await db.gameevents
      .where("matchLineupId")
      .anyOf(lineupIds)
      .toArray();

    if (events.length === 0) return [];

    events.sort((a, b) => {
      if (b.sequenceNumber !== a.sequenceNumber) {
        return b.sequenceNumber - a.sequenceNumber;
      }
      return (
        new Date(b.createdAt || b.eventTimestamp).getTime() -
        new Date(a.createdAt || a.eventTimestamp).getTime()
      );
    });

    const recentEvents = events.slice(0, 10);

    const eventDefIds = Array.from(
      new Set(recentEvents.map((e) => e.eventDefinitionId)),
    );

    const definitions = await db.eventdefinitions
      .where("id")
      .anyOf(eventDefIds)
      .toArray();

    const defMap = new Map<string, { name: string; isPositive: boolean }>();
    for (const def of definitions) {
      const isPos =
        def.isPositive ??
        (def as unknown as Record<string, unknown>).ispositive;
      defMap.set(def.id, {
        name: def.name,
        isPositive: Boolean(isPos),
      });
    }

    return recentEvents.map((e) => {
      const defInfo = defMap.get(e.eventDefinitionId);
      return {
        id: e.id,
        playerNumber: lineupMap.get(e.matchLineupId) ?? 0,
        actionName: defInfo?.name ?? "Unknown",
        isPositive: defInfo?.isPositive ?? true,
        timestamp: e.eventTimestamp || e.createdAt,
        matchLineupId: e.matchLineupId,
        eventDefinitionId: e.eventDefinitionId,
        isLeadToGoal: Boolean(e.isLeadToGoal),
        isSynced: e.isSynced,
      };
    });
  } catch (err) {
    console.error("Failed to recover recent match actions:", err);
    return [];
  }
};

const resolveEffectiveTeamId = async (
  match: TrackedMatch,
  explicitTeamId?: string,
): Promise<string | undefined> => {
  let effectiveTeamId =
    explicitTeamId?.trim() || match.trackedTeamId || match.selectedTeamId;

  if (!effectiveTeamId && db.syncQueue) {
    try {
      const syncItems = await db.syncQueue.toArray();
      const matchPrefix = `/Matches/${match.id}/teams/`;
      const matchItem = syncItems.find(
        (item) =>
          item.actionType === "POST" &&
          item.endpoint?.startsWith(matchPrefix) &&
          item.endpoint?.endsWith("/catch"),
      );
      if (matchItem) {
        const parts = matchItem.endpoint.split("/");
        const teamsIndex = parts.indexOf("teams");
        if (teamsIndex !== -1 && parts[teamsIndex + 1]) {
          effectiveTeamId = parts[teamsIndex + 1];
        }
      }
    } catch (err) {
      console.error(
        "Failed to recover correct teamId from syncQueue during discard:",
        err,
      );
    }
  }

  return effectiveTeamId;
};

const purgePendingMatchMutations = async (matchId: string): Promise<void> => {
  if (!db.syncQueue) return;
  const endpointPrefix = `/Matches/${matchId}`;
  const idsToPurge = (await db.syncQueue
    .filter(
      (item) =>
        (item.endpoint === endpointPrefix ||
          item.endpoint.startsWith(`${endpointPrefix}/`)) &&
        (item.actionType === "POST" || item.actionType === "PUT"),
    )
    .primaryKeys()) as number[];

  if (idsToPurge.length > 0) {
    await db.syncQueue.bulkDelete(idsToPurge);
  }
};

const deleteLocalMatchEntities = async (matchId: string): Promise<void> => {
  const lineups = await db.matchlineups
    .where("matchId")
    .equals(matchId)
    .toArray();
  const lineupIds = lineups.map((l) => l.id);

  if (lineupIds.length > 0) {
    await db.playerpresences.where("matchLineupId").anyOf(lineupIds).delete();
    await db.gameevents.where("matchLineupId").anyOf(lineupIds).delete();
  }

  await db.matches.delete(matchId);
  await db.matchlineups.where("matchId").equals(matchId).delete();
  await db.timeanchors.where("matchId").equals(matchId).delete();
};

const dispatchUncatchPostCommit = async (
  catchEndpoint: string,
  stagedSyncQueueId?: number,
): Promise<void> => {
  try {
    await apiClient.delete(catchEndpoint);
    if (stagedSyncQueueId !== undefined && db.syncQueue) {
      await db.syncQueue.delete(stagedSyncQueueId);
    }
  } catch (err) {
    if (err instanceof StaleUserError) throw err;

    const status = extractErrorStatus(err);
    if (status !== undefined && UNRECOVERABLE_STATUS_CODES.has(status)) {
      console.warn(
        `Uncatch match API call failed online with unrecoverable status (${status}). Purging staged syncQueue item:`,
        err,
      );
      if (stagedSyncQueueId !== undefined && db.syncQueue) {
        await db.syncQueue.delete(stagedSyncQueueId);
      }
      return;
    }

    console.warn(
      "Uncatch match API call failed online, fallback to syncQueue:",
      err,
    );
  }
};

export const discardUnfinishedMatch = async (
  matchId: string,
  teamId?: string,
  checkFreshness?: () => void,
  userId?: string,
) => {
  if (!db?.matches) return;

  const tables = [
    db.matches,
    db.matchlineups,
    db.playerpresences,
    db.gameevents,
    db.timeanchors,
    db.syncQueue,
  ].filter(Boolean);

  let stagedCatchEndpoint: string | null = null;
  let stagedSyncQueueId: number | undefined = undefined;

  await db.transaction("rw", tables, async () => {
    checkFreshness?.();

    const match = (await db.matches.get(matchId)) as TrackedMatch | undefined;

    if (!match || match.homeScore != null || match.guestScore != null) {
      return;
    }

    if (userId?.trim() && match.userId && match.userId !== userId.trim()) {
      return;
    }

    const effectiveTeamId = await resolveEffectiveTeamId(match, teamId);

    checkFreshness?.();

    await purgePendingMatchMutations(matchId);

    if (effectiveTeamId?.trim() && db.syncQueue) {
      stagedCatchEndpoint = `/Matches/${matchId}/teams/${effectiveTeamId.trim()}/catch`;
      stagedSyncQueueId = await db.syncQueue.put({
        actionType: "DELETE",
        endpoint: stagedCatchEndpoint,
        payload: "{}",
        createdAt: new Date().toISOString(),
      });
    }

    await deleteLocalMatchEntities(matchId);
    checkFreshness?.();
  });

  if (stagedCatchEndpoint && navigator.onLine) {
    try {
      checkFreshness?.();
    } catch (err) {
      if (
        err instanceof StaleUserError ||
        (err instanceof Error && err.name === "StaleUserError")
      ) {
        return;
      }
      throw err;
    }
    await dispatchUncatchPostCommit(stagedCatchEndpoint, stagedSyncQueueId);
  }
};

const verifyAndStoreMatch = async (
  matchId: string,
  match: MatchLookup | undefined,
  userId?: string,
  teamId?: string,
): Promise<void> => {
  if (!match || !db.matches) return;
  const existingMatch = (await db.matches.get(matchId)) as
    | TrackedMatch
    | undefined;
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

  const effectiveTrackedTeamId =
    teamId?.trim() ||
    existingMatch?.trackedTeamId ||
    existingMatch?.selectedTeamId;

  const matchToStore = {
    ...match,
    ...(effectiveUserId ? { userId: effectiveUserId } : {}),
    ...(effectiveTrackedTeamId
      ? { trackedTeamId: effectiveTrackedTeamId }
      : {}),
  };
  await db.matches.put(matchToStore);
};

interface HydrationPayloads {
  lineups?: MatchLineupLookup[];
  anchors?: TimeAnchor[];
  presence?: PlayerPresence[];
  events?: GameEvent[];
  definitions?: EventDefinitionResponse[];
}

const persistHydrationPayloads = async (
  matchId: string,
  sportId: string | undefined,
  payloads: HydrationPayloads,
  userId?: string,
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
  await syncEvents(matchLineupIds, payloads.events);

  if (payloads.definitions && sportId) {
    const definitions = payloads.definitions
      .filter((def): def is EventDefinitionResponse & { id: string } =>
        Boolean(def.id),
      )
      .map((def, idx) => ({
        id: def.id,
        sportId,
        name: def.name ?? "",
        shortName: def.shortName ?? "",
        isPositive: Boolean(def.isPositive),
        isCustom: def.isCustom,
        isEnabled: def.isEnabled ?? true,
        sortOrder: def.sortOrder ?? idx + 1,
      }));

    await saveEventDefinitionsToDb(definitions, sportId, userId);
  }
};

interface MatchHydrationContext {
  matchId: string;
  teamId?: string;
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
    teamId,
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
      db.usereventpresets,
    ],
    async () => {
      checkFreshness?.();

      await verifyAndStoreMatch(matchId, match, userId, teamId);
      if (tournament) await db.tournaments.put(tournament);
      if (sportConfig) await db.sportconfigurations.put(sportConfig);

      await persistHydrationPayloads(
        matchId,
        tournament?.sportId ?? sportConfig?.sportId,
        payloads,
        userId,
      );

      checkFreshness?.();
    },
  );
};

const getTournamentAndConfig = async (match?: MatchLookup) => {
  if (!match?.tournamentId) {
    return { tournament: null, sportConfig: null };
  }
  const metadata = await fetchTournamentMetadata(match.tournamentId);
  return { tournament: metadata.tournament, sportConfig: metadata.sportConfig };
};

export const hydrateMatchData = async (
  matchId: string,
  teamId: string,
  userId?: string,
  checkFreshness?: () => void,
): Promise<{ success: boolean }> => {
  const [match, lineups, anchors, presence, events, definitions] =
    await Promise.all([
      apiClient.get<MatchLookup>(`/Matches/${matchId}`),
      apiClient.get<MatchLineupLookup[]>(
        `/Matches/${matchId}/teams/${teamId}/lineup`,
      ),
      apiClient.get<TimeAnchor[]>(`/Matches/${matchId}/anchors`),
      apiClient.get<PlayerPresence[]>(`/Matches/${matchId}/presence`),
      apiClient.get<GameEvent[]>(`/Matches/${matchId}/events`),
      apiClient.get<EventDefinitionResponse[]>(
        `/Matches/${matchId}/event-definitions`,
      ),
    ]);

  checkFreshness?.();
  const { tournament, sportConfig } = await getTournamentAndConfig(match);
  checkFreshness?.();

  await executeMatchTransaction({
    matchId,
    teamId,
    match,
    tournament,
    sportConfig,
    payloads: { lineups, anchors, presence, events, definitions },
    userId,
    checkFreshness,
  });

  store.dispatch(incrementHydrationVersion());

  return { success: true };
};

export const deleteLocalMatchEntitiesForUser = async (
  matchId: string,
  userId?: string,
): Promise<void> => {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId || !db?.matches) return;

  await db.transaction(
    "rw",
    [
      db.matches,
      db.matchlineups,
      db.playerpresences,
      db.gameevents,
      db.timeanchors,
    ],
    async () => {
      const match = (await db.matches.get(matchId)) as TrackedMatch | undefined;
      if (match?.userId !== normalizedUserId) return;

      await deleteLocalMatchEntities(matchId);
    },
  );
};
