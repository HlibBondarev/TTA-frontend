import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { useGameEvents } from "../hooks/useGameEvents";
import matchReducer from "../store/matchSlice";
import { db } from "../../../db/ttaDatabase";
import * as eventService from "../../../db/eventService";

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matchlineups: {
      get: vi.fn(),
    },
    playerrosters: {
      get: vi.fn(),
    },
  },
}));

vi.mock("../../../db/eventService", () => ({
  getEventDefinitionByName: vi.fn(),
  createGameEventTx: vi.fn(),
}));

const createTestStore = (preloadedState = {}) => {
  return configureStore({
    reducer: {
      match: matchReducer,
    },
    preloadedState: {
      match: {
        activeMatchId: "test-match-id",
        periodNumber: 2,
        homeScore: 0,
        guestScore: 0,
        isPeriodActive: true,
        isInsideStoppage: false,
        globalSequenceNumber: 10,
        recentActions: [],
        ...preloadedState,
      },
    },
  });
};

describe("useGameEvents Custom Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should successfully record game event with explicit isLeadToGoal, increment sequence, and add recent action with real jersey number", async () => {
    const store = createTestStore();

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      isInStartingLineup: true,
      positionId: null,
    });

    vi.mocked(db.playerrosters.get).mockResolvedValueOnce({
      id: "roster-7",
      teamId: "team-456",
      personId: "person-7",
      tournamentId: "t-1",
      number: 7,
    });

    vi.mocked(eventService.getEventDefinitionByName).mockResolvedValueOnce({
      id: "def-goal-id",
      sportId: "waterpolo-sport-id",
      name: "Goal",
      shortName: "GL",
      isPositive: true,
      createdAt: new Date().toISOString(),
    });

    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce({
      id: "created-event-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-goal-id",
      periodNumber: 2,
      eventTimestamp: new Date().toISOString(),
      isLeadToGoal: true,
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
        isLeadToGoal: true,
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
      isLeadToGoal: true,
    });

    expect(store.getState().match.globalSequenceNumber).toBe(11);
    expect(store.getState().match.recentActions).toHaveLength(1);
    expect(store.getState().match.recentActions[0]).toEqual({
      id: "created-event-uuid",
      playerNumber: 7,
      actionName: "Goal",
      isPositive: true,
      timestamp: expect.any(String),
    });
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
      isInStartingLineup: true,
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
        });
      }),
    ).rejects.toThrow(
      "Player lineup lineup-uuid-other does not belong to match: test-match-id",
    );
  });

  it("should throw an error if player roster or roster teamId is missing", async () => {
    const store = createTestStore();
    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-no-roster",
      matchId: "test-match-id",
      playerRosterId: "roster-missing",
      number: 10,
      isInStartingLineup: true,
      positionId: null,
    });

    vi.mocked(db.playerrosters.get).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.recordGameEvent({
          selectedPlayerId: "lineup-uuid-no-roster",
          actionName: "Pass",
          isPositive: true,
          isLeadToGoal: false,
        });
      }),
    ).rejects.toThrow(
      "Player roster or team ID not found for roster ID: roster-missing",
    );
  });

  it("should throw an error if event definition cannot be resolved by action name", async () => {
    const store = createTestStore();
    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-1",
      matchId: "test-match-id",
      playerRosterId: "roster-1",
      number: 1,
      isInStartingLineup: true,
      positionId: null,
    });

    vi.mocked(db.playerrosters.get).mockResolvedValueOnce({
      id: "roster-1",
      teamId: "team-456",
      personId: "person-1",
      tournamentId: "t-1",
      number: 1,
    });

    vi.mocked(eventService.getEventDefinitionByName).mockResolvedValueOnce(
      undefined,
    );

    const { result } = renderHook(() => useGameEvents("test-match-id"), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.recordGameEvent({
          selectedPlayerId: "lineup-uuid-1",
          actionName: "InvalidAction",
          isPositive: true,
          isLeadToGoal: false,
        });
      }),
    ).rejects.toThrow('Event definition not found for action: "InvalidAction"');
  });

  it("should pass custom isLeadToGoal flag to createGameEventTx regardless of action name", async () => {
    const store = createTestStore();

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-7",
      matchId: "test-match-id",
      playerRosterId: "roster-7",
      number: 7,
      isInStartingLineup: true,
      positionId: null,
    });

    vi.mocked(db.playerrosters.get).mockResolvedValueOnce({
      id: "roster-7",
      teamId: "team-456",
      personId: "person-7",
      tournamentId: "t-1",
      number: 7,
    });

    vi.mocked(eventService.getEventDefinitionByName).mockResolvedValueOnce({
      id: "def-pass-id",
      sportId: "waterpolo-sport-id",
      name: "Pass",
      shortName: "PS",
      isPositive: true,
      createdAt: new Date().toISOString(),
    });

    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce({
      id: "created-event-uuid",
      matchLineupId: "lineup-uuid-7",
      eventDefinitionId: "def-pass-id",
      periodNumber: 2,
      eventTimestamp: new Date().toISOString(),
      isLeadToGoal: true,
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
    });
  });
});
