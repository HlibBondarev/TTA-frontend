import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PlayerDetailedReportView } from "../components/PlayerDetailedReportView";

describe("PlayerDetailedReportView", () => {
  it("renders loading state when isLoading is true", () => {
    render(
      <PlayerDetailedReportView
        report={null}
        isLoading={true}
        onBack={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/loading player detailed report/i),
    ).toBeInTheDocument();
  });

  it("renders error/failed state when report is null", () => {
    const handleBack = vi.fn();
    render(
      <PlayerDetailedReportView
        report={null}
        isLoading={false}
        onBack={handleBack}
      />,
    );

    expect(
      screen.getByText(/failed to load player report details/i),
    ).toBeInTheDocument();

    const backButton = screen.getByRole("button", {
      name: /back to team summary/i,
    });
    expect(backButton).toBeInTheDocument();

    fireEvent.click(backButton);
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it("renders message when player has no registered events", () => {
    const mockReport = {
      firstName: "John",
      lastName: "Doe",
      number: 7,
      events: [],
    };

    render(
      <PlayerDetailedReportView
        report={mockReport}
        isLoading={false}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText("#7 John Doe")).toBeInTheDocument();
    expect(
      screen.getByText(/no events recorded for this player/i),
    ).toBeInTheDocument();
  });

  it("renders TTA summary cards, grouped timeline, and distinctive goal lead badges", () => {
    const mockReport = {
      firstName: "Alex",
      lastName: "Smith",
      number: 10,
      events: [
        {
          eventName: "Shot on Target",
          isPositive: true,
          periodNumber: 1,
          eventTimestamp: "2026-08-18T10:00:00Z",
          normalizedMatchTime: "00:02:15",
          isLeadToGoal: false,
        },
        {
          eventName: "Key Pass",
          isPositive: true,
          periodNumber: 1,
          eventTimestamp: "2026-08-18T10:05:00Z",
          normalizedMatchTime: "00:07:10",
          isLeadToGoal: true,
        },
        {
          eventName: "Turnover",
          isPositive: false,
          periodNumber: 2,
          eventTimestamp: "2026-08-18T10:20:00Z",
          normalizedMatchTime: "00:15:30",
          isLeadToGoal: true,
        },
      ],
    };

    render(
      <PlayerDetailedReportView
        report={mockReport}
        isLoading={false}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText("#10 Alex Smith")).toBeInTheDocument();
    expect(screen.getByText("Total Actions: 3")).toBeInTheDocument();

    // Check Positive TTA Summary Card contents & count values (2 positive actions)
    const positiveCardHeader = screen.getByText("+ Positive Actions");
    const positiveCardContainer = positiveCardHeader.closest("div")!;
    expect(
      within(positiveCardContainer).getByText("Shot on Target:"),
    ).toBeInTheDocument();
    expect(
      within(positiveCardContainer).getByText("Key Pass:"),
    ).toBeInTheDocument();
    expect(within(positiveCardContainer).getAllByText("1")).toHaveLength(2);

    // Check Negative TTA Summary Card contents & count values (1 negative action)
    const negativeCardHeader = screen.getByText("- Negative Actions");
    const negativeCardContainer = negativeCardHeader.closest("div")!;
    expect(
      within(negativeCardContainer).getByText("Turnover:"),
    ).toBeInTheDocument();
    expect(within(negativeCardContainer).getByText("1")).toBeInTheDocument();

    // Check periods headers
    expect(screen.getByText("Period 1")).toBeInTheDocument();
    expect(screen.getByText("Period 2")).toBeInTheDocument();

    // Confirm total counts for Goal Lead badges across document
    expect(screen.getAllByText("+Goal Lead")).toHaveLength(1);
    expect(screen.getAllByText("-Goal Lead")).toHaveLength(1);

    // Verify Goal Lead badges are attached specifically to their corresponding event rows
    const keyPassRow = screen.getByText("Key Pass").closest("div")!;
    expect(within(keyPassRow).getByText("+Goal Lead")).toBeInTheDocument();

    const turnoverRow = screen.getByText("Turnover").closest("div")!;
    expect(within(turnoverRow).getByText("-Goal Lead")).toBeInTheDocument();

    const shotRow = screen.getByText("Shot on Target").closest("div")!;
    expect(within(shotRow).queryByText("+Goal Lead")).not.toBeInTheDocument();
    expect(within(shotRow).queryByText("-Goal Lead")).not.toBeInTheDocument();

    // Check normalized match times
    expect(screen.getByText("00:02:15")).toBeInTheDocument();
    expect(screen.getByText("00:15:30")).toBeInTheDocument();
  });

  it("sorts out-of-order events within a period ascending by normalizedMatchTime and uses eventTimestamp as tie-breaker", () => {
    const mockReport = {
      firstName: "Michael",
      lastName: "Jordan",
      number: 23,
      events: [
        {
          eventName: "Later Event",
          isPositive: true,
          periodNumber: 1,
          eventTimestamp: "2026-08-18T10:05:00Z",
          normalizedMatchTime: "00:07:10",
          isLeadToGoal: false,
        },
        {
          eventName: "Equal Time Event B",
          isPositive: true,
          periodNumber: 1,
          eventTimestamp: "2026-08-18T10:00:10Z",
          normalizedMatchTime: "00:02:15",
          isLeadToGoal: false,
        },
        {
          eventName: "Equal Time Event A",
          isPositive: true,
          periodNumber: 1,
          eventTimestamp: "2026-08-18T10:00:02Z",
          normalizedMatchTime: "00:02:15",
          isLeadToGoal: false,
        },
      ],
    };

    render(
      <PlayerDetailedReportView
        report={mockReport}
        isLoading={false}
        onBack={vi.fn()}
      />,
    );

    // Scope query exclusively to Period 1 timeline container
    const period1Container = screen.getByText("Period 1").parentElement!;
    const eventNames = within(period1Container).getAllByText(
      /(Equal Time Event A|Equal Time Event B|Later Event)/,
    );

    expect(eventNames[0]).toHaveTextContent("Equal Time Event A");
    expect(eventNames[1]).toHaveTextContent("Equal Time Event B");
    expect(eventNames[2]).toHaveTextContent("Later Event");
  });

  it("calls onBack when header back button is clicked", () => {
    const handleBack = vi.fn();
    const mockReport = {
      firstName: "John",
      lastName: "Doe",
      number: 5,
      events: [],
    };

    render(
      <PlayerDetailedReportView
        report={mockReport}
        isLoading={false}
        onBack={handleBack}
      />,
    );

    const backButton = screen.getByRole("button", { name: /← back/i });
    fireEvent.click(backButton);

    expect(handleBack).toHaveBeenCalledTimes(1);
  });
});
