import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../db/ttaDatabase";
import {
  isSportHydratedForUser,
  loadEventDefinitionsCache,
  clearEventDefinitionsCache,
  getEventDefinitionByName,
  saveEventDefinitionsToDb,
  replaceSportEventDefinitionsInDb,
  createGameEventTx,
  updateGameEventTx,
  deleteGameEventTx,
} from "../db/eventService";

const mockGameEventsGet = vi.fn();
const mockGameEventsPut = vi.fn();
const mockGameEventsDelete = vi.fn();
const mockEventDefinitionsGet = vi.fn();
const mockMatchLineupsGet = vi.fn();
const mockMatchesGet = vi.fn();
const mockSyncQueueUpdate = vi.fn();
const mockSyncQueueDelete = vi.fn();
const mockSyncQueueFilter = vi.fn();
const mockWhereEqualsToArray = vi.fn();

vi.mock("../db/ttaDatabase", () => ({
  db: {
    eventdefinitions: {
      get: (...args: unknown[]) => mockEventDefinitionsGet(...args),
      toArray: vi.fn(),
      bulkPut: vi.fn(),
      bulkDelete: vi.fn(),
      where: vi.fn(() => ({
        equals: mockWhereEqualsToArray,
      })),
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
    matchlineups: {
      get: (...args: unknown[]) => mockMatchLineupsGet(...args),
    },
    matches: {
      get: (...args: unknown[]) => mockMatchesGet(...args),
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
      isEnabled: true,
      createdAt: "2026-07-22T10:00:00.000Z",
    },
    {
      id: "def-2",
      sportId: "sport-1",
      name: "Pass",
      shortName: "PS",
      isPositive: true,
      isEnabled: true,
      createdAt: "2026-07-22T10:00:00.000Z",
    },
    {
      id: "def-3",
      sportId: "sport-1",
      name: "Disabled Action",
      shortName: "DA",
      isPositive: false,
      isEnabled: false,
      createdAt: "2026-07-22T10:00:00.000Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    clearEventDefinitionsCache();
    mockMatchLineupsGet.mockResolvedValue(undefined);
    mockMatchesGet.mockResolvedValue(undefined);
    mockEventDefinitionsGet.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        sportId: "sport-1",
        name: "Test Action",
        shortName: "TA",
        isPositive: true,
        isEnabled: true,
      }),
    );
    mockWhereEqualsToArray.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
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

  it("should filter definitions by sportId when sportId is passed to cache loader", async () => {
    const sport1Definitions = [mockDefinitions[0]];
    mockWhereEqualsToArray.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValueOnce(sport1Definitions),
    });

    const cache = await loadEventDefinitionsCache("sport-1");

    expect(db.eventdefinitions.where).toHaveBeenCalledWith("sportId");
    expect(mockWhereEqualsToArray).toHaveBeenCalledWith("sport-1");
    expect(cache.size).toBe(1);
    expect(cache.get("goal")).toBeDefined();
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

    const disabledDef = await getEventDefinitionByName("Disabled Action");
    expect(disabledDef).toBeUndefined();
  });

  it("should clear cache correctly when clearEventDefinitionsCache is invoked", async () => {
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValue(mockDefinitions);

    await loadEventDefinitionsCache();
    expect(db.eventdefinitions.toArray).toHaveBeenCalledTimes(1);

    clearEventDefinitionsCache();

    await loadEventDefinitionsCache();
    expect(db.eventdefinitions.toArray).toHaveBeenCalledTimes(2);
  });

  it("should persist definitions to IndexedDB and invalidate cache when saveEventDefinitionsToDb is called", async () => {
    const mockPutDefinitions = [
      {
        id: "def-new",
        sportId: "sport-1",
        name: "New Goal",
        shortName: "NG",
        isPositive: true,
        isEnabled: true,
      },
    ];

    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce(
      mockDefinitions,
    );
    await loadEventDefinitionsCache();
    expect(db.eventdefinitions.toArray).toHaveBeenCalledTimes(1);

    vi.mocked(db.eventdefinitions.bulkPut).mockResolvedValueOnce(
      undefined as never,
    );
    await saveEventDefinitionsToDb(mockPutDefinitions);

    expect(db.eventdefinitions.bulkPut).toHaveBeenCalledWith(
      mockPutDefinitions,
    );

    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce(
      mockPutDefinitions,
    );
    await loadEventDefinitionsCache();
    expect(db.eventdefinitions.toArray).toHaveBeenCalledTimes(2);
  });

  it("should remove omitted definitions when hydrating a new definition set for the same sport via saveEventDefinitionsToDb", async () => {
    const initialSet = [
      {
        id: "def-1",
        sportId: "sport-1",
        name: "Goal",
        shortName: "GL",
        isPositive: true,
        isEnabled: true,
      },
      {
        id: "def-2",
        sportId: "sport-1",
        name: "Foul",
        shortName: "FL",
        isPositive: false,
        isEnabled: true,
      },
    ];

    const updatedSet = [
      {
        id: "def-1",
        sportId: "sport-1",
        name: "Goal Updated",
        shortName: "GL",
        isPositive: true,
        isEnabled: true,
      },
    ];

    mockWhereEqualsToArray.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValueOnce([]),
    });
    await saveEventDefinitionsToDb(initialSet, "sport-1");

    expect(db.eventdefinitions.bulkPut).toHaveBeenCalledWith(initialSet);

    mockWhereEqualsToArray.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValueOnce(initialSet),
    });
    await saveEventDefinitionsToDb(updatedSet, "sport-1");

    expect(db.eventdefinitions.bulkDelete).toHaveBeenCalledWith(["def-2"]);
    expect(db.eventdefinitions.bulkPut).toHaveBeenCalledWith(updatedSet);
  });

  it("should replace sport event definitions atomically, purge missing IDs for sportId, and clear cache", async () => {
    const existingSport1Records = [
      {
        id: "def-1",
        sportId: "sport-1",
        name: "Goal",
        shortName: "GL",
        isPositive: true,
        isEnabled: true,
      },
      {
        id: "def-obsolete",
        sportId: "sport-1",
        name: "Obsolete",
        shortName: "OBS",
        isPositive: false,
        isEnabled: true,
      },
    ];

    mockWhereEqualsToArray.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValueOnce(existingSport1Records),
    });

    const updatedSport1Records = [
      {
        id: "def-1",
        sportId: "sport-1",
        name: "Goal Updated",
        shortName: "GL",
        isPositive: true,
        isEnabled: true,
      },
      {
        id: "def-new",
        sportId: "sport-1",
        name: "New Goal",
        shortName: "NG",
        isPositive: true,
        isEnabled: true,
      },
    ];

    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce(
      mockDefinitions,
    );
    await loadEventDefinitionsCache();
    expect(db.eventdefinitions.toArray).toHaveBeenCalledTimes(1);

    await replaceSportEventDefinitionsInDb("sport-1", updatedSport1Records);

    expect(db.transaction).toHaveBeenCalledWith(
      "rw",
      [db.eventdefinitions],
      expect.any(Function),
    );
    expect(db.eventdefinitions.where).toHaveBeenCalledWith("sportId");
    expect(mockWhereEqualsToArray).toHaveBeenCalledWith("sport-1");
    expect(db.eventdefinitions.bulkDelete).toHaveBeenCalledWith([
      "def-obsolete",
    ]);
    expect(db.eventdefinitions.bulkPut).toHaveBeenCalledWith(
      updatedSport1Records,
    );

    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce(
      updatedSport1Records,
    );
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
    mockMatchLineupsGet.mockImplementation((id: string) => {
      if (id === "lineup-1" || id === "lineup-2") {
        return Promise.resolve({ id, matchId: "match-123" });
      }
      return Promise.resolve(undefined);
    });
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
      matchLineupId: "lineup-1",
      isSynced: 0,
    });

    mockMatchLineupsGet.mockImplementation((id: string) => {
      if (id === "lineup-1" || id === "lineup-2") {
        return Promise.resolve({ id, matchId: "match-123" });
      }
      return Promise.resolve(undefined);
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

  it("should invalidate cache when userId parameter changes in loadEventDefinitionsCache", async () => {
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValue(mockDefinitions);

    await loadEventDefinitionsCache(undefined, "user-1");
    expect(db.eventdefinitions.toArray).toHaveBeenCalledTimes(1);

    await loadEventDefinitionsCache(undefined, "user-2");
    expect(db.eventdefinitions.toArray).toHaveBeenCalledTimes(2);
  });

  it("should track hydrated user ID per sport and return empty cache if sport is hydrated for a different user", async () => {
    mockWhereEqualsToArray.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockDefinitions),
    });

    // Hydrate definitions for user-1
    await replaceSportEventDefinitionsInDb(
      "sport-1",
      mockDefinitions,
      "user-1",
    );

    // Cache lookup for user-1 should return items
    const user1Cache = await loadEventDefinitionsCache("sport-1", "user-1");
    expect(user1Cache.size).toBe(2);

    // Cache lookup for user-2 (not yet hydrated for sport-1) should return empty Map (gated)
    const user2Cache = await loadEventDefinitionsCache("sport-1", "user-2");
    expect(user2Cache.size).toBe(0);
  });

  it("should return empty cache and false for isSportHydratedForUser on cold start when persisted records exist without an in-memory hydration marker", async () => {
    const coldSportId = "sport-cold-start";
    const userId = "user-1";

    mockWhereEqualsToArray.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValueOnce(mockDefinitions),
    });

    expect(isSportHydratedForUser(coldSportId, userId)).toBe(false);

    const cache = await loadEventDefinitionsCache(coldSportId, userId);
    expect(cache.size).toBe(0);

    const def = await getEventDefinitionByName("Goal", coldSportId, userId);
    expect(def).toBeUndefined();
  });

  it("should throw error in updateGameEventTx if target event is not found", async () => {
    await expect(
      updateGameEventTx({
        eventId: "non-existent-event",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        isLeadToGoal: false,
      }),
    ).rejects.toThrow("Game event not found for ID: non-existent-event");
  });

  it("should throw error in updateGameEventTx if lineup belongs to a different match", async () => {
    mockGameEventsGet.mockResolvedValueOnce({
      id: "event-1",
      matchLineupId: "lineup-A",
      eventDefinitionId: "def-1",
    });

    mockMatchLineupsGet.mockImplementation((id: string) => {
      if (id === "lineup-A") {
        return Promise.resolve({ id: "lineup-A", matchId: "match-A" });
      }
      if (id === "lineup-B") {
        return Promise.resolve({ id: "lineup-B", matchId: "match-B" });
      }
      return Promise.resolve(undefined);
    });

    await expect(
      updateGameEventTx({
        eventId: "event-1",
        matchLineupId: "lineup-B",
        eventDefinitionId: "def-1",
        isLeadToGoal: false,
      }),
    ).rejects.toThrow(
      "Lineup lineup-B does not belong to event match: match-A",
    );
  });

  it("should throw error in updateGameEventTx if event belongs to another user", async () => {
    mockGameEventsGet.mockResolvedValueOnce({
      id: "event-1",
      matchLineupId: "lineup-A",
      eventDefinitionId: "def-1",
    });

    mockMatchLineupsGet.mockResolvedValue({
      id: "lineup-A",
      matchId: "match-A",
    });

    mockMatchesGet.mockResolvedValue({
      id: "match-A",
      userId: "user-owner",
    });

    await expect(
      updateGameEventTx({
        eventId: "event-1",
        matchLineupId: "lineup-A",
        eventDefinitionId: "def-1",
        isLeadToGoal: false,
        userId: "user-attacker",
      }),
    ).rejects.toThrow("Event event-1 belongs to another user.");
  });

  it("should throw error in updateGameEventTx if target lineup is missing", async () => {
    mockGameEventsGet.mockResolvedValueOnce({
      id: "event-1",
      matchLineupId: "lineup-A",
      eventDefinitionId: "def-1",
    });

    mockMatchLineupsGet.mockImplementation((id: string) => {
      if (id === "lineup-A") {
        return Promise.resolve({ id: "lineup-A", matchId: "match-A" });
      }
      return Promise.resolve(undefined);
    });

    await expect(
      updateGameEventTx({
        eventId: "event-1",
        matchLineupId: "lineup-missing",
        eventDefinitionId: "def-1",
        isLeadToGoal: false,
      }),
    ).rejects.toThrow("Target lineup record not found: lineup-missing");
  });

  it("should throw error in updateGameEventTx if existing lineup is missing", async () => {
    mockGameEventsGet.mockResolvedValueOnce({
      id: "event-1",
      matchLineupId: "lineup-missing-existing",
      eventDefinitionId: "def-1",
    });

    mockMatchLineupsGet.mockImplementation((id: string) => {
      if (id === "lineup-B") {
        return Promise.resolve({ id: "lineup-B", matchId: "match-A" });
      }
      return Promise.resolve(undefined);
    });

    await expect(
      updateGameEventTx({
        eventId: "event-1",
        matchLineupId: "lineup-B",
        eventDefinitionId: "def-1",
        isLeadToGoal: false,
      }),
    ).rejects.toThrow(
      "Existing lineup record not found: lineup-missing-existing",
    );
  });
});
