import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../db/ttaDatabase";
import {
  loadEventDefinitionsCache,
  clearEventDefinitionsCache,
  getEventDefinitionByName,
  createGameEventTx,
  updateGameEventTx,
  deleteGameEventTx,
} from "../db/eventService";

const mockGameEventsGet = vi.fn();
const mockGameEventsPut = vi.fn();
const mockGameEventsDelete = vi.fn();
const mockSyncQueueUpdate = vi.fn();
const mockSyncQueueDelete = vi.fn();
const mockSyncQueueFilter = vi.fn();

vi.mock("../db/ttaDatabase", () => ({
  db: {
    eventdefinitions: {
      toArray: vi.fn(),
    },
    gameevents: {
      add: vi.fn(),
      get: (...args: unknown[]) => mockGameEventsGet(...args),
      put: (...args: unknown[]) => mockGameEventsPut(...args),
      delete: (...args: unknown[]) => mockGameEventsDelete(...args),
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue({ sequenceNumber: 4 }),
      }),
    },
    timeanchors: {
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    playerpresences: {
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    syncQueue: {
      add: vi.fn(),
      update: (...args: unknown[]) => mockSyncQueueUpdate(...args),
      delete: (...args: unknown[]) => mockSyncQueueDelete(...args),
      filter: (...args: unknown[]) => mockSyncQueueFilter(...args),
    },
    transaction: vi.fn((_mode, _tables, cb) => cb()),
  },
}));

