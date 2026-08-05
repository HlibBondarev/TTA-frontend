import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
      activePlayersLimit: 7,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render sports and configurations correctly and allow quick starting", async () => {
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

    expect(handleQuickStart).toHaveBeenCalledWith("sport-1", "config-1");
  });
});
