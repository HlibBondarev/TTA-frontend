import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import matchReducer from "../../matches/store/matchSlice";
import { useMatchDisciplinaryState } from "../hooks/useMatchDisciplinaryState";
import { db } from "../../../db/ttaDatabase";

vi.mock("dexie", () => ({
  liveQuery: (querier: () => Promise<unknown>) => ({
    subscribe: (observer: {
      next: (val: unknown) => void;
      error?: (err: unknown) => void;
    }) => {
      void querier()
        .then((res) => observer.next(res))
        .catch((err) => observer.error?.(err));
      return { unsubscribe: vi.fn() };
    },
  }),
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matches: { get: vi.fn() },
    tournaments: { get: vi.fn() },
    sportconfigurations: { get: vi.fn() },
    matchlineups: { where: vi.fn() },
    gameevents: { where: vi.fn() },
    eventdefinitions: { where: vi.fn() },
    playerpresences: { where: vi.fn() },
  },
}));

const createStore = () =>
  configureStore({
    reducer: { match: matchReducer },
  });

describe("useMatchDisciplinaryState", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(db.matches.get).mockResolvedValue({
      id: "m-1",
      tournamentId: "t-1",
    } as never);
    vi.mocked(db.tournaments.get).mockResolvedValue({
      id: "t-1",
      configurationId: "cfg-1",
    } as never);
    vi.mocked(db.sportconfigurations.get).mockResolvedValue({
      id: "cfg-1",
      maxPersonalFouls: 3,
    } as never);
    vi.mocked(db.matchlineups.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { id: "l-1", matchId: "m-1", number: 5 },
          { id: "l-2", matchId: "m-1", number: 7 },
        ]),
      }),
    } as never);
    vi.mocked(db.eventdefinitions.where).mockReturnValue({
      anyOf: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "def-ex",
            sportId: "s-1",
            name: "Exclusion",
            shortName: "EX",
            isPositive: false,
            isShot: false,
            foulImpact: "PersonalFoul",
            penaltyDurationSeconds: 20,
          },
        ]),
      }),
    } as never);
    vi.mocked(db.playerpresences.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    } as never);
  });

  it("derives foul counts, warning state, and timed-exclusion highlight from IndexedDB gameevents", async () => {
    vi.mocked(db.gameevents.where).mockReturnValue({
      anyOf: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "ev-1",
            matchLineupId: "l-1",
            eventDefinitionId: "def-ex",
            periodNumber: 1,
            eventTimestamp: "2026-11-18T10:01:00.000Z",
            isLeadToGoal: false,
            createdAt: "2026-11-18T10:01:00.000Z",
            sequenceNumber: 2,
            isSynced: 0,
            foulImpact: "PersonalFoul",
            penaltyDurationSeconds: 20,
          },
          {
            id: "ev-2",
            matchLineupId: "l-1",
            eventDefinitionId: "def-ex",
            periodNumber: 1,
            eventTimestamp: "2026-11-18T10:02:00.000Z",
            isLeadToGoal: false,
            createdAt: "2026-11-18T10:02:00.000Z",
            sequenceNumber: 4,
            isSynced: 0,
            foulImpact: "PersonalFoul",
            penaltyDurationSeconds: 20,
          },
        ]),
      }),
    } as never);

    const store = createStore();
    const { result } = renderHook(
      () =>
        useMatchDisciplinaryState({
          matchId: "m-1",
          currentPeriod: 1,
          isPeriodActive: true,
          activeLineupIds: ["l-2"],
          activePlayersLimit: 2,
        }),
      {
        wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
      },
    );

    await waitFor(() => {
      expect(result.current.maxPersonalFouls).toBe(3);
      expect(result.current.disciplinaryByLineupId["l-1"]).toEqual({
        personalFouls: 2,
        isWarning: true,
        isDisqualified: false,
        disqualificationReason: null,
        isServingTimedExclusion: true,
      });
    });
  });

  it("returns empty defaults when matchId is empty", () => {
    const store = createStore();
    const { result } = renderHook(
      () =>
        useMatchDisciplinaryState({
          matchId: "",
          currentPeriod: 1,
          isPeriodActive: false,
          activeLineupIds: [],
          activePlayersLimit: 7,
        }),
      {
        wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
      },
    );

    expect(result.current).toEqual({
      maxPersonalFouls: null,
      disciplinaryByLineupId: {},
    });
  });
});
