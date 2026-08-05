import { apiClient } from "../api/client";
import type { SportLookup, SportConfigurationLookup } from "../db/ttaDatabase";

/**
 * Service responsible for fetching sports and their configuration profiles from the backend API.
 * Supports Step-1 and Step-2 of the User Initial Application Workflow.
 */
export const sportService = {
  /**
   * Retrieves the full list of available sports from the backend.
   * Corresponds to Step-1: Sport Discipline Selection.
   */
  async getSports(): Promise<SportLookup[]> {
    return await apiClient.get<SportLookup[]>("/Sports");
  },

  /**
   * Retrieves available configuration profiles associated with a specific sport discipline.
   * Corresponds to Step-2: Sport Configuration Selection.
   *
   * @param sportId - The unique identifier of the sport discipline.
   */
  async getSportConfigurations(
    sportId: string,
  ): Promise<SportConfigurationLookup[]> {
    return await apiClient.get<SportConfigurationLookup[]>(
      `/Sports/${sportId}/configurations`,
    );
  },
};
