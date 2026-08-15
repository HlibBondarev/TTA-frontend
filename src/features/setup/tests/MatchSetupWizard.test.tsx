import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MatchSetupWizard } from "../components/MatchSetupWizard";
import { sportService } from "../../../services/sportService";
import { teamService } from "../../../services/teamService";
import { apiClient } from "../../../api/client";
import { db } from "../../../db/ttaDatabase";
import type { TeamLookup } from "../../../db/ttaDatabase";

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
    sportconfigurations: { bulkPut: vi.fn(), put: vi.fn() },
    matches: { put: vi.fn() },
    tournaments: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
  },
}));

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
  });

  it("should render wizard steps, load teams on Quick Start, allow team selection and trigger onQuickStart", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    const handleQuickStart = vi.fn().mockResolvedValue(undefined);

    render(<MatchSetupWizard onQuickStart={handleQuickStart} />);

    expect(await screen.findByText("Water Polo")).toBeDefined();
    expect(await screen.findByText(/Periods: 4/i)).toBeDefined();

    const quickStartBtn = screen.getByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    expect(await screen.findByText("3. Select Team to Track")).toBeDefined();
    expect(screen.getByText("Home Squad")).toBeDefined();
    expect(screen.getByText("Opponent Squad")).toBeDefined();

    // Select Guest Team
    fireEvent.click(screen.getByText("Opponent Squad"));

    // Confirm tracking session
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

    render(<MatchSetupWizard onQuickStart={vi.fn()} />);

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });

    // First attempt: POST succeeds, GET fails
    fireEvent.click(quickStartBtn);

    expect(
      await screen.findByText("Failed to load match details"),
    ).toBeDefined();

    // Retry initialization
    fireEvent.click(quickStartBtn);

    expect(await screen.findByText("3. Select Team to Track")).toBeDefined();

    // Verify /Matches/quick POST was only executed once
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it("should prevent changing configuration after match initialization and preserve original configuration on confirm", async () => {
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

    const handleQuickStart = vi.fn().mockResolvedValue(undefined);

    render(<MatchSetupWizard onQuickStart={handleQuickStart} />);

    expect(await screen.findByText(/Periods: 4/i)).toBeDefined();

    // Initialize quick match (pendingMatchId is now set)
    fireEvent.click(screen.getByRole("button", { name: /Quick Start Match/i }));

    expect(await screen.findByText("3. Select Team to Track")).toBeDefined();

    // Attempt to click second configuration button
    const config2Btn = screen.getByText(/Periods: 2/i).closest("button");
    expect(config2Btn).toBeDisabled();
    if (config2Btn) {
      fireEvent.click(config2Btn);
    }

    // Confirm tracking session
    fireEvent.click(
      screen.getByRole("button", { name: /Confirm & Start Tracking/i }),
    );

    // Should still use config-1 and activePlayersLimit: 7
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

    render(<MatchSetupWizard onQuickStart={vi.fn()} />);

    expect(await screen.findByText("Network error")).toBeDefined();
  });

  it("should handle error when fetching sport configurations fails", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockRejectedValueOnce(
      new Error("Config fetch error"),
    );

    render(<MatchSetupWizard onQuickStart={vi.fn()} />);

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

    render(<MatchSetupWizard onQuickStart={vi.fn()} />);

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

    render(<MatchSetupWizard onQuickStart={vi.fn()} />);

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    expect(
      await screen.findByText("Quick match creation failed"),
    ).toBeDefined();
  });

  it("should select the first available configuration if defaultConfigId does not match any config", async () => {
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

    const handleQuickStart = vi.fn().mockResolvedValue(undefined);
    render(<MatchSetupWizard onQuickStart={handleQuickStart} />);

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
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam)
      .mockResolvedValueOnce(mockGuestTeam);

    const handleQuickStart = vi
      .fn()
      .mockImplementation(() => Promise.reject(new Error("API Timeout")));

    render(<MatchSetupWizard onQuickStart={handleQuickStart} />);

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

    const handleQuickStart = vi.fn().mockResolvedValue(undefined);

    render(<MatchSetupWizard onQuickStart={handleQuickStart} />);

    expect(await screen.findByText(/Periods: 4/i)).toBeDefined();
    expect(screen.getByText(/Periods: 2/i)).toBeDefined();

    // Select second configuration
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

    render(<MatchSetupWizard onQuickStart={vi.fn()} />);

    await waitFor(() => {
      expect(db.sports.bulkPut).toHaveBeenCalledWith(mockSports);
      expect(db.sportconfigurations.bulkPut).toHaveBeenCalledWith(mockConfigs);
    });
  });

  it("should persist selected config, match and tournament fallback to IndexedDB on handleInitMatch", async () => {
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

    render(<MatchSetupWizard onQuickStart={vi.fn()} />);

    const quickStartBtn = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartBtn);

    await waitFor(() => {
      expect(db.sportconfigurations.put).toHaveBeenCalledWith(mockConfigs[0]);
      expect(db.matches.put).toHaveBeenCalledWith(
        expect.objectContaining({ id: "match-123" }),
      );
      expect(db.tournaments.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "tourn-456",
          configurationId: "config-1",
        }),
      );
    });
  });
});
