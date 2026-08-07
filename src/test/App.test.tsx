import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import App from "../App";
import matchReducer from "../features/matches/store/matchSlice";
import presenceReducer from "../features/playerpresences/store/presenceSlice";
import { apiClient } from "../api/client";
import { sportService } from "../services/sportService";
import { teamService } from "../services/teamService";
import { hydrateMatchData } from "../services/hydrationService";

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    isAuthenticated: true,
    isLoading: false,
    getAccessTokenSilently: vi.fn().mockResolvedValue("mock-token"),
    loginWithRedirect: vi.fn(),
  }),
}));

vi.mock("../api/client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("../services/sportService", () => ({
  sportService: {
    getSports: vi.fn(),
    getSportConfigurations: vi.fn(),
  },
}));

vi.mock("../services/teamService", () => ({
  teamService: {
    getTeamById: vi.fn(),
  },
}));

vi.mock("../services/hydrationService", () => ({
  hydrateMatchData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/syncService", () => ({
  initSyncEngine: vi.fn(),
}));

const createTestStore = (
  preloadedState?: Parameters<typeof configureStore>[0]["preloadedState"],
) => {
  return configureStore({
    reducer: {
      match: matchReducer,
      presence: presenceReducer,
    },
    preloadedState,
  });
};

describe("App Bootstrapping Component", () => {
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
      activePlayersLimit: 5,
    },
  ];

  const mockMatch = {
    id: "new-match-id-123",
    homeTeamId: "team-home-1",
    guestTeamId: "team-guest-2",
  };

  const mockHomeTeam = { id: "team-home-1", name: "Home Squad" };
  const mockGuestTeam = { id: "team-guest-2", name: "Guest Squad" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render MatchSetupWizard when no active match is set", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );

    const store = createTestStore({
      match: {
        activeMatchId: null,
        periodNumber: 1,
        homeScore: 0,
        guestScore: 0,
        isPeriodActive: false,
        isInsideStoppage: false,
        globalSequenceNumber: 0,
        recentActions: [],
      },
    });

    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );

    expect(await screen.findByText("Match Setup Wizard")).toBeDefined();
    expect(await screen.findByText("Water Polo")).toBeDefined();
  });

  it("should execute quick start flow with team selection, hydrate data and render TTAConsole", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );

    // 1st POST call inside Wizard's handleInitMatch
    // 2nd POST call inside App's handleQuickStart
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ id: "new-match-id-123" })
      .mockResolvedValueOnce({ id: "new-match-id-123" });

    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam as never)
      .mockResolvedValueOnce(mockGuestTeam as never);

    const store = createTestStore({
      match: {
        activeMatchId: null,
        periodNumber: 1,
        homeScore: 0,
        guestScore: 0,
        isPeriodActive: false,
        isInsideStoppage: false,
        globalSequenceNumber: 0,
        recentActions: [],
      },
    });

    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );

    expect(
      await screen.findByRole("button", { name: /Periods: 4/i }),
    ).toBeDefined();

    // Click Step 1: Quick Start Match
    const quickStartButton = screen.getByRole("button", {
      name: /Quick Start Match/i,
    });
    fireEvent.click(quickStartButton);

    // Wait for team selection step
    expect(await screen.findByText("3. Select Team to Track")).toBeDefined();

    // Click Step 2: Confirm & Start Tracking
    const confirmButton = screen.getByRole("button", {
      name: /Confirm & Start Tracking/i,
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      // Verify hydration was triggered with match ID and selected team ID (defaults to home team)
      expect(hydrateMatchData).toHaveBeenCalledWith(
        "new-match-id-123",
        "team-home-1",
      );
      expect(store.getState().presence.activePlayersLimit).toBe(5);
    });

    // Render TTAConsole upon successful match selection
    expect(await screen.findByText("TTA Match Recorder")).toBeDefined();
  });

  it("should not set active match if hydration throws an error", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ id: "new-match-id-123" })
      .mockResolvedValueOnce({ id: "new-match-id-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam as never)
      .mockResolvedValueOnce(mockGuestTeam as never);

    vi.mocked(hydrateMatchData).mockRejectedValueOnce(
      new Error("401 Unauthorized"),
    );

    const store = createTestStore({
      match: {
        activeMatchId: null,
        periodNumber: 1,
        homeScore: 0,
        guestScore: 0,
        isPeriodActive: false,
        isInsideStoppage: false,
        globalSequenceNumber: 0,
        recentActions: [],
      },
    });

    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /Quick Start Match/i }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Confirm & Start Tracking/i }),
    );

    await waitFor(() => {
      expect(hydrateMatchData).toHaveBeenCalled();
      // Match ID should NOT be updated in Redux store on hydration rejection
      expect(store.getState().match.activeMatchId).toBeNull();
    });
  });
});
