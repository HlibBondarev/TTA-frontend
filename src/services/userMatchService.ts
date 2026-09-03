import { apiClient } from "../api/client";

export interface MatchWithDetailsResponse {
  id: string;
  tournamentId: string;
  tournamentName: string;
  homeTeamId: string;
  homeTeamName: string;
  guestTeamId: string;
  guestTeamName: string;
  scheduledAt: string;
  matchNumber: string | null;
  venue: string | null;
  temperature: number | null;
  homeScore: number | null;
  guestScore: number | null;
  createdAt: string;
  trackedTeamId: string;
}

export interface AddUserToTrackedMatchRequest {
  email: string;
}

export const userMatchService = {
  /**
   * Retrieves all detailed matches tracked by the authorized user.
   */
  async getCatchedMatches(): Promise<MatchWithDetailsResponse[]> {
    return apiClient.get<MatchWithDetailsResponse[]>("/Matches/catch");
  },

  /**
   * Links the authorized user to a specific match and team context for tracking.
   */
  async catchMatch(matchId: string, teamId: string): Promise<void> {
    return apiClient.post<void>(`/Matches/${matchId}/teams/${teamId}/catch`);
  },

  /**
   * Removes tracking link between the authorized user and a match/team context.
   */
  async uncatchMatch(matchId: string, teamId: string): Promise<void> {
    return apiClient.delete<void>(`/Matches/${matchId}/teams/${teamId}/catch`);
  },

  /**
   * Shares a tracked match with another user using their email address.
   */
  async addUserToTrackedMatch(
    matchId: string,
    teamId: string,
    email: string,
  ): Promise<void> {
    const payload: AddUserToTrackedMatchRequest = { email };
    return apiClient.post<void>(
      `/Matches/${matchId}/teams/${teamId}/catch/add-user`,
      payload,
    );
  },
};
