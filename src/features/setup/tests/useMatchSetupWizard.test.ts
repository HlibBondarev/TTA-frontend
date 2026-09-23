import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useMatchSetupWizard } from "../hooks/useMatchSetupWizard";
import { sportService } from "../../../services/sportService";
import { apiClient } from "../../../api/client";

const mockDispatch = vi.fn();

vi.mock("react-redux", () => ({
  useDispatch: () => mockDispatch,
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    user: { sub: "auth0|user-777" },
  }),
}));

vi.mock("../../../services/sportService", () => ({
  sportService: {
    getSports: vi.fn(),
    getSportConfigurations: vi.fn(),
  },
}));

vi.mock("../../../api/client", () => ({
  apiClient: {
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    sports: { bulkPut: vi.fn() },
    sportconfigurations: { bulkPut: vi.fn() },
  },
}));

describe("useMatchSetupWizard", () => {
  const mockSports = [
    {
      id: "water-polo",
      name: "Water Polo",
      shortName: "WP",
      defaultConfigId: "cfg-1",
    },
  ];

  const mockConfigs = [
    {
      id: "cfg-1",
      sportId: "water-polo",
      periodsCount: 4,
      periodDurationMinutes: 8,
      usesCleanTime: true,
      fieldSize: "30x20",
      activePlayersLimit: 7,
      rosterLimit: 13,
      lineupLimit: 13,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sportService.getSports).mockResolvedValue(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValue(
      mockConfigs,
    );
  });

  it("should load sports and default configuration on mount", async () => {
    const onQuickStart = vi.fn();

    const { result } = renderHook(() => useMatchSetupWizard({ onQuickStart }));

    expect(result.current.isLoadingSports).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoadingSports).toBe(false);
    });

    expect(sportService.getSports).toHaveBeenCalled();
    expect(sportService.getSportConfigurations).toHaveBeenCalledWith(
      "water-polo",
    );
    expect(result.current.selectedSportId).toBe("water-polo");
    expect(result.current.selectedConfigId).toBe("cfg-1");
  });

  it("should keep start button disabled until preset is saved and definitions loaded", async () => {
    const onQuickStart = vi.fn();

    const { result } = renderHook(() => useMatchSetupWizard({ onQuickStart }));

    await waitFor(() => {
      expect(result.current.isLoadingSports).toBe(false);
    });

    expect(result.current.isStartDisabled).toBe(true);

    act(() => {
      result.current.setAreDefinitionsLoaded(true);
    });

    expect(result.current.isStartDisabled).toBe(true);

    act(() => {
      result.current.setIsPresetSaved(true);
    });

    expect(result.current.isStartDisabled).toBe(false);
  });

  it("should call POST /Matches/quick and onQuickStart on confirm", async () => {
    const onQuickStart = vi.fn().mockResolvedValue(undefined);
    vi.mocked(apiClient.post).mockResolvedValue({
      id: "server-match-1",
      homeTeamId: "team-home",
      guestTeamId: "team-guest",
    });

    const { result } = renderHook(() => useMatchSetupWizard({ onQuickStart }));

    await waitFor(() => {
      expect(result.current.isLoadingSports).toBe(false);
    });

    act(() => {
      result.current.setAreDefinitionsLoaded(true);
      result.current.setIsPresetSaved(true);
    });

    await act(async () => {
      await result.current.handleConfirmQuickStart();
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/quick",
      expect.objectContaining({
        sportId: "water-polo",
        configurationId: "cfg-1",
        isGuestTeam: false,
      }),
    );

    expect(onQuickStart).toHaveBeenCalledWith(
      expect.any(String),
      "water-polo",
      "cfg-1",
      7,
      "team-home",
    );
  });

  it("should execute compensating DELETE request for posted ID if onQuickStart fails", async () => {
    const onQuickStart = vi.fn().mockRejectedValue(new Error("Local DB error"));
    vi.mocked(apiClient.post).mockResolvedValue({
      id: "server-match-1",
      homeTeamId: "team-home",
      guestTeamId: "team-guest",
    });
    vi.mocked(apiClient.delete).mockResolvedValue(undefined);

    const { result } = renderHook(() => useMatchSetupWizard({ onQuickStart }));

    await waitFor(() => {
      expect(result.current.isLoadingSports).toBe(false);
    });

    act(() => {
      result.current.setAreDefinitionsLoaded(true);
      result.current.setIsPresetSaved(true);
    });

    await act(async () => {
      await result.current.handleConfirmQuickStart();
    });

    const postCallPayload = vi.mocked(apiClient.post).mock.calls[0][1] as {
      id: string;
    };
    const postedMatchId = postCallPayload.id;

    expect(apiClient.delete).toHaveBeenCalledWith(`/Matches/${postedMatchId}`);
    expect(result.current.errorMessage).toBe("Local DB error");
  });
});
