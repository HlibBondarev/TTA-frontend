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
        apiClient.get<MatchLookup>(`/Matches/${matchId}`).catch(() => null),
        apiClient
          .get<MatchLineupLookup[]>(`/Matches/${matchId}/lineups`)
          .catch(() => []),
        apiClient
          .get<TimeAnchor[]>(`/Matches/${matchId}/anchors`)
          .catch(() => []),
        apiClient
          .get<PlayerPresence[]>(`/Matches/${matchId}/presence`)
          .catch(() => []),
        apiClient
          .get<GameEvent[]>(`/Matches/${matchId}/events`)
          .catch(() => []),
        apiClient
          .get<EventDefinitionLookup[]>(`/Matches/${matchId}/eventdefinitions`)
          .catch(() => []),
      ]);

    // If completely offline or backend unavailable on initial run
    if (!match && lineups.length === 0) {
      console.warn("Backend unavailable. Hydrating via local seed.");
      await seedTestData();
      return { success: true, isOfflineFallback: true };
    }

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

        if (lineups.length > 0) {
          await db.matchlineups.where("matchId").equals(matchId).delete();
          await db.matchlineups.bulkPut(lineups);
        }

        if (anchors.length > 0) {
          const syncedAnchors = anchors.map((a) => ({ ...a, isSynced: 1 }));
          await db.timeanchors.where("matchId").equals(matchId).delete();
          await db.timeanchors.bulkPut(syncedAnchors);
        }

        if (presence.length > 0) {
          const syncedPresence = presence.map((p) => ({ ...p, isSynced: 1 }));
          await db.playerpresences.bulkPut(syncedPresence);
        }

        if (events.length > 0) {
          const syncedEvents = events.map((e) => ({ ...e, isSynced: 1 }));
          await db.gameevents.bulkPut(syncedEvents);
        }

        if (definitions.length > 0) {
          await db.eventdefinitions.bulkPut(definitions);
        }
      },
    );

    return { success: true, isOfflineFallback: false };
  } catch (err) {
    console.error("Hydration failed, using local seed fallback:", err);
    await seedTestData();
    return { success: true, isOfflineFallback: true };
  }
};
