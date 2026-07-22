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
        periodnumber: 2,
        homescore: 0,
        guestscore: 0,
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

  it("should successfully record game event, increment sequence, and add recent action with real jersey number", async () => {
    const store = createTestStore();

    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-7",
      matchid: "test-match-id",
      playerrosterid: "roster-7",
      number: 7,
      isinstartinglineup: true,
      positionid: null,
    });

    vi.mocked(eventService.getEventDefinitionByName).mockResolvedValueOnce({
      id: "def-goal-id",
      sportid: "waterpolo-sport-id",
      name: "Goal",
      shortname: "GL",
      ispositive: true,
      createdat: new Date().toISOString(),
    });

    vi.mocked(eventService.createGameEventTx).mockResolvedValueOnce({
      id: "created-event-uuid",
      matchlineupid: "lineup-uuid-7",
      eventdefinitionid: "def-goal-id",
      periodnumber: 2,
      eventtimestamp: new Date().toISOString(),
      isleadtogoal: true,
      createdat: new Date().toISOString(),
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
      });
      expect(success).toBe(true);
    });

    // Check IndexedDB transaction payload
    expect(eventService.createGameEventTx).toHaveBeenCalledWith({
      matchlineupid: "lineup-uuid-7",
      eventdefinitionid: "def-goal-id",
      periodnumber: 2,
      eventtimestamp: expect.any(String),
      isleadtogoal: true,
      sequenceNumber: 11,
    });

    // Check Redux state updates
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
        });
      }),
    ).rejects.toThrow("Player lineup record not found for ID: non-existent-id");
  });

  it("should throw an error if player lineup does not belong to the active match", async () => {
    const store = createTestStore();
    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-other",
      matchid: "other-match-id",
      playerrosterid: "roster-1",
      number: 1,
      isinstartinglineup: true,
      positionid: null,
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
        });
      }),
    ).rejects.toThrow(
      "Player lineup lineup-uuid-other does not belong to match: test-match-id",
    );
  });

  it("should throw an error if event definition cannot be resolved by action name", async () => {
    const store = createTestStore();
    vi.mocked(db.matchlineups.get).mockResolvedValueOnce({
      id: "lineup-uuid-1",
      matchid: "test-match-id",
      playerrosterid: "roster-1",
      number: 1,
      isinstartinglineup: true,
      positionid: null,
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
        });
      }),
    ).rejects.toThrow('Event definition not found for action: "InvalidAction"');
  });
});
