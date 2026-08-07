import { apiClient } from "../api/client";
import type { TeamLookup } from "../db/ttaDatabase";

/**
 * Service responsible for fetching team entity details from the backend API.
 */
export const teamService = {
  /**
   * Retrieves team details by its unique identifier.
   *
   * @param teamId - The unique identifier of the target team.
   */
  async getTeamById(teamId: string): Promise<TeamLookup> {
    return await apiClient.get<TeamLookup>(
      `/Teams/${encodeURIComponent(teamId)}`,
    );
  },
};
