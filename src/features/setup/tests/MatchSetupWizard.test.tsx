import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MatchSetupWizard } from "../components/MatchSetupWizard";
import { useMatchSetupWizard } from "../hooks/useMatchSetupWizard";

vi.mock("../hooks/useMatchSetupWizard");

vi.mock(
  "../../event-definitions/components/EventDefinitionsConfigurator",
  () => ({
    EventDefinitionsConfigurator: (props: {
      onPresetSaved: () => void;
      onPresetModified: () => void;
      onLoadStateChange: (loaded: boolean) => void;
    }) => (
      <div data-testid="mock-event-configurator">
        <button
          type="button"
          data-testid="trigger-preset-saved"
          onClick={props.onPresetSaved}
        >
          Save
        </button>
        <button
          type="button"
          data-testid="trigger-preset-modified"
          onClick={props.onPresetModified}
        >
          Modify
        </button>
        <button
          type="button"
          data-testid="trigger-load-state"
          onClick={() => props.onLoadStateChange(true)}
        >
          Load
        </button>
      </div>
    ),
  }),
);

describe("MatchSetupWizard Component", () => {
  const mockOnQuickStart = vi.fn();

  const defaultHookReturn = {
    sports: [
      {
        id: "wp",
        name: "Water Polo",
        shortName: "WP",
        defaultConfigId: "cfg-1",
      },
    ],
    selectedSportId: "wp",
    configurations: [
      {
        id: "cfg-1",
        sportId: "wp",
        periodsCount: 4,
        periodDurationMinutes: 8,
        usesCleanTime: true,
        fieldSize: "30x20",
        activePlayersLimit: 7,
        rosterLimit: 13,
        lineupLimit: 13,
      },
    ],
    selectedConfigId: "cfg-1",
    isPresetSaved: true,
    areDefinitionsLoaded: true,
    isGuestTeam: false,
    isLoadingSports: false,
    isLoadingConfigs: false,
    isSubmitting: false,
    errorMessage: null,
    isNavDisabled: false,
    isStartDisabled: false,
    configuratorKey: "user:wp",
    setIsPresetSaved: vi.fn(),
    setAreDefinitionsLoaded: vi.fn(),
    setIsGuestTeam: vi.fn(),
    handleSelectSport: vi.fn(),
    handleSelectConfig: vi.fn(),
    handleConfirmQuickStart: vi.fn(),
    handleBackToMenu: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useMatchSetupWizard).mockReturnValue(defaultHookReturn);
  });

  it("should render loading state when sports are loading", () => {
    vi.mocked(useMatchSetupWizard).mockReturnValue({
      ...defaultHookReturn,
      isLoadingSports: true,
    });

    render(<MatchSetupWizard onQuickStart={mockOnQuickStart} />);

    expect(
      screen.getByText("Loading sports disciplines..."),
    ).toBeInTheDocument();
  });

  it("should render loading state when configurations are loading", () => {
    vi.mocked(useMatchSetupWizard).mockReturnValue({
      ...defaultHookReturn,
      isLoadingConfigs: true,
    });

    render(<MatchSetupWizard onQuickStart={mockOnQuickStart} />);

    expect(screen.getByText("Loading configurations...")).toBeInTheDocument();
  });

  it("should render empty message when configurations list is empty", () => {
    vi.mocked(useMatchSetupWizard).mockReturnValue({
      ...defaultHookReturn,
      configurations: [],
    });

    render(<MatchSetupWizard onQuickStart={mockOnQuickStart} />);

    expect(
      screen.getByText("No configurations available for this sport."),
    ).toBeInTheDocument();
  });

  it("should render sports and configuration options when loaded", () => {
    render(<MatchSetupWizard onQuickStart={mockOnQuickStart} />);

    expect(screen.getByText("Match Setup Wizard")).toBeInTheDocument();
    expect(screen.getByText("Water Polo")).toBeInTheDocument();
    expect(screen.getByTestId("mock-event-configurator")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirm & Start Tracking/i }),
    ).not.toBeDisabled();
  });

  it("should render error message if provided by hook", () => {
    vi.mocked(useMatchSetupWizard).mockReturnValue({
      ...defaultHookReturn,
      errorMessage: "Failed to connect to server",
    });

    render(<MatchSetupWizard onQuickStart={mockOnQuickStart} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to connect to server",
    );
  });

  it("should display 'Save Preset to Continue' when preset is not saved", () => {
    vi.mocked(useMatchSetupWizard).mockReturnValue({
      ...defaultHookReturn,
      isPresetSaved: false,
      isStartDisabled: true,
    });

    render(<MatchSetupWizard onQuickStart={mockOnQuickStart} />);

    const button = screen.getByRole("button", {
      name: /Save Preset to Continue/i,
    });
    expect(button).toBeDisabled();
  });

  it("should display 'Starting Quick Match...' when submitting form", () => {
    vi.mocked(useMatchSetupWizard).mockReturnValue({
      ...defaultHookReturn,
      isSubmitting: true,
      isStartDisabled: true,
    });

    render(<MatchSetupWizard onQuickStart={mockOnQuickStart} />);

    const button = screen.getByRole("button", {
      name: /Starting Quick Match.../i,
    });
    expect(button).toBeDisabled();
  });

  it("should handle sport and config button selections", () => {
    render(<MatchSetupWizard onQuickStart={mockOnQuickStart} />);

    const sportButton = screen.getByRole("button", { name: /Water Polo/i });
    fireEvent.click(sportButton);
    expect(defaultHookReturn.handleSelectSport).toHaveBeenCalledWith("wp");

    const configButton = screen.getByRole("button", { name: /Periods: 4/i });
    fireEvent.click(configButton);
    expect(defaultHookReturn.handleSelectConfig).toHaveBeenCalledWith("cfg-1");
  });

  it("should handle team focus selections (Home Squad / Opponent Squad)", () => {
    render(<MatchSetupWizard onQuickStart={mockOnQuickStart} />);

    const homeSquadButton = screen.getByRole("button", { name: /Home Squad/i });
    fireEvent.click(homeSquadButton);
    expect(defaultHookReturn.setIsGuestTeam).toHaveBeenCalledWith(false);

    const opponentSquadButton = screen.getByRole("button", {
      name: /Opponent Squad/i,
    });
    fireEvent.click(opponentSquadButton);
    expect(defaultHookReturn.setIsGuestTeam).toHaveBeenCalledWith(true);
  });

  it("should trigger EventDefinitionsConfigurator callbacks correctly", () => {
    render(<MatchSetupWizard onQuickStart={mockOnQuickStart} />);

    fireEvent.click(screen.getByTestId("trigger-preset-saved"));
    expect(defaultHookReturn.setIsPresetSaved).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByTestId("trigger-preset-modified"));
    expect(defaultHookReturn.setIsPresetSaved).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByTestId("trigger-load-state"));
    expect(defaultHookReturn.setAreDefinitionsLoaded).toHaveBeenCalledWith(
      true,
    );
  });

  it("should call handleConfirmQuickStart when clicking start button", () => {
    render(<MatchSetupWizard onQuickStart={mockOnQuickStart} />);

    const startButton = screen.getByRole("button", {
      name: /Confirm & Start Tracking/i,
    });
    fireEvent.click(startButton);

    expect(defaultHookReturn.handleConfirmQuickStart).toHaveBeenCalledTimes(1);
  });

  it("should call handleBackToMenu when clicking back button", () => {
    render(<MatchSetupWizard onQuickStart={mockOnQuickStart} />);

    const backButton = screen.getByRole("button", { name: /Back to Menu/i });
    fireEvent.click(backButton);

    expect(defaultHookReturn.handleBackToMenu).toHaveBeenCalledTimes(1);
  });
});
