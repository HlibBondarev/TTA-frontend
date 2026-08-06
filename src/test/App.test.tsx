import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import App from "../App";
import matchReducer from "../features/matches/store/matchSlice";
import presenceReducer from "../features/playerpresences/store/presenceSlice";
import { apiClient } from "../api/client";
import { sportService } from "../services/sportService";

// Mock Auth0
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
      activePlayersLimit: 5, // Non-7 limit config coverage
    },
  ];

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

  it("should execute quick start with dynamic activePlayersLimit and render TTAConsole", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "new-match-id-123" });

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

    // Wait until the configuration profile button/element is fully loaded and rendered
    const configButton = await screen.findByRole("button", {
      name: /Periods: 4/i,
    });
    expect(configButton).toBeDefined();

    const quickStartButton = screen.getByRole("button", {
      name: /Quick Start Match/i,
    });
    expect(quickStartButton).not.toBeDisabled();

    fireEvent.click(quickStartButton);

    // Verify API call for quick start
    expect(apiClient.post).toHaveBeenCalledWith("/Matches/quick", {
      sportId: "sport-1",
      configurationId: "config-1",
    });

    // Verify that presence limits were correctly updated in store with the configuration's limit (5)
    await waitFor(() => {
      expect(store.getState().presence.activePlayersLimit).toBe(5);
    });

    // After quick start, TTAConsole should be rendered
    expect(await screen.findByText("TTA Match Recorder")).toBeDefined();
  });
});
