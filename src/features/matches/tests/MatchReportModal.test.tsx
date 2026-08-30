import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MatchReportModal } from "../components/MatchReportModal";
import { reportService } from "../../../services/reportService";

vi.mock("../../../services/reportService", () => ({
  reportService: {
    getTeamSummaryReport: vi.fn(),
    getPlayerDetailedReport: vi.fn(),
  },
}));

describe("MatchReportModal", () => {
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

  it("renders team switcher tabs with team names and fetches guest team summary report when Guest Team tab is clicked", async () => {
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
    expect(
      screen.getByRole("button", { name: /Opponent Squad/i }),
    ).toBeInTheDocument();

    const guestTab = screen.getByRole("button", { name: /Opponent Squad/i });
    fireEvent.click(guestTab);

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenLastCalledWith(
        "match-101",
        "guest-team-303",
      );
    });

    const homeTab = screen.getByRole("button", { name: /Home Squad/i });
    fireEvent.click(homeTab);

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenLastCalledWith(
        "match-101",
        "team-202",
      );
    });
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

  it("handles error gracefully when fetching player detailed report fails", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce(
      mockTeamSummary,
    );
    vi.mocked(reportService.getPlayerDetailedReport).mockRejectedValueOnce(
      new Error("Player report error"),
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
      expect(reportService.getPlayerDetailedReport).toHaveBeenCalledWith(
        "match-101",
        "lineup-1",
      );
      expect(
        screen.getByText(/failed to load player report details/i),
      ).toBeInTheDocument();
    });
  });

  it("falls back to setAttribute('open', '') when dialog.showModal is not a function", () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce(
      mockTeamSummary,
    );

    const originalShowModal = HTMLDialogElement.prototype.showModal;
    // @ts-expect-error Simulate older browser environment without showModal
    delete HTMLDialogElement.prototype.showModal;

    render(<MatchReportModal {...defaultProps} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    HTMLDialogElement.prototype.showModal = originalShowModal;
  });

  it("synchronizes state when props (isOpen, matchId, teamId, guestTeamId) change", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValue(
      mockTeamSummary,
    );

    const { rerender } = render(
      <MatchReportModal {...defaultProps} isOpen={false} />,
    );

    rerender(<MatchReportModal {...defaultProps} isOpen={true} />);

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenCalledWith(
        "match-101",
        "team-202",
      );
    });

    rerender(
      <MatchReportModal {...defaultProps} isOpen={true} teamId="team-999" />,
    );

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenCalledWith(
        "match-101",
        "team-999",
      );
    });

    rerender(
      <MatchReportModal
        {...defaultProps}
        isOpen={true}
        matchId="match-999"
        guestTeamId="guest-team-888"
      />,
    );

    await waitFor(() => {
      expect(reportService.getTeamSummaryReport).toHaveBeenCalledWith(
        "match-999",
        "team-202",
      );
    });
  });

  it("retains focus inside dialog and does not trigger focus restoration when report context props change while open", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValue(
      mockTeamSummary,
    );

    const triggerBtn = document.createElement("button");
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);

    const { rerender } = render(<MatchReportModal {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Michael Jordan/i }),
      ).toBeInTheDocument();
    });

    const closeButton = screen.getByRole("button", { name: /close report/i });
    closeButton.focus();
    expect(document.activeElement).toBe(closeButton);

    // Context prop change while remaining open
    rerender(<MatchReportModal {...defaultProps} matchId="match-999" />);

    // Focus must remain on elements inside the dialog and not restore prematurely to triggerBtn
    expect(document.activeElement).not.toBe(triggerBtn);

    document.body.removeChild(triggerBtn);
  });

  it("navigates to player detailed report and displays summary cards when a player row is clicked", async () => {
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
      expect(screen.getByText("+ Positive Actions")).toBeInTheDocument();
      expect(screen.getByText("- Negative Actions")).toBeInTheDocument();
      expect(screen.getByText("Goal")).toBeInTheDocument();
    });
  });

  it("navigates to player detailed report when player button is focused and activated", async () => {
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
    playerButton.focus();
    expect(document.activeElement).toBe(playerButton);

    fireEvent.click(playerButton);

    await waitFor(() => {
      expect(
        screen.getByText("Player TTA Detailed Report"),
      ).toBeInTheDocument();
      expect(reportService.getPlayerDetailedReport).toHaveBeenCalledWith(
        "match-101",
        "lineup-1",
      );
    });
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
    expect(
      screen.getByRole("button", { name: /Michael Jordan/i }),
    ).toBeInTheDocument();
  });

  it("calls onClose when Close Report button is clicked", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce(
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
  });

  it("calls onClose when top-right cross button (✕) is clicked", async () => {
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce(
      mockTeamSummary,
    );

    render(<MatchReportModal {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Michael Jordan/i }),
      ).toBeInTheDocument();
    });

    const crossButton = screen.getByRole("button", { name: "✕" });
    fireEvent.click(crossButton);

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
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

  it("restores focus to the triggering element upon closing", async () => {
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

    const closeButton = screen.getByRole("button", { name: /close report/i });
    closeButton.focus();
    expect(document.activeElement).toBe(closeButton);

    unmount();

    expect(document.activeElement).toBe(triggerBtn);
    document.body.removeChild(triggerBtn);
  });
});
