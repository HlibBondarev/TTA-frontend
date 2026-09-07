import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MatchSetupWizard } from "../components/MatchSetupWizard";
import { sportService } from "../../../services/sportService";
import { teamService } from "../../../services/teamService";
import { apiClient } from "../../../api/client";
import { db } from "../../../db/ttaDatabase";
import navigationReducer from "../../../store/slices/navigationSlice";
import type { TeamLookup, MatchLookup } from "../../../db/ttaDatabase";

let mockUser = { email: "tester@tta.com", sub: "auth0|user-tester" };

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

vi.mock("../../../services/teamService", () => ({
  teamService: {
    getTeamById: vi.fn(),
  },
}));

vi.mock("../../../api/client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    sports: { bulkPut: vi.fn() },
    sportconfigurations: {
      bulkPut: vi.fn(),
      put: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn(),
    },
    matches: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
    tournaments: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const createTestStore = (
  preloadedState?: Parameters<typeof configureStore>[0]["preloadedState"],
) => {
  return configureStore({
    reducer: {
      navigation: navigationReducer,
    },
    preloadedState,
  });
};

describe("MatchSetupWizard Component", () => {
  const mockSports = [
    {
      id: "sport-1",
      name: "Water Polo",
      shortName: "WP",
      defaultConfigId: "config-1",
    },
    {
      id: "sport-2",
      name: "Basketball",
      shortName: "BB",
      defaultConfigId: "config-99",
    },
  ];

  const mockConfigs = [
    {
      id: "config-1",
      sportId: "sport-1",
      usesCleanTime: true,
      periodsCount: 4,
      periodDurationMinutes: 8,
      fieldSize: "30x20",
      rosterLimit: 13,
      lineupLimit: 7,
      activePlayersLimit: 5,
    },
  ];

  const mockMatch = {
    id: "match-123",
    homeTeamId: "team-home",
    guestTeamId: "team-guest",
  };

  const mockHomeTeam: TeamLookup = {
    id: "team-home",
    clubId: "club-1",
    sportId: "sport-1",
    name: "Home Squad",
    minBirthYear: null,
    gender: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  const mockGuestTeam: TeamLookup = {
    id: "team-guest",
    clubId: "club-1",
    sportId: "sport-1",
    name: "Opponent Squad",
    minBirthYear: null,
    gender: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sportService.getSports).mockReset();
    vi.mocked(sportService.getSportConfigurations).mockReset();
    vi.mocked(teamService.getTeamById).mockReset();
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockReset();
    vi.mocked(db.sports.bulkPut).mockReset();
    vi.mocked(db.sportconfigurations.bulkPut).mockReset();
    vi.mocked(db.sportconfigurations.put).mockReset();
    vi.mocked(db.sportconfigurations.get).mockReset().mockResolvedValue(null);
    vi.mocked(db.sportconfigurations.delete).mockReset();
    vi.mocked(db.matches.put).mockReset();
    vi.mocked(db.matches.get).mockReset();
    vi.mocked(db.matches.delete).mockReset();
    vi.mocked(db.tournaments.get).mockReset().mockResolvedValue(null);
    vi.mocked(db.tournaments.put).mockReset();
    vi.mocked(db.tournaments.delete).mockReset();
    mockUser = { email: "tester@tta.com", sub: "auth0|user-tester" };
  });

  const renderWithRedux = (
    ui: React.ReactElement,
    store = createTestStore(),
  ) => {
    return {
      ...render(<Provider store={store}>{ui}</Provider>),
      store,
    };
  };

  it("should navigate back to Hub when clicking Back to Menu button", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );

    const store = createTestStore({
      navigation: { currentView: "QUICK_START" },
    });

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />, store);

    expect(store.getState().navigation.currentView).toBe("QUICK_START");

    const backBtn = await screen.findByRole("button", {
      name: /Back to Menu/i,
    });
    fireEvent.click(backBtn);

    expect(store.getState().navigation.currentView).toBe("HUB");
  });

  it("should disable Back to Menu button while quick match initialization is in progress", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );

    let resolvePostPromise: (value: { id: string }) => void;
    const postPromise = new Promise<{ id: string }>((resolve) => {
      resolvePostPromise = resolve;
    });

    vi.mocked(apiClient.post).mockReturnValueOnce(postPromise);
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    const backBtn = screen.getByRole("button", { name: /Back to Menu/i });

    expect(backBtn).not.toBeDisabled();

    fireEvent.click(quickStartBtn);

    expect(backBtn).toBeDisabled();

    resolvePostPromise!({ id: "match-123" });
    await waitFor(() => {
      expect(backBtn).not.toBeDisabled();
    });
  });

  it("should render wizard steps, load teams on Quick Start, allow team selection and trigger onQuickStart", async () => {
    const handleQuickStart = vi.fn().mockResolvedValue(undefined);

    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    renderWithRedux(<MatchSetupWizard onQuickStart={handleQuickStart} />);

    expect(await screen.findByText("Water Polo")).toBeDefined();
    expect(await screen.findByText(/Periods: 4/i)).toBeDefined();

    const quickStartBtn = screen.getByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    expect(await screen.findByText("3. Select Team to Track")).toBeDefined();
    expect(screen.getByText("Home Squad")).toBeDefined();
    expect(screen.getByText("Opponent Squad")).toBeDefined();

    fireEvent.click(screen.getByText("Opponent Squad"));

    const confirmBtn = screen.getByRole("button", {
      name: /Confirm & Start Tracking/i,
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(handleQuickStart).toHaveBeenCalledWith(
        "match-123",
        "sport-1",
        "config-1",
        5,
        "team-guest",
      );
    });
  });

  it("should reuse pendingMatchId and post to /Matches/quick only once on retry when team loading fails", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get)
      .mockRejectedValueOnce(new Error("Failed to load match details"))
      .mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });

    fireEvent.click(quickStartBtn);

    expect(
      await screen.findByText("Failed to load match details"),
    ).toBeDefined();

    fireEvent.click(quickStartBtn);

    expect(await screen.findByText("3. Select Team to Track")).toBeDefined();

    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it("should reject operation and reset pendingMatchId when quick match POST returns an invalid or empty id", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "   " });

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    expect(
      await screen.findByText("Failed to initialize quick match session."),
    ).toBeDefined();

    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-456" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    fireEvent.click(quickStartBtn);

    expect(await screen.findByText("3. Select Team to Track")).toBeDefined();
    expect(apiClient.post).toHaveBeenCalledTimes(2);
  });

  it("should handle incomplete match response during initialization step", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      id: "match-123",
    } as MatchLookup);

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    expect(
      await screen.findByText("Failed to load match details."),
    ).toBeDefined();
  });

  it("should reject match initialization when match object contains blank team identifiers", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      id: "match-123",
      homeTeamId: "   ",
      guestTeamId: "team-guest",
    } as MatchLookup);

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    expect(
      await screen.findByText("Failed to load match details."),
    ).toBeDefined();
  });

  it("should reject match initialization when match object contains non-string team identifiers", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      id: "match-123",
      homeTeamId: 12345 as unknown as string,
      guestTeamId: "team-guest",
    } as MatchLookup);

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    expect(
      await screen.findByText("Failed to load match details."),
    ).toBeDefined();
  });

  it("should normalize match and team identifiers with whitespace before persisting and fetching teams", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: " match-123 " });
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      id: " match-123 ",
      homeTeamId: " team-home ",
      guestTeamId: " team-guest ",
      tournamentId: " tourn-789 ",
    } as MatchLookup);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    await waitFor(() => {
      expect(db.matches.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "match-123",
          homeTeamId: "team-home",
          guestTeamId: "team-guest",
          tournamentId: "tourn-789",
          userId: "auth0|user-tester",
        }),
      );
      expect(teamService.getTeamById).toHaveBeenCalledWith("team-home");
      expect(teamService.getTeamById).toHaveBeenCalledWith("team-guest");
    });
  });

  it("should normalize whitespace-only tournamentId to an empty string and prevent persistence", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      id: "match-123",
      homeTeamId: "team-home",
      guestTeamId: "team-guest",
      tournamentId: "   ",
    } as MatchLookup);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    await waitFor(() => {
      expect(db.matches.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "match-123",
          tournamentId: "",
        }),
      );
      expect(db.tournaments.put).not.toHaveBeenCalled();
    });
  });

  it("should prevent changing configuration after match initialization and preserve original configuration on confirm", async () => {
    const handleQuickStart = vi.fn().mockResolvedValue(undefined);
    const multipleConfigs = [
      {
        id: "config-1",
        sportId: "sport-1",
        usesCleanTime: true,
        periodsCount: 4,
        periodDurationMinutes: 8,
        fieldSize: "30x20",
        rosterLimit: 13,
        lineupLimit: 7,
        activePlayersLimit: 7,
      },
      {
        id: "config-2",
        sportId: "sport-1",
        usesCleanTime: false,
        periodsCount: 2,
        periodDurationMinutes: 20,
        fieldSize: "40x25",
        rosterLimit: 15,
        lineupLimit: 5,
        activePlayersLimit: 5,
      },
    ];

    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      multipleConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    renderWithRedux(<MatchSetupWizard onQuickStart={handleQuickStart} />);

    expect(await screen.findByText(/Periods: 4/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Quick Start Match/i }));

    expect(await screen.findByText("3. Select Team to Track")).toBeDefined();

    const config2Btn = screen.getByText(/Periods: 2/i).closest("button");
    expect(config2Btn).toBeDisabled();
    if (config2Btn) {
      fireEvent.click(config2Btn);
    }

    fireEvent.click(
      screen.getByRole("button", { name: /Confirm & Start Tracking/i }),
    );

    await waitFor(() => {
      expect(handleQuickStart).toHaveBeenCalledWith(
        "match-123",
        "sport-1",
        "config-1",
        7,
        "team-home",
      );
    });
  });

  it("should handle error when fetching sports fails", async () => {
    vi.mocked(sportService.getSports).mockRejectedValueOnce(
      new Error("Network error"),
    );

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    expect(await screen.findByText("Network error")).toBeDefined();
  });

  it("should handle error when fetching sport configurations fails", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockRejectedValueOnce(
      new Error("Config fetch error"),
    );

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    expect(await screen.findByText("Config fetch error")).toBeDefined();
    expect(
      screen.getByText("No configurations available for this sport."),
    ).toBeDefined();
  });

  it("should handle sport selection change and reset draft state", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce([]);

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    expect(await screen.findByText("Basketball")).toBeDefined();

    fireEvent.click(screen.getByText("Basketball"));

    await waitFor(() => {
      expect(
        screen.getByText("No configurations available for this sport."),
      ).toBeDefined();
    });

    expect(sportService.getSportConfigurations).toHaveBeenLastCalledWith(
      "sport-2",
    );
  });

  it("should handle error during match initialization step", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockRejectedValueOnce(
      new Error("Quick match creation failed"),
    );

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    expect(
      await screen.findByText("Quick match creation failed"),
    ).toBeDefined();
  });

  it("should select the first available configuration if defaultConfigId does not match any config", async () => {
    const handleQuickStart = vi.fn().mockResolvedValue(undefined);
    const modifiedSports = [
      {
        id: "sport-1",
        name: "Water Polo",
        shortName: "WP",
        defaultConfigId: "non-existent-config",
      },
    ];

    const multipleConfigs = [
      {
        id: "config-fallback",
        sportId: "sport-1",
        usesCleanTime: false,
        periodsCount: 2,
        periodDurationMinutes: 15,
        fieldSize: "20x10",
        rosterLimit: 10,
        lineupLimit: 5,
        activePlayersLimit: 5,
      },
    ];

    vi.mocked(sportService.getSports).mockResolvedValueOnce(modifiedSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      multipleConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    renderWithRedux(<MatchSetupWizard onQuickStart={handleQuickStart} />);

    expect(await screen.findByText(/Periods: 2/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Quick Start Match/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Confirm & Start Tracking/i }),
    );

    await waitFor(() => {
      expect(handleQuickStart).toHaveBeenCalledWith(
        "match-123",
        "sport-1",
        "config-fallback",
        5,
        "team-home",
      );
    });
  });

  it("should handle submission error during final confirmation gracefully and reset submitting state", async () => {
    const handleQuickStart = vi
      .fn()
      .mockImplementation(() => Promise.reject(new Error("API Timeout")));

    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    renderWithRedux(<MatchSetupWizard onQuickStart={handleQuickStart} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Quick Start Match/i }),
    );

    const confirmBtn = await screen.findByRole("button", {
      name: /Confirm & Start Tracking/i,
    });
    fireEvent.click(confirmBtn);

    expect(await screen.findByText("API Timeout")).toBeDefined();
    expect(confirmBtn).not.toBeDisabled();
  });

  it("should allow selecting a different configuration when multiple configurations are available", async () => {
    const handleQuickStart = vi.fn().mockResolvedValue(undefined);
    const multipleConfigs = [
      {
        id: "config-1",
        sportId: "sport-1",
        usesCleanTime: true,
        periodsCount: 4,
        periodDurationMinutes: 8,
        fieldSize: "30x20",
        rosterLimit: 13,
        lineupLimit: 7,
        activePlayersLimit: 7,
      },
      {
        id: "config-2",
        sportId: "sport-1",
        usesCleanTime: false,
        periodsCount: 2,
        periodDurationMinutes: 20,
        fieldSize: "40x25",
        rosterLimit: 15,
        lineupLimit: 5,
        activePlayersLimit: 5,
      },
    ];

    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      multipleConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    renderWithRedux(<MatchSetupWizard onQuickStart={handleQuickStart} />);

    expect(await screen.findByText(/Periods: 4/i)).toBeDefined();
    expect(screen.getByText(/Periods: 2/i)).toBeDefined();

    fireEvent.click(screen.getByText(/Periods: 2/i));

    fireEvent.click(screen.getByRole("button", { name: /Quick Start Match/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Confirm & Start Tracking/i }),
    );

    await waitFor(() => {
      expect(handleQuickStart).toHaveBeenCalledWith(
        "match-123",
        "sport-1",
        "config-2",
        5,
        "team-home",
      );
    });
  });

  it("should persist loaded sports and configurations into IndexedDB", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    await waitFor(() => {
      expect(db.sports.bulkPut).toHaveBeenCalledWith(mockSports);
      expect(db.sportconfigurations.bulkPut).toHaveBeenCalledWith(mockConfigs);
    });
  });

  it("should persist selected config, match with userId and tournament fallback to IndexedDB on handleInitMatch", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({
        id: "match-123",
        tournamentId: "tourn-456",
        homeTeamId: "team-home",
        guestTeamId: "team-guest",
      })
      .mockRejectedValueOnce(new Error("Tournament not found"));

    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    await waitFor(() => {
      expect(db.sportconfigurations.put).toHaveBeenCalledWith(mockConfigs[0]);
      expect(db.matches.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "match-123",
          userId: "auth0|user-tester",
        }),
      );
      expect(db.tournaments.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "tourn-456",
          configurationId: "config-1",
        }),
      );
    });
  });

  it("should ignore stale configuration state updates if sport selection changes during bulkPut", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations)
      .mockResolvedValueOnce(mockConfigs)
      .mockResolvedValueOnce([]);

    vi.mocked(db.sportconfigurations.bulkPut).mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(["config-1"]), 50),
        ) as unknown as ReturnType<typeof db.sportconfigurations.bulkPut>,
    );

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    expect(await screen.findByText("Water Polo")).toBeDefined();

    fireEvent.click(screen.getByText("Basketball"));

    await waitFor(() => {
      expect(
        screen.getByText("No configurations available for this sport."),
      ).toBeDefined();
    });
  });

  it("should reset pending match draft state when authenticated user identity changes while mounted", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ id: "match-user1" })
      .mockResolvedValueOnce({ id: "match-user2" });
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({
        id: "match-user1",
        homeTeamId: "team-home",
        guestTeamId: "team-guest",
      } as MatchLookup)
      .mockResolvedValueOnce({
        id: "match-user2",
        homeTeamId: "team-home",
        guestTeamId: "team-guest",
      } as MatchLookup);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    const { rerender, store } = renderWithRedux(
      <MatchSetupWizard onQuickStart={vi.fn()} />,
    );

    expect(await screen.findByText("Water Polo")).toBeDefined();

    const quickStartBtn = screen.getByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    expect(await screen.findByText("3. Select Team to Track")).toBeDefined();
    expect(apiClient.post).toHaveBeenCalledTimes(1);

    // Change authenticated user identity while wizard remains mounted
    mockUser = { email: "newuser@tta.com", sub: "auth0|user-new" };
    rerender(
      <Provider store={store}>
        <MatchSetupWizard onQuickStart={vi.fn()} />
      </Provider>,
    );

    // Pending draft state should be reset
    await waitFor(() => {
      expect(screen.queryByText("3. Select Team to Track")).toBeNull();
    });

    // Clicking Quick Start again should trigger a new quick match creation for the new user
    const quickStartBtn2 = screen.getByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn2);

    expect(await screen.findByText("3. Select Team to Track")).toBeDefined();
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    expect(db.matches.put).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "match-user2",
        userId: "auth0|user-new",
      }),
    );
  });

  it("should reject operation and reset draft state when pendingMatchId belongs to a different user in IndexedDB", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockRejectedValueOnce(
      new Error("Transient fetch error"),
    );

    renderWithRedux(<MatchSetupWizard onQuickStart={vi.fn()} />);

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    expect(await screen.findByText("Transient fetch error")).toBeDefined();

    // Simulate local db.matches returning an existing match owned by another user for this matchId
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "match-123",
      userId: "auth0|other-user",
    } as never);

    // Simulate retrying handleInitMatch with pendingMatchId still in state
    fireEvent.click(quickStartBtn);

    expect(
      await screen.findByText("Match session belongs to another user."),
    ).toBeDefined();

    expect(screen.queryByText("3. Select Team to Track")).toBeNull();
  });

  it("should delete persisted match record if user identity changes while db.matches.put is pending", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    let resolvePut: () => void;
    const putPromise = new Promise<void>((resolve) => {
      resolvePut = resolve;
    });

    vi.mocked(db.matches.put).mockImplementationOnce(() => putPromise as never);

    const { rerender, store } = renderWithRedux(
      <MatchSetupWizard onQuickStart={vi.fn()} />,
    );

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    await waitFor(() => {
      expect(db.matches.put).toHaveBeenCalled();
    });

    // Change authenticated user identity while db.matches.put is pending
    mockUser = { email: "user2@tta.com", sub: "auth0|user-2" };
    rerender(
      <Provider store={store}>
        <MatchSetupWizard onQuickStart={vi.fn()} />
      </Provider>,
    );

    // Resolve the pending db.matches.put write operation
    resolvePut!();

    // Verify post-write rollback triggered db.matches.delete to clean up the stale match record
    await waitFor(() => {
      expect(db.matches.delete).toHaveBeenCalledWith("match-123");
      expect(screen.queryByText("3. Select Team to Track")).toBeNull();
    });
  });

  it("should NOT delete existing match record if record existed before put and user identity changes while pending", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    // Simulate match already existing in IndexedDB before write
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "match-123",
      userId: "auth0|user-tester",
    } as never);

    let resolvePut: () => void;
    const putPromise = new Promise<void>((resolve) => {
      resolvePut = resolve;
    });

    vi.mocked(db.matches.put).mockImplementationOnce(() => putPromise as never);

    const { rerender, store } = renderWithRedux(
      <MatchSetupWizard onQuickStart={vi.fn()} />,
    );

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    await waitFor(() => {
      expect(db.matches.put).toHaveBeenCalled();
    });

    // Change authenticated user identity while db.matches.put is pending
    mockUser = { email: "user2@tta.com", sub: "auth0|user-2" };
    rerender(
      <Provider store={store}>
        <MatchSetupWizard onQuickStart={vi.fn()} />
      </Provider>,
    );

    // Resolve the pending db.matches.put write operation and await its microtask continuation
    resolvePut!();
    await putPromise;
    // Allow post-write verifyFreshness & try/catch error handler in persistMatchLocally to execute
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert wizard UI reset to initial step for new user
    expect(screen.queryByText("3. Select Team to Track")).toBeNull();

    // Verify db.matches.delete was strictly NOT called because the record existed prior to write
    expect(db.matches.delete).not.toHaveBeenCalled();
  });

  it("should reset isSubmitting and isLoadingTeams flags when authenticated user identity changes while init is in progress", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );

    let resolvePost: (val: { id: string }) => void;
    const postPromise = new Promise<{ id: string }>((resolve) => {
      resolvePost = resolve;
    });

    vi.mocked(apiClient.post).mockReturnValueOnce(postPromise);

    const { rerender, store } = renderWithRedux(
      <MatchSetupWizard onQuickStart={vi.fn()} />,
    );

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    // Verify button shows loading text during POST
    expect(
      screen.getByRole("button", { name: /Initializing Match\.\.\./i }),
    ).toBeDefined();

    // Change authenticated user identity while POST is pending
    mockUser = { email: "user2@tta.com", sub: "auth0|user-2" };
    rerender(
      <Provider store={store}>
        <MatchSetupWizard onQuickStart={vi.fn()} />
      </Provider>,
    );

    // Button should immediately revert to normal state and be enabled for the new account
    await waitFor(() => {
      const activeBtn = screen.getByRole("button", {
        name: /Quick Start Match/i,
      });
      expect(activeBtn).not.toBeDisabled();
    });

    resolvePost!({ id: "match-deferred-123" });
  });

  it("should invalidate in-flight match initialization if user identity changes before async operations resolve", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );

    let resolvePost: (val: { id: string }) => void;
    const postPromise = new Promise<{ id: string }>((resolve) => {
      resolvePost = resolve;
    });

    vi.mocked(apiClient.post).mockReturnValueOnce(postPromise);

    const { rerender, store } = renderWithRedux(
      <MatchSetupWizard onQuickStart={vi.fn()} />,
    );

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    // Wait until apiClient.post has been invoked and is in-flight
    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledTimes(1);
    });

    // Change user while POST is pending
    mockUser = { email: "newuser@tta.com", sub: "auth0|user-new" };
    rerender(
      <Provider store={store}>
        <MatchSetupWizard onQuickStart={vi.fn()} />
      </Provider>,
    );

    // Resolve POST request after user change
    resolvePost!({ id: "match-deferred-123" });

    // Assert post-invalidation outcomes
    await waitFor(() => {
      expect(screen.queryByText("3. Select Team to Track")).toBeNull();
    });

    expect(db.matches.put).not.toHaveBeenCalled();
  });

  it("should clear error message when authenticated user identity changes", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );

    // Reject POST request directly to prevent proceeding to GET details fetch
    vi.mocked(apiClient.post).mockRejectedValueOnce(
      new Error("User 1 error message"),
    );

    const { rerender, store } = renderWithRedux(
      <MatchSetupWizard onQuickStart={vi.fn()} />,
    );

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    // Assert initial error message from User 1 is displayed
    expect(await screen.findByText("User 1 error message")).toBeDefined();

    // Prepare fresh resolution mocks for User 2 reconnect flow
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-user2" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    // Change authenticated user identity while wizard remains mounted
    mockUser = { email: "user2@tta.com", sub: "auth0|user-2" };

    // Rerender component with updated mockUser context
    rerender(
      <Provider store={store}>
        <MatchSetupWizard onQuickStart={vi.fn()} />
      </Provider>,
    );

    // Verify error banner is completely cleared for the new user
    await waitFor(() => {
      expect(screen.queryByText("User 1 error message")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("should abort IndexedDB writes, purge stale config write, and cancel match setup if user account changes before saveSelectedConfig completes", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );

    let resolveConfigPut: () => void;
    const configPutPromise = new Promise<void>((resolve) => {
      resolveConfigPut = resolve;
    });

    vi.mocked(db.sportconfigurations.put).mockImplementationOnce(
      () => configPutPromise as never,
    );

    const { rerender, store } = renderWithRedux(
      <MatchSetupWizard onQuickStart={vi.fn()} />,
    );

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    // Wait until saveSelectedConfig has initiated db.sportconfigurations.put and is pending
    await waitFor(() => {
      expect(db.sportconfigurations.put).toHaveBeenCalledWith(mockConfigs[0]);
    });

    // Change authenticated user identity while saveSelectedConfig is pending
    mockUser = { email: "user2@tta.com", sub: "auth0|user-2" };
    rerender(
      <Provider store={store}>
        <MatchSetupWizard onQuickStart={vi.fn()} />
      </Provider>,
    );

    // Resolve pending config put
    resolveConfigPut!();
    await configPutPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify stale config was purged and subsequent IndexedDB match writes were aborted
    expect(db.sportconfigurations.delete).toHaveBeenCalledWith("config-1");
    expect(db.matches.put).not.toHaveBeenCalled();
    expect(screen.queryByText("3. Select Team to Track")).toBeNull();
  });

  it("should delete fetched tournament record if user identity changes while db.tournaments.put is pending in ensureTournamentPersisted", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({
        id: "match-123",
        tournamentId: "tourn-fetched-456",
        homeTeamId: "team-home",
        guestTeamId: "team-guest",
      })
      .mockResolvedValueOnce({
        id: "tourn-fetched-456",
        sportId: "sport-1",
        configurationId: "config-1",
      });

    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    let resolveTournPut: () => void;
    const tournPutPromise = new Promise<void>((resolve) => {
      resolveTournPut = resolve;
    });

    vi.mocked(db.tournaments.put).mockImplementationOnce(
      () => tournPutPromise as never,
    );

    const { rerender, store } = renderWithRedux(
      <MatchSetupWizard onQuickStart={vi.fn()} />,
    );

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    await waitFor(() => {
      expect(db.tournaments.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "tourn-fetched-456",
        }),
      );
    });

    // Change authenticated user identity while db.tournaments.put is pending
    mockUser = { email: "user2@tta.com", sub: "auth0|user-2" };
    rerender(
      <Provider store={store}>
        <MatchSetupWizard onQuickStart={vi.fn()} />
      </Provider>,
    );

    // Resolve the pending db.tournaments.put write operation
    resolveTournPut!();
    await tournPutPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify post-write rollback triggered db.tournaments.delete to clean up the stale fetched tournament
    await waitFor(() => {
      expect(db.tournaments.delete).toHaveBeenCalledWith("tourn-fetched-456");
      expect(screen.queryByText("3. Select Team to Track")).toBeNull();
    });
  });

  it("should delete fallback tournament record if user identity changes while fallback db.tournaments.put is pending in ensureTournamentPersisted", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({
        id: "match-123",
        tournamentId: "tourn-fallback-789",
        homeTeamId: "team-home",
        guestTeamId: "team-guest",
      })
      .mockRejectedValueOnce(new Error("Tournament fetch failed 404"));

    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    let resolveFallbackPut: () => void;
    const fallbackPutPromise = new Promise<void>((resolve) => {
      resolveFallbackPut = resolve;
    });

    vi.mocked(db.tournaments.put).mockImplementationOnce(
      () => fallbackPutPromise as never,
    );

    const { rerender, store } = renderWithRedux(
      <MatchSetupWizard onQuickStart={vi.fn()} />,
    );

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    await waitFor(() => {
      expect(db.tournaments.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "tourn-fallback-789",
          name: "Quick Tournament",
        }),
      );
    });

    // Change authenticated user identity while fallback db.tournaments.put is pending
    mockUser = { email: "user2@tta.com", sub: "auth0|user-2" };
    rerender(
      <Provider store={store}>
        <MatchSetupWizard onQuickStart={vi.fn()} />
      </Provider>,
    );

    // Resolve the pending fallback db.tournaments.put write operation
    resolveFallbackPut!();
    await fallbackPutPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify post-write rollback triggered db.tournaments.delete to clean up the stale fallback tournament
    await waitFor(() => {
      expect(db.tournaments.delete).toHaveBeenCalledWith("tourn-fallback-789");
      expect(screen.queryByText("3. Select Team to Track")).toBeNull();
    });
  });
});
