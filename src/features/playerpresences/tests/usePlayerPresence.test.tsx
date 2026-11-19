import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import React from "react";
import { usePlayerPresence } from "../hooks/usePlayerPresence";
import presenceReducer, { setPresenceLimits } from "../store/presenceSlice";
import matchReducer, {
  incrementPeriodNumber,
} from "../../matches/store/matchSlice";
import { db } from "../../../db/ttaDatabase";
import {
  findDisqualifiedLineupIds,
  initializePeriodPresenceTx,
  terminatePeriodPresenceTx,
  substitutePlayerTx,
  exitPlayerPresenceTx,
  enterPlayerPresenceTx,
} from "../../../db/presenceService";

// Mock the IndexedDB module to isolate the hook from real database connections
vi.mock("../../../db/ttaDatabase", () => {
  return {
    db: {
      matchlineups: {
        where: vi.fn().mockReturnThis(),
        equals: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          { id: "lineup-1", matchId: "test-match" },
          { id: "lineup-2", matchId: "test-match" },
        ]),
      },
      playerpresences: {
        where: vi.fn().mockReturnThis(),
        equals: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          {
            id: "pres-1",
            matchLineupId: "lineup-1",
            periodNumber: 1,
            timeIn: "2026-07-16T10:00:00.000Z",
            timeOut: null,
          },
          {
            id: "pres-closed",
            matchLineupId: "lineup-1",
            periodNumber: 1,
            timeIn: "2026-07-16T09:50:00.000Z",
            timeOut: "2026-07-16T09:55:00.000Z",
          },
        ]),
      },
    },
  };
});

// Mock the transactional service functions
vi.mock("../../../db/presenceService", () => {
  return {
    findDisqualifiedLineupIds: vi.fn().mockResolvedValue([]),
    initializePeriodPresenceTx: vi.fn().mockResolvedValue(undefined),
    terminatePeriodPresenceTx: vi.fn().mockResolvedValue(undefined),
    substitutePlayerTx: vi.fn().mockResolvedValue("new-presence-uuid"),
    exitPlayerPresenceTx: vi.fn().mockResolvedValue(true),
    enterPlayerPresenceTx: vi.fn().mockResolvedValue("entered-presence-uuid"),
  };
});

const createTestStore = () => {
  return configureStore({
    reducer: {
      match: matchReducer,
      presence: presenceReducer,
    },
  });
};

