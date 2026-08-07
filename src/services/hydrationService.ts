import { apiClient } from "../api/client";
import { db } from "../db/ttaDatabase";
import type {
  MatchLookup,
  MatchLineupLookup,
  TimeAnchor,
  PlayerPresence,
  GameEvent,
  EventDefinitionLookup,
} from "../db/ttaDatabase";
import { seedTestData } from "../db/seed";

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

export const hydrateMatchData = async (
  matchId: string,
  teamId: string,
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

    await db.transaction(
      "rw",
      [
        db.matches,
        db.matchlineups,
        db.timeanchors,
        db.playerpresences,
        db.gameevents,
        db.eventdefinitions,
      ],
      async () => {
        if (match) await db.matches.put(match);

        await syncLineups(matchId, lineups);

        const currentLineups = await db.matchlineups
          .where("matchId")
          .equals(matchId)
          .toArray();
        const matchLineupIds = new Set(currentLineups.map((l) => l.id));

        await syncAnchors(matchId, anchors);
        await syncPresence(matchLineupIds, presence);
        await syncEvents(matchLineupIds, events);

        if (definitions && definitions.length > 0) {
          await db.eventdefinitions.bulkPut(definitions);
        }
      },
    );

    return { success: true, isOfflineFallback: false };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("401") || errorMessage.includes("403")) {
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
