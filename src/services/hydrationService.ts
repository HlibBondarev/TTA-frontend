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

export const hydrateMatchData = async (
  matchId: string,
): Promise<{ success: boolean; isOfflineFallback: boolean }> => {
  try {
    const [match, lineups, anchors, presence, events, definitions] =
      await Promise.all([
        apiClient.get<MatchLookup>(`/Matches/${matchId}`),
        apiClient.get<MatchLineupLookup[]>(`/Matches/${matchId}/lineups`),
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

        if (lineups && lineups.length > 0) {
          await db.matchlineups.where("matchId").equals(matchId).delete();
          await db.matchlineups.bulkPut(lineups);
        }

        if (anchors && anchors.length > 0) {
          const syncedAnchors = anchors.map((a) => ({ ...a, isSynced: 1 }));
          await db.timeanchors
            .where("matchId")
            .equals(matchId)
            .and((a) => a.isSynced === 1)
            .delete();
          await db.timeanchors.bulkPut(syncedAnchors);
        }

        if (presence && presence.length > 0) {
          const syncedPresence = presence.map((p) => ({ ...p, isSynced: 1 }));
          await db.playerpresences.bulkPut(syncedPresence);
        }

        if (events && events.length > 0) {
          const syncedEvents = events.map((e) => ({ ...e, isSynced: 1 }));
          await db.gameevents.bulkPut(syncedEvents);
        }

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
