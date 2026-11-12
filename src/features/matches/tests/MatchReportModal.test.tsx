import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MatchReportModal } from "../components/MatchReportModal";
import { reportService } from "../../../services/reportService";
import { db } from "../../../db/ttaDatabase";

vi.mock("../../../services/reportService", () => ({
  reportService: {
    getTeamSummaryReport: vi.fn(),
    getPlayerDetailedReport: vi.fn(),
  },
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matches: {
      get: vi.fn(),
    },
    tournaments: {
      get: vi.fn(),
    },
    sportconfigurations: {
      get: vi.fn(),
    },
  },
}));

vi.mock("../../reports/components/MatchSpatialReportView", () => ({
  MatchSpatialReportView: ({
    matchId,
    teamId,
    playground,
    shotMap,
    onBack,
  }: {
    matchId: string;
    teamId: string;
    playground?: string | null;
    shotMap?: string | null;
    onBack?: () => void;
  }) => (
    <div data-testid="match-spatial-report-view">
      <span>
        Spatial View for Match {matchId}, Team {teamId}
      </span>
      {playground && <span>SVG: {playground}</span>}
      {shotMap && <span>SHOT_SVG: {shotMap}</span>}
      <button type="button" onClick={onBack}>
        Back from Spatial
      </button>
    </div>
  ),
}));

