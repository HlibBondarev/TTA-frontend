import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MatchSetupWizard } from "../components/MatchSetupWizard";
import { sportService } from "../../../services/sportService";
import { teamService } from "../../../services/teamService";
import { apiClient } from "../../../api/client";

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

  const mockHomeTeam = { id: "team-home", name: "Home Squad" };
  const mockGuestTeam = { id: "team-guest", name: "Opponent Squad" };

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
      .mockResolvedValueOnce(mockHomeTeam as never)
      .mockResolvedValueOnce(mockGuestTeam as never);

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

    expect(handleQuickStart).toHaveBeenCalledWith(
      "sport-1",
      "config-1",
      5,
      "team-guest",
    );
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
      .mockResolvedValueOnce(mockHomeTeam as never)
      .mockResolvedValueOnce(mockGuestTeam as never);

    const handleQuickStart = vi.fn().mockResolvedValue(undefined);
    render(<MatchSetupWizard onQuickStart={handleQuickStart} />);

    expect(await screen.findByText(/Periods: 2/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Quick Start Match/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Confirm & Start Tracking/i }),
    );

    expect(handleQuickStart).toHaveBeenCalledWith(
      "sport-1",
      "config-fallback",
      5,
      "team-home",
    );
  });

  it("should handle submission error during final confirmation gracefully and reset submitting state", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "match-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam as never)
      .mockResolvedValueOnce(mockGuestTeam as never);

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
      .mockResolvedValueOnce(mockHomeTeam as never)
      .mockResolvedValueOnce(mockGuestTeam as never);

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

    expect(handleQuickStart).toHaveBeenCalledWith(
      "sport-1",
      "config-2",
      5,
      "team-home",
    );
  });
});
