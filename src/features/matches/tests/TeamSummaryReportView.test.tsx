import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TeamSummaryReportView } from "../components/TeamSummaryReportView";

describe("TeamSummaryReportView", () => {
  const mockReports = [
    {
      matchLineupId: "lineup-1",
      firstName: "Michael",
      lastName: "Jordan",
      number: 23,
      goals: 5,
      positiveGoalLeadingActions: 2,
      negativeGoalLeadingActions: 1,
      totalPositiveActions: 12,
      totalNegativeActions: 2,
      playPercentage: 95.0,
    },
  ];

  it("renders loading state when isLoading is true", () => {
    render(
      <TeamSummaryReportView
        reports={[]}
        isLoading={true}
        onSelectPlayer={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/loading team summary performance report/i),
    ).toBeInTheDocument();
  });

  it("renders empty message when no reports are provided", () => {
    render(
      <TeamSummaryReportView
        reports={[]}
        isLoading={false}
        onSelectPlayer={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/no report data available for this team/i),
    ).toBeInTheDocument();
  });

  it("renders player data correctly in summary table and calls onSelectPlayer on click", () => {
    const handleSelectPlayer = vi.fn();

    render(
      <TeamSummaryReportView
        reports={mockReports}
        isLoading={false}
        onSelectPlayer={handleSelectPlayer}
      />,
    );

    expect(screen.getByText("Michael Jordan")).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();

    const playerButton = screen.getByRole("button", {
      name: "Michael Jordan",
    });
    fireEvent.click(playerButton);

    expect(handleSelectPlayer).toHaveBeenCalledWith("lineup-1");
  });

  it("supports keyboard activation via focus and click/Enter", () => {
    const handleSelectPlayer = vi.fn();

    render(
      <TeamSummaryReportView
        reports={mockReports}
        isLoading={false}
        onSelectPlayer={handleSelectPlayer}
      />,
    );

    const playerButton = screen.getByRole("button", {
      name: "Michael Jordan",
    });

    playerButton.focus();
    expect(document.activeElement).toBe(playerButton);

    fireEvent.click(playerButton);
    expect(handleSelectPlayer).toHaveBeenCalledWith("lineup-1");
  });

  it("supports keyboard activation via Enter and Space keydown events", () => {
    const handleSelectPlayer = vi.fn();

    render(
      <TeamSummaryReportView
        reports={mockReports}
        isLoading={false}
        onSelectPlayer={handleSelectPlayer}
      />,
    );

    const playerButton = screen.getByRole("button", {
      name: "Michael Jordan",
    });

    playerButton.focus();
    expect(document.activeElement).toBe(playerButton);

    // Check Enter
    fireEvent.keyDown(playerButton, { key: "Enter", code: "Enter" });
    expect(handleSelectPlayer).toHaveBeenLastCalledWith("lineup-1");

    // Check Space
    fireEvent.keyDown(playerButton, { key: " ", code: "Space" });
    expect(handleSelectPlayer).toHaveBeenLastCalledWith("lineup-1");
  });
});