describe("MatchReportModal Component", () => {
  const defaultProps = {
    isOpen: true,
    matchId: "match-101",
    teamId: "team-202",
    teamName: "Home Squad",
    onClose: vi.fn(),
  };

  const mockTeamSummary = [
    {
      matchLineupId: "lineup-1",
      firstName: "Michael",
      lastName: "Jordan",
      number: 23,
      goals: 5,
      positiveGoalLeadingActions: 2,
      negativeGoalLeadingActions: 0,
      totalPositiveActions: 12,
      totalNegativeActions: 2,
      playPercentage: 95.0,
    },
  ];

  const mockPlayerDetailed = {
    firstName: "Michael",
    lastName: "Jordan",
    number: 23,
    events: [
      {
        eventName: "Goal",
        isPositive: true,
        periodNumber: 1,
        eventTimestamp: "2026-08-18T12:00:00Z",
        normalizedMatchTime: "00:03:00",
        isLeadToGoal: true,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = vi.fn(function (
        this: HTMLDialogElement,
      ) {
        this.open = true;
      });
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = vi.fn(function (
        this: HTMLDialogElement,
      ) {
        this.open = false;
      });
    }

    vi.mocked(db.matches.get).mockResolvedValue(undefined as never);
  });

  it("does not render when isOpen is false", () => {
    render(<MatchReportModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("fetches and renders team summary report when opened", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce(
      mockTeamSummary,
    );

    render(<MatchReportModal {...defaultProps} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Team TTA Summary Report")).toBeInTheDocument();

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenCalledWith(
        "match-101",
        "team-202",
      );
      expect(
        screen.getByRole("button", { name: /Michael Jordan/i }),
      ).toBeInTheDocument();
    });
  });

  it("fetches SVG layout configuration from Dexie database when playground/shotMap props are missing", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce(
      mockTeamSummary,
    );
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "match-101",
      tournamentId: "tour-1",
    } as never);
    vi.mocked(db.tournaments.get).mockResolvedValueOnce({
      id: "tour-1",
      configurationId: "config-1",
    } as never);
    vi.mocked(db.sportconfigurations.get).mockResolvedValueOnce({
      id: "config-1",
      playground: "<svg>Court SVG</svg>",
      shotMap: "<svg>Goal SVG</svg>",
    } as never);

    render(<MatchReportModal {...defaultProps} />);

    await waitFor(() => {
      expect(db.matches.get).toHaveBeenCalledWith("match-101");
      expect(db.tournaments.get).toHaveBeenCalledWith("tour-1");
      expect(db.sportconfigurations.get).toHaveBeenCalledWith("config-1");
    });

    const spatialTab = screen.getByRole("button", { name: /📍 Spatial Map/i });
    fireEvent.click(spatialTab);

    expect(screen.getByText("SVG: <svg>Court SVG</svg>")).toBeInTheDocument();
    expect(
      screen.getByText("SHOT_SVG: <svg>Goal SVG</svg>"),
    ).toBeInTheDocument();
  });

  it("auto-selects guest team tab when home team report has zero recorded actions and guest team has actions", async () => {
    const mockEmptyHomeSummary = [
      {
        matchLineupId: "lineup-home-1",
        firstName: "Home",
        lastName: "Player",
        number: 1,
        goals: 0,
        positiveGoalLeadingActions: 0,
        negativeGoalLeadingActions: 0,
        totalPositiveActions: 0,
        totalNegativeActions: 0,
        playPercentage: 100.0,
      },
    ];

    const mockGuestSummary = [
      {
        matchLineupId: "lineup-guest-1",
        firstName: "Guest",
        lastName: "Player",
        number: 10,
        goals: 2,
        positiveGoalLeadingActions: 1,
        negativeGoalLeadingActions: 0,
        totalPositiveActions: 8,
        totalNegativeActions: 1,
        playPercentage: 90.0,
      },
    ];

    vi.mocked(reportService.getTeamSummaryReport)
      .mockResolvedValueOnce(mockEmptyHomeSummary)
      .mockResolvedValueOnce(mockGuestSummary);

    render(
      <MatchReportModal
        {...defaultProps}
        guestTeamId="guest-team-303"
        guestTeamName="Opponent Squad"
      />,
    );

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenCalledWith(
        "match-101",
        "team-202",
      );
      expect(reportService.getTeamSummaryReport).toHaveBeenCalledWith(
        "match-101",
        "guest-team-303",
      );
      expect(
        screen.getByRole("button", { name: /Guest Player/i }),
      ).toBeInTheDocument();
    });
  });

  it("preserves guest team selection when guest summary report promise resolves after a delay", async () => {
    const mockEmptyHomeSummary = [
      {
        matchLineupId: "lineup-home-1",
        firstName: "Home",
        lastName: "Player",
        number: 1,
        goals: 0,
        positiveGoalLeadingActions: 0,
        negativeGoalLeadingActions: 0,
        totalPositiveActions: 0,
        totalNegativeActions: 0,
        playPercentage: 100.0,
      },
    ];

    const mockGuestSummary = [
      {
        matchLineupId: "lineup-guest-1",
        firstName: "Guest",
        lastName: "Player",
        number: 10,
        goals: 2,
        positiveGoalLeadingActions: 1,
        negativeGoalLeadingActions: 0,
        totalPositiveActions: 8,
        totalNegativeActions: 1,
        playPercentage: 90.0,
      },
    ];

    let resolveGuestReport: (value: typeof mockGuestSummary) => void;
    const guestReportPromise = new Promise<typeof mockGuestSummary>(
      (resolve) => {
        resolveGuestReport = resolve;
      },
    );

    vi.mocked(reportService.getTeamSummaryReport)
      .mockResolvedValueOnce(mockEmptyHomeSummary)
      .mockReturnValueOnce(guestReportPromise);

    render(
      <MatchReportModal
        {...defaultProps}
        guestTeamId="guest-team-303"
        guestTeamName="Opponent Squad"
      />,
    );

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenCalledWith(
        "match-101",
        "team-202",
      );
    });

    resolveGuestReport!(mockGuestSummary);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Guest Player/i }),
      ).toBeInTheDocument();
    });
  });

  it("triggers a replacement summary request when the already-active Home Squad tab is clicked", async () => {
    let resolveInitialHomeReport: (value: typeof mockTeamSummary) => void;
    const initialHomePromise = new Promise<typeof mockTeamSummary>(
      (resolve) => {
        resolveInitialHomeReport = resolve;
      },
    );

    let resolveReplacementHomeReport: (value: typeof mockTeamSummary) => void;
    const replacementHomePromise = new Promise<typeof mockTeamSummary>(
      (resolve) => {
        resolveReplacementHomeReport = resolve;
      },
    );

    const replacementSummary = [
      {
        ...mockTeamSummary[0],
        firstName: "Replacement",
        lastName: "Player",
      },
    ];

    vi.mocked(reportService.getTeamSummaryReport)
      .mockReturnValueOnce(initialHomePromise)
      .mockReturnValueOnce(replacementHomePromise);

    render(
      <MatchReportModal
        {...defaultProps}
        teamName="Home Squad"
        guestTeamId="guest-team-303"
        guestTeamName="Opponent Squad"
      />,
    );

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenCalledTimes(1);
    });

    const homeTab = screen.getByRole("button", { name: /Home Squad/i });
    fireEvent.click(homeTab);

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenCalledTimes(2);
    });

    resolveInitialHomeReport!(mockTeamSummary);
    resolveReplacementHomeReport!(replacementSummary);

    await waitFor(() => {
      expect(screen.getByText(/Replacement Player/i)).toBeInTheDocument();
    });
  });

  it("renders team switcher tabs and fetches guest team summary report when Guest Team tab is clicked", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValue(
      mockTeamSummary,
    );

    render(
      <MatchReportModal
        {...defaultProps}
        teamName="Home Squad"
        guestTeamId="guest-team-303"
        guestTeamName="Opponent Squad"
      />,
    );

    expect(
      await screen.findByRole("button", { name: /Home Squad/i }),
    ).toBeInTheDocument();

    const guestTab = screen.getByRole("button", { name: /Opponent Squad/i });
    fireEvent.click(guestTab);

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenLastCalledWith(
        "match-101",
        "guest-team-303",
      );
    });
  });

  it("switches back to home team tab and ignores stale deferred guest summary response", async () => {
    const mockGuestSummary = [
      {
        matchLineupId: "lineup-guest-1",
        firstName: "Guest",
        lastName: "Player",
        number: 10,
        goals: 2,
        positiveGoalLeadingActions: 1,
        negativeGoalLeadingActions: 0,
        totalPositiveActions: 8,
        totalNegativeActions: 1,
        playPercentage: 90.0,
      },
    ];

    const secondHomeSummary = [
      {
        ...mockTeamSummary[0],
        firstName: "Home",
        lastName: "Captain",
      },
    ];

    let resolveGuestReport: (value: typeof mockGuestSummary) => void;
    const guestReportPromise = new Promise<typeof mockGuestSummary>(
      (resolve) => {
        resolveGuestReport = resolve;
      },
    );

    vi.mocked(reportService.getTeamSummaryReport)
      .mockResolvedValueOnce(mockTeamSummary)
      .mockReturnValueOnce(guestReportPromise)
      .mockResolvedValueOnce(secondHomeSummary);

    render(
      <MatchReportModal
        {...defaultProps}
        teamName="Home Squad"
        guestTeamId="guest-team-303"
        guestTeamName="Opponent Squad"
      />,
    );

    expect(
      await screen.findByRole("button", { name: /Michael Jordan/i }),
    ).toBeInTheDocument();

    const guestTab = screen.getByRole("button", { name: /Opponent Squad/i });
    fireEvent.click(guestTab);

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenCalledWith(
        "match-101",
        "guest-team-303",
      );
    });

    // Switch back to Home before the deferred guest summary resolves
    const homeTab = screen.getByRole("button", { name: /Home Squad/i });
    fireEvent.click(homeTab);

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenLastCalledWith(
        "match-101",
        "team-202",
      );
      expect(
        screen.getByRole("button", { name: /Home Captain/i }),
      ).toBeInTheDocument();
    });

    // Resolve the stale guest response and verify Home report remains displayed
    await act(async () => {
      resolveGuestReport!(mockGuestSummary);
      await guestReportPromise;
    });

    expect(
      screen.getByRole("button", { name: /Home Captain/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Guest Player/i }),
    ).not.toBeInTheDocument();
  });

  it("passes active guest teamId to MatchSpatialReportView when spatial tab is selected under guest team view", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValue(
      mockTeamSummary,
    );

    render(
      <MatchReportModal
        {...defaultProps}
        guestTeamId="guest-team-303"
        guestTeamName="Opponent Squad"
      />,
    );

    const guestTab = await screen.findByRole("button", {
      name: /Opponent Squad/i,
    });
    fireEvent.click(guestTab);

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenLastCalledWith(
        "match-101",
        "guest-team-303",
      );
    });

    const spatialTab = screen.getByRole("button", { name: /📍 Spatial Map/i });
    fireEvent.click(spatialTab);

    expect(
      screen.getByText("Spatial View for Match match-101, Team guest-team-303"),
    ).toBeInTheDocument();
  });

  it("renders fallback default tab labels when team names are omitted", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValue(
      mockTeamSummary,
    );

    render(
      <MatchReportModal
        isOpen={true}
        matchId="match-101"
        teamId="team-202"
        guestTeamId="guest-team-303"
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: /Home Team/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Guest Team/i }),
    ).toBeInTheDocument();
  });

  it("renders error banner if fetching summary report fails", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockRejectedValueOnce(
      new Error("Network Error"),
    );

    render(<MatchReportModal {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByText(/failed to load match summary report/i),
      ).toBeInTheDocument();
    });
  });

  it("navigates to player detailed report when a player row is clicked", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce(
      mockTeamSummary,
    );
    vi.mocked(reportService.getPlayerDetailedReport).mockResolvedValueOnce(
      mockPlayerDetailed,
    );

    render(<MatchReportModal {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Michael Jordan/i }),
      ).toBeInTheDocument();
    });

    const playerButton = screen.getByRole("button", {
      name: /Michael Jordan/i,
    });
    fireEvent.click(playerButton);

    expect(screen.getByText("Player TTA Detailed Report")).toBeInTheDocument();

    await waitFor(() => {
      expect(reportService.getPlayerDetailedReport).toHaveBeenCalledWith(
        "match-101",
        "lineup-1",
      );
      expect(screen.getByText("#23 Michael Jordan")).toBeInTheDocument();
    });
  });

  it("handles error gracefully when getPlayerDetailedReport fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce(
      mockTeamSummary,
    );
    vi.mocked(reportService.getPlayerDetailedReport).mockRejectedValueOnce(
      new Error("Player Report Failed"),
    );

    render(<MatchReportModal {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Michael Jordan/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Michael Jordan/i }));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to load player detailed report:",
        expect.any(Error),
      );
    });

    consoleSpy.mockRestore();
  });

  it("navigates back to team summary view when back button is clicked in player view", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValue(
      mockTeamSummary,
    );
    vi.mocked(reportService.getPlayerDetailedReport).mockResolvedValueOnce(
      mockPlayerDetailed,
    );

    render(<MatchReportModal {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Michael Jordan/i }),
      ).toBeInTheDocument();
    });

    const playerButton = screen.getByRole("button", {
      name: /Michael Jordan/i,
    });
    fireEvent.click(playerButton);

    await waitFor(() => {
      expect(screen.getByText("#23 Michael Jordan")).toBeInTheDocument();
    });

    const backButton = screen.getByRole("button", { name: /← back/i });
    fireEvent.click(backButton);

    expect(screen.getByText("Team TTA Summary Report")).toBeInTheDocument();
  });

  it("switches to spatial analytics view mode when Spatial Map tab is clicked and allows returning to summary", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce(
      mockTeamSummary,
    );

    render(<MatchReportModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Team TTA Summary Report")).toBeInTheDocument();
    });

    const spatialTab = screen.getByRole("button", { name: /📍 Spatial Map/i });
    fireEvent.click(spatialTab);

    expect(screen.getByText("Match Spatial Analytics")).toBeInTheDocument();
    expect(screen.getByTestId("match-spatial-report-view")).toBeInTheDocument();

    const backButton = screen.getByRole("button", {
      name: /Back from Spatial/i,
    });
    fireEvent.click(backButton);

    expect(screen.getByText("Team TTA Summary Report")).toBeInTheDocument();
  });

  it("resets reportMode to summary and activeTeamId to teamId when modal is reopened", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValue(
      mockTeamSummary,
    );

    const { rerender } = render(<MatchReportModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Team TTA Summary Report")).toBeInTheDocument();
    });

    const spatialTab = screen.getByRole("button", { name: /📍 Spatial Map/i });
    fireEvent.click(spatialTab);
    expect(screen.getByText("Match Spatial Analytics")).toBeInTheDocument();

    rerender(<MatchReportModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<MatchReportModal {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByText("Team TTA Summary Report")).toBeInTheDocument();
    });
  });

  it("resets active team and fetches new summary data when props change while open, retaining focus on trigger element", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValue(
      mockTeamSummary,
    );

    const triggerBtn = document.createElement("button");
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();

    const { rerender } = render(<MatchReportModal {...defaultProps} />);

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenCalledWith(
        "match-101",
        "team-202",
      );
    });

    rerender(
      <MatchReportModal
        {...defaultProps}
        matchId="match-999"
        teamId="team-888"
      />,
    );

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenCalledWith(
        "match-999",
        "team-888",
      );
    });

    expect(document.activeElement).toBe(triggerBtn);
    document.body.removeChild(triggerBtn);
  });

  it("passes playground and shotMap props to MatchSpatialReportView when provided", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce(
      mockTeamSummary,
    );

    render(
      <MatchReportModal
        {...defaultProps}
        playground="<svg>court</svg>"
        shotMap="<svg>shot-target</svg>"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Team TTA Summary Report")).toBeInTheDocument();
    });

    const spatialTab = screen.getByRole("button", { name: /📍 Spatial Map/i });
    fireEvent.click(spatialTab);

    expect(screen.getByText("SVG: <svg>court</svg>")).toBeInTheDocument();
    expect(
      screen.getByText("SHOT_SVG: <svg>shot-target</svg>"),
    ).toBeInTheDocument();
  });

  it("calls onClose when Close Report button or cross button (✕) is clicked", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValue(
      mockTeamSummary,
    );

    render(<MatchReportModal {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Michael Jordan/i }),
      ).toBeInTheDocument();
    });

    const closeButton = screen.getByRole("button", { name: /close report/i });
    fireEvent.click(closeButton);

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);

    const crossButton = screen.getByRole("button", { name: "✕" });
    fireEvent.click(crossButton);

    expect(defaultProps.onClose).toHaveBeenCalledTimes(2);
  });

  it("calls onClose when cancel event (Escape key) is triggered on dialog", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce(
      mockTeamSummary,
    );

    render(<MatchReportModal {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Michael Jordan/i }),
      ).toBeInTheDocument();
    });

    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to previously active element upon unmounting", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce(
      mockTeamSummary,
    );

    const triggerBtn = document.createElement("button");
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);

    const { unmount } = render(<MatchReportModal {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Michael Jordan/i }),
      ).toBeInTheDocument();
    });

    unmount();

    expect(document.activeElement).toBe(triggerBtn);
    document.body.removeChild(triggerBtn);
  });
});