describe("usePlayerPresence Hook", () => {
  let store: ReturnType<typeof createTestStore>;
  let wrapper: React.FC<{ children: React.ReactNode }>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createTestStore();
    wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
  });

  it("should initialize with default states and limits", () => {
    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    expect(result.current.currentPeriod).toBe(1);
    expect(result.current.activePlayersLimit).toBe(0);
    expect(result.current.selectedStartingIds).toEqual([]);
    expect(result.current.activeLineupIds).toEqual([]);
  });

  it("should stage and validate starting lineup correctly within limits", () => {
    act(() => {
      store.dispatch(setPresenceLimits({ limit: 7, period: 1 }));
    });

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    act(() => {
      result.current.stageStartingLineup(["p1", "p2", "p3"]);
    });

    expect(result.current.selectedStartingIds).toEqual(["p1", "p2", "p3"]);

    expect(() => {
      act(() => {
        result.current.stageStartingLineup([
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
        ]);
      });
    }).toThrow("Cannot exceed the limit of 7 active players.");
  });

  it("should refresh roster and load presence state from IndexedDB filtering out closed sessions and duplicates", async () => {
    vi.mocked(db.playerpresences.toArray).mockResolvedValueOnce([
      {
        id: "pres-2",
        matchLineupId: "lineup-2",
        periodNumber: 1,
        timeIn: "2026-07-16T10:02:00.000Z",
        timeOut: null,
      },
      {
        id: "pres-1",
        matchLineupId: "lineup-1",
        periodNumber: 1,
        timeIn: "2026-07-16T10:00:00.000Z",
        timeOut: null,
      },
      {
        id: "pres-duplicate",
        matchLineupId: "lineup-1",
        periodNumber: 1,
        timeIn: "2026-07-16T10:01:00.000Z",
        timeOut: null,
      },
    ] as never);

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    await act(async () => {
      await result.current.refreshPresenceFromDB();
    });

    // Sorted chronologically by timeIn: lineup-1 (10:00) before lineup-2 (10:02)
    expect(result.current.activeLineupIds).toEqual(["lineup-1", "lineup-2"]);
    expect(result.current.benchLineupIds).toEqual([]);
  });

  it("should ignore refresh result if periodNumber changed while the DB query was in flight", async () => {
    let resolveQuery!: (value: unknown) => void;

    vi.mocked(db.playerpresences.toArray).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }) as unknown as ReturnType<typeof db.playerpresences.toArray>,
    );

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    let refreshPromise!: Promise<void>;
    await act(async () => {
      refreshPromise = result.current.refreshPresenceFromDB(1);
      // Flush microtask so db.matchlineups.toArray() resolves and db.playerpresences.toArray() is invoked
      await Promise.resolve();
    });

    // Advance period while period 1 presence query is still in flight
    act(() => {
      store.dispatch(incrementPeriodNumber());
    });

    await act(async () => {
      resolveQuery([
        {
          id: "pres-1",
          matchLineupId: "lineup-1",
          periodNumber: 1,
          timeIn: "2026-07-16T10:00:00.000Z",
          timeOut: null,
        },
      ]);
      await refreshPromise;
    });

    expect(result.current.activeLineupIds).toEqual([]);
  });

  it("should ignore stale refresh requests if a newer request was issued", async () => {
    let resolveFirstQuery!: (value: unknown) => void;

    vi.mocked(db.playerpresences.toArray)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstQuery = resolve;
          }) as unknown as ReturnType<typeof db.playerpresences.toArray>,
      )
      .mockResolvedValueOnce([
        {
          id: "pres-2",
          matchLineupId: "lineup-2",
          periodNumber: 1,
          timeIn: "2026-07-16T10:00:00.000Z",
          timeOut: null,
        },
      ] as never);

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    // Trigger first (slow) refresh synchronously within act
    let firstRefreshPromise!: Promise<void>;
    act(() => {
      firstRefreshPromise = result.current.refreshPresenceFromDB();
    });

    // Trigger second (fast) refresh and await it
    await act(async () => {
      await result.current.refreshPresenceFromDB();
    });

    // Resolve first query late and await its promise within act
    await act(async () => {
      resolveFirstQuery([
        {
          id: "pres-1",
          matchLineupId: "lineup-1",
          periodNumber: 1,
          timeIn: "2026-07-16T09:00:00.000Z",
          timeOut: null,
        },
      ]);
      await firstRefreshPromise;
    });

    // Active lineup should reflect second request result ("lineup-2"), ignoring stale first request
    expect(result.current.activeLineupIds).toEqual(["lineup-2"]);
  });

  it("should handle error gracefully when refreshPresenceFromDB fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(db.matchlineups.toArray).mockRejectedValueOnce(
      new Error("Database Read Error"),
    );

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    await act(async () => {
      await result.current.refreshPresenceFromDB();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to load local presence state:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it("should start a period, trigger database initialization, and sync with DB", async () => {
    act(() => {
      store.dispatch(setPresenceLimits({ limit: 7, period: 1 }));
    });

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    const completeLineup = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];

    act(() => {
      result.current.stageStartingLineup(completeLineup);
    });

    await act(async () => {
      await result.current.startPeriodWithRoster("2026-07-16T10:00:00.000Z");
    });

    expect(initializePeriodPresenceTx).toHaveBeenCalledWith(
      "test-match",
      1,
      completeLineup,
      "2026-07-16T10:00:00.000Z",
    );
    expect(db.matchlineups.where).toHaveBeenCalled();
  });

  it("should respect overridePeriodNumber when passed to startPeriodWithRoster, endPeriodWithRoster, and executeSubstitution", async () => {
    act(() => {
      store.dispatch(setPresenceLimits({ limit: 7, period: 1 }));
    });

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    const completeLineup = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];

    act(() => {
      result.current.stageStartingLineup(completeLineup);
    });

    await act(async () => {
      await result.current.startPeriodWithRoster("2026-07-16T10:00:00.000Z", 2);
    });

    expect(initializePeriodPresenceTx).toHaveBeenCalledWith(
      "test-match",
      2,
      completeLineup,
      "2026-07-16T10:00:00.000Z",
    );

    await act(async () => {
      await result.current.executeSubstitution("outgoing-p", "incoming-p", 2);
    });

    expect(substitutePlayerTx).toHaveBeenCalledWith(
      "test-match",
      2,
      "outgoing-p",
      "incoming-p",
    );

    await act(async () => {
      await result.current.endPeriodWithRoster("2026-07-16T11:00:00.000Z", 2);
    });

    expect(terminatePeriodPresenceTx).toHaveBeenCalledWith(
      "test-match",
      2,
      expect.any(Array),
      "2026-07-16T11:00:00.000Z",
    );
  });

  it("should refresh presence from DB and rethrow when startPeriodWithRoster fails", async () => {
    act(() => {
      store.dispatch(setPresenceLimits({ limit: 7, period: 1 }));
    });

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    const completeLineup = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    act(() => {
      result.current.stageStartingLineup(completeLineup);
    });

    vi.mocked(initializePeriodPresenceTx).mockRejectedValueOnce(
      new Error("Init failed"),
    );

    await expect(
      act(async () => {
        await result.current.startPeriodWithRoster("2026-07-16T10:00:00.000Z");
      }),
    ).rejects.toThrow("Init failed");

    expect(db.matchlineups.where).toHaveBeenCalled();
  });

  it("should end a period and trigger database presence termination", async () => {
    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    await act(async () => {
      await result.current.refreshPresenceFromDB();
    });
    expect(result.current.activeLineupIds).toEqual(["lineup-1"]);

    await act(async () => {
      await result.current.endPeriodWithRoster("2026-07-16T11:00:00.000Z");
    });

    expect(result.current.activeLineupIds).toEqual([]);
    expect(terminatePeriodPresenceTx).toHaveBeenCalledWith(
      "test-match",
      1,
      ["lineup-1"],
      "2026-07-16T11:00:00.000Z",
    );
  });

  it("should refresh presence from DB and rethrow when endPeriodWithRoster fails", async () => {
    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    vi.mocked(terminatePeriodPresenceTx).mockRejectedValueOnce(
      new Error("Terminate failed"),
    );

    await expect(
      act(async () => {
        await result.current.endPeriodWithRoster("2026-07-16T11:00:00.000Z");
      }),
    ).rejects.toThrow("Terminate failed");

    expect(db.matchlineups.where).toHaveBeenCalled();
  });

  it("should reject starting a period if the roster is incomplete", async () => {
    act(() => {
      store.dispatch(setPresenceLimits({ limit: 7, period: 1 }));
    });

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    act(() => {
      result.current.stageStartingLineup(["p1", "p2"]);
    });

    await expect(
      act(async () => {
        await result.current.startPeriodWithRoster("2026-07-16T10:00:00.000Z");
      }),
    ).rejects.toThrow("Starting lineup must contain exactly 7 players.");

    expect(initializePeriodPresenceTx).not.toHaveBeenCalled();
  });

  it("should execute substitution and dispatch optimistic updates", async () => {
    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    await act(async () => {
      await result.current.executeSubstitution("outgoing-p", "incoming-p");
    });

    expect(substitutePlayerTx).toHaveBeenCalledWith(
      "test-match",
      1,
      "outgoing-p",
      "incoming-p",
    );
  });

  it("should revert optimistic substitution if IndexedDB transaction fails", async () => {
    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    vi.mocked(substitutePlayerTx).mockRejectedValueOnce(
      new Error("Transaction Aborted"),
    );

    await expect(
      act(async () => {
        await result.current.executeSubstitution("outgoing-p", "incoming-p");
      }),
    ).rejects.toThrow("Transaction Aborted");

    expect(db.matchlineups.where).toHaveBeenCalled();
  });

  it("should reject starting a period when activePlayersLimit is zero or negative", async () => {
    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    // Default activePlayersLimit is 0 in initial state
    await expect(
      act(async () => {
        await result.current.startPeriodWithRoster("2026-07-16T10:00:00.000Z");
      }),
    ).rejects.toThrow("The active players limit is not configured.");

    expect(initializePeriodPresenceTx).not.toHaveBeenCalled();
  });

  it("should remove an active player via removePlayerFromActive and rollback on error", async () => {
    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    await act(async () => {
      await result.current.refreshPresenceFromDB();
    });
    expect(result.current.activeLineupIds).toEqual(["lineup-1"]);

    await act(async () => {
      const didExit = await result.current.removePlayerFromActive(
        "lineup-1",
        "2026-07-16T10:02:00.000Z",
      );
      expect(didExit).toBe(true);
    });

    expect(exitPlayerPresenceTx).toHaveBeenCalledWith(
      "test-match",
      1,
      "lineup-1",
      "2026-07-16T10:02:00.000Z",
    );
    expect(result.current.activeLineupIds).toEqual([]);
    expect(result.current.benchLineupIds).toContain("lineup-1");

    // Restore lineup-1 to active roster before testing rejection rollback
    await act(async () => {
      await result.current.refreshPresenceFromDB();
    });
    expect(result.current.activeLineupIds).toEqual(["lineup-1"]);
    expect(result.current.benchLineupIds).toEqual(["lineup-2"]);

    const whereCallsBeforeReject = vi.mocked(db.matchlineups.where).mock.calls
      .length;
    vi.mocked(exitPlayerPresenceTx).mockRejectedValueOnce(
      new Error("Exit failed"),
    );

    await expect(
      act(async () => {
        await result.current.removePlayerFromActive(
          "lineup-1",
          "2026-07-16T10:03:00.000Z",
        );
      }),
    ).rejects.toThrow("Exit failed");

    expect(db.matchlineups.where).toHaveBeenCalledTimes(
      whereCallsBeforeReject + 1,
    );
    expect(result.current.activeLineupIds).toEqual(["lineup-1"]);
    expect(result.current.benchLineupIds).toEqual(["lineup-2"]);
  });

  it("should refresh roster and return false when exitPlayerPresenceTx reports no open presence (didExit = false)", async () => {
    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    await act(async () => {
      await result.current.refreshPresenceFromDB();
    });
    expect(result.current.activeLineupIds).toEqual(["lineup-1"]);

    const whereCallsBeforeNoop = vi.mocked(db.matchlineups.where).mock.calls
      .length;
    vi.mocked(exitPlayerPresenceTx).mockResolvedValueOnce(false);

    await act(async () => {
      const didExit = await result.current.removePlayerFromActive(
        "lineup-1",
        "2026-07-16T10:04:00.000Z",
        2,
      );
      expect(didExit).toBe(false);
    });

    expect(exitPlayerPresenceTx).toHaveBeenCalledWith(
      "test-match",
      2,
      "lineup-1",
      "2026-07-16T10:04:00.000Z",
    );
    expect(db.matchlineups.where).toHaveBeenCalledTimes(
      whereCallsBeforeNoop + 1,
    );
  });

  it("should reject startPeriodWithRoster and unstage disqualified players before initializing presences", async () => {
    act(() => {
      store.dispatch(setPresenceLimits({ limit: 2, period: 2 }));
    });

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    act(() => {
      result.current.stageStartingLineup(["lineup-1", "lineup-2"]);
    });

    vi.mocked(findDisqualifiedLineupIds).mockResolvedValueOnce(["lineup-2"]);

    await expect(
      act(async () => {
        await result.current.startPeriodWithRoster("2026-07-16T10:15:00.000Z");
      }),
    ).rejects.toThrow(
      "Cannot start period with disqualified players in the starting lineup.",
    );

    expect(initializePeriodPresenceTx).not.toHaveBeenCalled();
    expect(result.current.selectedStartingIds).toEqual(["lineup-1"]);
  });

  it("should enter a bench player when shorthanded via enterPlayerFromBench and enforce activePlayersLimit", async () => {
    act(() => {
      store.dispatch(setPresenceLimits({ limit: 2, period: 1 }));
    });

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    await act(async () => {
      await result.current.refreshPresenceFromDB();
    });
    expect(result.current.activeLineupIds).toEqual(["lineup-1"]);

    await act(async () => {
      const newId = await result.current.enterPlayerFromBench("lineup-2");
      expect(newId).toBe("entered-presence-uuid");
    });

    expect(enterPlayerPresenceTx).toHaveBeenCalledWith(
      "test-match",
      1,
      "lineup-2",
    );
    expect(result.current.activeLineupIds).toEqual(["lineup-1", "lineup-2"]);
    expect(result.current.benchLineupIds).toEqual([]);

    // Now at full strength (2 of 2) -> entering another player rejects
    await expect(
      act(async () => {
        await result.current.enterPlayerFromBench("lineup-3");
      }),
    ).rejects.toThrow("Cannot exceed the limit of 2 active players.");
  });

  it("should validate limit, duplicate active player, overridePeriodNumber, and rollback on DB error in enterPlayerFromBench", async () => {
    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    // 1. Rejects when activePlayersLimit <= 0
    await expect(
      act(async () => {
        await result.current.enterPlayerFromBench("lineup-2");
      }),
    ).rejects.toThrow("The active players limit is not configured.");

    // Configure limit = 2 and hydrate active roster with lineup-1
    act(() => {
      store.dispatch(setPresenceLimits({ limit: 2, period: 1 }));
    });
    await act(async () => {
      await result.current.refreshPresenceFromDB();
    });
    expect(result.current.activeLineupIds).toEqual(["lineup-1"]);

    // 2. Rejects when player is already active
    await expect(
      act(async () => {
        await result.current.enterPlayerFromBench("lineup-1");
      }),
    ).rejects.toThrow("Player is already active.");
    expect(enterPlayerPresenceTx).not.toHaveBeenCalled();

    // 3. Advance match period to 3 so refreshPresenceFromDB(3) matches currentPeriodRef during rollback
    act(() => {
      store.dispatch(incrementPeriodNumber());
      store.dispatch(incrementPeriodNumber());
    });
    await act(async () => {
      await result.current.refreshPresenceFromDB(3);
    });
    expect(result.current.activeLineupIds).toEqual(["lineup-1"]);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const whereCallsBeforeError = vi.mocked(db.matchlineups.where).mock.calls
      .length;
    vi.mocked(enterPlayerPresenceTx).mockRejectedValueOnce(
      new Error("Disqualified player entry rejected"),
    );

    await expect(
      act(async () => {
        await result.current.enterPlayerFromBench("lineup-2", 3);
      }),
    ).rejects.toThrow("Disqualified player entry rejected");

    expect(enterPlayerPresenceTx).toHaveBeenCalledWith(
      "test-match",
      3,
      "lineup-2",
    );
    expect(db.matchlineups.where).toHaveBeenCalledTimes(
      whereCallsBeforeError + 1,
    );
    expect(result.current.activeLineupIds).toEqual(["lineup-1"]);
    expect(result.current.benchLineupIds).toEqual(["lineup-2"]);
    consoleSpy.mockRestore();
  });
});
