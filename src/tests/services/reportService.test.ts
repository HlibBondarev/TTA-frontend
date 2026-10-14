import { describe, it, expect, vi, beforeEach } from "vitest";
import { reportService } from "../../services/reportService";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

describe("reportService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch team summary report via GET request", async () => {
    const mockSummary = [
      {
        matchLineupId: "ml-1",
        firstName: "John",
        lastName: "Doe",
        number: 10,
        goals: 2,
        positiveGoalLeadingActions: 1,
        negativeGoalLeadingActions: 0,
        totalPositiveActions: 5,
        totalNegativeActions: 1,
        playPercentage: 80.5,
      },
    ];

    vi.mocked(apiClient.get).mockResolvedValueOnce(mockSummary);

    const result = await reportService.getTeamSummaryReport("m-1", "t-1");

    expect(apiClient.get).toHaveBeenCalledWith(
      "/Matches/m-1/teams/t-1/reports/summary",
    );
    expect(result).toEqual(mockSummary);
  });

  it("should fetch player detailed report via GET request", async () => {
    const mockDetailed = {
      firstName: "John",
      lastName: "Doe",
      number: 10,
      events: [
        {
          eventName: "Goal",
          isPositive: true,
          periodNumber: 1,
          eventTimestamp: "2026-08-18T10:00:00Z",
          normalizedMatchTime: "00:04:12",
          isLeadToGoal: true,
        },
      ],
    };

    vi.mocked(apiClient.get).mockResolvedValueOnce(mockDetailed);

    const result = await reportService.getPlayerDetailedReport("m-1", "ml-1");

    expect(apiClient.get).toHaveBeenCalledWith(
      "/Matches/m-1/lineups/ml-1/reports/detailed",
    );
    expect(result).toEqual(mockDetailed);
  });

  it("should fetch complete match events timeline via GET request", async () => {
    const mockEvents = [
      {
        id: "ev-1",
        matchLineupId: "ml-1",
        eventDefinitionId: "def-1",
        eventName: "Goal",
        isPositive: true,
        periodNumber: 1,
        eventTimestamp: "2026-10-14T10:00:00Z",
        normalizedMatchTime: "00:02:15",
        isLeadToGoal: true,
        locationX: 75.0,
        locationY: 50.0,
      },
    ];

    vi.mocked(apiClient.get).mockResolvedValueOnce(mockEvents);

    const result = await reportService.getMatchEvents("m-1");

    expect(apiClient.get).toHaveBeenCalledWith("/Matches/m-1/events");
    expect(result).toEqual(mockEvents);
  });
});
