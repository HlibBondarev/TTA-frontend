import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MatchSetupWizard } from "../components/MatchSetupWizard";
import { sportService } from "../../../services/sportService";

vi.mock("../../../services/sportService", () => ({
  sportService: {
    getSports: vi.fn(),
    getSportConfigurations: vi.fn(),
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
      name: "Swimming",
      shortName: "SW",
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
      activePlayersLimit: 5, // Non-7 limit config for testing dynamic passing
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render sports and configurations correctly and allow quick starting with activePlayersLimit", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );

    const handleQuickStart = vi.fn().mockResolvedValue(undefined);

    render(<MatchSetupWizard onQuickStart={handleQuickStart} />);

    // Wait for sports to load
    expect(await screen.findByText("Water Polo")).toBeDefined();

    // Wait for configurations to load
    expect(await screen.findByText(/Periods: 4/i)).toBeDefined();

    // Click Quick Start button using fireEvent
    const quickStartButton = screen.getByRole("button", {
      name: /Quick Start Match/i,
    });
    expect(quickStartButton).not.toBeDisabled();

    fireEvent.click(quickStartButton);

    expect(handleQuickStart).toHaveBeenCalledWith("sport-1", "config-1", 5);
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

  it("should handle sport selection change and empty configurations gracefully", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    // Initial fetch for sport-1 returns configs
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    // Subsequent fetch for sport-2 returns empty list
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce([]);

    render(<MatchSetupWizard onQuickStart={vi.fn()} />);

    expect(await screen.findByText("Swimming")).toBeDefined();

    // Click on the second sport to trigger handleSelectSport
    fireEvent.click(screen.getByText("Swimming"));

    await waitFor(() => {
      expect(
        screen.getByText("No configurations available for this sport."),
      ).toBeDefined();
    });

    expect(sportService.getSportConfigurations).toHaveBeenLastCalledWith(
      "sport-2",
    );
  });

  it("should handle error during quick start submission", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );

    const handleQuickStart = vi
      .fn()
      .mockRejectedValueOnce(new Error("Submission error"));

    render(<MatchSetupWizard onQuickStart={handleQuickStart} />);

    const quickStartButton = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartButton);

    expect(await screen.findByText("Submission error")).toBeDefined();
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

    const handleQuickStart = vi.fn().mockResolvedValue(undefined);
    render(<MatchSetupWizard onQuickStart={handleQuickStart} />);

    expect(await screen.findByText(/Periods: 2/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Quick Start Match/i }));

    expect(handleQuickStart).toHaveBeenCalledWith(
      "sport-1",
      "config-fallback",
      5,
    );
  });

  it("should handle submission error gracefully and reset submitting state", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );

    const handleQuickStart = vi
      .fn()
      .mockImplementation(() => Promise.reject(new Error("API Timeout")));

    render(<MatchSetupWizard onQuickStart={handleQuickStart} />);

    const quickStartButton = await screen.findByRole("button", {
      name: /Quick Start Match/i,
    });

    fireEvent.click(quickStartButton);

    expect(await screen.findByText("API Timeout")).toBeDefined();
    // Button should be enabled again after error handling
    expect(quickStartButton).not.toBeDisabled();
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

    const handleQuickStart = vi.fn().mockResolvedValue(undefined);

    render(<MatchSetupWizard onQuickStart={handleQuickStart} />);

    // Wait for configurations to load
    expect(await screen.findByText(/Periods: 4/i)).toBeDefined();
    expect(screen.getByText(/Periods: 2/i)).toBeDefined();

    // Click the second configuration button
    fireEvent.click(screen.getByText(/Periods: 2/i));

    // Click Quick Start button
    const quickStartButton = screen.getByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartButton);

    expect(handleQuickStart).toHaveBeenCalledWith("sport-1", "config-2", 5);
  });
});
