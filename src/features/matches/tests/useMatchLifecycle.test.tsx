import { renderHook, act, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import {
  useMatchLifecycle,
  calculatePeriodState,
  type EndPeriodResult,
} from "../hooks/useMatchLifecycle";
import matchReducer, {
  type MatchState,
  setPeriodStatePayload,
} from "../store/matchSlice";
import { db, type TimeAnchor } from "../../../db/ttaDatabase";
import { apiClient } from "../../../api/client";
import { vi, describe, beforeEach, test, expect } from "vitest";

vi.mock("../../../api/client", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

let mockTimeAnchors: TimeAnchor[] = [];
let mockSyncQueue: Array<{
  id?: number;
  payload: string;
  [key: string]: unknown;
}> = [];
let mockPlayerPresences: Array<{
  id: string;
  periodNumber: number;
  timeOut: string | null;
  matchLineupId: string;
  [key: string]: unknown;
}> = [];

let mockMatches: Record<string, unknown> = {};
let mockTournaments: Record<string, unknown> = {};
let mockSportConfigs: Record<string, unknown> = {};

const seedAnchorsFromState = (matchState: Partial<MatchState> = {}) => {
  const matchId = matchState.activeMatchId || "test-match-id";
  const periodNumber = matchState.periodNumber ?? 1;

  if (matchState.isPeriodActive || matchState.isPeriodEnded) {
    mockTimeAnchors.push({
      id: "seed-start-anchor",
      matchId,
      periodNumber,
      type: 0,
      timestamp: "2020-01-01T10:00:00Z",
      sequenceNumber: 1,
      isSynced: 0,
    });
  }

  if (matchState.isInsideStoppage) {
    mockTimeAnchors.push({
      id: "seed-stoppage-start-anchor",
      matchId,
      periodNumber,
      type: 2,
      timestamp: "2020-01-01T10:05:00Z",
      sequenceNumber: 2,
      isSynced: 0,
    });
  }

  if (matchState.isPeriodEnded) {
    mockTimeAnchors.push({
      id: "seed-end-anchor",
      matchId,
      periodNumber,
      type: 1,
      timestamp: "2020-01-01T10:10:00Z",
      sequenceNumber: 3,
      isSynced: 0,
    });
    mockSyncQueue.push({
      id: 101,
      actionType: "POST",
      endpoint: `/Matches/${matchId}/anchors`,
      payload: JSON.stringify([{ id: "seed-end-anchor" }]),
      createdAt: "2020-01-01T10:10:00Z",
    });
  }
};

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matches: {
      get: vi.fn((id: string) => Promise.resolve(mockMatches[id])),
      put: vi.fn(),
    },
    tournaments: {
      get: vi.fn((id: string) => Promise.resolve(mockTournaments[id])),
      put: vi.fn(),
    },
    sportconfigurations: {
      get: vi.fn((id: string) => Promise.resolve(mockSportConfigs[id])),
      put: vi.fn(),
    },
    timeanchors: {
      add: vi.fn((anchor: TimeAnchor) => {
        mockTimeAnchors.push(anchor);
        return Promise.resolve(anchor.id);
      }),
      delete: vi.fn((id: string) => {
        mockTimeAnchors = mockTimeAnchors.filter((a) => a.id !== id);
        return Promise.resolve();
      }),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockImplementation((matchIdVal: string) => ({
          filter: vi
            .fn()
            .mockImplementation((predicate: (a: TimeAnchor) => boolean) => ({
              toArray: vi.fn().mockImplementation(() => {
                const res = mockTimeAnchors.filter(
                  (a) => a.matchId === matchIdVal && predicate(a),
                );
                return Promise.resolve(res);
              }),
            })),
        })),
      }),
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    matchlineups: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    },
    gameevents: {
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    playerpresences: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      update: vi.fn((id: string, updateData: Record<string, unknown>) => {
        const index = mockPlayerPresences.findIndex((p) => p.id === id);
        if (index !== -1) {
          mockPlayerPresences[index] = {
            ...mockPlayerPresences[index],
            ...updateData,
          };
        }
        return Promise.resolve(1);
      }),
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    syncQueue: {
      add: vi.fn(
        (item: { id?: number; payload?: string; [key: string]: unknown }) => {
          const id = item.id ?? mockSyncQueue.length + 1;
          const newItem = {
            payload: "",
            ...item,
            id,
          };
          mockSyncQueue.push(newItem);
          return Promise.resolve(id);
        },
      ),
      delete: vi.fn((id: number) => {
        mockSyncQueue = mockSyncQueue.filter((i) => i.id !== id);
        return Promise.resolve();
      }),
      filter: vi.fn(
        (predicate?: (item: Record<string, unknown>) => boolean) => ({
          toArray: vi.fn().mockImplementation(() => {
            return Promise.resolve(
              predicate
                ? mockSyncQueue.filter((item) => predicate(item))
                : mockSyncQueue,
            );
          }),
        }),
      ),
    },
    transaction: vi.fn((...args: unknown[]) => {
      const cb = args[args.length - 1];
      return typeof cb === "function" ? cb() : undefined;
    }),
  },
}));

const createTestStore = (preloadedMatchState: Partial<MatchState> = {}) => {
  mockTimeAnchors = [];
  mockSyncQueue = [];
  seedAnchorsFromState(preloadedMatchState);

  return configureStore({
    reducer: {
      match: matchReducer,
    },
    preloadedState: {
      match: {
        activeMatchId: "test-match-id",
        activeTeamId: "test-team-id",
        periodNumber: 1,
        homeScore: 0,
        guestScore: 0,
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: false,
        globalSequenceNumber: 0,
        recentActions: [],
        ...preloadedMatchState,
      },
    },
  });
};

