import { renderHook, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAppSession } from "../../hooks/useAppSession";
import matchReducer from "../../features/matches/store/matchSlice";
import presenceReducer from "../../features/playerpresences/store/presenceSlice";
import uiReducer from "../../store/slices/uiSlice";
import navigationReducer from "../../store/slices/navigationSlice";
import {
  hydrateMatchData,
  getMatchRecoveryState,
  recoverRecentActions,
  StaleUserError,
} from "../../services/hydrationService";
import { setTokenGetter } from "../../services/tokenService";
import type { RootState } from "../../store";

let mockIsAuthenticated = true;
let mockIsLoading = false;
let mockUser: { email?: string; sub?: string } | null = {
  email: "tester@tta.com",
  sub: "auth0|tester-123",
};
const mockGetAccessTokenSilently = vi.fn().mockResolvedValue("mock-token");

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    get isAuthenticated() {
      return mockIsAuthenticated;
    },
    get isLoading() {
      return mockIsLoading;
    },
    getAccessTokenSilently: mockGetAccessTokenSilently,
    loginWithRedirect: vi.fn(),
    get user() {
      return mockUser;
    },
  }),
}));

vi.mock("../../services/hydrationService", () => ({
  hydrateMatchData: vi.fn().mockResolvedValue({ success: true }),
  getMatchRecoveryState: vi.fn().mockResolvedValue({
    recoveredPeriod: 2,
    activePlayersLimit: 6,
  }),
  recoverRecentActions: vi.fn().mockResolvedValue([]),
  StaleUserError: class StaleUserError extends Error {
    constructor(message = "Operation aborted due to user account change.") {
      super(message);
      this.name = "StaleUserError";
    }
  },
}));

vi.mock("../../services/tokenService", () => ({
  setTokenGetter: vi.fn(),
}));

type TestState = {
  match?: Partial<RootState["match"]>;
  presence?: Partial<RootState["presence"]>;
  ui?: Partial<RootState["ui"]>;
  navigation?: Partial<RootState["navigation"]>;
};

const createTestStore = (preloadedState?: TestState) => {
  return configureStore({
    reducer: {
      match: matchReducer,
      presence: presenceReducer,
      ui: uiReducer,
      navigation: navigationReducer,
    },
    preloadedState: preloadedState as unknown as RootState,
  });
};

const createWrapper = (store: ReturnType<typeof createTestStore>) => {
  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
};

describe("useAppSession Custom Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthenticated = true;
    mockIsLoading = false;
    mockUser = { email: "tester@tta.com", sub: "auth0|tester-123" };
  });

  it("should initialize session state and setup token getter", async () => {
    const store = createTestStore();
    const { result } = renderHook(() => useAppSession(), {
      wrapper: createWrapper(store),
    });

    expect(result.current.isInitializing).toBe(false);
    expect(result.current.isAuthenticated).toBe(true);
    expect(setTokenGetter).toHaveBeenCalledWith(expect.any(Function));
  });

  it("should prevent window unload when activeMatchId or isPeriodActive is true", async () => {
    const store = createTestStore({
      match: { activeMatchId: "m-active-123", isPeriodActive: true },
    });

    renderHook(() => useAppSession(), {
      wrapper: createWrapper(store),
    });

    const event = new Event("beforeunload", {
      cancelable: true,
    }) as BeforeUnloadEvent;

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("should handle Quick Start flow correctly and dispatch match state", async () => {
    const store = createTestStore();
    const { result } = renderHook(() => useAppSession(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      await result.current.handleQuickStart(
        "match-99",
        "sport-1",
        "config-1",
        7,
        "team-home-1",
      );
    });

    expect(hydrateMatchData).toHaveBeenCalledWith(
      "match-99",
      "team-home-1",
      "auth0|tester-123",
      expect.any(Function),
    );

    expect(store.getState().presence.activePlayersLimit).toBe(7);
    expect(store.getState().match.activeMatchId).toBe("match-99");
    expect(store.getState().match.activeTeamId).toBe("team-home-1");
  });

  it("should catch StaleUserError during Quick Start and not set active match in Redux", async () => {
    vi.mocked(hydrateMatchData).mockRejectedValueOnce(new StaleUserError());
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const store = createTestStore();
    const { result } = renderHook(() => useAppSession(), {
      wrapper: createWrapper(store),
    });

    await expect(
      act(async () => {
        await result.current.handleQuickStart(
          "match-99",
          "sport-1",
          "config-1",
          7,
          "team-home-1",
        );
      }),
    ).rejects.toThrow(StaleUserError);

    expect(consoleSpy).toHaveBeenCalledWith(
      "Account changed during Quick Start hydration. Aborting session activation.",
    );
    expect(store.getState().match.activeMatchId).toBeNull();

    consoleSpy.mockRestore();
  });

  it("should recover match session and restore recent actions into Redux", async () => {
    const mockActions = [
      {
        id: "act-1",
        playerNumber: 10,
        actionName: "Shot",
        isPositive: true,
        timestamp: "2026-06-01T12:00:00Z",
        matchLineupId: "lin-1",
        eventDefinitionId: "def-1",
        isLeadToGoal: false,
        isSynced: 1,
      },
    ];

    vi.mocked(recoverRecentActions).mockResolvedValueOnce(mockActions);

    const store = createTestStore();
    const { result } = renderHook(() => useAppSession(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      await result.current.handleResumeMatch("match-resumed", "team-guest-2");
    });

    expect(getMatchRecoveryState).toHaveBeenCalledWith("match-resumed");
    expect(recoverRecentActions).toHaveBeenCalledWith("match-resumed");

    expect(store.getState().presence.currentPeriod).toBe(2);
    expect(store.getState().presence.activePlayersLimit).toBe(6);
    expect(store.getState().match.activeMatchId).toBe("match-resumed");
    expect(store.getState().match.activeTeamId).toBe("team-guest-2");
    expect(store.getState().match.recentActions).toEqual(mockActions);
  });
});
