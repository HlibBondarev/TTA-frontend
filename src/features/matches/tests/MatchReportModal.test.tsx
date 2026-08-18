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

  it("navigates to player detailed report when player button is activated via keyboard input", async () => {
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

    fireEvent.keyDown(playerButton, { key: "Enter", code: "Enter" });
    fireEvent.click(playerButton);

    expect(screen.getByText("Player TTA Detailed Report")).toBeInTheDocument();
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

    // Shift focus to an internal modal control first
    const closeButton = screen.getByRole("button", { name: /close report/i });
    closeButton.focus();
    expect(document.activeElement).toBe(closeButton);

    // Unmount modal and assert focus is restored to triggerBtn
    unmount();

    expect(document.activeElement).toBe(triggerBtn);
    document.body.removeChild(triggerBtn);
  });
});
