import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import {
  useGameEvents,
  clearPendingDisciplinaryRemovals,
} from "../hooks/useGameEvents";
import matchReducer from "../store/matchSlice";
import { db } from "../../../db/ttaDatabase";
import * as eventService from "../../../db/eventService";
import * as presenceService from "../../../db/presenceService";
import presenceReducer from "../../playerpresences/store/presenceSlice";

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    user: undefined,
  }),
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matchlineups: {
      get: vi.fn(),
    },
    matches: {
      get: vi.fn(),
    },
    tournaments: {
      get: vi.fn(),
    },
    gameevents: {
      get: vi.fn(),
    },
  },
}));

vi.mock("../../../db/eventService", () => ({
  createGameEventTx: vi.fn(),
  updateGameEventTx: vi.fn(),
  deleteGameEventTx: vi.fn(),
}));

vi.mock("../../../db/presenceService", () => ({
  exitPlayerPresenceTx: vi.fn().mockResolvedValue(true),
}));

const createTestStore = (preloadedState = {}, currentUserId = "user-123") => {
  return configureStore({
    reducer: {
      match: matchReducer,
      auth: (state = { currentUserId }) => state,
    },
    preloadedState: {
      match: {
        activeMatchId: "test-match-id",
        activeTeamId: "team-456",
        periodNumber: 2,
        homeScore: 0,
        guestScore: 0,
        isPeriodActive: true,
        isInsideStoppage: false,
        isPeriodEnded: false,
        globalSequenceNumber: 10,
        recentActions: [],
        hydrationVersion: 0,
        ...preloadedState,
      },
      auth: {
        currentUserId,
      },
    },
  });
};