describe("useMatchLifecycle Hook & State Machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimeAnchors = [];
    mockSyncQueue = [];
    mockPlayerPresences = [];

    mockMatches = {
      "test-match-id": { id: "test-match-id", tournamentId: "test-tourn-id" },
      "match-padded-id": {
        id: "match-padded-id",
        tournamentId: "test-tourn-id",
      },
    };
    mockTournaments = {
      "test-tourn-id": {
        id: "test-tourn-id",
        configurationId: "test-config-id",
      },
    };
    mockSportConfigs = {
      "test-config-id": { id: "test-config-id", periodsCount: 4 },
    };

    vi.mocked(db.timeanchors.where).mockImplementation(
      () =>
        ({
          equals: vi.fn().mockImplementation((matchIdVal: string) => ({
            filter: vi
              .fn()
              .mockImplementation((predicate: (a: TimeAnchor) => boolean) => ({
                toArray: vi.fn().mockImplementation(() => {
                  const res = mockTimeAnchors.filter(
                    (a) => a.matchId === matchIdVal && predicate(a),
                  );
                  return Promise.resolve(res);
                }),
              })),
          })),
        }) as unknown as ReturnType<typeof db.timeanchors.where>,
    );

    vi.mocked(db.matchlineups.where).mockImplementation(
      () =>
        ({
          equals: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }) as unknown as ReturnType<typeof db.matchlineups.where>,
    );

    vi.mocked(db.playerpresences.where).mockImplementation(
      () =>
        ({
          equals: vi.fn().mockReturnValue({
            filter: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([]),
            }),
          }),
        }) as unknown as ReturnType<typeof db.playerpresences.where>,
    );

    vi.mocked(db.playerpresences.update).mockImplementation(((
      key: unknown,
      updateData: Record<string, unknown>,
    ) => {
      if (typeof key === "string") {
        const index = mockPlayerPresences.findIndex((p) => p.id === key);
        if (index !== -1) {
          mockPlayerPresences[index] = {
            ...mockPlayerPresences[index],
            ...updateData,
          };
        }
      }
      return Promise.resolve(1);
    }) as unknown as typeof db.playerpresences.update);

    vi.mocked(db.syncQueue.filter).mockImplementation(((
      predicate?: (item: Record<string, unknown>) => boolean,
    ) => ({
      toArray: vi.fn().mockImplementation(() => {
        return Promise.resolve(
          predicate
            ? mockSyncQueue.filter((item) => predicate(item))
            : mockSyncQueue,
        );
      }),
    })) as unknown as typeof db.syncQueue.filter);

    vi.mocked(db.transaction).mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        const timeAnchorsSnapshot = [...mockTimeAnchors];
        const syncQueueSnapshot = [...mockSyncQueue];
        const playerPresencesSnapshot = mockPlayerPresences.map((p) => ({
          ...p,
        }));

        const restoreSnapshots = () => {
          mockTimeAnchors = timeAnchorsSnapshot;
          mockSyncQueue = syncQueueSnapshot;
          mockPlayerPresences = playerPresencesSnapshot;
        };

        try {
          const res = cb();
          if (res && typeof (res as Promise<unknown>).then === "function") {
            return (res as Promise<unknown>).catch((err: unknown) => {
              restoreSnapshots();
              throw err;
            });
          }
          return res;
        } catch (err) {
          restoreSnapshots();
          throw err;
        }
      }
      return Promise.resolve();
    }) as unknown as typeof db.transaction);
  });

  describe("calculatePeriodState Helper", () => {
    test("should calculate inactive initial state when no anchors exist", () => {
      const state = calculatePeriodState([]);
      expect(state).toEqual({
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: false,
      });
    });

    test("should calculate active period state after PeriodStart anchor", () => {
      const anchors: TimeAnchor[] = [
        {
          id: "a1",
          matchId: "m1",
          periodNumber: 1,
          type: 0,
          timestamp: "2020-01-01T10:00:00Z",
          sequenceNumber: 1,
          isSynced: 0,
        },
      ];
      const state = calculatePeriodState(anchors);
      expect(state).toEqual({
        isPeriodActive: true,
        isInsideStoppage: false,
        isPeriodEnded: false,
      });
    });

    test("should calculate stoppage state when StoppageStart occurs after PeriodStart", () => {
      const anchors: TimeAnchor[] = [
        {
          id: "a1",
          matchId: "m1",
          periodNumber: 1,
          type: 0,
          timestamp: "2020-01-01T10:00:00Z",
          sequenceNumber: 1,
          isSynced: 0,
        },
        {
          id: "a2",
          matchId: "m1",
          periodNumber: 1,
          type: 2,
          timestamp: "2020-01-01T10:05:00Z",
          sequenceNumber: 2,
          isSynced: 0,
        },
      ];
      const state = calculatePeriodState(anchors);
      expect(state).toEqual({
        isPeriodActive: true,
        isInsideStoppage: true,
        isPeriodEnded: false,
      });
    });

    test("should calculate ended period state after PeriodEnd anchor", () => {
      const anchors: TimeAnchor[] = [
        {
          id: "a1",
          matchId: "m1",
          periodNumber: 1,
          type: 0,
          timestamp: "2020-01-01T10:00:00Z",
          sequenceNumber: 1,
          isSynced: 0,
        },
        {
          id: "a2",
          matchId: "m1",
          periodNumber: 1,
          type: 1,
          timestamp: "2020-01-01T10:10:00Z",
          sequenceNumber: 2,
          isSynced: 0,
        },
      ];
      const state = calculatePeriodState(anchors);
      expect(state).toEqual({
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: true,
      });
    });
  });

  describe("Dynamic SportConfiguration Periods Count Resolution", () => {
    test("should dynamically resolve periodsCount from IndexedDB for active match", async () => {
      const store = createTestStore();
      const { result } = renderHook(() => useMatchLifecycle(), {
        wrapper: ({ children }) => (
          <Provider store={store}>{children}</Provider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoadingConfig).toBe(false);
      });

      expect(result.current.periodsCount).toBe(4);
      expect(result.current.configError).toBeNull();
      expect(result.current.isFinalPeriod(4)).toBe(true);
      expect(result.current.isFinalPeriod(1)).toBe(false);
    });

    test("fetches tournament from API fallback when missing in IndexedDB and resolves config from Dexie", async () => {
      mockMatches = {
        "test-match-id": {
          id: "test-match-id",
          tournamentId: "missing-tourn-id",
        },
      };
      mockTournaments = {};
      mockSportConfigs = {
        "missing-config-id": { id: "missing-config-id", periodsCount: 4 },
      };

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        id: "missing-tourn-id",
        configurationId: "missing-config-id",
      });

      const store = createTestStore();
      const { result } = renderHook(() => useMatchLifecycle(), {
        wrapper: ({ children }) => (
          <Provider store={store}>{children}</Provider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoadingConfig).toBe(false);
      });

      expect(apiClient.get).toHaveBeenCalledWith(
        "/Tournaments/missing-tourn-id",
      );
      expect(db.tournaments.put).toHaveBeenCalledWith({
        id: "missing-tourn-id",
        configurationId: "missing-config-id",
      });
      expect(result.current.periodsCount).toBe(4);
    });

    test("should set configError and keep periodsCount null when match or config is missing", async () => {
      mockMatches = {};

      const store = createTestStore({ activeMatchId: "missing-match-id" });
      const { result } = renderHook(() => useMatchLifecycle(), {
        wrapper: ({ children }) => (
          <Provider store={store}>{children}</Provider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoadingConfig).toBe(false);
      });

      expect(result.current.periodsCount).toBeNull();
      expect(result.current.configError).toContain(
        "Match with ID 'missing-match-id' not found",
      );

      expect(() => result.current.isFinalPeriod(1)).toThrow(
        /Cannot evaluate isFinalPeriod: periodsCount is not resolved/i,
      );
    });

    test("should set configError when periodsCount is a non-integer float", async () => {
      mockSportConfigs["test-config-id"] = {
        id: "test-config-id",
        periodsCount: 3.5,
      };

      const store = createTestStore();
      const { result } = renderHook(() => useMatchLifecycle(), {
        wrapper: ({ children }) => (
          <Provider store={store}>{children}</Provider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoadingConfig).toBe(false);
      });

      expect(result.current.periodsCount).toBeNull();
      expect(result.current.configError).toContain(
        "Invalid or missing periodsCount in SportConfiguration",
      );
    });

    test("should throw error and abort endPeriod without Redux state mutation when periodsCount is unresolved", async () => {
      mockMatches = {};

      const store = createTestStore({
        isPeriodActive: true,
        globalSequenceNumber: 1,
      });

      const { result } = renderHook(() => useMatchLifecycle(), {
        wrapper: ({ children }) => (
          <Provider store={store}>{children}</Provider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoadingConfig).toBe(false);
      });

      expect(result.current.periodsCount).toBeNull();

      await expect(
        act(async () => {
          await result.current.endPeriod();
        }),
      ).rejects.toThrow(/Cannot evaluate isFinalPeriod/i);

      expect(store.getState().match.isPeriodActive).toBe(true);
      expect(store.getState().match.isPeriodEnded).toBe(false);
      expect(store.getState().match.globalSequenceNumber).toBe(1);
    });

    test("should return isFinal=true when ending the final period", async () => {
      mockSportConfigs["test-config-id"] = {
        id: "test-config-id",
        periodsCount: 2,
      };

      const store = createTestStore({
        periodNumber: 2,
        isPeriodActive: true,
      });

      const { result } = renderHook(() => useMatchLifecycle(), {
        wrapper: ({ children }) => (
          <Provider store={store}>{children}</Provider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoadingConfig).toBe(false);
      });

      expect(result.current.periodsCount).toBe(2);

      let endRes: EndPeriodResult | undefined;
      await act(async () => {
        endRes = await result.current.endPeriod();
      });

      expect(endRes).toEqual({
        anchorId: expect.any(String),
        isFinal: true,
      });
    });
  });

  test("should initialize with values matched from the Redux store", () => {
    const store = createTestStore({ periodNumber: 3, isPeriodActive: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    expect(result.current.periodNumber).toBe(3);
    expect(result.current.isPeriodActive).toBe(true);
  });

  test("should evaluate canUndoEndPeriod to true when unsynced PeriodEnd anchor exists", async () => {
    const store = createTestStore({
      periodNumber: 1,
      isPeriodEnded: true,
    });

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => {
      expect(result.current.canUndoEndPeriod).toBe(true);
    });
  });

  test("should start a period, add a TimeAnchor and push item to syncQueue in IndexedDB", async () => {
    const store = createTestStore({ isPeriodActive: false });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let anchorId: string | undefined;
    await act(async () => {
      anchorId = await result.current.startPeriod();
    });

    expect(anchorId).toBeDefined();
    expect(store.getState().match.isPeriodActive).toBe(true);
    expect(store.getState().match.globalSequenceNumber).toBe(1);
    expect(db.timeanchors.add).toHaveBeenCalledWith(
      expect.objectContaining({
        id: anchorId,
        matchId: "test-match-id",
        periodNumber: 1,
        type: 0,
        sequenceNumber: 1,
      }),
    );
    expect(db.syncQueue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "POST",
        endpoint: "/Matches/test-match-id/anchors",
        payload: expect.stringContaining(anchorId!),
      }),
    );
  });

  test("should start a specific target period when passed to startPeriod", async () => {
    const store = createTestStore({ periodNumber: 1, isPeriodEnded: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let anchorId: string | undefined;
    await act(async () => {
      anchorId = await result.current.startPeriod(2);
    });

    expect(anchorId).toBeDefined();
    expect(store.getState().match.periodNumber).toBe(2);
    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should block starting a period if it is already active or ended", async () => {
    const storeActive = createTestStore({ isPeriodActive: true });
    const { result: resActive } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={storeActive}>{children}</Provider>
      ),
    });

    await act(async () => {
      await resActive.current.startPeriod();
    });
    expect(db.timeanchors.add).not.toHaveBeenCalled();

    const storeEnded = createTestStore({ isPeriodEnded: true });
    const { result: resEnded } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={storeEnded}>{children}</Provider>
      ),
    });

    await act(async () => {
      await resEnded.current.startPeriod();
    });
    expect(db.timeanchors.add).not.toHaveBeenCalled();
  });

  test("should reject startPeriod atomically inside IndexedDB transaction when an existing end anchor is present before initial sync completes", async () => {
    let resolveSyncQuery: (value: TimeAnchor[]) => void = () => {};
    const syncQueryPromise = new Promise<TimeAnchor[]>((resolve) => {
      resolveSyncQuery = resolve;
    });

    let callCount = 0;
    const filterMock = vi
      .fn()
      .mockImplementation((predicate: (a: TimeAnchor) => boolean) => ({
        toArray: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return syncQueryPromise;
          }
          return Promise.resolve(
            mockTimeAnchors.filter(
              (a) => a.matchId === "test-match-id" && predicate(a),
            ),
          );
        }),
      }));

    vi.mocked(db.timeanchors.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({ filter: filterMock }),
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: false,
      isPeriodEnded: false,
    });

    mockTimeAnchors = [
      {
        id: "existing-start-anchor",
        matchId: "test-match-id",
        periodNumber: 1,
        type: 0,
        timestamp: "2020-01-01T10:00:00Z",
        sequenceNumber: 1,
        isSynced: 1,
      },
      {
        id: "existing-end-anchor",
        matchId: "test-match-id",
        periodNumber: 1,
        type: 1,
        timestamp: "2020-01-01T10:10:00Z",
        sequenceNumber: 2,
        isSynced: 1,
      },
    ];

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.startPeriod();
      }),
    ).rejects.toThrow(
      "Cannot start period: period is already active or ended.",
    );

    expect(mockTimeAnchors.filter((a) => a.type === 0)).toHaveLength(1);
    expect(store.getState().match.isPeriodActive).toBe(false);

    await act(async () => {
      resolveSyncQuery(mockTimeAnchors);
    });
  });

  test("should end a period, set isPeriodEnded=true and push item to syncQueue", async () => {
    const store = createTestStore({ isPeriodActive: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => {
      expect(result.current.isLoadingConfig).toBe(false);
    });

    let endResult: EndPeriodResult | undefined;
    await act(async () => {
      endResult = await result.current.endPeriod();
    });

    expect(endResult?.anchorId).toBeDefined();
    expect(endResult?.isFinal).toBe(false);
    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(store.getState().match.isPeriodEnded).toBe(true);
    expect(store.getState().match.globalSequenceNumber).toBe(1);
    expect(db.timeanchors.add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 1,
        sequenceNumber: 1,
      }),
    );
    expect(db.syncQueue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "POST",
        endpoint: "/Matches/test-match-id/anchors",
      }),
    );
  });

  test("should block ending a period if currently inside a stoppage", async () => {
    const store = createTestStore({
      isPeriodActive: true,
      isInsideStoppage: true,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.endPeriod();
    });

    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should remove both time anchor and associated sync queue item atomically in removeTimeAnchor", async () => {
    const mockSyncItemWithId = {
      id: 101,
      actionType: "POST",
      endpoint: "/Matches/test-match-id/anchors",
      payload: JSON.stringify([{ id: "target-anchor-id", type: 0 }]),
      createdAt: new Date().toISOString(),
    };
    const mockSyncItemWithoutId = {
      id: undefined,
      actionType: "POST",
      endpoint: "/Matches/test-match-id/anchors",
      payload: JSON.stringify([{ id: "target-anchor-id", type: 0 }]),
      createdAt: new Date().toISOString(),
    };

    vi.mocked(db.syncQueue.filter).mockReturnValueOnce({
      toArray: vi
        .fn()
        .mockResolvedValue([mockSyncItemWithId, mockSyncItemWithoutId]),
    } as unknown as ReturnType<typeof db.syncQueue.filter>);

    const store = createTestStore();
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.removeTimeAnchor("target-anchor-id");
    });

    expect(db.timeanchors.delete).toHaveBeenCalledWith("target-anchor-id");
    expect(db.syncQueue.filter).toHaveBeenCalled();
    expect(db.syncQueue.delete).toHaveBeenCalledTimes(1);
    expect(db.syncQueue.delete).toHaveBeenCalledWith(101);
  });

  test("should remove time anchor and queue item when revertStartPeriod and revertEndPeriod are called with anchorId", async () => {
    const mockSyncItem = {
      id: 202,
      actionType: "POST",
      endpoint: "/Matches/test-match-id/anchors",
      payload: JSON.stringify([{ id: "revert-anchor-id", type: 0 }]),
      createdAt: new Date().toISOString(),
    };

    vi.mocked(db.syncQueue.filter).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([mockSyncItem]),
    } as unknown as ReturnType<typeof db.syncQueue.filter>);

    const store = createTestStore({ isPeriodActive: true });
    mockTimeAnchors = [
      {
        id: "revert-anchor-id",
        matchId: "test-match-id",
        periodNumber: 1,
        type: 0,
        timestamp: "2020-01-01T10:00:00Z",
        sequenceNumber: 1,
        isSynced: 0,
      },
    ];

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.revertStartPeriod("revert-anchor-id");
    });

    expect(db.timeanchors.delete).toHaveBeenCalledWith("revert-anchor-id");
    expect(db.syncQueue.delete).toHaveBeenCalledWith(202);
    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(store.getState().match.isPeriodEnded).toBe(false);

    mockTimeAnchors.push({
      id: "start-anchor-for-revert",
      matchId: "test-match-id",
      periodNumber: 1,
      type: 0,
      timestamp: "2020-01-01T10:00:00Z",
      sequenceNumber: 1,
      isSynced: 0,
    });

    await act(async () => {
      await result.current.revertEndPeriod("revert-anchor-id");
    });

    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should revert end period when revertEndPeriod is called without explicit anchorId", async () => {
    const store = createTestStore({
      periodNumber: 1,
      isPeriodEnded: true,
    });

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.revertEndPeriod();
    });

    expect(db.timeanchors.delete).toHaveBeenCalledWith("seed-end-anchor");
    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should select and delete the latest end anchor by sequenceNumber when multiple exist during revertEndPeriod", async () => {
    const store = createTestStore({
      periodNumber: 1,
      isPeriodEnded: true,
    });

    mockTimeAnchors = [
      {
        id: "older-end-anchor",
        matchId: "test-match-id",
        periodNumber: 1,
        type: 1,
        timestamp: "2020-01-01T10:05:00Z",
        sequenceNumber: 2,
        isSynced: 0,
      },
      {
        id: "newer-end-anchor",
        matchId: "test-match-id",
        periodNumber: 1,
        type: 1,
        timestamp: "2020-01-01T10:10:00Z",
        sequenceNumber: 5,
        isSynced: 0,
      },
    ];

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.revertEndPeriod();
    });

    expect(db.timeanchors.delete).toHaveBeenCalledWith("newer-end-anchor");
    expect(db.timeanchors.delete).not.toHaveBeenCalledWith("older-end-anchor");
  });

  test("should handle revertStartPeriod and revertEndPeriod safely when anchorId is null or undefined", async () => {
    const store = createTestStore({ isPeriodActive: true });
    mockTimeAnchors = [];

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.revertStartPeriod(null);
    });

    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(store.getState().match.isPeriodEnded).toBe(false);

    mockTimeAnchors.push({
      id: "start-anchor-safe",
      matchId: "test-match-id",
      periodNumber: 1,
      type: 0,
      timestamp: "2020-01-01T10:00:00Z",
      sequenceNumber: 1,
      isSynced: 0,
    });

    await act(async () => {
      await result.current.revertEndPeriod(undefined);
    });

    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should roll back Redux state and rethrow error when logTimeAnchor fails inside startPeriod, endPeriod, stopTime, or startTime", async () => {
    vi.mocked(db.transaction).mockRejectedValue(
      new Error("IndexedDB transaction failure"),
    );

    const initialSeq = 5;
    const store = createTestStore({
      isPeriodActive: false,
      isInsideStoppage: false,
      globalSequenceNumber: initialSeq,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => {
      expect(result.current.isLoadingConfig).toBe(false);
    });

    // 1. startPeriod failure
    await expect(
      act(async () => {
        await result.current.startPeriod();
      }),
    ).rejects.toThrow("IndexedDB transaction failure");
    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(store.getState().match.isPeriodEnded).toBe(false);
    expect(store.getState().match.globalSequenceNumber).toBe(initialSeq);

    // Set state & anchor for endPeriod and stopTime tests
    act(() => {
      store.dispatch({ type: "match/startPeriodState" });
    });
    mockTimeAnchors = [
      {
        id: "start-fail-test",
        matchId: "test-match-id",
        periodNumber: 1,
        type: 0,
        timestamp: "2020-01-01T10:00:00Z",
        sequenceNumber: 1,
        isSynced: 0,
      },
    ];

    // 2. endPeriod failure
    await expect(
      act(async () => {
        await result.current.endPeriod();
      }),
    ).rejects.toThrow("IndexedDB transaction failure");
    expect(store.getState().match.isPeriodActive).toBe(true);
    expect(store.getState().match.globalSequenceNumber).toBe(initialSeq);

    // 3. stopTime failure
    await expect(
      act(async () => {
        await result.current.stopTime();
      }),
    ).rejects.toThrow("IndexedDB transaction failure");
    expect(store.getState().match.isInsideStoppage).toBe(false);
    expect(store.getState().match.globalSequenceNumber).toBe(initialSeq);

    // Set stoppage state and anchors for startTime test
    act(() => {
      store.dispatch({ type: "match/startStoppageState" });
    });
    mockTimeAnchors.push({
      id: "stoppage-start-fail-test",
      matchId: "test-match-id",
      periodNumber: 1,
      type: 2,
      timestamp: "2020-01-01T10:05:00Z",
      sequenceNumber: 2,
      isSynced: 0,
    });

    // 4. startTime failure
    await expect(
      act(async () => {
        await result.current.startTime();
      }),
    ).rejects.toThrow("IndexedDB transaction failure");
    expect(store.getState().match.isInsideStoppage).toBe(true);
    expect(store.getState().match.globalSequenceNumber).toBe(initialSeq);
  });

  test("should skip stale Redux rollback and sync in revertStartPeriod if period changes before removeTimeAnchor resolves", async () => {
    let resolveDelete: () => void = () => {};
    const deletePromise = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });

    vi.mocked(db.transaction).mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        return deletePromise.then(() => cb()) as ReturnType<
          typeof db.transaction
        >;
      }
      return Promise.resolve() as ReturnType<typeof db.transaction>;
    });

    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: true,
    });

    const { result, rerender } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let revertPromise!: Promise<void>;
    act(() => {
      revertPromise = result.current.revertStartPeriod("test-anchor-id");
    });

    mockTimeAnchors.push({
      id: "p2-start-anchor",
      matchId: "test-match-id",
      periodNumber: 2,
      type: 0,
      timestamp: "2020-01-01T10:20:00Z",
      sequenceNumber: 10,
      isSynced: 0,
    });

    act(() => {
      store.dispatch(
        setPeriodStatePayload({
          isPeriodActive: false,
          isInsideStoppage: false,
          isPeriodEnded: false,
        }),
      );
      result.current.nextPeriod();
    });
    rerender();

    expect(store.getState().match.periodNumber).toBe(2);

    await act(async () => {
      resolveDelete();
      await revertPromise;
    });

    expect(store.getState().match.periodNumber).toBe(2);
    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should skip stale Redux rollback on logTimeAnchor failure if context changes before error is handled", async () => {
    let rejectTransaction: (err: Error) => void = () => {};
    const transactionPromise = new Promise<void>((_, reject) => {
      rejectTransaction = reject;
    });

    vi.mocked(db.transaction).mockReturnValue(
      transactionPromise as unknown as ReturnType<typeof db.transaction>,
    );

    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: false,
    });

    const { result, rerender } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let startPromise!: Promise<string | undefined>;
    act(() => {
      startPromise = result.current.startPeriod();
    });

    mockTimeAnchors.push({
      id: "p2-start-anchor-fail-test",
      matchId: "test-match-id",
      periodNumber: 2,
      type: 0,
      timestamp: "2020-01-01T10:20:00Z",
      sequenceNumber: 10,
      isSynced: 0,
    });

    act(() => {
      store.dispatch(
        setPeriodStatePayload({
          isPeriodActive: false,
          isInsideStoppage: false,
          isPeriodEnded: false,
        }),
      );
      result.current.nextPeriod();
    });
    rerender();

    expect(store.getState().match.periodNumber).toBe(2);

    await act(async () => {
      rejectTransaction(new Error("DB write failure"));
      await expect(startPromise).rejects.toThrow("DB write failure");
    });

    expect(store.getState().match.periodNumber).toBe(2);
    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should ignore syncPeriodStateWithDB when period transitions from 1 to 2 during an async operation", async () => {
    let resolveAddAnchor: () => void = () => {};
    const addAnchorPromise = new Promise<void>((resolve) => {
      resolveAddAnchor = resolve;
    });

    vi.mocked(db.transaction).mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        return addAnchorPromise.then(() => cb()) as ReturnType<
          typeof db.transaction
        >;
      }
      return Promise.resolve() as ReturnType<typeof db.transaction>;
    });

    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: true,
      isPeriodEnded: false,
    });

    const { result, rerender } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => {
      expect(result.current.isLoadingConfig).toBe(false);
    });

    let endPromise!: Promise<EndPeriodResult | undefined>;
    act(() => {
      endPromise = result.current.endPeriod();
    });

    act(() => {
      result.current.nextPeriod();
    });
    rerender();

    expect(store.getState().match.periodNumber).toBe(2);

    await act(async () => {
      resolveAddAnchor();
      await endPromise;
    });

    expect(store.getState().match.periodNumber).toBe(2);
    expect(store.getState().match.isPeriodActive).toBe(false);
  });

  test("should stop the timer (stoppage start) and start the timer (stoppage end) properly", async () => {
    const store = createTestStore({
      isPeriodActive: true,
      isInsideStoppage: false,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.stopTime();
    });

    expect(store.getState().match.isInsideStoppage).toBe(true);
    expect(db.timeanchors.add).toHaveBeenCalledWith(
      expect.objectContaining({ type: 2 }),
    );

    await act(async () => {
      await result.current.startTime();
    });

    expect(store.getState().match.isInsideStoppage).toBe(false);
    expect(db.timeanchors.add).toHaveBeenCalledWith(
      expect.objectContaining({ type: 3 }),
    );
  });

  test("should block stoppage state triggers if current period is inactive", async () => {
    const store = createTestStore({ isPeriodActive: false });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.stopTime();
    });

    expect(store.getState().match.isPeriodActive).toBe(false);
  });

  test("should navigate period numbers up and down safely when period is inactive", () => {
    const store = createTestStore({ periodNumber: 1, isPeriodActive: false });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    act(() => {
      result.current.nextPeriod();
    });
    expect(store.getState().match.periodNumber).toBe(2);

    act(() => {
      result.current.prevPeriod();
    });
    expect(store.getState().match.periodNumber).toBe(1);
  });

  test("should block period navigation when a period is active", () => {
    const store = createTestStore({ periodNumber: 1, isPeriodActive: true });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    act(() => {
      result.current.nextPeriod();
    });
    expect(store.getState().match.periodNumber).toBe(1);
  });

  test("should throw and leave state unchanged if starting period without active match ID", async () => {
    const store = createTestStore({
      activeMatchId: null,
      globalSequenceNumber: 0,
      isPeriodActive: false,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.startPeriod();
      }),
    ).rejects.toThrow("No active match ID found for logging time anchor.");

    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(store.getState().match.globalSequenceNumber).toBe(0);
  });

  test("should throw and leave state unchanged if ending period without active match ID", async () => {
    const store = createTestStore({
      activeMatchId: null,
      globalSequenceNumber: 0,
      isPeriodActive: true,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.endPeriod();
      }),
    ).rejects.toThrow("No active match ID found for logging time anchor.");

    expect(store.getState().match.isPeriodActive).toBe(true);
    expect(store.getState().match.globalSequenceNumber).toBe(0);
  });

  test("should throw and leave state unchanged if stopping/resuming time without active match ID", async () => {
    const store = createTestStore({
      activeMatchId: null,
      globalSequenceNumber: 0,
      isPeriodActive: true,
      isInsideStoppage: false,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.stopTime();
      }),
    ).rejects.toThrow("No active match ID found for logging time anchor.");

    expect(store.getState().match.isInsideStoppage).toBe(false);
    expect(store.getState().match.globalSequenceNumber).toBe(0);

    await expect(
      act(async () => {
        await result.current.startTime();
      }),
    ).rejects.toThrow("No active match ID found for logging time anchor.");

    expect(store.getState().match.isInsideStoppage).toBe(false);
    expect(store.getState().match.globalSequenceNumber).toBe(0);
  });

  test("should block timer start (resume) if not inside stoppage or period is inactive", async () => {
    const store = createTestStore({
      isPeriodActive: true,
      isInsideStoppage: false,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.startTime();
    });

    expect(store.getState().match.isInsideStoppage).toBe(false);
  });

  test("should safely decrement period number down when period is inactive and greater than 1", () => {
    const store = createTestStore({ periodNumber: 2, isPeriodActive: false });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    act(() => {
      result.current.prevPeriod();
    });
    expect(store.getState().match.periodNumber).toBe(1);

    act(() => {
      result.current.prevPeriod();
    });
    expect(store.getState().match.periodNumber).toBe(1);
  });

  test("should throw and validate if activeMatchId is whitespace-only when starting a period", async () => {
    const store = createTestStore({
      activeMatchId: "   ",
      globalSequenceNumber: 0,
      isPeriodActive: false,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.startPeriod();
      }),
    ).rejects.toThrow("No active match ID found for logging time anchor.");
  });

  test("should normalize padded activeMatchId when logging time anchor", async () => {
    const store = createTestStore({
      activeMatchId: "  match-padded-id  ",
      isPeriodActive: false,
    });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let anchorId: string | undefined;
    await act(async () => {
      anchorId = await result.current.startPeriod();
    });

    expect(anchorId).toBeDefined();
    expect(db.timeanchors.add).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: "match-padded-id",
      }),
    );
    expect(db.syncQueue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/Matches/match-padded-id/anchors",
      }),
    );
  });

  test("should ignore stale syncPeriodStateWithDB results when period changes before query completes", async () => {
    let resolveFirstQuery: (value: TimeAnchor[]) => void = () => {};
    const firstQueryPromise = new Promise<TimeAnchor[]>((resolve) => {
      resolveFirstQuery = resolve;
    });

    const filterMock = vi
      .fn()
      .mockImplementation((predicate: (a: TimeAnchor) => boolean) => {
        const isPeriod1Query = mockTimeAnchors.some(
          (a) => a.periodNumber === 1 && predicate(a),
        );
        if (isPeriod1Query) {
          return { toArray: () => firstQueryPromise };
        }
        return {
          toArray: () =>
            Promise.resolve(
              mockTimeAnchors.filter(
                (a) => a.matchId === "test-match-id" && predicate(a),
              ),
            ),
        };
      });

    vi.mocked(db.timeanchors.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({ filter: filterMock }),
    } as unknown as ReturnType<typeof db.timeanchors.where>);

    const store = createTestStore({ periodNumber: 1, isPeriodActive: false });
    const { result, rerender } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    act(() => {
      result.current.nextPeriod();
    });
    rerender();

    expect(store.getState().match.periodNumber).toBe(2);

    await act(async () => {
      resolveFirstQuery([
        {
          id: "stale-p1-anchor",
          matchId: "test-match-id",
          periodNumber: 1,
          type: 0,
          timestamp: "2020-01-01T10:00:00Z",
          sequenceNumber: 1,
          isSynced: 0,
        },
      ]);
    });

    expect(store.getState().match.isPeriodActive).toBe(false);
  });

  test("should preserve new period state when delayed endPeriod transaction completes after period switch", async () => {
    let resolveAddAnchor: () => void = () => {};
    const addAnchorPromise = new Promise<void>((resolve) => {
      resolveAddAnchor = resolve;
    });

    vi.mocked(db.transaction).mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        return addAnchorPromise.then(() => cb()) as ReturnType<
          typeof db.transaction
        >;
      }
      return Promise.resolve() as ReturnType<typeof db.transaction>;
    });

    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: true,
      isPeriodEnded: false,
    });

    const { result, rerender } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => {
      expect(result.current.isLoadingConfig).toBe(false);
    });

    let endPromise!: Promise<EndPeriodResult | undefined>;
    act(() => {
      endPromise = result.current.endPeriod();
    });

    act(() => {
      result.current.nextPeriod();
    });
    rerender();

    expect(store.getState().match.periodNumber).toBe(2);

    await act(async () => {
      resolveAddAnchor();
      await endPromise;
    });

    expect(store.getState().match.periodNumber).toBe(2);
    expect(store.getState().match.isPeriodActive).toBe(false);
  });

  test("should roll back transaction and preserve ended state when playerpresences update fails inside revertEndPeriod", async () => {
    vi.mocked(db.matchlineups.where).mockImplementation(
      () =>
        ({
          equals: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([{ id: "lineup-1" }]),
          }),
        }) as unknown as ReturnType<typeof db.matchlineups.where>,
    );

    vi.mocked(db.playerpresences.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        filter: vi
          .fn()
          .mockImplementation(
            (
              predicate: (p: {
                matchLineupId: string;
                timeOut: string | null;
              }) => boolean,
            ) => ({
              toArray: vi.fn().mockResolvedValue(
                [
                  {
                    id: "presence-1",
                    matchLineupId: "lineup-1",
                    timeOut: "2020-01-01T10:00:00Z",
                  },
                ].filter(predicate),
              ),
            }),
          ),
      }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    vi.mocked(db.playerpresences.update).mockRejectedValueOnce(
      new Error("Player presences update failed"),
    );

    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: false,
      isPeriodEnded: true,
    });

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => {
      expect(result.current.isPeriodEnded).toBe(true);
    });

    await expect(
      act(async () => {
        await result.current.revertEndPeriod("seed-end-anchor");
      }),
    ).rejects.toThrow("Player presences update failed");

    expect(store.getState().match.isPeriodEnded).toBe(true);
    expect(store.getState().match.isPeriodActive).toBe(false);
  });

  test("should only reset player presences for the active match lineups during revertEndPeriod", async () => {
    vi.mocked(db.matchlineups.where).mockImplementation(
      () =>
        ({
          equals: vi.fn().mockImplementation((matchIdVal: string) => ({
            toArray: vi
              .fn()
              .mockResolvedValue(
                matchIdVal === "test-match-id"
                  ? [{ id: "lineup-match-1" }]
                  : [{ id: "lineup-match-2" }],
              ),
          })),
        }) as unknown as ReturnType<typeof db.matchlineups.where>,
    );

    const updatedPresences: string[] = [];
    vi.mocked(db.playerpresences.update).mockImplementation(((key: unknown) => {
      if (typeof key === "string") {
        updatedPresences.push(key);
      }
      return Promise.resolve(1);
    }) as unknown as typeof db.playerpresences.update);

    vi.mocked(db.playerpresences.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        filter: vi
          .fn()
          .mockImplementation(
            (
              predicate: (p: {
                matchLineupId: string;
                timeOut: string | null;
              }) => boolean,
            ) => ({
              toArray: vi.fn().mockResolvedValue(
                [
                  {
                    id: "presence-match-1",
                    matchLineupId: "lineup-match-1",
                    timeOut: "2020-01-01T10:00:00Z",
                  },
                  {
                    id: "presence-match-2",
                    matchLineupId: "lineup-match-2",
                    timeOut: "2020-01-01T10:00:00Z",
                  },
                ].filter(predicate),
              ),
            }),
          ),
      }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: false,
      isPeriodEnded: true,
    });

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => {
      expect(result.current.isPeriodEnded).toBe(true);
    });

    await act(async () => {
      await result.current.revertEndPeriod("seed-end-anchor");
    });

    expect(updatedPresences).toEqual(["presence-match-1"]);
    expect(updatedPresences).not.toContain("presence-match-2");
  });

  test("should only reopen player presences matching the max timeOut during revertEndPeriod", async () => {
    vi.mocked(db.matchlineups.where).mockImplementation(
      () =>
        ({
          equals: vi.fn().mockReturnValue({
            toArray: vi
              .fn()
              .mockResolvedValue([
                { id: "lineup-earlier-sub" },
                { id: "lineup-period-end" },
              ]),
          }),
        }) as unknown as ReturnType<typeof db.matchlineups.where>,
    );

    mockPlayerPresences = [
      {
        id: "presence-earlier-sub",
        periodNumber: 1,
        timeOut: "2020-01-01T10:05:00Z",
        matchLineupId: "lineup-earlier-sub",
      },
      {
        id: "presence-period-end",
        periodNumber: 1,
        timeOut: "2020-01-01T10:10:00Z",
        matchLineupId: "lineup-period-end",
      },
    ];

    vi.mocked(db.playerpresences.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        filter: vi
          .fn()
          .mockImplementation(
            (
              predicate: (p: {
                matchLineupId: string;
                timeOut: string | null;
              }) => boolean,
            ) => ({
              toArray: vi
                .fn()
                .mockResolvedValue(mockPlayerPresences.filter(predicate)),
            }),
          ),
      }),
    } as unknown as ReturnType<typeof db.playerpresences.where>);

    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: false,
      isPeriodEnded: true,
    });

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => {
      expect(result.current.isPeriodEnded).toBe(true);
    });

    await act(async () => {
      await result.current.revertEndPeriod("seed-end-anchor");
    });

    const reopenedPresence = mockPlayerPresences.find(
      (p) => p.id === "presence-period-end",
    );
    expect(reopenedPresence?.timeOut).toBeNull();

    const earlierSubPresence = mockPlayerPresences.find(
      (p) => p.id === "presence-earlier-sub",
    );
    expect(earlierSubPresence?.timeOut).toBe("2020-01-01T10:05:00Z");
  });

  test("should purge orphaned /presence/terminate queue items for the current period during revertEndPeriod", async () => {
    const store = createTestStore({
      periodNumber: 1,
      isPeriodEnded: true,
    });

    const terminateQueueItem = {
      id: 303,
      actionType: "PUT",
      endpoint: "/Matches/test-match-id/presence/terminate",
      payload: JSON.stringify({
        periodNumber: 1,
        playerLineupIds: ["lineup-1"],
        timeOut: "2020-01-01T10:10:00Z",
      }),
      createdAt: "2020-01-01T10:10:00Z",
    };

    const otherPeriodTerminateQueueItem = {
      id: 304,
      actionType: "PUT",
      endpoint: "/Matches/test-match-id/presence/terminate",
      payload: JSON.stringify({
        periodNumber: 2,
        playerLineupIds: ["lineup-1"],
        timeOut: "2020-01-01T10:20:00Z",
      }),
      createdAt: "2020-01-01T10:20:00Z",
    };

    mockSyncQueue.push(terminateQueueItem, otherPeriodTerminateQueueItem);

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.revertEndPeriod("seed-end-anchor");
    });

    expect(db.syncQueue.delete).toHaveBeenCalledWith(303);
    expect(db.syncQueue.delete).not.toHaveBeenCalledWith(304);
    expect(mockSyncQueue.some((i) => i.id === 303)).toBe(false);
    expect(mockSyncQueue.some((i) => i.id === 304)).toBe(true);
  });

  test("should reject invalid targetPeriodNumber without advancing state", async () => {
    const store = createTestStore({ periodNumber: 1, isPeriodEnded: false });
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.startPeriod(3);
    });

    expect(store.getState().match.periodNumber).toBe(1);
    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(db.timeanchors.add).not.toHaveBeenCalled();
  });

  test("should restore prior period number and ended state when logTimeAnchor fails during START PERIOD N+1", async () => {
    vi.mocked(db.transaction).mockRejectedValueOnce(
      new Error("Anchor write failed"),
    );

    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: false,
      isPeriodEnded: true,
      globalSequenceNumber: 3,
    });

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.startPeriod(2);
      }),
    ).rejects.toThrow("Anchor write failed");

    expect(store.getState().match.periodNumber).toBe(1);
    expect(store.getState().match.isPeriodEnded).toBe(true);
    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(store.getState().match.globalSequenceNumber).toBe(3);
  });

  test("logs error when tournament API fallback fetch fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockMatches = {
      "test-match-id": {
        id: "test-match-id",
        tournamentId: "failed-tourn-id",
      },
    };
    mockTournaments = {};

    vi.mocked(apiClient.get).mockRejectedValueOnce(
      new Error("Network connection lost"),
    );

    const store = createTestStore();
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => {
      expect(result.current.isLoadingConfig).toBe(false);
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      "[useMatchLifecycle] Tournament fallback fetch failed for 'failed-tourn-id':",
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});
