import { apiClient } from "../api/client";
import type { components } from "../api/types";

export type TeamMatchSummaryReportResponse =
  components["schemas"]["TeamMatchSummaryReportResponse"];

export type PlayerDetailedMatchReportResponse =
  components["schemas"]["PlayerDetailedMatchReportResponse"];

export type PlayerDetailedEventResponse =
  components["schemas"]["PlayerDetailedEventResponse"];

/**
 * Service for retrieving match performance and TTA reports from WebAPI.
 */
export const reportService = {
  /**
   * Fetches the team summary TTA report for all participating players in a match.
   * @param matchId The unique identifier of the match.
   * @param teamId The unique identifier of the team.
   */
  async getTeamSummaryReport(
    matchId: string,
    teamId: string,
  ): Promise<TeamMatchSummaryReportResponse[]> {
    return apiClient.get<TeamMatchSummaryReportResponse[]>(
      `/Matches/${matchId}/teams/${teamId}/reports/summary`,
    );
  },

  /**
   * Fetches detailed TTA events chronology for an individual player match lineup entry.
   * @param matchId The unique identifier of the match.
   * @param matchLineupId The unique identifier of the match lineup entry.
   */
  async getPlayerDetailedReport(
    matchId: string,
    matchLineupId: string,
  ): Promise<PlayerDetailedMatchReportResponse> {
    return apiClient.get<PlayerDetailedMatchReportResponse>(
      `/Matches/${matchId}/lineups/${matchLineupId}/reports/detailed`,
    );
  },
};