describe("useGameEvents Custom Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.matches.get).mockResolvedValue({
      id: "test-match-id",
      tournamentId: "tour-123",
      userId: "user-123",
    } as never);
    vi.mocked(db.tournaments.get).mockResolvedValue({
      id: "tour-123",
      sportId: "waterpolo-sport-id",
    } as never);
  });

  afterEach(() => {
    cleanup();
    clearPendingDisciplinaryRemovals();
  });

  it("should successfully record game event with explicit eventDefinitionId, increment sequence, and add recent action", async () => {
    const store = createTestStore();

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      positionId: null,
    });

    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce({
      id: "created-event-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-goal-id",
      periodNumber: 2,
      eventTimestamp: new Date().toISOString(),
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
      createdAt: new Date().toISOString(),
      sequenceNumber: 11,
      isSynced: 0,
    });

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      const success = await result.current.recordGameEvent({
        selectedPlayerId: "lineup-uuid-7",
        actionName: "Goal",
        isPositive: true,
        isLeadToGoal: false,
        eventDefinitionId: "def-goal-id",
      });
      expect(success).toBe(true);
    });

    expect(eventService.createGameEventTx).toHaveBeenCalledWith({
      matchId: "test-match-id",
      teamId: "team-456",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-goal-id",
      periodNumber: 2,
      eventTimestamp: expect.any(String),
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
    });

    expect(store.getState().match.globalSequenceNumber).toBe(11);
    expect(store.getState().match.recentActions).toHaveLength(1);
    expect(store.getState().match.recentActions[0]).toEqual({
      id: "created-event-uuid",
      playerNumber: 7,
      actionName: "Goal",
      isPositive: true,
      timestamp: expect.any(String),
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-goal-id",
      isLeadToGoal: false,
      isSynced: 0,
    });
  });

  it("should pass spatial coordinates locationX and locationY to createGameEventTx when provided", async () => {
    const store = createTestStore();

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      positionId: null,
    });

    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce({
      id: "created-event-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-goal-id",
      periodNumber: 2,
      eventTimestamp: new Date().toISOString(),
      isLeadToGoal: false,
      locationX: 45.5,
      locationY: 80.25,
      shotLocationX: null,
      shotLocationY: null,
      createdAt: new Date().toISOString(),
      sequenceNumber: 11,
      isSynced: 0,
    });

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      const success = await result.current.recordGameEvent({
        selectedPlayerId: "lineup-uuid-7",
        actionName: "Goal",
        isPositive: true,
        isLeadToGoal: false,
        eventDefinitionId: "def-goal-id",
        locationX: 45.5,
        locationY: 80.25,
      });
      expect(success).toBe(true);
    });

    expect(eventService.createGameEventTx).toHaveBeenCalledWith({
      matchId: "test-match-id",
      teamId: "team-456",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-goal-id",
      periodNumber: 2,
      eventTimestamp: expect.any(String),
      isLeadToGoal: false,
      locationX: 45.5,
      locationY: 80.25,
      shotLocationX: null,
      shotLocationY: null,
    });
  });

  it("should pass goal target shotLocationX and shotLocationY to createGameEventTx when provided", async () => {
    const store = createTestStore();

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      positionId: null,
    });

    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce({
      id: "created-event-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-shot-id",
      periodNumber: 2,
      eventTimestamp: new Date().toISOString(),
      isLeadToGoal: false,
      locationX: 30.0,
      locationY: 60.0,
      shotLocationX: 15.5,
      shotLocationY: 85.0,
      createdAt: new Date().toISOString(),
      sequenceNumber: 11,
      isSynced: 0,
    });

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      const success = await result.current.recordGameEvent({
        selectedPlayerId: "lineup-uuid-7",
        actionName: "Shot",
        isPositive: true,
        isLeadToGoal: false,
        eventDefinitionId: "def-shot-id",
        locationX: 30.0,
        locationY: 60.0,
        shotLocationX: 15.5,
        shotLocationY: 85.0,
      });
      expect(success).toBe(true);
    });

    expect(eventService.createGameEventTx).toHaveBeenCalledWith({
      matchId: "test-match-id",
      teamId: "team-456",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-shot-id",
      periodNumber: 2,
      eventTimestamp: expect.any(String),
      isLeadToGoal: false,
      locationX: 30.0,
      locationY: 60.0,
      shotLocationX: 15.5,
      shotLocationY: 85.0,
    });
  });

  it("should throw an error if matchId is missing or empty", async () => {
    const store = createTestStore();
    const { result } = renderHook(() => useGameEvents("   "), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.recordGameEvent({
          selectedPlayerId: "lineup-uuid-1",
          actionName: "Pass",
          isPositive: true,
          isLeadToGoal: false,
          eventDefinitionId: "def-1",
        });
      }),
    ).rejects.toThrow("Active match ID is missing or empty.");
  });

  it("should throw an error if activeTeamId in Redux store is missing or empty", async () => {
    const store = createTestStore({
      activeTeamId: "   ",
    });

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.recordGameEvent({
          selectedPlayerId: "lineup-uuid-1",
          actionName: "Pass",
          isPositive: true,
          isLeadToGoal: false,
          eventDefinitionId: "def-1",
        });
      }),
    ).rejects.toThrow("Active team ID is missing or empty in Redux store.");
  });

  it("should throw an error if player lineup record is not found in Dexie DB", async () => {
    const store = createTestStore();
    vi.mocked(db.matchlineups.get).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.recordGameEvent({
          selectedPlayerId: "non-existent-id",
          actionName: "Pass",
          isPositive: true,
          isLeadToGoal: false,
          eventDefinitionId: "def-1",
        });
      }),
    ).rejects.toThrow("Player lineup record not found for ID: non-existent-id");
  });

  it("should throw an error if player lineup does not belong to the active match", async () => {
    const store = createTestStore();
    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-other",
      matchId: "other-match-id",
      playerRosterId: "roster-1",
      number: 1,
      positionId: null,
    });

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.recordGameEvent({
          selectedPlayerId: "lineup-uuid-other",
          actionName: "Pass",
          isPositive: true,
          isLeadToGoal: false,
          eventDefinitionId: "def-1",
        });
      }),
    ).rejects.toThrow(
      "Player lineup lineup-uuid-other does not belong to match: test-match-id",
    );
  });

  it("should pass custom isLeadToGoal flag to createGameEventTx", async () => {
    const store = createTestStore();

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      positionId: null,
    });

    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce({
      id: "created-event-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-pass-id",
      periodNumber: 2,
      eventTimestamp: new Date().toISOString(),
      isLeadToGoal: true,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
      createdAt: new Date().toISOString(),
      sequenceNumber: 12,
      isSynced: 0,
    });

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      const success = await result.current.recordGameEvent({
        selectedPlayerId: "lineup-uuid-7",
        actionName: "Pass",
        isPositive: true,
        isLeadToGoal: true,
        eventDefinitionId: "def-pass-id",
      });
      expect(success).toBe(true);
    });

    expect(eventService.createGameEventTx).toHaveBeenCalledWith({
      matchId: "test-match-id",
      teamId: "team-456",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-pass-id",
      periodNumber: 2,
      eventTimestamp: expect.any(String),
      isLeadToGoal: true,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
    });
  });

  it("should normalize padded matchId and activeTeamId before validating lineup and passing to createGameEventTx", async () => {
    const store = createTestStore({
      activeTeamId: "  team-padded-999  ",
    });

    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "test-match-id",
      tournamentId: "tour-123",
      userId: "user-123",
    } as never);

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-padded",
      matchId: "  test-match-id  ",
      playerRosterId: "roster-padded",
      number: 9,
      positionId: null,
    });

    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce({
      id: "created-foul-uuid",
      matchLineupId: "lineup-uuid-padded",
      eventDefinitionId: "def-foul-id",
      periodNumber: 2,
      eventTimestamp: new Date().toISOString(),
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
      createdAt: new Date().toISOString(),
      sequenceNumber: 15,
      isSynced: 0,
    });

    const { result } = renderHook(() => useGameEvents("  test-match-id  "), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      const success = await result.current.recordGameEvent({
        selectedPlayerId: "lineup-uuid-padded",
        actionName: "Foul",
        isPositive: false,
        isLeadToGoal: false,
        eventDefinitionId: "def-foul-id",
      });
      expect(success).toBe(true);
    });

    expect(eventService.createGameEventTx).toHaveBeenCalledWith({
      matchId: "test-match-id",
      teamId: "team-padded-999",
      matchLineupId: "lineup-uuid-padded",
      eventDefinitionId: "def-foul-id",
      periodNumber: 2,
      eventTimestamp: expect.any(String),
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
    });
  });

  it("should update an existing game event via updateGameEvent using passed eventDefinitionId and shot locations", async () => {
    const store = createTestStore({
      recentActions: [
        {
          id: "event-to-update",
          playerNumber: 7,
          actionName: "Pass",
          isPositive: true,
          timestamp: new Date().toISOString(),
          matchLineupId: "lineup-7",
          eventDefinitionId: "def-pass",
          isLeadToGoal: false,
          isSynced: 0,
        },
      ],
    });

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-10",
      matchId: "test-match-id",
      number: 10,
      playerRosterId: "r-10",
      positionId: null,
    });

    vi.mocked(eventService.updateGameEventTx).mockResolvedValueOnce({
      id: "event-to-update",
      matchLineupId: "lineup-10",
      eventDefinitionId: "def-steal-direct",
      periodNumber: 2,
      eventTimestamp: new Date().toISOString(),
      isLeadToGoal: true,
      locationX: 12.5,
      locationY: 88.0,
      shotLocationX: 40.0,
      shotLocationY: 50.0,
      createdAt: new Date().toISOString(),
      sequenceNumber: 5,
      isSynced: 0,
    });

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      const success = await result.current.updateGameEvent({
        eventId: "event-to-update",
        selectedPlayerId: "lineup-10",
        actionName: "Steal",
        eventDefinitionId: "def-steal-direct",
        isPositive: true,
        isLeadToGoal: true,
        locationX: 12.5,
        locationY: 88.0,
        shotLocationX: 40.0,
        shotLocationY: 50.0,
      });
      expect(success).toBe(true);
    });

    expect(eventService.updateGameEventTx).toHaveBeenCalledWith({
      eventId: "event-to-update",
      matchLineupId: "lineup-10",
      eventDefinitionId: "def-steal-direct",
      expectedSportId: "waterpolo-sport-id",
      isLeadToGoal: true,
      locationX: 12.5,
      locationY: 88.0,
      shotLocationX: 40.0,
      shotLocationY: 50.0,
      userId: "user-123",
    });

    expect(store.getState().match.recentActions[0]).toEqual(
      expect.objectContaining({
        id: "event-to-update",
        playerNumber: 10,
        actionName: "Steal",
        eventDefinitionId: "def-steal-direct",
        isLeadToGoal: true,
      }),
    );
  });

  it("should throw an error in updateGameEvent if match belongs to another user", async () => {
    const store = createTestStore({}, "user-B");
    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-1",
      matchId: "test-match-id",
      number: 1,
      playerRosterId: "r-1",
      positionId: null,
    });
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "test-match-id",
      tournamentId: "tour-123",
      userId: "user-A",
    } as never);

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.updateGameEvent({
          eventId: "event-1",
          selectedPlayerId: "lineup-1",
          actionName: "Pass",
          eventDefinitionId: "def-direct-id",
          isPositive: true,
          isLeadToGoal: false,
        });
      }),
    ).rejects.toThrow("Match test-match-id belongs to another user.");
  });

  it("should throw an error if tournamentId is missing for match", async () => {
    const store = createTestStore();
    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-1",
      matchId: "test-match-id",
      playerRosterId: "roster-1",
      number: 1,
      positionId: null,
    });
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "test-match-id",
      tournamentId: "",
    } as never);

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.recordGameEvent({
          selectedPlayerId: "lineup-uuid-1",
          actionName: "Pass",
          isPositive: true,
          isLeadToGoal: false,
          eventDefinitionId: "def-1",
        });
      }),
    ).rejects.toThrow("Tournament is missing for match: test-match-id");
  });

  it("should throw an error if sportId is missing or blank for tournament", async () => {
    const store = createTestStore();
    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-1",
      matchId: "test-match-id",
      playerRosterId: "roster-1",
      number: 1,
      positionId: null,
    });
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "test-match-id",
      tournamentId: "tour-123",
      userId: "user-123",
    } as never);
    vi.mocked(db.tournaments.get).mockResolvedValueOnce({
      id: "tour-123",
      sportId: "   ",
    } as never);

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.recordGameEvent({
          selectedPlayerId: "lineup-uuid-1",
          actionName: "Pass",
          isPositive: true,
          isLeadToGoal: false,
          eventDefinitionId: "def-1",
        });
      }),
    ).rejects.toThrow("Sport is missing for match: test-match-id");
  });

  it("should delete a game event via deleteGameEvent and remove from Redux store after validating ownership", async () => {
    const store = createTestStore({
      recentActions: [
        {
          id: "event-del-1",
          playerNumber: 7,
          actionName: "Pass",
          isPositive: true,
          timestamp: new Date().toISOString(),
          matchLineupId: "lineup-7",
          eventDefinitionId: "def-pass",
          isLeadToGoal: false,
          isSynced: 0,
        },
      ],
    });

    vi.mocked(db.gameevents.get).mockResolvedValueOnce({
      id: "event-del-1",
      matchLineupId: "lineup-7",
      eventDefinitionId: "def-pass",
      periodNumber: 2,
      eventTimestamp: new Date().toISOString(),
      isLeadToGoal: false,
      createdAt: new Date().toISOString(),
      sequenceNumber: 1,
      isSynced: 0,
    } as never);

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      positionId: null,
    });

    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "test-match-id",
      tournamentId: "tour-123",
      userId: "user-123",
    } as never);

    vi.mocked(db.tournaments.get).mockResolvedValueOnce({
      id: "tour-123",
      sportId: "waterpolo-sport-id",
    } as never);

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      const success = await result.current.deleteGameEvent("event-del-1");
      expect(success).toBe(true);
    });

    expect(eventService.deleteGameEventTx).toHaveBeenCalledWith("event-del-1");
    expect(store.getState().match.recentActions).toHaveLength(0);
  });

  it("should throw an error in deleteGameEvent if game event record is not found", async () => {
    const store = createTestStore();
    vi.mocked(db.gameevents.get).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.deleteGameEvent("non-existent-event");
      }),
    ).rejects.toThrow("Game event record not found for ID: non-existent-event");
  });

  it("should throw an error in deleteGameEvent if lineup for game event is missing", async () => {
    const store = createTestStore();
    vi.mocked(db.gameevents.get).mockResolvedValueOnce({
      id: "event-1",
      matchLineupId: "missing-lineup",
    } as never);
    vi.mocked(db.matchlineups.get).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.deleteGameEvent("event-1");
      }),
    ).rejects.toThrow("Player lineup record not found for ID: missing-lineup");
  });

  it("should throw an error in deleteGameEvent if game event does not belong to active match", async () => {
    const store = createTestStore();
    vi.mocked(db.gameevents.get).mockResolvedValueOnce({
      id: "event-1",
      matchLineupId: "lineup-other-match",
    } as never);
    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-other-match",
      matchId: "other-match-id",
    } as never);

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.deleteGameEvent("event-1");
      }),
    ).rejects.toThrow(
      "Game event event-1 does not belong to match: test-match-id",
    );
  });

  it("should respect explicit userId parameter over Auth0 and Redux currentUserId", async () => {
    const store = createTestStore({}, "redux-user-id");
    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-1",
      matchId: "test-match-id",
      number: 1,
    } as never);
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "test-match-id",
      tournamentId: "tour-123",
      userId: "explicit-user-id",
    } as never);

    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce({
      id: "created-event-uuid",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 2,
      eventTimestamp: new Date().toISOString(),
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
      createdAt: new Date().toISOString(),
      sequenceNumber: 11,
      isSynced: 0,
    });

    const { result } = renderHook(
      () => useGameEvents("test-match-id", "explicit-user-id"),
      {
        wrapper: ({ children }) => (
          <Provider store={store}>{children}</Provider>
        ),
      },
    );

    await act(async () => {
      const success = await result.current.recordGameEvent({
        selectedPlayerId: "lineup-1",
        actionName: "Pass",
        isPositive: true,
        isLeadToGoal: false,
        eventDefinitionId: "def-1",
      });
      expect(success).toBe(true);
    });
  });

  it("should auto-remove active player on timed exclusion or DQ event during active period", async () => {
    const store = configureStore({
      reducer: {
        match: matchReducer,
        presence: presenceReducer,
        auth: (state = { currentUserId: "user-123" }) => state,
      },
      preloadedState: {
        match: {
          activeMatchId: "test-match-id",
          activeTeamId: "team-456",
          periodNumber: 2,
          homeScore: 0,
          guestScore: 0,
          isPeriodActive: true,
          isInsideStoppage: false,
          isPeriodEnded: false,
          globalSequenceNumber: 10,
          recentActions: [],
          hydrationVersion: 0,
        },
        presence: {
          currentPeriod: 2,
          activeLineupIds: ["lineup-uuid-7", "lineup-uuid-8"],
          benchLineupIds: ["lineup-uuid-9"],
          selectedStartingIds: [],
          activePlayersLimit: 7,
          isLoading: false,
        },
        auth: { currentUserId: "user-123" },
      },
    });

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      positionId: null,
    });

    const eventTimestamp = "2026-11-18T10:05:00.000Z";
    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce({
      id: "excl-event-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-excl-id",
      periodNumber: 2,
      eventTimestamp,
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
      foulImpact: "PersonalFoul",
      penaltyDurationSeconds: 20,
      createdAt: eventTimestamp,
      sequenceNumber: 11,
      isSynced: 0,
    });

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.recordGameEvent({
        selectedPlayerId: "lineup-uuid-7",
        actionName: "Exclusion",
        isPositive: false,
        isLeadToGoal: false,
        eventDefinitionId: "def-excl-id",
      });
    });

    expect(presenceService.exitPlayerPresenceTx).toHaveBeenCalledWith(
      "test-match-id",
      2,
      "lineup-uuid-7",
      eventTimestamp,
    );
    expect(store.getState().presence.activeLineupIds).toEqual([
      "lineup-uuid-8",
    ]);
    expect(store.getState().presence.benchLineupIds).toContain("lineup-uuid-7");
  });

  it("should return distinct removalPending result and allow retrying only unfinished removal without duplicating committed event", async () => {
    const store = configureStore({
      reducer: {
        match: matchReducer,
        presence: presenceReducer,
        auth: (state = { currentUserId: "user-123" }) => state,
      },
      preloadedState: {
        match: {
          activeMatchId: "test-match-id",
          activeTeamId: "team-456",
          periodNumber: 2,
          homeScore: 0,
          guestScore: 0,
          isPeriodActive: true,
          isInsideStoppage: false,
          isPeriodEnded: false,
          globalSequenceNumber: 10,
          recentActions: [],
          hydrationVersion: 0,
        },
        presence: {
          currentPeriod: 2,
          activeLineupIds: ["lineup-uuid-7", "lineup-uuid-8"],
          benchLineupIds: ["lineup-uuid-9"],
          selectedStartingIds: [],
          activePlayersLimit: 7,
          isLoading: false,
        },
        auth: { currentUserId: "user-123" },
      },
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      positionId: null,
    });

    const eventTimestamp = "2026-11-18T10:05:00.000Z";
    const createdEvent = {
      id: "excl-event-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-excl-id",
      periodNumber: 2,
      eventTimestamp,
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
      foulImpact: "PersonalFoul" as const,
      penaltyDurationSeconds: 18,
      createdAt: eventTimestamp,
      sequenceNumber: 11,
      isSynced: 0,
    };
    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce(
      createdEvent,
    );
    vi.mocked(db.gameevents.get).mockResolvedValueOnce(createdEvent);

    vi.mocked(presenceService.exitPlayerPresenceTx).mockRejectedValueOnce(
      new Error("Presence DB write failed"),
    );

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.recordGameEvent({
        selectedPlayerId: "lineup-uuid-7",
        actionName: "Exclusion",
        isPositive: false,
        isLeadToGoal: false,
        eventDefinitionId: "def-excl-id",
      });
    });

    expect(outcome).toEqual({
      eventSaved: true,
      removalPending: true,
      eventId: "excl-event-uuid",
    });
    expect(eventService.createGameEventTx).toHaveBeenCalledTimes(1);
    expect(presenceService.exitPlayerPresenceTx).toHaveBeenCalledTimes(1);
    expect(presenceService.exitPlayerPresenceTx).toHaveBeenCalledWith(
      "test-match-id",
      2,
      "lineup-uuid-7",
      eventTimestamp,
    );
    expect(store.getState().match.recentActions).toHaveLength(1);
    expect(store.getState().match.recentActions[0].id).toBe("excl-event-uuid");
    expect(store.getState().presence.activeLineupIds).toEqual([
      "lineup-uuid-7",
      "lineup-uuid-8",
    ]);

    vi.mocked(presenceService.exitPlayerPresenceTx).mockResolvedValueOnce(true);

    let retrySucceeded = false;
    await act(async () => {
      retrySucceeded = await result.current.retryPendingDisciplinaryRemovals();
    });

    expect(retrySucceeded).toBe(true);
    expect(eventService.createGameEventTx).toHaveBeenCalledTimes(1);
    expect(presenceService.exitPlayerPresenceTx).toHaveBeenCalledTimes(2);
    expect(store.getState().presence.activeLineupIds).toEqual([
      "lineup-uuid-8",
    ]);
    expect(store.getState().presence.benchLineupIds).toContain("lineup-uuid-7");

    consoleErrorSpy.mockRestore();
  });

  it("should preserve pending disciplinary removal across hook unmount and retry removal from a new hook instance", async () => {
    const store = configureStore({
      reducer: {
        match: matchReducer,
        presence: presenceReducer,
        auth: (state = { currentUserId: "user-123" }) => state,
      },
      preloadedState: {
        match: {
          activeMatchId: "test-match-id",
          activeTeamId: "team-456",
          periodNumber: 2,
          homeScore: 0,
          guestScore: 0,
          isPeriodActive: true,
          isInsideStoppage: false,
          isPeriodEnded: false,
          globalSequenceNumber: 10,
          recentActions: [],
          hydrationVersion: 0,
        },
        presence: {
          currentPeriod: 2,
          activeLineupIds: ["lineup-uuid-7", "lineup-uuid-8"],
          benchLineupIds: ["lineup-uuid-9"],
          selectedStartingIds: [],
          activePlayersLimit: 7,
          isLoading: false,
        },
        auth: { currentUserId: "user-123" },
      },
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      positionId: null,
    });

    const eventTimestamp = "2026-11-18T10:05:00.000Z";
    const createdEvent = {
      id: "unmount-excl-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-excl-id",
      periodNumber: 2,
      eventTimestamp,
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
      foulImpact: "PersonalFoul" as const,
      penaltyDurationSeconds: 18,
      createdAt: eventTimestamp,
      sequenceNumber: 11,
      isSynced: 0,
    };
    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce(
      createdEvent,
    );
    vi.mocked(db.gameevents.get).mockResolvedValueOnce(createdEvent);

    vi.mocked(presenceService.exitPlayerPresenceTx).mockRejectedValueOnce(
      new Error("Temporary IndexedDB failure"),
    );

    const firstMount = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      const outcome = await firstMount.result.current.recordGameEvent({
        selectedPlayerId: "lineup-uuid-7",
        actionName: "Exclusion",
        isPositive: false,
        isLeadToGoal: false,
        eventDefinitionId: "def-excl-id",
      });
      expect(outcome).toEqual({
        eventSaved: true,
        removalPending: true,
        eventId: "unmount-excl-uuid",
      });
    });

    firstMount.unmount();

    vi.mocked(presenceService.exitPlayerPresenceTx).mockResolvedValueOnce(true);

    const secondMount = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    expect(secondMount.result.current.hasPendingRemovals).toBe(true);

    let retried = false;
    await act(async () => {
      retried =
        await secondMount.result.current.retryPendingDisciplinaryRemovals();
    });

    expect(retried).toBe(true);
    expect(secondMount.result.current.hasPendingRemovals).toBe(false);
    expect(eventService.createGameEventTx).toHaveBeenCalledTimes(1);
    expect(presenceService.exitPlayerPresenceTx).toHaveBeenCalledTimes(2);
    expect(store.getState().presence.activeLineupIds).toEqual([
      "lineup-uuid-8",
    ]);

    consoleErrorSpy.mockRestore();
  });

  it("should not report false success or clear pending removal when retried after period has ended and presence was not exited", async () => {
    const store = configureStore({
      reducer: {
        match: matchReducer,
        presence: presenceReducer,
        auth: (state = { currentUserId: "user-123" }) => state,
      },
      preloadedState: {
        match: {
          activeMatchId: "test-match-id",
          activeTeamId: "team-456",
          periodNumber: 2,
          homeScore: 0,
          guestScore: 0,
          isPeriodActive: true,
          isInsideStoppage: false,
          isPeriodEnded: false,
          globalSequenceNumber: 10,
          recentActions: [],
          hydrationVersion: 0,
        },
        presence: {
          currentPeriod: 2,
          activeLineupIds: ["lineup-uuid-7", "lineup-uuid-8"],
          benchLineupIds: ["lineup-uuid-9"],
          selectedStartingIds: [],
          activePlayersLimit: 7,
          isLoading: false,
        },
        auth: { currentUserId: "user-123" },
      },
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      positionId: null,
    });

    const eventTimestamp = "2026-11-18T10:05:00.000Z";
    const createdEvent = {
      id: "end-period-excl-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-excl-id",
      periodNumber: 2,
      eventTimestamp,
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
      foulImpact: "PersonalFoul" as const,
      penaltyDurationSeconds: 18,
      createdAt: eventTimestamp,
      sequenceNumber: 11,
      isSynced: 0,
    };
    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce(
      createdEvent,
    );
    vi.mocked(db.gameevents.get).mockResolvedValueOnce(createdEvent);

    vi.mocked(presenceService.exitPlayerPresenceTx).mockRejectedValueOnce(
      new Error("DB lock during exclusion"),
    );

    const { result, rerender } = renderHook(
      () => useGameEvents("test-match-id"),
      {
        wrapper: ({ children }) => (
          <Provider store={store}>{children}</Provider>
        ),
      },
    );

    await act(async () => {
      await result.current.recordGameEvent({
        selectedPlayerId: "lineup-uuid-7",
        actionName: "Exclusion",
        isPositive: false,
        isLeadToGoal: false,
        eventDefinitionId: "def-excl-id",
      });
    });

    expect(result.current.hasPendingRemovals).toBe(true);

    // Simulate period ending while removal is still pending
    act(() => {
      store.dispatch({ type: "match/endPeriodState" });
    });
    rerender();

    // Presence was already closed by period end, so exitPlayerPresenceTx returns false
    vi.mocked(presenceService.exitPlayerPresenceTx).mockResolvedValueOnce(
      false,
    );

    let retried = true;
    await act(async () => {
      retried = await result.current.retryPendingDisciplinaryRemovals();
    });

    expect(retried).toBe(false);
    expect(result.current.hasPendingRemovals).toBe(true);
    expect(presenceService.exitPlayerPresenceTx).toHaveBeenCalledTimes(2);

    consoleErrorSpy.mockRestore();
  });

  it("should not auto-remove an active player when updating an earlier timed penalty after the player re-entered", async () => {
    const store = configureStore({
      reducer: {
        match: matchReducer,
        presence: presenceReducer,
        auth: (state = { currentUserId: "user-123" }) => state,
      },
      preloadedState: {
        match: {
          activeMatchId: "test-match-id",
          activeTeamId: "team-456",
          periodNumber: 2,
          homeScore: 0,
          guestScore: 0,
          isPeriodActive: true,
          isInsideStoppage: false,
          isPeriodEnded: false,
          globalSequenceNumber: 20,
          recentActions: [],
          hydrationVersion: 0,
        },
        presence: {
          currentPeriod: 2,
          activeLineupIds: ["lineup-uuid-7", "lineup-uuid-8"],
          benchLineupIds: ["lineup-uuid-9"],
          selectedStartingIds: [],
          activePlayersLimit: 7,
          isLoading: false,
        },
        auth: { currentUserId: "user-123" },
      },
    });

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      positionId: null,
    });

    const originalPresences = (db as unknown as { playerpresences?: unknown })
      .playerpresences;
    (db as unknown as { playerpresences: unknown }).playerpresences = {
      where: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "pres-reentered",
            matchLineupId: "lineup-uuid-7",
            periodNumber: 2,
            timeIn: "2026-11-18T10:07:00.000Z",
            timeOut: null,
            sequenceNumber: 15,
            isSynced: 0,
          },
        ]),
      }),
    };

    try {
      vi.mocked(eventService.updateGameEventTx).mockResolvedValueOnce({
        id: "earlier-excl-uuid",
        matchLineupId: "lineup-uuid-7",
        eventDefinitionId: "def-excl-id",
        periodNumber: 2,
        eventTimestamp: "2026-11-18T10:05:00.000Z",
        isLeadToGoal: false,
        locationX: 10,
        locationY: 20,
        shotLocationX: null,
        shotLocationY: null,
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
        createdAt: "2026-11-18T10:05:00.000Z",
        sequenceNumber: 11,
        isSynced: 0,
      });

      const { result } = renderHook(() => useGameEvents("test-match-id"), {
        wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
      });

      await act(async () => {
        const outcome = await result.current.updateGameEvent({
          eventId: "earlier-excl-uuid",
          selectedPlayerId: "lineup-uuid-7",
          actionName: "Exclusion",
          isPositive: false,
          isLeadToGoal: false,
          eventDefinitionId: "def-excl-id",
          locationX: 10,
          locationY: 20,
        });
        expect(outcome).toBe(true);
      });

      expect(presenceService.exitPlayerPresenceTx).not.toHaveBeenCalled();
      expect(store.getState().presence.activeLineupIds).toContain(
        "lineup-uuid-7",
      );
    } finally {
      (db as unknown as { playerpresences?: unknown }).playerpresences =
        originalPresences;
    }
  });

  it("should invalidate a changed event's pending entry before retrying other pending events", async () => {
    const store = configureStore({
      reducer: {
        match: matchReducer,
        presence: presenceReducer,
        auth: (state = { currentUserId: "user-123" }) => state,
      },
      preloadedState: {
        match: {
          activeMatchId: "test-match-id",
          activeTeamId: "team-456",
          periodNumber: 2,
          homeScore: 0,
          guestScore: 0,
          isPeriodActive: true,
          isInsideStoppage: false,
          isPeriodEnded: false,
          globalSequenceNumber: 20,
          recentActions: [],
          hydrationVersion: 0,
        },
        presence: {
          currentPeriod: 2,
          activeLineupIds: ["lineup-uuid-7", "lineup-uuid-8"],
          benchLineupIds: ["lineup-uuid-9"],
          selectedStartingIds: [],
          activePlayersLimit: 7,
          isLoading: false,
        },
        auth: { currentUserId: "user-123" },
      },
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const eventTimestamp = "2026-11-18T10:05:00.000Z";
    const pendingEventA = {
      id: "event-a-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-excl-id",
      periodNumber: 2,
      eventTimestamp,
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
      foulImpact: "PersonalFoul" as const,
      penaltyDurationSeconds: 18,
      createdAt: eventTimestamp,
      sequenceNumber: 11,
      isSynced: 0,
    };
    const pendingEventB = {
      ...pendingEventA,
      id: "event-b-uuid",
      matchLineupId: "lineup-uuid-8",
      sequenceNumber: 12,
    };

    vi.mocked(db.matchlineups.get)
      .mockResolvedValueOnce({
        id: "lineup-uuid-7",
        matchId: "test-match-id",
        playerRosterId: "roster-7",
        number: 7,
        positionId: null,
      })
      .mockResolvedValueOnce({
        id: "lineup-uuid-8",
        matchId: "test-match-id",
        playerRosterId: "roster-8",
        number: 8,
        positionId: null,
      })
      .mockResolvedValueOnce({
        id: "lineup-uuid-9",
        matchId: "test-match-id",
        playerRosterId: "roster-9",
        number: 9,
        positionId: null,
      });

    vi.mocked(eventService.createGameEventTx)
      .mockResolvedValueOnce(pendingEventA)
      .mockResolvedValueOnce(pendingEventB);

    vi.mocked(presenceService.exitPlayerPresenceTx)
      .mockRejectedValueOnce(new Error("DB lock A"))
      .mockRejectedValueOnce(new Error("DB lock A retry"))
      .mockRejectedValueOnce(new Error("DB lock B"));

    vi.mocked(db.gameevents.get).mockImplementation((async (id: unknown) => {
      if (id === "event-a-uuid") return pendingEventA;
      if (id === "event-b-uuid") return pendingEventB;
      return undefined;
    }) as never);

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.recordGameEvent({
        selectedPlayerId: "lineup-uuid-7",
        actionName: "Exclusion",
        isPositive: false,
        isLeadToGoal: false,
        eventDefinitionId: "def-excl-id",
      });
      await result.current.recordGameEvent({
        selectedPlayerId: "lineup-uuid-8",
        actionName: "Exclusion",
        isPositive: false,
        isLeadToGoal: false,
        eventDefinitionId: "def-excl-id",
      });
    });

    expect(result.current.hasPendingRemovals).toBe(true);
    vi.mocked(presenceService.exitPlayerPresenceTx).mockReset();
    vi.mocked(presenceService.exitPlayerPresenceTx).mockResolvedValue(true);

    // Update event-a-uuid to a non-disciplinary Goal on lineup-uuid-9
    vi.mocked(eventService.updateGameEventTx).mockResolvedValueOnce({
      ...pendingEventA,
      matchLineupId: "lineup-uuid-9",
      eventDefinitionId: "def-goal-id",
      foulImpact: "None",
      penaltyDurationSeconds: null,
    });

    await act(async () => {
      const outcome = await result.current.updateGameEvent({
        eventId: "event-a-uuid",
        selectedPlayerId: "lineup-uuid-9",
        actionName: "Goal",
        isPositive: true,
        isLeadToGoal: false,
        eventDefinitionId: "def-goal-id",
      });
      expect(outcome).toBe(true);
    });

    // Only unchanged pendingEventB (lineup-uuid-8) should be exited; old lineup-uuid-7 must NOT be removed
    expect(presenceService.exitPlayerPresenceTx).toHaveBeenCalledTimes(1);
    expect(presenceService.exitPlayerPresenceTx).toHaveBeenCalledWith(
      "test-match-id",
      2,
      "lineup-uuid-8",
      eventTimestamp,
    );
    expect(result.current.hasPendingRemovals).toBe(false);
    expect(store.getState().presence.activeLineupIds).toEqual([
      "lineup-uuid-7",
    ]);

    consoleErrorSpy.mockRestore();
  });

  it("should clear pending removal without restoring event when the persisted event was deleted", async () => {
    const store = configureStore({
      reducer: {
        match: matchReducer,
        presence: presenceReducer,
        auth: (state = { currentUserId: "user-123" }) => state,
      },
      preloadedState: {
        match: {
          activeMatchId: "test-match-id",
          activeTeamId: "team-456",
          periodNumber: 2,
          homeScore: 0,
          guestScore: 0,
          isPeriodActive: true,
          isInsideStoppage: false,
          isPeriodEnded: false,
          globalSequenceNumber: 10,
          recentActions: [],
          hydrationVersion: 0,
        },
        presence: {
          currentPeriod: 2,
          activeLineupIds: ["lineup-uuid-7", "lineup-uuid-8"],
          benchLineupIds: ["lineup-uuid-9"],
          selectedStartingIds: [],
          activePlayersLimit: 7,
          isLoading: false,
        },
        auth: { currentUserId: "user-123" },
      },
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      positionId: null,
    });

    const eventTimestamp = "2026-11-18T10:05:00.000Z";
    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce({
      id: "deleted-later-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-excl-id",
      periodNumber: 2,
      eventTimestamp,
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
      foulImpact: "PersonalFoul",
      penaltyDurationSeconds: 18,
      createdAt: eventTimestamp,
      sequenceNumber: 11,
      isSynced: 0,
    });

    vi.mocked(presenceService.exitPlayerPresenceTx).mockRejectedValueOnce(
      new Error("Temporary DB failure"),
    );

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.recordGameEvent({
        selectedPlayerId: "lineup-uuid-7",
        actionName: "Exclusion",
        isPositive: false,
        isLeadToGoal: false,
        eventDefinitionId: "def-excl-id",
      });
    });

    expect(result.current.hasPendingRemovals).toBe(true);
    vi.mocked(presenceService.exitPlayerPresenceTx).mockClear();

    // Event no longer exists in Dexie when retry runs
    vi.mocked(db.gameevents.get).mockResolvedValueOnce(undefined);

    let retried = false;
    await act(async () => {
      retried = await result.current.retryPendingDisciplinaryRemovals();
    });

    expect(retried).toBe(true);
    expect(result.current.hasPendingRemovals).toBe(false);
    expect(presenceService.exitPlayerPresenceTx).not.toHaveBeenCalled();
    expect(store.getState().presence.activeLineupIds).toContain(
      "lineup-uuid-7",
    );

    consoleErrorSpy.mockRestore();
  });

  it("should preserve a newer replacement pending-removal entry when an older retry completes", async () => {
    const store = configureStore({
      reducer: {
        match: matchReducer,
        presence: presenceReducer,
        auth: (state = { currentUserId: "user-123" }) => state,
      },
      preloadedState: {
        match: {
          activeMatchId: "test-match-id",
          activeTeamId: "team-456",
          periodNumber: 2,
          homeScore: 0,
          guestScore: 0,
          isPeriodActive: true,
          isInsideStoppage: false,
          isPeriodEnded: false,
          globalSequenceNumber: 10,
          recentActions: [],
          hydrationVersion: 0,
        },
        presence: {
          currentPeriod: 2,
          activeLineupIds: ["lineup-uuid-7", "lineup-uuid-8"],
          benchLineupIds: ["lineup-uuid-9"],
          selectedStartingIds: [],
          activePlayersLimit: 7,
          isLoading: false,
        },
        auth: { currentUserId: "user-123" },
      },
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const eventTimestamp = "2026-11-18T10:05:00.000Z";
    const initialEvent = {
      id: "race-excl-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-excl-id",
      periodNumber: 2,
      eventTimestamp,
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
      foulImpact: "PersonalFoul" as const,
      penaltyDurationSeconds: 18,
      createdAt: eventTimestamp,
      sequenceNumber: 11,
      isSynced: 0,
    };
    const updatedEvent = {
      ...initialEvent,
      matchLineupId: "lineup-uuid-8",
    };

    vi.mocked(db.matchlineups.get)
      .mockResolvedValueOnce({
        id: "lineup-uuid-7",
        matchId: "test-match-id",
        playerRosterId: "roster-7",
        number: 7,
        positionId: null,
      })
      .mockResolvedValueOnce({
        id: "lineup-uuid-8",
        matchId: "test-match-id",
        playerRosterId: "roster-8",
        number: 8,
        positionId: null,
      });

    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce(
      initialEvent,
    );
    vi.mocked(presenceService.exitPlayerPresenceTx).mockRejectedValueOnce(
      new Error("Initial DB failure"),
    );

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(async () => {
      await result.current.recordGameEvent({
        selectedPlayerId: "lineup-uuid-7",
        actionName: "Exclusion",
        isPositive: false,
        isLeadToGoal: false,
        eventDefinitionId: "def-excl-id",
      });
    });

    expect(result.current.hasPendingRemovals).toBe(true);

    // Hold the first retry in-flight while a concurrent update replaces the pending entry
    let resolveInFlightRetry!: (value: boolean) => void;
    const inFlightRetryPromise = new Promise<boolean>((resolve) => {
      resolveInFlightRetry = resolve;
    });

    vi.mocked(db.gameevents.get).mockResolvedValueOnce(initialEvent);
    vi.mocked(presenceService.exitPlayerPresenceTx)
      .mockReturnValueOnce(inFlightRetryPromise)
      .mockRejectedValueOnce(new Error("Updated player DB failure"));

    vi.mocked(eventService.updateGameEventTx).mockResolvedValueOnce(
      updatedEvent,
    );

    let firstRetryPromise!: Promise<boolean>;
    await act(async () => {
      firstRetryPromise = result.current.retryPendingDisciplinaryRemovals();
      await Promise.resolve();

      const updateOutcome = await result.current.updateGameEvent({
        eventId: "race-excl-uuid",
        selectedPlayerId: "lineup-uuid-8",
        actionName: "Exclusion",
        isPositive: false,
        isLeadToGoal: false,
        eventDefinitionId: "def-excl-id",
      });
      expect(updateOutcome).toEqual({
        eventSaved: true,
        removalPending: true,
        eventId: "race-excl-uuid",
      });

      resolveInFlightRetry(true);
      const firstRetryCompleted = await firstRetryPromise;
      expect(firstRetryCompleted).toBe(false);
    });

    // Replacement pending entry for lineup-uuid-8 must still be present
    expect(result.current.hasPendingRemovals).toBe(true);

    consoleErrorSpy.mockRestore();
  });

  it("should NOT treat exitPlayerPresenceTx returning false as complete when presence was closed after event timestamp, and retryPendingDisciplinaryRemovals should wait for in-flight finalization", async () => {
    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: true,
    });

    const eventTimestamp = "2026-11-19T10:05:00.000Z";
    const laterPeriodEndTimestamp = "2026-11-19T10:06:00.000Z";

    const createdEvent = {
      id: "in-flight-excl-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-excl-id",
      periodNumber: 1,
      eventTimestamp,
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
      foulImpact: "PersonalFoul" as const,
      penaltyDurationSeconds: 20,
      createdAt: eventTimestamp,
      sequenceNumber: 20,
      isSynced: 0,
    };

    vi.mocked(db.matchlineups.get).mockResolvedValue({
      id: "lineup-uuid-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      positionId: null,
    });

    // First loadDisciplinaryContext sees active presence; after exitPlayerPresenceTx returns false,
    // re-read sees the presence closed at a LATER timestamp (not already out before event).
    const originalPlayerPresences = (
      db as unknown as { playerpresences?: unknown }
    ).playerpresences;
    const whereMock = vi
      .fn()
      .mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "pres-1",
            matchLineupId: "lineup-uuid-7",
            periodNumber: 1,
            timeIn: "2026-11-19T10:00:00.000Z",
            timeOut: null,
          },
        ]),
      })
      .mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "pres-1",
            matchLineupId: "lineup-uuid-7",
            periodNumber: 1,
            timeIn: "2026-11-19T10:00:00.000Z",
            timeOut: laterPeriodEndTimestamp,
          },
        ]),
      });
    (db as unknown as { playerpresences?: unknown }).playerpresences = {
      where: whereMock,
    };

    try {
      vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce(
        createdEvent,
      );
      vi.mocked(db.gameevents.get).mockResolvedValue(createdEvent);

      let resolveExit!: (value: boolean) => void;
      const inFlightExitPromise = new Promise<boolean>((resolve) => {
        resolveExit = resolve;
      });

      vi.mocked(presenceService.exitPlayerPresenceTx)
        .mockReturnValueOnce(inFlightExitPromise)
        .mockResolvedValueOnce(false);

      const { result } = renderHook(() => useGameEvents("test-match-id"), {
        wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
      });

      let recordPromise!: Promise<unknown>;
      let retryPromise!: Promise<boolean>;
      let retrySettled = false;

      await act(async () => {
        recordPromise = result.current.recordGameEvent({
          selectedPlayerId: "lineup-uuid-7",
          actionName: "Exclusion",
          isPositive: false,
          isLeadToGoal: false,
          eventDefinitionId: "def-excl-id",
        });

        // Wait for recordGameEvent to reach exitPlayerPresenceTx (in-flight)
        await vi.waitFor(() => {
          expect(presenceService.exitPlayerPresenceTx).toHaveBeenCalledTimes(1);
        });

        // END PERIOD calls retryPendingDisciplinaryRemovals while finalization is still in-flight
        retryPromise = result.current
          .retryPendingDisciplinaryRemovals()
          .then((res) => {
            retrySettled = true;
            return res;
          });

        await Promise.resolve();
        expect(retrySettled).toBe(false);

        // In-flight exit returns false while presence was closed after event timestamp
        resolveExit(false);

        const [recordResult, retryResult] = await Promise.all([
          recordPromise,
          retryPromise,
        ]);

        expect(recordResult).toEqual({
          eventSaved: true,
          removalPending: true,
          eventId: "in-flight-excl-uuid",
        });
        // After waiting for in-flight finalization, retry sees the pending removal and fails to complete it
        expect(retryResult).toBe(false);
      });

      expect(result.current.hasPendingRemovals).toBe(true);
    } finally {
      (db as unknown as { playerpresences?: unknown }).playerpresences =
        originalPlayerPresences;
    }
  });

  it("should wait for in-flight createGameEventTx before END PERIOD retry settles and block new events while period end is in progress", async () => {
    const { beginPeriodEndEventBarrier } = await import("../hooks/useGameEvents");
    const store = createTestStore({
      periodNumber: 1,
      isPeriodActive: true,
    });

    const eventTimestamp = "2026-11-19T10:05:00.000Z";
    const createdEvent = {
      id: "delayed-create-excl-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-excl-id",
      periodNumber: 1,
      eventTimestamp,
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
      foulImpact: "PersonalFoul" as const,
      penaltyDurationSeconds: 20,
      createdAt: eventTimestamp,
      sequenceNumber: 21,
      isSynced: 0,
    };

    vi.mocked(db.matchlineups.get).mockResolvedValue({
      id: "lineup-uuid-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      positionId: null,
    });

    let resolveCreate!: (value: typeof createdEvent) => void;
    const delayedCreatePromise = new Promise<typeof createdEvent>((resolve) => {
      resolveCreate = resolve;
    });

    vi.mocked(eventService.createGameEventTx).mockReturnValueOnce(
      delayedCreatePromise,
    );
    vi.mocked(presenceService.exitPlayerPresenceTx).mockResolvedValueOnce(true);

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    let recordPromise!: Promise<unknown>;
    let endPeriodWaitPromise!: Promise<boolean>;
    let endPeriodWaitSettled = false;

    await act(async () => {
      // 1. Start recording an exclusion event whose createGameEventTx is still pending
      recordPromise = result.current.recordGameEvent({
        selectedPlayerId: "lineup-uuid-7",
        actionName: "Exclusion",
        isPositive: false,
        isLeadToGoal: false,
        eventDefinitionId: "def-excl-id",
      });

      await vi.waitFor(() => {
        expect(eventService.createGameEventTx).toHaveBeenCalledTimes(1);
      });

      // 2. END PERIOD starts while createGameEventTx has not returned yet
      const releaseBarrier = beginPeriodEndEventBarrier("test-match-id");
      try {
        endPeriodWaitPromise = result.current
          .retryPendingDisciplinaryRemovals()
          .then((res) => {
            endPeriodWaitSettled = true;
            return res;
          });

        // Any NEW event started while period end is in progress must be rejected immediately
        await expect(
          result.current.recordGameEvent({
            selectedPlayerId: "lineup-uuid-7",
            actionName: "Exclusion",
            isPositive: false,
            isLeadToGoal: false,
            eventDefinitionId: "def-excl-id",
          }),
        ).rejects.toThrow(/period end is in progress/i);

        await expect(
          result.current.updateGameEvent({
            eventId: "some-event-id",
            selectedPlayerId: "lineup-uuid-7",
            actionName: "Exclusion",
            isPositive: false,
            isLeadToGoal: false,
            eventDefinitionId: "def-excl-id",
          }),
        ).rejects.toThrow(/period end is in progress/i);

        // END PERIOD must still be waiting for the earlier in-flight event creation + exit
        expect(endPeriodWaitSettled).toBe(false);
        expect(presenceService.exitPlayerPresenceTx).not.toHaveBeenCalled();

        // 3. Complete createGameEventTx; exclusion exit persists its timestamp before END PERIOD proceeds
        resolveCreate(createdEvent);

        const [recordOutcome, endPeriodCanProceed] = await Promise.all([
          recordPromise,
          endPeriodWaitPromise,
        ]);

        expect(recordOutcome).toBe(true);
        expect(endPeriodCanProceed).toBe(true);
        expect(presenceService.exitPlayerPresenceTx).toHaveBeenCalledWith(
          "test-match-id",
          1,
          "lineup-uuid-7",
          eventTimestamp,
        );
      } finally {
        releaseBarrier();
      }
    });
  });
});
