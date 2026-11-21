import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import React from "react";
import { liveQuery } from "dexie";
import { usePlayerPresence } from "../hooks/usePlayerPresence";
import presenceReducer, {
  setPresenceLimits,
  setClearedPenaltyEventIds,
} from "../store/presenceSlice";
import matchReducer, {
  endPeriodState,
  incrementPeriodNumber,
} from "../../matches/store/matchSlice";
import { db } from "../../../db/ttaDatabase";
import {
  initializePeriodPresenceTx,
  terminatePeriodPresenceTx,
  substitutePlayerTx,
  enterShorthandedPlayerTx,
} from "../../../db/presenceService";

vi.mock("dexie", () => ({
  liveQuery: vi.fn((querier: () => Promise<unknown>) => ({
    subscribe: (observer: {
      next?: (val: unknown) => void;
      error?: (err: unknown) => void;
    }) => {
      Promise.resolve()
        .then(() => querier())
        .then((res) => observer.next?.(res))
        .catch((err) => observer.error?.(err));
      return { unsubscribe: vi.fn() };
    },
  })),
}));

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
      gameevents: {
        where: vi.fn().mockReturnValue({
          anyOf: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
        toArray: vi.fn().mockResolvedValue([]),
      },
      eventdefinitions: {
        toArray: vi.fn().mockResolvedValue([]),
      },
      matches: {
        get: vi.fn().mockResolvedValue(undefined),
      },
      tournaments: {
        get: vi.fn().mockResolvedValue(undefined),
      },
      sportconfigurations: {
        get: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
});

// Mock the transactional service functions
vi.mock("../../../db/presenceService", () => {
  return {
    initializePeriodPresenceTx: vi.fn().mockResolvedValue(undefined),
    terminatePeriodPresenceTx: vi.fn().mockResolvedValue(undefined),
    substitutePlayerTx: vi.fn().mockResolvedValue("new-presence-uuid"),
    enterShorthandedPlayerTx: vi.fn().mockResolvedValue("new-shorthanded-uuid"),
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
    vi.mocked(db.matchlineups.toArray).mockResolvedValue([
      { id: "lineup-1", matchId: "test-match" },
      { id: "lineup-2", matchId: "test-match" },
    ] as never);
    vi.mocked(db.playerpresences.where).mockReturnThis();
    vi.mocked(db.playerpresences.toArray).mockResolvedValue([
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
    ] as never);
    vi.mocked(db.gameevents.where).mockReturnValue({
      anyOf: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    } as never);
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValue([] as never);
    vi.mocked(db.matches.get).mockResolvedValue(undefined);
    vi.mocked(db.tournaments.get).mockResolvedValue(undefined);
    vi.mocked(db.sportconfigurations.get).mockResolvedValue(undefined);

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

    expect(result.current.activeLineupIds).toEqual(["lineup-1"]);
    expect(result.current.benchLineupIds).toEqual(["lineup-2"]);
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

    let firstRefreshPromise!: Promise<void>;
    act(() => {
      firstRefreshPromise = result.current.refreshPresenceFromDB();
    });

    await act(async () => {
      await result.current.refreshPresenceFromDB();
    });

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

    await expect(
      act(async () => {
        await result.current.startPeriodWithRoster("2026-07-16T10:00:00.000Z");
      }),
    ).rejects.toThrow("The active players limit is not configured.");

    expect(initializePeriodPresenceTx).not.toHaveBeenCalled();
  });

  it("should support enterShorthandedPlayer when activeLineupIds.length < maxAllowedActive and revert on DB error", async () => {
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
    expect(result.current.isShorthanded).toBe(true);

    await act(async () => {
      await result.current.enterShorthandedPlayer?.("lineup-2", 1);
    });

    expect(enterShorthandedPlayerTx).toHaveBeenCalledWith(
      "test-match",
      1,
      "lineup-2",
      undefined,
      2,
    );
    expect(result.current.activeLineupIds).toEqual(["lineup-1", "lineup-2"]);

    await expect(
      act(async () => {
        await result.current.enterShorthandedPlayer?.("lineup-3", 1);
      }),
    ).rejects.toThrow("Cannot exceed the limit of 2 active players.");
  });

  it("should handle pre-period bench taps and resetClearedPenalties via shared Redux state", async () => {
    act(() => {
      store.dispatch(setPresenceLimits({ limit: 2, period: 2 }));
    });

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    await act(async () => {
      await result.current.refreshPresenceFromDB();
    });

    act(() => {
      result.current.handlePrePeriodBenchTap?.("lineup-1");
    });

    expect(result.current.selectedStartingIds).toEqual(["lineup-1"]);

    act(() => {
      result.current.resetPrePeriodClearedPenalties?.();
    });

    expect(result.current.clearedPenaltyEventIds).toEqual([]);
  });

  it("should hydrate maxPersonalFouls, events, and definitions via liveQuery and enforce DQ & carryover rules", async () => {
    vi.mocked(db.matches.get).mockResolvedValue({
      id: "test-match",
      tournamentId: "tourn-1",
    } as never);
    vi.mocked(db.tournaments.get).mockResolvedValue({
      id: "tourn-1",
      configurationId: "cfg-1",
    } as never);
    vi.mocked(db.sportconfigurations.get).mockResolvedValue({
      id: "cfg-1",
      activePlayersLimit: 2,
      maxPersonalFouls: 2,
    } as never);
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValue([
      {
        id: "def-ex",
        sportId: "sport-1",
        name: "Exclusion",
        shortName: "EX",
        isPositive: false,
        isShot: false,
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
      },
      {
        id: "def-dq",
        sportId: "sport-1",
        name: "Red Card",
        shortName: "RC",
        isPositive: false,
        isShot: false,
        foulImpact: "DisqualificationWithSub",
        penaltyDurationSeconds: null,
      },
    ] as never);
    vi.mocked(db.gameevents.where).mockReturnValue({
      anyOf: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "evt-dq-1",
            matchLineupId: "lineup-1",
            eventDefinitionId: "def-dq",
            periodNumber: 1,
            eventTimestamp: "2026-07-16T10:02:00.000Z",
            isLeadToGoal: false,
            createdAt: "2026-07-16T10:02:00.000Z",
            sequenceNumber: 1,
            isSynced: 0,
          },
          {
            id: "evt-ex-2",
            matchLineupId: "lineup-2",
            eventDefinitionId: "def-ex",
            periodNumber: 1,
            eventTimestamp: "2026-07-16T10:03:00.000Z",
            isLeadToGoal: false,
            foulImpact: "PersonalFoul",
            penaltyDurationSeconds: 20,
            createdAt: "2026-07-16T10:03:00.000Z",
            sequenceNumber: 2,
            isSynced: 0,
          },
        ]),
      }),
    } as never);
    vi.mocked(db.playerpresences.where).mockReturnThis();
    vi.mocked(db.playerpresences.toArray).mockResolvedValue([
      {
        id: "pres-l1",
        matchLineupId: "lineup-1",
        periodNumber: 1,
        timeIn: "2026-07-16T10:00:00.000Z",
        timeOut: "2026-07-16T10:02:00.000Z",
        sequenceNumber: 1,
        isSynced: 0,
      },
      {
        id: "pres-l2",
        matchLineupId: "lineup-2",
        periodNumber: 1,
        timeIn: "2026-07-16T10:00:00.000Z",
        timeOut: "2026-07-16T10:03:00.000Z",
        sequenceNumber: 2,
        isSynced: 0,
      },
    ] as never);

    act(() => {
      store.dispatch(setPresenceLimits({ limit: 2, period: 1 }));
      store.dispatch(endPeriodState());
    });

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.maxPersonalFouls).toBe(2);
      expect(
        result.current.disciplinaryState?.playersById["lineup-1"]
          ?.isDisqualified,
      ).toBe(true);
    });

    // When period 1 ended with lineup-2 carrying a timed exclusion, period 2 requires 1 starter
    expect(result.current.requiredStartingPlayers).toBe(1);

    // Staging more than reduced requiredStartingPlayers (1) throws
    expect(() => {
      act(() => {
        result.current.stageStartingLineup(["lineup-1", "lineup-2"]);
      });
    }).toThrow("Cannot exceed the limit of 1 active players.");

    // Starting period 2 with disqualified lineup-1 throws
    act(() => {
      result.current.stageStartingLineup(["lineup-1"]);
    });
    await expect(
      act(async () => {
        await result.current.startPeriodWithRoster(
          "2026-07-16T10:10:00.000Z",
          2,
        );
      }),
    ).rejects.toThrow(
      "Disqualified players cannot be included in the starting lineup.",
    );

    // Substituting or shorthanded-entering disqualified lineup-1 throws
    await expect(
      act(async () => {
        await result.current.executeSubstitution("lineup-2", "lineup-1", 1);
      }),
    ).rejects.toThrow("Disqualified player cannot enter the game.");

    await expect(
      act(async () => {
        await result.current.enterShorthandedPlayer?.("lineup-1", 1);
      }),
    ).rejects.toThrow("Disqualified player cannot enter the game.");
  });

  it("should sync active and bench roster on subsequent liveQuery emissions and clear clearedPenaltyEventIds on period change", async () => {
    let emitNext!: (val: unknown) => void;
    let savedQuerier!: () => Promise<unknown>;

    vi.mocked(liveQuery).mockImplementationOnce(((
      querier: () => Promise<unknown>,
    ) => {
      savedQuerier = querier;
      return {
        subscribe: (observer: { next?: (val: unknown) => void }) => {
          emitNext = (val: unknown) => observer.next?.(val);
          Promise.resolve()
            .then(() => querier())
            .then((res) => observer.next?.(res));
          return { unsubscribe: vi.fn() };
        },
      };
    }) as never);

    act(() => {
      store.dispatch(setPresenceLimits({ limit: 2, period: 1 }));
      store.dispatch(setClearedPenaltyEventIds(["evt-ex-1"]));
    });

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.disciplinaryState).toBeDefined();
    });

    // Simulate second liveQuery emission after mid-period auto-exit (lineup-1 exited, lineup-2 active)
    vi.mocked(db.playerpresences.toArray).mockResolvedValueOnce([
      {
        id: "pres-1",
        matchLineupId: "lineup-1",
        periodNumber: 1,
        timeIn: "2026-07-16T10:00:00.000Z",
        timeOut: "2026-07-16T10:02:00.000Z",
      },
      {
        id: "pres-2",
        matchLineupId: "lineup-2",
        periodNumber: 1,
        timeIn: "2026-07-16T10:00:00.000Z",
        timeOut: null,
      },
    ] as never);

    await act(async () => {
      const nextPayload = await savedQuerier();
      emitNext(nextPayload);
    });

    expect(result.current.activeLineupIds).toEqual(["lineup-2"]);
    expect(result.current.benchLineupIds).toEqual(["lineup-1"]);

    // Entering an already active player throws
    await expect(
      act(async () => {
        await result.current.enterShorthandedPlayer?.("lineup-2", 1);
      }),
    ).rejects.toThrow("Player is already active.");

    // Reverting enterShorthandedPlayer on DB error refreshes from DB and rethrows
    vi.mocked(enterShorthandedPlayerTx).mockRejectedValueOnce(
      new Error("Shorthanded entry failed"),
    );
    await expect(
      act(async () => {
        await result.current.enterShorthandedPlayer?.("lineup-1", 1);
      }),
    ).rejects.toThrow("Shorthanded entry failed");

    // Advancing period clears clearedPenaltyEventIds automatically
    act(() => {
      store.dispatch(incrementPeriodNumber());
    });
    expect(result.current.clearedPenaltyEventIds).toEqual([]);
  });

  it("should support pre-period bench tap toggle before DB lineup loads and fallback table scans", async () => {
    vi.mocked(db.matchlineups.toArray).mockResolvedValue([] as never);
    const originalWhere = db.gameevents.where;
    // Simulate table without .where().anyOf() to exercise .toArray() fallback path
    (db.gameevents as unknown as Record<string, unknown>).where = undefined;
    vi.mocked(db.gameevents.toArray).mockResolvedValue([
      {
        id: "evt-fallback",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        periodNumber: 1,
        eventTimestamp: "2026-07-16T10:01:00.000Z",
        isLeadToGoal: false,
        createdAt: "2026-07-16T10:01:00.000Z",
        sequenceNumber: 1,
        isSynced: 0,
      },
    ] as never);

    act(() => {
      store.dispatch(setPresenceLimits({ limit: 3, period: 1 }));
    });

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    act(() => {
      const firstTap = result.current.handlePrePeriodBenchTap?.("lineup-1");
      expect(firstTap?.wasSelectionToggled).toBe(true);
    });
    expect(result.current.selectedStartingIds).toEqual(["lineup-1"]);

    act(() => {
      const secondTap = result.current.handlePrePeriodBenchTap?.("lineup-1");
      expect(secondTap?.wasSelectionToggled).toBe(true);
    });
    expect(result.current.selectedStartingIds).toEqual([]);
    (db.gameevents as unknown as Record<string, unknown>).where = originalWhere;
  });

  it("should preserve clearedPenaltyEventIds and load all-period presences on same-period refreshPresenceFromDB", async () => {
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValue([
      {
        id: "def-ex",
        sportId: "sport-1",
        name: "Exclusion",
        shortName: "EX",
        isPositive: false,
        isShot: false,
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
      },
    ] as never);
    vi.mocked(db.gameevents.where).mockReturnValue({
      anyOf: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "evt-ex-p1",
            matchLineupId: "lineup-1",
            eventDefinitionId: "def-ex",
            periodNumber: 1,
            eventTimestamp: "2026-07-16T10:03:00.000Z",
            isLeadToGoal: false,
            foulImpact: "PersonalFoul",
            penaltyDurationSeconds: 20,
            createdAt: "2026-07-16T10:03:00.000Z",
            sequenceNumber: 2,
            isSynced: 0,
          },
        ]),
      }),
    } as never);

    const period1Presences = [
      {
        id: "pres-p1",
        matchLineupId: "lineup-1",
        periodNumber: 1,
        timeIn: "2026-07-16T10:00:00.000Z",
        timeOut: "2026-07-16T10:03:00.000Z",
        sequenceNumber: 1,
        isSynced: 0,
      },
    ];
    vi.mocked(db.playerpresences.where).mockImplementation((index: unknown) => {
      if (index === "periodNumber") {
        return {
          equals: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        } as never;
      }
      return {
        anyOf: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(period1Presences),
        }),
      } as never;
    });

    act(() => {
      store.dispatch(incrementPeriodNumber());
      store.dispatch(setPresenceLimits({ limit: 2, period: 2 }));
      store.dispatch(setClearedPenaltyEventIds(["evt-ex-p1"]));
    });

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    await act(async () => {
      await result.current.refreshPresenceFromDB(2);
    });

    expect(result.current.clearedPenaltyEventIds).toEqual(["evt-ex-p1"]);
    expect(result.current.carryoverState?.carriedOverPenalties).toHaveLength(1);
    expect(
      result.current.carryoverState?.effectiveCarriedOverPenalties,
    ).toHaveLength(0);
  });

  it("should reject enterShorthandedPlayer when activePlayersLimit > 0 and maxAllowedActive is 0", async () => {
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValue([
      {
        id: "def-nosub",
        sportId: "sport-1",
        name: "Brutality",
        shortName: "BR",
        isPositive: false,
        isShot: false,
        foulImpact: "DisqualificationNoSub",
        penaltyDurationSeconds: null,
      },
    ] as never);
    vi.mocked(db.gameevents.where).mockReturnValue({
      anyOf: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "evt-nosub-1",
            matchLineupId: "lineup-1",
            eventDefinitionId: "def-nosub",
            periodNumber: 1,
            eventTimestamp: "2026-07-16T10:02:00.000Z",
            isLeadToGoal: false,
            foulImpact: "DisqualificationNoSub",
            penaltyDurationSeconds: null,
            createdAt: "2026-07-16T10:02:00.000Z",
            sequenceNumber: 1,
            isSynced: 0,
          },
        ]),
      }),
    } as never);
    vi.mocked(db.playerpresences.toArray).mockResolvedValue([]);

    act(() => {
      store.dispatch(setPresenceLimits({ limit: 1, period: 1 }));
    });

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.maxAllowedActive).toBe(0);
    });

    await expect(
      act(async () => {
        await result.current.enterShorthandedPlayer?.("lineup-2", 1);
      }),
    ).rejects.toThrow("Cannot exceed the limit of 0 active players.");

    expect(enterShorthandedPlayerTx).not.toHaveBeenCalled();
  });

  it("should reject startPeriodWithRoster if staged starters include players not in match lineup", async () => {
    act(() => {
      store.dispatch(setPresenceLimits({ limit: 2, period: 1 }));
    });

    const { result } = renderHook(() => usePlayerPresence("test-match"), {
      wrapper,
    });

    await act(async () => {
      await result.current.refreshPresenceFromDB(1);
    });

    act(() => {
      result.current.stageStartingLineup(["lineup-1", "unknown-player"]);
    });

    await expect(
      act(async () => {
        await result.current.startPeriodWithRoster("2026-07-16T10:00:00.000Z");
      }),
    ).rejects.toThrow(
      "Starting lineup contains players who are not in the match lineup.",
    );

    expect(initializePeriodPresenceTx).not.toHaveBeenCalled();
  });
});
