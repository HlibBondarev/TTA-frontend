import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useMatchSetupWizard } from "../hooks/useMatchSetupWizard";
import { sportService } from "../../../services/sportService";
import { apiClient } from "../../../api/client";
import { navigateToHub } from "../../../store/slices/navigationSlice";

const mockDispatch = vi.fn();

let mockUser: { sub?: string; email?: string } | undefined = {
  sub: "auth0|user-777",
};

vi.mock("react-redux", () => ({
  useDispatch: () => mockDispatch,
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    get user() {
      return mockUser;
    },
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
    {
      id: "swimming",
      name: "Swimming",
      shortName: "SW",
      defaultConfigId: "cfg-2",
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
    mockUser = { sub: "auth0|user-777" };
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

  it("should handle error when fetching sports fails", async () => {
    vi.mocked(sportService.getSports).mockRejectedValue(
      new Error("Sports load error"),
    );
    const onQuickStart = vi.fn();

    const { result } = renderHook(() => useMatchSetupWizard({ onQuickStart }));

    await waitFor(() => {
      expect(result.current.isLoadingSports).toBe(false);
    });

    expect(result.current.errorMessage).toBe("Sports load error");
  });

  it("should handle error when fetching configurations fails", async () => {
    vi.mocked(sportService.getSportConfigurations).mockRejectedValue(
      new Error("Config load error"),
    );
    const onQuickStart = vi.fn();

    const { result } = renderHook(() => useMatchSetupWizard({ onQuickStart }));

    await waitFor(() => {
      expect(result.current.isLoadingSports).toBe(false);
    });

    expect(result.current.errorMessage).toBe("Config load error");
  });

  it("should ignore sport selection if same sport is selected or form is submitting", async () => {
    const onQuickStart = vi.fn();
    const { result } = renderHook(() => useMatchSetupWizard({ onQuickStart }));

    await waitFor(() => {
      expect(result.current.isLoadingSports).toBe(false);
    });

    const initialCalls = vi.mocked(sportService.getSportConfigurations).mock
      .calls.length;

    await act(async () => {
      await result.current.handleSelectSport("water-polo");
    });

    expect(sportService.getSportConfigurations).toHaveBeenCalledTimes(
      initialCalls,
    );
  });

  it("should switch sport and load its configurations", async () => {
    const onQuickStart = vi.fn();
    const { result } = renderHook(() => useMatchSetupWizard({ onQuickStart }));

    await waitFor(() => {
      expect(result.current.isLoadingSports).toBe(false);
    });

    await act(async () => {
      await result.current.handleSelectSport("swimming");
    });

    expect(result.current.selectedSportId).toBe("swimming");
    expect(sportService.getSportConfigurations).toHaveBeenCalledWith(
      "swimming",
    );
  });

  it("should handle configuration selection", async () => {
    const onQuickStart = vi.fn();
    const { result } = renderHook(() => useMatchSetupWizard({ onQuickStart }));

    await waitFor(() => {
      expect(result.current.isLoadingSports).toBe(false);
    });

    act(() => {
      result.current.handleSelectConfig("cfg-1");
    });

    expect(result.current.selectedConfigId).toBe("cfg-1");
  });

  it("should reset wizard state when user changes", async () => {
    const onQuickStart = vi.fn();
    const { result, rerender } = renderHook(() =>
      useMatchSetupWizard({ onQuickStart }),
    );

    await waitFor(() => {
      expect(result.current.isLoadingSports).toBe(false);
    });

    act(() => {
      result.current.setIsPresetSaved(true);
      result.current.setAreDefinitionsLoaded(true);
      result.current.setIsGuestTeam(true);
    });

    mockUser = { sub: "auth0|user-888" };
    rerender();

    expect(result.current.isPresetSaved).toBe(false);
    expect(result.current.areDefinitionsLoaded).toBe(false);
    expect(result.current.isGuestTeam).toBe(false);
  });

  it("should navigate back to menu when handleBackToMenu is called", async () => {
    const onQuickStart = vi.fn();
    const { result } = renderHook(() => useMatchSetupWizard({ onQuickStart }));

    await waitFor(() => {
      expect(result.current.isLoadingSports).toBe(false);
    });

    act(() => {
      result.current.handleBackToMenu();
    });

    expect(mockDispatch).toHaveBeenCalledWith(navigateToHub());
  });

  it("should fallback configuratorUserId to anonymous when user is undefined", async () => {
    mockUser = undefined;
    const onQuickStart = vi.fn();
    const { result } = renderHook(() => useMatchSetupWizard({ onQuickStart }));

    await waitFor(() => {
      expect(result.current.isLoadingSports).toBe(false);
    });

    expect(result.current.configuratorKey).toContain("anonymous");
  });

  it("should execute compensating DELETE request for exact client match ID if onQuickStart fails", async () => {
    const expectedUuid = "mocked-client-match-uuid-12345";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      expectedUuid as `${string}-${string}-${string}-${string}-${string}`,
    );

    const onQuickStart = vi.fn().mockRejectedValue(new Error("Local DB error"));
    vi.mocked(apiClient.post).mockResolvedValue({
      id: expectedUuid,
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

    expect(apiClient.post).toHaveBeenCalledWith(
      "/Matches/quick",
      expect.objectContaining({
        id: expectedUuid,
        sportId: "water-polo",
        configurationId: "cfg-1",
        isGuestTeam: false,
      }),
    );

    expect(apiClient.delete).toHaveBeenCalledWith(`/Matches/${expectedUuid}`);
    expect(result.current.errorMessage).toBe("Local DB error");
  });
});