describe("Event Database Service (eventService)", () => {
  const mockDefinitions = [
    {
      id: "def-1",
      sportId: "sport-1",
      name: "Goal",
      shortName: "GL",
      isPositive: true,
      createdAt: "2026-07-22T10:00:00.000Z",
    },
    {
      id: "def-2",
      sportId: "sport-1",
      name: "Pass",
      shortName: "PS",
      isPositive: true,
      createdAt: "2026-07-22T10:00:00.000Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    clearEventDefinitionsCache();
  });

  it("should load definitions into cache and return in-memory cache on subsequent calls", async () => {
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce(
      mockDefinitions,
    );

    const firstLoad = await loadEventDefinitionsCache();
    expect(firstLoad.size).toBe(2);
    expect(db.eventdefinitions.toArray).toHaveBeenCalledTimes(1);

    const secondLoad = await loadEventDefinitionsCache();
    expect(secondLoad.size).toBe(2);
    expect(db.eventdefinitions.toArray).toHaveBeenCalledTimes(1);
  });

  it("should resolve event definition by name case-insensitively and with whitespace", async () => {
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce(
      mockDefinitions,
    );

    const goalDef = await getEventDefinitionByName("  gOaL ");
    expect(goalDef).toBeDefined();
    expect(goalDef?.id).toBe("def-1");

    const passDef = await getEventDefinitionByName("pass");
    expect(passDef).toBeDefined();
    expect(passDef?.id).toBe("def-2");

    const unknownDef = await getEventDefinitionByName("UnknownAction");
    expect(unknownDef).toBeUndefined();
  });

  it("should clear cache correctly when clearEventDefinitionsCache is invoked", async () => {
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValue(mockDefinitions);

    await loadEventDefinitionsCache();
    expect(db.eventdefinitions.toArray).toHaveBeenCalledTimes(1);

    clearEventDefinitionsCache();

    await loadEventDefinitionsCache();
    expect(db.eventdefinitions.toArray).toHaveBeenCalledTimes(2);
  });

  it("should throw an error and prevent persistence if matchId or teamId is missing or empty", async () => {
    const invalidParamsMissingMatch = {
      matchId: "",
      teamId: "team-456",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "2026-07-22T12:00:00.000Z",
      isLeadToGoal: false,
    };

    await expect(createGameEventTx(invalidParamsMissingMatch)).rejects.toThrow(
      "Missing or empty matchId for creating game event.",
    );

    const invalidParamsMissingTeam = {
      matchId: "match-123",
      teamId: "  ",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "2026-07-22T12:00:00.000Z",
      isLeadToGoal: false,
    };

    await expect(createGameEventTx(invalidParamsMissingTeam)).rejects.toThrow(
      "Missing or empty teamId for creating game event.",
    );

    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.gameevents.add).not.toHaveBeenCalled();
    expect(db.syncQueue.add).not.toHaveBeenCalled();
  });

  it("should create and persist a GameEvent entity atomically with incremented sequence and sync queue item", async () => {
    const params = {
      matchId: "match-123",
      teamId: "team-456",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "2026-07-22T12:00:00.000Z",
      isLeadToGoal: false,
    };

    const createdEvent = await createGameEventTx(params);

    expect(createdEvent).toEqual({
      id: expect.any(String),
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "2026-07-22T12:00:00.000Z",
      isLeadToGoal: false,
      createdAt: expect.any(String),
      sequenceNumber: 5,
      isSynced: 0,
    });

    expect(db.transaction).toHaveBeenCalledWith(
      "rw",
      [db.gameevents, db.timeanchors, db.playerpresences, db.syncQueue],
      expect.any(Function),
    );
    expect(db.gameevents.add).toHaveBeenCalledWith(createdEvent);
  });

  it("should update an unsynchronized GameEvent entity and its syncQueue payload", async () => {
    const existingEvent = {
      id: "event-1",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "2026-07-22T12:00:00.000Z",
      isLeadToGoal: false,
      createdAt: "2026-07-22T12:00:00.000Z",
      sequenceNumber: 1,
      isSynced: 0,
    };

    mockGameEventsGet.mockResolvedValueOnce(existingEvent);
    mockSyncQueueFilter.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        { id: 99, endpoint: "/other", payload: "invalid-json" },
        {
          id: 10,
          endpoint: "/Matches/match-123/teams/team-456/events",
          payload: JSON.stringify([
            { id: "event-1", matchLineupId: "lineup-1" },
          ]),
        },
      ]),
    });

    const updated = await updateGameEventTx({
      eventId: "event-1",
      matchLineupId: "lineup-2",
      eventDefinitionId: "def-2",
      isLeadToGoal: true,
    });

    expect(updated.matchLineupId).toBe("lineup-2");
    expect(updated.eventDefinitionId).toBe("def-2");
    expect(updated.isLeadToGoal).toBe(true);
    expect(mockGameEventsPut).toHaveBeenCalledWith(updated);
    expect(mockSyncQueueUpdate).toHaveBeenCalledWith(10, {
      payload: expect.stringContaining('"matchLineupId":"lineup-2"'),
    });
  });

  it("should throw error when event to update is not found", async () => {
    mockGameEventsGet.mockResolvedValueOnce(undefined);

    await expect(
      updateGameEventTx({
        eventId: "non-existent",
        matchLineupId: "l-1",
        eventDefinitionId: "d-1",
        isLeadToGoal: false,
      }),
    ).rejects.toThrow("Game event not found for ID: non-existent");
  });

  it("should throw error when attempting to update a synced event", async () => {
    mockGameEventsGet.mockResolvedValueOnce({
      id: "event-synced",
      isSynced: 1,
    });

    await expect(
      updateGameEventTx({
        eventId: "event-synced",
        matchLineupId: "lineup-2",
        eventDefinitionId: "def-2",
        isLeadToGoal: true,
      }),
    ).rejects.toThrow("Cannot edit a synchronized event.");
  });

  it("should throw error when matching sync queue payload is missing during update", async () => {
    mockGameEventsGet.mockResolvedValueOnce({
      id: "event-orphaned",
      isSynced: 0,
    });

    mockSyncQueueFilter.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([]),
    });

    await expect(
      updateGameEventTx({
        eventId: "event-orphaned",
        matchLineupId: "lineup-2",
        eventDefinitionId: "def-2",
        isLeadToGoal: true,
      }),
    ).rejects.toThrow(
      "Matching sync queue payload not found for event ID: event-orphaned",
    );
  });

  it("should delete an unsynchronized GameEvent entity and update syncQueue array payload", async () => {
    mockGameEventsGet.mockResolvedValueOnce({
      id: "event-del-1",
      isSynced: 0,
    });

    mockSyncQueueFilter.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 20,
          endpoint: "/Matches/match-123/teams/team-456/events",
          payload: JSON.stringify([
            { id: "event-del-1" },
            { id: "event-del-2" },
          ]),
        },
      ]),
    });

    await deleteGameEventTx("event-del-1");

    expect(mockGameEventsDelete).toHaveBeenCalledWith("event-del-1");
    expect(mockSyncQueueUpdate).toHaveBeenCalledWith(20, {
      payload: JSON.stringify([{ id: "event-del-2" }]),
    });
  });

  it("should delete syncQueue item entirely when last item in batch is deleted", async () => {
    mockGameEventsGet.mockResolvedValueOnce({
      id: "event-del",
      isSynced: 0,
    });

    mockSyncQueueFilter.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 15,
          endpoint: "/Matches/match-123/teams/team-456/events",
          payload: JSON.stringify([{ id: "event-del" }]),
        },
      ]),
    });

    await deleteGameEventTx("event-del");

    expect(mockGameEventsDelete).toHaveBeenCalledWith("event-del");
    expect(mockSyncQueueDelete).toHaveBeenCalledWith(15);
  });

  it("should throw error when event to delete is not found", async () => {
    mockGameEventsGet.mockResolvedValueOnce(undefined);

    await expect(deleteGameEventTx("non-existent")).rejects.toThrow(
      "Game event not found for ID: non-existent",
    );
  });

  it("should throw error when attempting to delete a synced event", async () => {
    mockGameEventsGet.mockResolvedValueOnce({
      id: "event-synced",
      isSynced: 1,
    });

    await expect(deleteGameEventTx("event-synced")).rejects.toThrow(
      "Cannot delete a synchronized event.",
    );
  });

  it("should throw error when matching sync queue payload is missing during deletion", async () => {
    mockGameEventsGet.mockResolvedValueOnce({
      id: "event-orphaned",
      isSynced: 0,
    });

    mockSyncQueueFilter.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([]),
    });

    await expect(deleteGameEventTx("event-orphaned")).rejects.toThrow(
      "Matching sync queue payload not found for event ID: event-orphaned",
    );
  });
});
