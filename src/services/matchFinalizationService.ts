import { apiClient } from "../api/client";
import { db } from "../db/ttaDatabase";
import { processSyncQueue } from "./syncService";
import { userMatchService } from "./userMatchService";

export interface FinalizeMatchParams {
  matchId: string;
  activeTeamId: string;
  homeScore: number;
  guestScore: number;
  temperature: number | null;
}

export const matchFinalizationService = {
  /**
   * Sequentially completes match recording by syncing offline queue,
   * sending match results, linking user tracking, normalizing event times, and purging local DB.
   */
  async finalizeMatch(params: FinalizeMatchParams): Promise<void> {
    const { matchId, activeTeamId, homeScore, guestScore, temperature } =
      params;

    if (!matchId || !activeTeamId) {
      throw new Error(
        "Missing required matchId or activeTeamId for match finalization.",
      );
    }

    // Step 1: Flush all pending offline sync queue items to backend
    await processSyncQueue();

    const remainingQueueCount = await db.syncQueue.count();
    if (remainingQueueCount > 0) {
      throw new Error(
        "Cannot finalize match: offline sync queue is not empty. Please ensure all pending actions are synchronized.",
      );
    }

    // Step 2: Record match result scores and weather/water temperature
    await apiClient.put(`/Matches/${matchId}/result`, {
      homeScore,
      guestScore,
      temperature,
    });

    // Step 3: Link current user to this match context upon successful result record
    try {
      await userMatchService.catchMatch(matchId, activeTeamId);
    } catch (catchErr) {
      console.warn(
        "User match catch link creation failed or already exists:",
        catchErr,
      );
    }

    // Step 4: Trigger event time normalization for the active tracking team
    await apiClient.put(
      `/Matches/${matchId}/teams/${activeTeamId}/events/normalize`,
    );

    // Step 5: Conditionally purge local IndexedDB tables ONLY after 100% success of steps 1-4
    await db.transaction(
      "rw",
      [
        db.gameevents,
        db.timeanchors,
        db.playerpresences,
        db.matchlineups,
        db.syncQueue,
        db.matches,
        db.teams,
        db.players,
        db.playerrosters,
        db.tournaments,
        db.sportconfigurations,
        db.eventdefinitions,
        db.sports,
      ],
      async () => {
        await Promise.all([
          db.gameevents.clear(),
          db.timeanchors.clear(),
          db.playerpresences.clear(),
          db.matchlineups.clear(),
          db.syncQueue.clear(),
          db.matches.clear(),
          db.teams.clear(),
          db.players.clear(),
          db.playerrosters.clear(),
          db.tournaments.clear(),
          db.sportconfigurations.clear(),
          db.eventdefinitions.clear(),
          db.sports.clear(),
        ]);
      },
    );
  },
};
