import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TeamSummaryReportView } from "../components/TeamSummaryReportView";

describe("TeamSummaryReportView", () => {
  it("renders loading state", () => {
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

  it("renders empty state", () => {
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

  it("renders player report rows with -GL column and triggers onSelectPlayer click", () => {
    const handleSelect = vi.fn();
    const mockData = [
      {
        matchLineupId: "lineup-123",
        firstName: "Alex",
        lastName: "Smith",
        number: 9,
        goals: 3,
        positiveGoalLeadingActions: 2,
        negativeGoalLeadingActions: 1,
        totalPositiveActions: 7,
        totalNegativeActions: 1,
        playPercentage: 90.0,
      },
    ];

    render(
      <TeamSummaryReportView
        reports={mockData}
        isLoading={false}
        onSelectPlayer={handleSelect}
      />,
    );

    // Header & Mobile Prompt Checks
    expect(screen.getByText("+GL")).toBeInTheDocument();
    expect(screen.getByText("-GL")).toBeInTheDocument();
    expect(
      screen.getByText("Tap a player to view detailed TTA event timeline"),
    ).toBeInTheDocument();

    // Player Data Checks
    expect(screen.getByText("Alex Smith")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();

    // Click Row Interaction
    fireEvent.click(screen.getByText("Alex Smith"));
    expect(handleSelect).toHaveBeenCalledWith("lineup-123");
  });

  it("correctly displays positive (+GL) and negative (-GL) goal leading metrics", () => {
    const mockData = [
      {
        matchLineupId: "lineup-[456]",
        firstName: "John",
        lastName: "Doe",
        number: 5,
        goals: 1,
        positiveGoalLeadingActions: 4,
        negativeGoalLeadingActions: 2,
        totalPositiveActions: 10,
        totalNegativeActions: 3,
        playPercentage: 75.0,
      },
    ];

    render(
      <TeamSummaryReportView
        reports={mockData}
        isLoading={false}
        onSelectPlayer={vi.fn()}
      />,
    );

    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument(); // +GL
    expect(screen.getByText("2")).toBeInTheDocument(); // -GL
  });
});
