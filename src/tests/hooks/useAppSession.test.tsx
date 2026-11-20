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
    maxPersonalFouls: 3,
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

    expect((store.getState() as RootState).presence.activePlayersLimit).toBe(7);
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

  it("should abort Quick Start activation if user identity changes mid-hydration", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let resolveHydration: (val: { success: boolean }) => void = () => {};
    const deferredHydration = new Promise<{ success: boolean }>((resolve) => {
      resolveHydration = resolve;
    });

    vi.mocked(hydrateMatchData).mockImplementationOnce(
      async (_mId, _tId, _uId, verifyFreshness) => {
        const res = await deferredHydration;
        verifyFreshness?.();
        return res;
      },
    );

    const store = createTestStore();
    const { result, rerender } = renderHook(() => useAppSession(), {
      wrapper: createWrapper(store),
    });

    let quickStartPromise: Promise<void>;
    act(() => {
      quickStartPromise = result.current.handleQuickStart(
        "match-99",
        "sport-1",
        "config-1",
        7,
        "team-home-1",
      );
    });

    mockUser = { email: "userB@tta.com", sub: "auth0|user-B" };
    rerender();

    resolveHydration({ success: true });

    await expect(quickStartPromise!).rejects.toThrow(StaleUserError);

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

    expect((store.getState() as RootState).presence.currentPeriod).toBe(2);
    expect((store.getState() as RootState).presence.activePlayersLimit).toBe(6);
    expect(store.getState().match.activeMatchId).toBe("match-resumed");
    expect(store.getState().match.activeTeamId).toBe("team-guest-2");
    expect(store.getState().match.recentActions).toEqual(mockActions);
  });

  it("should abort handleResumeMatch without updating Redux state if user switches accounts during recovery", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let resolveRecovery: (val: {
      recoveredPeriod: number;
      activePlayersLimit: number;
      maxPersonalFouls: number | null;
    }) => void = () => {};
    const deferredRecovery = new Promise<{
      recoveredPeriod: number;
      activePlayersLimit: number;
      maxPersonalFouls: number | null;
    }>((resolve) => {
      resolveRecovery = resolve;
    });

    vi.mocked(getMatchRecoveryState).mockReturnValueOnce(deferredRecovery);

    const store = createTestStore();
    const { result, rerender } = renderHook(() => useAppSession(), {
      wrapper: createWrapper(store),
    });

    let resumePromise: Promise<void>;
    act(() => {
      resumePromise = result.current.handleResumeMatch(
        "match-resumed",
        "team-guest-2",
      );
    });

    mockUser = { email: "userB@tta.com", sub: "auth0|user-B" };
    rerender();

    resolveRecovery({
      recoveredPeriod: 3,
      activePlayersLimit: 7,
      maxPersonalFouls: 3,
    });

    await act(async () => {
      await resumePromise!;
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      "Account changed during match recovery. Aborting session resumption.",
    );
    expect(store.getState().match.activeMatchId).toBeNull();

    consoleSpy.mockRestore();
  });

  it("should re-throw error when getMatchRecoveryState fails during handleResumeMatch", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getMatchRecoveryState).mockRejectedValueOnce(
      new Error("Recovery DB Error"),
    );

    const store = createTestStore();
    const { result } = renderHook(() => useAppSession(), {
      wrapper: createWrapper(store),
    });

    await expect(
      act(async () => {
        await result.current.handleResumeMatch("match-err", "team-1");
      }),
    ).rejects.toThrow("Recovery DB Error");

    expect(consoleSpy).toHaveBeenCalledWith(
      "Session recovery failed (non-critical):",
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it("should suppress error re-throw in handleResumeMatch if user account changes during failed recovery", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getMatchRecoveryState).mockRejectedValueOnce(
      new Error("Recovery DB Error"),
    );

    const store = createTestStore();
    const { result, rerender } = renderHook(() => useAppSession(), {
      wrapper: createWrapper(store),
    });

    let resumePromise: Promise<void>;
    act(() => {
      resumePromise = result.current.handleResumeMatch("match-err", "team-1");
    });

    mockUser = { email: "userB@tta.com", sub: "auth0|user-B" };
    rerender();

    await expect(resumePromise!).resolves.toBeUndefined();

    consoleSpy.mockRestore();
  });

  it("should keep maxPersonalFouls undefined when starting from initial presence state with no background refresh, and update Redux when background refresh resolves", async () => {
    // 1. Start with default initial presence state (maxPersonalFouls: undefined) and no background refresh
    vi.mocked(getMatchRecoveryState).mockResolvedValueOnce({
      recoveredPeriod: 2,
      activePlayersLimit: 7,
    });

    const store = createTestStore();
    expect(
      (store.getState() as RootState).presence.maxPersonalFouls,
    ).toBeUndefined();

    const { result } = renderHook(() => useAppSession(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      await result.current.handleResumeMatch("match-no-refresh", "team-1");
    });

    // When cached maxPersonalFouls is absent (undefined) and no refresh runs, it remains undefined (distinct from explicit null)
    expect(
      (store.getState() as RootState).presence.maxPersonalFouls,
    ).toBeUndefined();

    // 2. Resume with a background refresh promise that resolves with remote maxPersonalFouls = 3
    let resolveRefresh!: (val: {
      id: string;
      sportId: string;
      activePlayersLimit: number;
      maxPersonalFouls?: number | null;
    }) => void;
    const refreshPromise = new Promise<{
      id: string;
      sportId: string;
      activePlayersLimit: number;
      maxPersonalFouls?: number | null;
    }>((resolve) => {
      resolveRefresh = resolve;
    });

    vi.mocked(getMatchRecoveryState).mockResolvedValueOnce({
      recoveredPeriod: 2,
      activePlayersLimit: 7,
      refreshPromise: refreshPromise as never,
    });

    await act(async () => {
      await result.current.handleResumeMatch("match-resumed", "team-1");
    });

    expect(
      (store.getState() as RootState).presence.maxPersonalFouls,
    ).toBeUndefined();

    await act(async () => {
      resolveRefresh({
        id: "cfg-1",
        sportId: "sport-1",
        activePlayersLimit: 7,
        maxPersonalFouls: 3,
      });
      await refreshPromise;
    });

    expect((store.getState() as RootState).presence.maxPersonalFouls).toBe(3);
  });

  it("should ignore a stale background refresh callback if a new match starts before the old refresh resolves", async () => {
    let resolveOldRefresh!: (val: {
      id: string;
      sportId: string;
      activePlayersLimit: number;
      maxPersonalFouls?: number | null;
    }) => void;
    const oldRefreshPromise = new Promise<{
      id: string;
      sportId: string;
      activePlayersLimit: number;
      maxPersonalFouls?: number | null;
    }>((resolve) => {
      resolveOldRefresh = resolve;
    });

    vi.mocked(getMatchRecoveryState).mockResolvedValueOnce({
      recoveredPeriod: 3,
      activePlayersLimit: 7,
      maxPersonalFouls: 5,
      refreshPromise: oldRefreshPromise as never,
    });

    const store = createTestStore();
    const { result } = renderHook(() => useAppSession(), {
      wrapper: createWrapper(store),
    });

    // 1. Resume first match ("match-old") withpending refresh
    await act(async () => {
      await result.current.handleResumeMatch("match-old", "team-1");
    });

    expect(store.getState().match.activeMatchId).toBe("match-old");
    expect((store.getState() as RootState).presence.currentPeriod).toBe(3);
    expect((store.getState() as RootState).presence.activePlayersLimit).toBe(7);
    expect((store.getState() as RootState).presence.maxPersonalFouls).toBe(5);

    // 2. Start a new match ("match-new") with limit 11, period 1, maxPersonalFouls: null (unlimited)
    await act(async () => {
      await result.current.handleQuickStart(
        "match-new",
        "sport-2",
        "cfg-2",
        11,
        "team-2",
        null,
      );
    });

    expect(store.getState().match.activeMatchId).toBe("match-new");
    expect((store.getState() as RootState).presence.currentPeriod).toBe(1);
    expect((store.getState() as RootState).presence.activePlayersLimit).toBe(
      11,
    );
    expect(
      (store.getState() as RootState).presence.maxPersonalFouls,
    ).toBeNull();

    // 3. Resolve the old match's background refresh -> must NOT overwrite the new match's limits or period
    await act(async () => {
      resolveOldRefresh({
        id: "cfg-1",
        sportId: "sport-1",
        activePlayersLimit: 7,
        maxPersonalFouls: 3,
      });
      await oldRefreshPromise;
    });

    expect(store.getState().match.activeMatchId).toBe("match-new");
    expect((store.getState() as RootState).presence.currentPeriod).toBe(1);
    expect((store.getState() as RootState).presence.activePlayersLimit).toBe(
      11,
    );
    expect(
      (store.getState() as RootState).presence.maxPersonalFouls,
    ).toBeNull();
  });

  it("should abort stale handleResumeMatch after getMatchRecoveryState if a newer Quick Start session starts first", async () => {
    type RecoveryState = Awaited<ReturnType<typeof getMatchRecoveryState>>;
    let resolveRecovery!: (val: RecoveryState) => void;
    const deferredRecovery = new Promise<RecoveryState>((resolve) => {
      resolveRecovery = resolve;
    });

    vi.mocked(getMatchRecoveryState).mockReturnValueOnce(deferredRecovery);

    const store = createTestStore();
    const { result } = renderHook(() => useAppSession(), {
      wrapper: createWrapper(store),
    });

    let resumePromise!: Promise<void>;
    act(() => {
      resumePromise = result.current.handleResumeMatch("match-old", "team-old");
    });

    await act(async () => {
      await result.current.handleQuickStart(
        "match-new",
        "sport-2",
        "cfg-2",
        11,
        "team-new",
        null,
      );
    });

    resolveRecovery({
      recoveredPeriod: 3,
      activePlayersLimit: 7,
      maxPersonalFouls: 3,
    });

    await act(async () => {
      await resumePromise;
    });

    expect(recoverRecentActions).not.toHaveBeenCalled();
    expect(store.getState().match.activeMatchId).toBe("match-new");
    expect(store.getState().match.activeTeamId).toBe("team-new");
    expect((store.getState() as RootState).presence.currentPeriod).toBe(1);
    expect((store.getState() as RootState).presence.activePlayersLimit).toBe(
      11,
    );
    expect(
      (store.getState() as RootState).presence.maxPersonalFouls,
    ).toBeNull();
  });

  it("should abort stale handleResumeMatch after recoverRecentActions if a newer Quick Start session starts before actions resolve", async () => {
    type RecoveredActions = Awaited<ReturnType<typeof recoverRecentActions>>;
    let resolveRecentActions!: (val: RecoveredActions) => void;
    let notifyRecoverActionsCalled!: () => void;
    const recoverActionsCalled = new Promise<void>((resolve) => {
      notifyRecoverActionsCalled = resolve;
    });
    const deferredRecentActions = new Promise<RecoveredActions>((resolve) => {
      resolveRecentActions = resolve;
    });

    vi.mocked(getMatchRecoveryState).mockResolvedValueOnce({
      recoveredPeriod: 3,
      activePlayersLimit: 7,
      maxPersonalFouls: 3,
    });
    vi.mocked(recoverRecentActions).mockImplementationOnce(() => {
      notifyRecoverActionsCalled();
      return deferredRecentActions;
    });

    const store = createTestStore();
    const { result } = renderHook(() => useAppSession(), {
      wrapper: createWrapper(store),
    });

    let resumePromise!: Promise<void>;
    act(() => {
      resumePromise = result.current.handleResumeMatch("match-old", "team-old");
    });

    await recoverActionsCalled;

    await act(async () => {
      await result.current.handleQuickStart(
        "match-new",
        "sport-2",
        "cfg-2",
        11,
        "team-new",
        null,
      );
    });

    resolveRecentActions([
      {
        id: "stale-act-1",
        playerNumber: 5,
        actionName: "Goal",
        isPositive: true,
        timestamp: "2026-06-01T12:00:00Z",
        matchLineupId: "lin-1",
        eventDefinitionId: "def-1",
        isLeadToGoal: false,
        isSynced: 1,
      },
    ]);

    await act(async () => {
      await resumePromise;
    });

    expect(store.getState().match.activeMatchId).toBe("match-new");
    expect(store.getState().match.activeTeamId).toBe("team-new");
    expect(store.getState().match.recentActions).toEqual([]);
    expect((store.getState() as RootState).presence.currentPeriod).toBe(1);
    expect((store.getState() as RootState).presence.activePlayersLimit).toBe(
      11,
    );
    expect(
      (store.getState() as RootState).presence.maxPersonalFouls,
    ).toBeNull();
  });
});
