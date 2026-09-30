import { apiClient } from "../api/client";
import type { components } from "../api/types";

export type EventDefinitionResponse =
  components["schemas"]["EventDefinitionResponse"];
export type CreateCustomEventDefinitionRequest =
  components["schemas"]["CreateCustomEventDefinitionRequest"];
export type SaveUserEventPresetRequest =
  components["schemas"]["SaveUserEventPresetRequest"];

/**
 * Service responsible for managing sport event action definitions, custom user definitions,
 * and active user presets.
 */
export const eventDefinitionService = {
  /**
   * Fetches available event definitions for a specific sport discipline, including preset status.
   */
  async getAvailableForSport(
    sportId: string,
  ): Promise<EventDefinitionResponse[]> {
    return await apiClient.get<EventDefinitionResponse[]>(
      `/Sports/${encodeURIComponent(sportId)}/event-definitions`,
    );
  },

  /**
   * Creates a new custom event definition for a specific sport discipline.
   */
  async createCustom(
    sportId: string,
    request: CreateCustomEventDefinitionRequest,
  ): Promise<EventDefinitionResponse> {
    return await apiClient.post<EventDefinitionResponse>(
      `/Sports/${encodeURIComponent(sportId)}/event-definitions/custom`,
      request,
    );
  },

  /**
   * Soft-deletes a user-owned custom event definition by its ID.
   */
  async softDeleteCustom(id: string): Promise<void> {
    await apiClient.delete<void>(
      `/event-definitions/custom/${encodeURIComponent(id)}`,
    );
  },

  /**
   * Persists the user's active event preset and action order for a specific sport discipline.
   */
  async savePreset(
    sportId: string,
    request: SaveUserEventPresetRequest,
  ): Promise<void> {
    await apiClient.put<void>(
      `/Sports/${encodeURIComponent(sportId)}/event-definitions/preset`,
      request,
    );
  },
};
