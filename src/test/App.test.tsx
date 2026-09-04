import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import App from "../App";
import matchReducer from "../features/matches/store/matchSlice";
import presenceReducer from "../features/playerpresences/store/presenceSlice";
import uiReducer from "../store/slices/uiSlice";
import navigationReducer from "../store/slices/navigationSlice";
import { apiClient } from "../api/client";
import { sportService } from "../services/sportService";
import { teamService } from "../services/teamService";
import {
  hydrateMatchData,
  checkUnfinishedMatch,
} from "../services/hydrationService";

let mockIsAuthenticated = true;

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    get isAuthenticated() {
      return mockIsAuthenticated;
    },
    isLoading: false,
    getAccessTokenSilently: vi.fn().mockResolvedValue("mock-token"),
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
    user: { email: "tester@tta.com" },
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

vi.mock("../services/userMatchService", () => ({
  userMatchService: {
    getCatchedMatches: vi.fn().mockResolvedValue([]),
    uncatchMatch: vi.fn(),
    addUserToTrackedMatch: vi.fn(),
  },
}));

vi.mock("../services/hydrationService", () => ({
  hydrateMatchData: vi.fn().mockResolvedValue(undefined),
  checkUnfinishedMatch: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/syncService", () => ({
  processSyncQueue: vi.fn().mockResolvedValue(0),
}));

const createTestStore = (
  preloadedState?: Parameters<typeof configureStore>[0]["preloadedState"],
) => {
  return configureStore({
    reducer: {
      match: matchReducer,
      presence: presenceReducer,
      ui: uiReducer,
      navigation: navigationReducer,
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
    mockIsAuthenticated = true;
  });

  it("should prevent tab unload when match session is active even during breaks", async () => {
    const store = createTestStore({
      match: {
        isPeriodActive: false,
        activeMatchId: "m-123",
        activeTeamId: "t-123",
      } as never,
    });

    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );

    const event = new Event("beforeunload", {
      cancelable: true,
    }) as BeforeUnloadEvent;
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("should render Auth Gate Login screen when user is unauthenticated", async () => {
    mockIsAuthenticated = false;

    const store = createTestStore();

    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );

    expect(
      await screen.findByRole("button", { name: /Log In \/ Register/i }),
    ).toBeDefined();
  });

  it("should render MainDashboard when user is authenticated and navigation view is HUB", async () => {
    const store = createTestStore({
      navigation: { currentView: "HUB" },
    });

    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );

    expect(await screen.findByText("TTA Hub Navigation")).toBeDefined();
    expect(screen.getByText("tester@tta.com")).toBeDefined();
  });

  it("should render MainDashboard when user is authenticated and navigation view is AUTH_GATE", async () => {
    const store = createTestStore({
      navigation: { currentView: "AUTH_GATE" },
    });

    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );

    expect(await screen.findByText("TTA Hub Navigation")).toBeDefined();
  });

  it("should render TTAConsole when navigation view is CONSOLE", async () => {
    const store = createTestStore({
      navigation: { currentView: "CONSOLE" },
    });

    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );

    expect(await screen.findByText("TTA Match Recorder")).toBeDefined();
  });

  it("should navigate from Hub to MatchSetupWizard when clicking Quick Start Match card", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );

    const store = createTestStore({
      navigation: { currentView: "HUB" },
    });

    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );

    fireEvent.click(await screen.findByText("Quick Start Match"));

    expect(await screen.findByText("Match Setup Wizard")).toBeDefined();
  });

  it("should execute quick start flow with team selection, hydrate data, set match and team IDs in Redux, and render TTAConsole", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );

    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "new-match-id-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam as never)
      .mockResolvedValueOnce(mockGuestTeam as never);

    const store = createTestStore({
      navigation: { currentView: "QUICK_START" },
    });

    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );

    expect(
      await screen.findByRole("button", { name: /Periods: 4/i }),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Quick Start Match/i }));

    expect(await screen.findByText("3. Select Team to Track")).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: /Confirm & Start Tracking/i }),
    );

    await waitFor(() => {
      expect(hydrateMatchData).toHaveBeenCalledWith(
        "new-match-id-123",
        "team-home-1",
      );
      expect(store.getState().presence.activePlayersLimit).toBe(5);
      expect(store.getState().match.activeMatchId).toBe("new-match-id-123");
      expect(store.getState().match.activeTeamId).toBe("team-home-1");
    });

    expect(await screen.findByText("TTA Match Recorder")).toBeDefined();
  });

  it("should resume interrupted match session from MainDashboard prompt", async () => {
    vi.mocked(checkUnfinishedMatch).mockResolvedValueOnce({
      id: "m-interrupted",
      homeTeamId: "team-home-99",
    } as never);

    const store = createTestStore({
      navigation: { currentView: "HUB" },
    });

    render(
      <Provider store={store}>
        <App />
      </Provider>,
    );

    expect(
      await screen.findByRole("region", { name: "Session Recovery Prompt" }),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Resume Match/i }));

    await waitFor(() => {
      expect(hydrateMatchData).toHaveBeenCalledWith(
        "m-interrupted",
        "team-home-99",
      );
      expect(store.getState().match.activeMatchId).toBe("m-interrupted");
      expect(store.getState().match.activeTeamId).toBe("team-home-99");
    });
  });

  it("should not set active match or team in Redux if hydration throws an error", async () => {
    vi.mocked(sportService.getSports).mockResolvedValueOnce(mockSports);
    vi.mocked(sportService.getSportConfigurations).mockResolvedValueOnce(
      mockConfigs,
    );
    vi.mocked(apiClient.post).mockResolvedValueOnce({ id: "new-match-id-123" });
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockMatch);
    vi.mocked(teamService.getTeamById)
      .mockResolvedValueOnce(mockHomeTeam as never)
      .mockResolvedValueOnce(mockGuestTeam as never);

    vi.mocked(hydrateMatchData).mockRejectedValueOnce(
      new Error("401 Unauthorized"),
    );

    const store = createTestStore({
      navigation: { currentView: "QUICK_START" },
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
      expect(store.getState().match.activeMatchId).toBeNull();
      expect(store.getState().match.activeTeamId).toBeNull();
    });
  });
});
