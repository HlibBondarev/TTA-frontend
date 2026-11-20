import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../../db/ttaDatabase";
import { matchLockService } from "../../services/matchLockService";
import {
  isSportHydratedForUser,
  loadEventDefinitionsCache,
  clearEventDefinitionsCache,
  saveEventDefinitionsToDb,
  replaceSportEventDefinitionsInDb,
  createGameEventTx,
  updateGameEventTx,
  deleteGameEventTx,
} from "../../db/eventService";

const mockGameEventsGet = vi.fn();
const mockGameEventsPut = vi.fn();
const mockGameEventsDelete = vi.fn();
const mockGameEventsWhere = vi.fn();
const mockEventDefinitionsGet = vi.fn();
const mockEventDefinitionsBulkGet = vi.fn();
const mockMatchLineupsGet = vi.fn();
const mockMatchesGet = vi.fn();
const mockTournamentsGet = vi.fn();
const mockSportConfigurationsGet = vi.fn();
const mockPlayerPresencesWhere = vi.fn();
const mockPlayerPresencesUpdate = vi.fn();
const mockTimeAnchorsWhere = vi.fn();
const mockSyncQueueUpdate = vi.fn();
const mockSyncQueueDelete = vi.fn();
const mockSyncQueueFilter = vi.fn();
const mockWhereEquals = vi.fn();
const mockUserPresetsWhere = vi.fn();
const mockUserPresetsDelete = vi.fn();

vi.mock("../../db/ttaDatabase", () => ({
  db: {
    eventdefinitions: {
      get: vi.fn((...args: unknown[]) => mockEventDefinitionsGet(...args)),
      bulkGet: vi.fn((...args: unknown[]) =>
        mockEventDefinitionsBulkGet(...args),
      ),
      toArray: vi.fn(),
      bulkPut: vi.fn(),
      bulkDelete: vi.fn(),
      where: vi.fn(() => ({
        equals: mockWhereEquals,
      })),
    },
    usereventpresets: {
      bulkPut: vi.fn(),
      delete: vi.fn((...args: unknown[]) => mockUserPresetsDelete(...args)),
      where: vi.fn((...args: unknown[]) => mockUserPresetsWhere(...args)),
    },
    gameevents: {
      add: vi.fn(),
      get: (...args: unknown[]) => mockGameEventsGet(...args),
      put: (...args: unknown[]) => mockGameEventsPut(...args),
      delete: (...args: unknown[]) => mockGameEventsDelete(...args),
      where: (...args: unknown[]) => mockGameEventsWhere(...args),
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
    tournaments: {
      get: (...args: unknown[]) => mockTournamentsGet(...args),
    },
    sportconfigurations: {
      get: (...args: unknown[]) => mockSportConfigurationsGet(...args),
    },
    timeanchors: {
      where: (...args: unknown[]) => mockTimeAnchorsWhere(...args),
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    playerpresences: {
      where: (...args: unknown[]) => mockPlayerPresencesWhere(...args),
      update: (...args: unknown[]) => mockPlayerPresencesUpdate(...args),
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
      score: 1,
      shortName: "GL",
      isPositive: true,
      isShot: true,
      isEnabled: true,
      sortOrder: 1,
      ownerId: "user-1",
      userId: "user-1",
      createdAt: "2026-07-22T10:00:00.000Z",
    },
    {
      id: "def-2",
      sportId: "sport-1",
      name: "Pass",
      shortName: "PS",
      isPositive: true,
      isShot: true,
      isEnabled: true,
      sortOrder: 2,
      ownerId: "user-1",
      userId: "user-1",
      createdAt: "2026-07-22T10:00:00.000Z",
    },
    {
      id: "def-3",
      sportId: "sport-1",
      name: "Disabled Action",
      shortName: "DA",
      isPositive: false,
      isShot: false,
      isEnabled: false,
      sortOrder: 3,
      ownerId: "user-1",
      userId: "user-1",
      createdAt: "2026-07-22T10:00:00.000Z",
    },
  ];

  const mockPresets = [
    {
      userId: "user-1",
      eventDefinitionId: "def-1",
      sportId: "sport-1",
      sortOrder: 1,
      isEnabled: true,
    },
    {
      userId: "user-1",
      eventDefinitionId: "def-2",
      sportId: "sport-1",
      sortOrder: 2,
      isEnabled: true,
    },
    {
      userId: "user-1",
      eventDefinitionId: "def-3",
      sportId: "sport-1",
      sortOrder: 3,
      isEnabled: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    clearEventDefinitionsCache();
    matchLockService.clearAllMatchLocks();
    mockMatchLineupsGet.mockResolvedValue(undefined);
    mockMatchesGet.mockResolvedValue(undefined);
    mockTournamentsGet.mockResolvedValue(undefined);
    mockSportConfigurationsGet.mockResolvedValue(undefined);
    mockGameEventsWhere.mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });
    mockTimeAnchorsWhere.mockReturnValue({
      equals: vi.fn().mockReturnValue({
        filter: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    });
    mockPlayerPresencesWhere.mockReturnValue({
      filter: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(undefined),
      }),
      equals: vi.fn().mockReturnValue({
        filter: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    });
    mockSyncQueueFilter.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    mockEventDefinitionsGet.mockImplementation((id: string) =>
      Promise.resolve(
        mockDefinitions.find((d) => d.id === id) || {
          id,
          sportId: "sport-1",
          name: "Test Action",
          shortName: "TA",
          isPositive: true,
          isShot: false,
          isEnabled: true,
          ownerId: "user-1",
          userId: "user-1",
        },
      ),
    );
    mockEventDefinitionsBulkGet.mockResolvedValue([
      mockDefinitions[0],
      mockDefinitions[1],
    ]);
    mockWhereEquals.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    });
    mockUserPresetsWhere.mockReturnValue({
      count: vi.fn().mockResolvedValue(3),
      toArray: vi.fn().mockResolvedValue(mockPresets),
    });
  });

  it("should load definitions into cache and return in-memory cache on subsequent calls", async () => {
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValueOnce(
      mockDefinitions,
    );

    const firstLoad = await loadEventDefinitionsCache();
    expect(firstLoad.size).toBe(3);

    const secondLoad = await loadEventDefinitionsCache();
    expect(secondLoad.size).toBe(3);
  });

  it("should filter definitions by sportId when sportId is passed to cache loader", async () => {
    const cache = await loadEventDefinitionsCache("sport-1", "user-1");

    expect(mockUserPresetsWhere).toHaveBeenCalledWith({
      userId: "user-1",
      sportId: "sport-1",
    });
    expect(db.eventdefinitions.bulkGet).toHaveBeenCalledWith([
      "def-1",
      "def-2",
    ]);
    expect(cache.size).toBe(2);
    expect(cache.get("goal")).toBeDefined();
  });

  it("should clear cache correctly when clearEventDefinitionsCache is invoked", async () => {
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValue(mockDefinitions);

    await loadEventDefinitionsCache();

    clearEventDefinitionsCache();

    await loadEventDefinitionsCache();
    expect(db.eventdefinitions.toArray).toHaveBeenCalled();
  });

  it("should persist definitions to IndexedDB and invalidate cache when saveEventDefinitionsToDb is called", async () => {
    const mockPutDefinitions = [
      {
        id: "def-new",
        sportId: "sport-1",
        name: "New Goal",
        shortName: "NG",
        isPositive: true,
        isShot: false,
        score: 3,
        isEnabled: true,
        ownerId: "user-1",
        userId: "user-1",
      },
    ];

    vi.mocked(db.eventdefinitions.bulkPut).mockResolvedValueOnce(
      undefined as never,
    );
    await saveEventDefinitionsToDb(mockPutDefinitions, "sport-1", "user-1");

    expect(db.eventdefinitions.bulkPut).toHaveBeenCalledWith([
      {
        id: "def-new",
        sportId: "sport-1",
        name: "New Goal",
        shortName: "NG",
        isPositive: true,
        isShot: false,
        score: 3,
        isCustom: undefined,
        ownerId: "user-1",
      },
    ]);

    expect(db.usereventpresets.bulkPut).toHaveBeenCalledWith([
      {
        userId: "user-1",
        eventDefinitionId: "def-new",
        sportId: "sport-1",
        sortOrder: 0,
        isEnabled: true,
      },
    ]);
  });

  it("should remove omitted definitions when hydrating a new definition set for the same sport via saveEventDefinitionsToDb", async () => {
    const initialPresets = [
      {
        userId: "user-1",
        eventDefinitionId: "def-1",
        sportId: "sport-1",
        sortOrder: 1,
        isEnabled: true,
      },
      {
        userId: "user-1",
        eventDefinitionId: "def-2",
        sportId: "sport-1",
        sortOrder: 2,
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
        isShot: false,
        isEnabled: true,
        ownerId: "user-1",
      },
    ];

    mockUserPresetsWhere.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValueOnce(initialPresets),
    });

    await saveEventDefinitionsToDb(updatedSet, "sport-1", "user-1");

    expect(mockUserPresetsDelete).toHaveBeenCalledWith(["user-1", "def-2"]);
    expect(db.usereventpresets.bulkPut).toHaveBeenCalledWith([
      {
        userId: "user-1",
        eventDefinitionId: "def-1",
        sportId: "sport-1",
        sortOrder: 0,
        isEnabled: true,
      },
    ]);
    expect(db.eventdefinitions.bulkDelete).not.toHaveBeenCalled();
  });

  it("should replace sport event definitions atomically, purge missing IDs for sportId, and clear cache", async () => {
    const updatedSport1Records = [
      {
        id: "def-1",
        sportId: "sport-1",
        name: "Goal Updated",
        shortName: "GL",
        isPositive: true,
        isShot: false,
        isEnabled: true,
        ownerId: "user-1",
      },
      {
        id: "def-new",
        sportId: "sport-1",
        name: "New Goal",
        shortName: "NG",
        isPositive: true,
        isShot: false,
        isEnabled: true,
        ownerId: "user-1",
      },
    ];

    await replaceSportEventDefinitionsInDb(
      "sport-1",
      updatedSport1Records,
      "user-1",
    );

    expect(db.transaction).toHaveBeenCalledWith(
      "rw",
      [db.eventdefinitions, db.usereventpresets],
      expect.any(Function),
    );
    expect(db.eventdefinitions.bulkPut).toHaveBeenCalledWith([
      {
        id: "def-1",
        sportId: "sport-1",
        name: "Goal Updated",
        shortName: "GL",
        isPositive: true,
        isShot: false,
        score: 0,
        isCustom: undefined,
        ownerId: "user-1",
      },
      {
        id: "def-new",
        sportId: "sport-1",
        name: "New Goal",
        shortName: "NG",
        isPositive: true,
        isShot: false,
        score: 0,
        isCustom: undefined,
        ownerId: "user-1",
      },
    ]);
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

  it("should throw error in createGameEventTx if target match is locked for finalization", async () => {
    matchLockService.lockMatchForFinalization("match-123");

    const params = {
      matchId: "match-123",
      teamId: "team-456",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "2026-07-22T12:00:00.000Z",
      isLeadToGoal: false,
    };

    await expect(createGameEventTx(params)).rejects.toThrow(
      `Cannot create event: match match-123 is locked for finalization.`,
    );

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("should throw error in createGameEventTx if event definition record is missing in IndexedDB", async () => {
    mockEventDefinitionsGet.mockResolvedValueOnce(undefined);

    const params = {
      matchId: "match-123",
      teamId: "team-456",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-missing",
      periodNumber: 1,
      eventTimestamp: "2026-07-22T12:00:00.000Z",
      isLeadToGoal: false,
    };

    await expect(createGameEventTx(params)).rejects.toThrow(
      "Event definition record not found for ID: def-missing",
    );

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
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
      foulImpact: "None",
      penaltyDurationSeconds: null,
      createdAt: expect.any(String),
      sequenceNumber: 5,
      isSynced: 0,
    });

    expect(db.transaction).toHaveBeenCalledWith(
      "rw",
      [
        db.gameevents,
        db.timeanchors,
        db.playerpresences,
        db.syncQueue,
        db.eventdefinitions,
        db.matchlineups,
        db.matches,
        db.tournaments,
        db.sportconfigurations,
      ],
      expect.any(Function),
    );
    expect(db.gameevents.add).toHaveBeenCalledWith(createdEvent);
  });

  it("should snapshot foulImpact and penaltyDurationSeconds on event creation and preserve or re-snapshot on update", async () => {
    mockEventDefinitionsGet.mockImplementation((id: string) => {
      if (id === "def-ex") {
        return Promise.resolve({
          id: "def-ex",
          sportId: "sport-1",
          name: "Exclusion",
          shortName: "EX",
          isPositive: false,
          isShot: false,
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: 20,
        });
      }
      if (id === "def-brutality") {
        return Promise.resolve({
          id: "def-brutality",
          sportId: "sport-1",
          name: "Brutality",
          shortName: "BR",
          isPositive: false,
          isShot: false,
          foulImpact: "DisqualificationWithSub",
          penaltyDurationSeconds: 240,
        });
      }
      return Promise.resolve(undefined);
    });

    const created = await createGameEventTx({
      matchId: "match-123",
      teamId: "team-456",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-ex",
      periodNumber: 1,
      eventTimestamp: "2026-07-22T12:00:00.000Z",
      isLeadToGoal: false,
    });

    expect(created.foulImpact).toBe("PersonalFoul");
    expect(created.penaltyDurationSeconds).toBe(20);

    // Edit same definition (even if definition in DB is mutated later) -> preserves snapshot!
    mockEventDefinitionsGet.mockResolvedValue({
      id: "def-ex",
      sportId: "sport-1",
      name: "Exclusion Mutated",
      shortName: "EX",
      isPositive: false,
      isShot: false,
      foulImpact: "DisqualificationNoSub",
      penaltyDurationSeconds: null,
    });

    mockGameEventsGet.mockResolvedValueOnce(created);
    mockMatchLineupsGet.mockResolvedValue({
      id: "lineup-1",
      matchId: "match-123",
    });
    mockSyncQueueFilter.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 11,
          endpoint: "/Matches/match-123/teams/team-456/events",
          payload: JSON.stringify([
            { id: created.id, matchLineupId: "lineup-1" },
          ]),
        },
      ]),
    });

    const updatedSameDef = await updateGameEventTx({
      eventId: created.id,
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-ex",
      isLeadToGoal: true,
    });

    expect(updatedSameDef.foulImpact).toBe("PersonalFoul");
    expect(updatedSameDef.penaltyDurationSeconds).toBe(20);

    // Reassign to another definition -> re-snapshots from the new definition!
    mockEventDefinitionsGet.mockResolvedValue({
      id: "def-brutality",
      sportId: "sport-1",
      name: "Brutality",
      shortName: "BR",
      isPositive: false,
      isShot: false,
      foulImpact: "DisqualificationWithSub",
      penaltyDurationSeconds: 240,
    });
    mockGameEventsGet.mockResolvedValueOnce(updatedSameDef);
    mockSyncQueueFilter.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 11,
          endpoint: "/Matches/match-123/teams/team-456/events",
          payload: JSON.stringify([
            { id: created.id, matchLineupId: "lineup-1" },
          ]),
        },
      ]),
    });

    const updatedNewDef = await updateGameEventTx({
      eventId: created.id,
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-brutality",
      isLeadToGoal: false,
    });

    expect(updatedNewDef.foulImpact).toBe("DisqualificationWithSub");
    expect(updatedNewDef.penaltyDurationSeconds).toBe(240);

    // Reassign to a definition that omits foulImpact and penaltyDurationSeconds -> explicitly snapshots "None" and null
    mockEventDefinitionsGet.mockResolvedValue({
      id: "def-plain",
      sportId: "sport-1",
      name: "Plain Action",
      shortName: "PA",
      isPositive: true,
      isShot: false,
    });
    mockGameEventsGet.mockResolvedValueOnce(updatedNewDef);
    mockSyncQueueFilter.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 11,
          endpoint: "/Matches/match-123/teams/team-456/events",
          payload: JSON.stringify([
            { id: created.id, matchLineupId: "lineup-1" },
          ]),
        },
      ]),
    });

    const updatedPlainDef = await updateGameEventTx({
      eventId: created.id,
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-plain",
      isLeadToGoal: false,
    });

    expect(updatedPlainDef.foulImpact).toBe("None");
    expect(updatedPlainDef.penaltyDurationSeconds).toBeNull();
  });

  it("should store spatial coordinates and goal shot locations in created GameEvent and syncQueue payload when provided", async () => {
    const params = {
      matchId: "match-123",
      teamId: "team-456",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "2026-07-22T12:00:00.000Z",
      isLeadToGoal: false,
      locationX: 45.5,
      locationY: 82.25,
      shotLocationX: 30.0,
      shotLocationY: 70.0,
    };

    const createdEvent = await createGameEventTx(params);

    expect(createdEvent.locationX).toBe(45.5);
    expect(createdEvent.locationY).toBe(82.25);
    expect(createdEvent.shotLocationX).toBe(30.0);
    expect(createdEvent.shotLocationY).toBe(70.0);
    expect(db.syncQueue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.stringContaining('"locationX":45.5'),
      }),
    );
    expect(db.syncQueue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.stringContaining('"shotLocationX":30'),
      }),
    );
    expect(
      JSON.parse(
        vi.mocked(db.syncQueue.add).mock.lastCall?.[0].payload ?? "null",
      ),
    ).toContainEqual(
      expect.objectContaining({ id: createdEvent.id, shotLocationY: 70.0 }),
    );
  });

  it("should update an unsynchronized GameEvent entity and its syncQueue payload with shot locations", async () => {
    const existingEvent = {
      id: "event-1",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "2026-07-22T12:00:00.000Z",
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
      shotLocationX: null,
      shotLocationY: null,
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
          endpoint: `/Matches/match-123/teams/team-456/events`,
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
      locationX: 15.25,
      locationY: 30.5,
      shotLocationX: 40.0,
      shotLocationY: 60.0,
    });

    expect(updated.matchLineupId).toBe("lineup-2");
    expect(updated.eventDefinitionId).toBe("def-2");
    expect(updated.isLeadToGoal).toBe(true);
    expect(updated.locationX).toBe(15.25);
    expect(updated.locationY).toBe(30.5);
    expect(updated.shotLocationX).toBe(40.0);
    expect(updated.shotLocationY).toBe(60.0);
    expect(mockGameEventsPut).toHaveBeenCalledWith(updated);
    expect(mockSyncQueueUpdate).toHaveBeenCalledWith(10, {
      payload: expect.stringContaining('"shotLocationX":40'),
    });
    expect(
      JSON.parse(mockSyncQueueUpdate.mock.lastCall?.[1]?.payload ?? "null"),
    ).toContainEqual(
      expect.objectContaining({ id: "event-1", shotLocationY: 60.0 }),
    );
  });

  it("should throw error in updateGameEventTx if target match is locked for finalization", async () => {
    mockGameEventsGet.mockResolvedValueOnce({
      id: "event-1",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      isSynced: 0,
    });

    mockMatchLineupsGet.mockImplementation((id: string) => {
      if (id === "lineup-1") {
        return Promise.resolve({ id: "lineup-1", matchId: "match-123" });
      }
      return Promise.resolve(undefined);
    });

    matchLockService.lockMatchForFinalization("match-123");

    await expect(
      updateGameEventTx({
        eventId: "event-1",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        isLeadToGoal: false,
      }),
    ).rejects.toThrow(
      `Cannot update event: match match-123 is locked for finalization.`,
    );
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
          endpoint: `/Matches/match-123/teams/team-456/events`,
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

  it("should throw error in deleteGameEventTx if target match is locked for finalization", async () => {
    mockGameEventsGet.mockResolvedValueOnce({
      id: "event-1",
      matchLineupId: "lineup-1",
      isSynced: 0,
    });

    mockMatchLineupsGet.mockImplementation((id: string) => {
      if (id === "lineup-1") {
        return Promise.resolve({ id: "lineup-1", matchId: "match-123" });
      }
      return Promise.resolve(undefined);
    });

    matchLockService.lockMatchForFinalization("match-123");

    await expect(deleteGameEventTx("event-1")).rejects.toThrow(
      `Cannot delete event: match match-123 is locked for finalization.`,
    );
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
          endpoint: `/Matches/match-123/teams/team-456/events`,
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
    await loadEventDefinitionsCache(undefined, "user-1");

    await loadEventDefinitionsCache(undefined, "user-2");
    expect(db.eventdefinitions.toArray).toHaveBeenCalledTimes(2);
  });

  it("should track hydrated user ID per sport and return empty cache if sport is hydrated for a different user", async () => {
    await replaceSportEventDefinitionsInDb(
      "sport-1",
      mockDefinitions,
      "user-1",
    );

    const user1Cache = await loadEventDefinitionsCache("sport-1", "user-1");
    expect(user1Cache.size).toBe(2);

    mockUserPresetsWhere.mockReturnValueOnce({
      count: vi.fn().mockResolvedValueOnce(0),
      toArray: vi.fn().mockResolvedValueOnce([]),
    });
    const user2Cache = await loadEventDefinitionsCache("sport-1", "user-2");
    expect(user2Cache.size).toBe(0);
  });

  it("should verify persistent records in IndexedDB on cold start when in-memory hydration marker is missing", async () => {
    const coldSportId = "sport-cold-start";
    const userId = "user-1";

    expect(await isSportHydratedForUser(coldSportId, userId)).toBe(true);

    const cache = await loadEventDefinitionsCache(coldSportId, userId);
    expect(cache.size).toBe(2);
  });

  it("should return false for isSportHydratedForUser when IndexedDB contains no records for sport", async () => {
    const unhydratedSportId = "sport-empty";
    const userId = "user-1";

    mockUserPresetsWhere.mockReturnValue({
      count: vi.fn().mockResolvedValue(0),
      toArray: vi.fn().mockResolvedValue([]),
    });

    expect(await isSportHydratedForUser(unhydratedSportId, userId)).toBe(false);

    const cache = await loadEventDefinitionsCache(unhydratedSportId, userId);
    expect(cache.size).toBe(0);
  });

  it("should return false for isSportHydratedForUser when IndexedDB contains definitions owned by another user", async () => {
    const unhydratedSportId = "sport-owned-by-other";
    const userId = "user-current";

    mockUserPresetsWhere.mockReturnValue({
      count: vi.fn().mockResolvedValue(0),
      toArray: vi.fn().mockResolvedValue([]),
    });

    expect(await isSportHydratedForUser(unhydratedSportId, userId)).toBe(false);

    const cache = await loadEventDefinitionsCache(unhydratedSportId, userId);
    expect(cache.size).toBe(0);
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
      `Lineup lineup-B does not belong to event match: match-A`,
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
    ).rejects.toThrow(`Event event-1 belongs to another user.`);
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
    ).rejects.toThrow(`Target lineup record not found: lineup-missing`);
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
      `Existing lineup record not found: lineup-missing-existing`,
    );
  });

  it("should defer hydratedUserIdBySport marker update until Dexie transaction complete event fires", async () => {
    const completeListeners: Array<() => void> = [];
    const mockTx = {
      on: vi.fn((event: string, callback: () => void) => {
        if (event === "complete") {
          completeListeners.push(callback);
        }
      }),
    };

    const dexieModule = await import("dexie");
    vi.spyOn(dexieModule.default, "currentTransaction", "get").mockReturnValue(
      mockTx as unknown as import("dexie").Transaction,
    );

    mockUserPresetsWhere.mockReturnValue({
      count: vi.fn().mockResolvedValue(0),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const sportId = "sport-tx-test";
    const userId = "user-tx-1";

    await replaceSportEventDefinitionsInDb(sportId, mockDefinitions, userId);

    expect(mockTx.on).toHaveBeenCalledWith("complete", expect.any(Function));

    expect(await isSportHydratedForUser(sportId, userId)).toBe(false);

    completeListeners.forEach((listener) => listener());

    expect(await isSportHydratedForUser(sportId, userId)).toBe(true);
  });

  it("should allow updating event when eventDefinitionId is unchanged even if historical definition is missing from db", async () => {
    const existingEvent = {
      id: "event-1",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-removed",
      periodNumber: 1,
      eventTimestamp: "2026-07-22T12:00:00.000Z",
      isLeadToGoal: false,
      createdAt: "2026-07-22T12:00:00.000Z",
      sequenceNumber: 1,
      isSynced: 0,
    };

    mockGameEventsGet.mockResolvedValueOnce(existingEvent);
    mockMatchLineupsGet.mockImplementation((id: string) => {
      if (id === "lineup-1") {
        return Promise.resolve({ id, matchId: "match-123" });
      }
      return Promise.resolve(undefined);
    });

    mockSyncQueueFilter.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 10,
          endpoint: `/Matches/match-123/teams/team-456/events`,
          payload: JSON.stringify([
            { id: "event-1", matchLineupId: "lineup-1" },
          ]),
        },
      ]),
    });

    const updated = await updateGameEventTx({
      eventId: "event-1",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-removed",
      isLeadToGoal: true,
    });

    expect(updated.isLeadToGoal).toBe(true);
    expect(mockEventDefinitionsGet).not.toHaveBeenCalled();
  });

  it("should successfully update event when expectedSportId matches definition sportId", async () => {
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
      if (id === "lineup-1") {
        return Promise.resolve({ id, matchId: "match-123" });
      }
      return Promise.resolve(undefined);
    });

    mockEventDefinitionsGet.mockResolvedValueOnce({
      id: "def-1",
      sportId: "sport-waterpolo",
      name: "Goal",
      ownerId: "user-1",
      userId: "user-1",
    });

    mockSyncQueueFilter.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 10,
          endpoint: `/Matches/match-123/teams/team-456/events`,
          payload: JSON.stringify([
            { id: "event-1", matchLineupId: "lineup-1" },
          ]),
        },
      ]),
    });

    const updated = await updateGameEventTx({
      eventId: "event-1",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      expectedSportId: "sport-waterpolo",
      isLeadToGoal: true,
    });

    expect(updated.isLeadToGoal).toBe(true);
    expect(mockGameEventsPut).toHaveBeenCalledWith(updated);
  });

  it("should throw error in updateGameEventTx when expectedSportId does not match definition sportId", async () => {
    const existingEvent = {
      id: "event-1",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      isSynced: 0,
    };

    mockGameEventsGet.mockResolvedValueOnce(existingEvent);
    mockMatchLineupsGet.mockImplementation((id: string) => {
      if (id === "lineup-1") {
        return Promise.resolve({ id, matchId: "match-123" });
      }
      return Promise.resolve(undefined);
    });

    mockEventDefinitionsGet.mockResolvedValueOnce({
      id: "def-basketball-pass",
      sportId: "sport-basketball",
      name: "Pass",
      ownerId: "user-1",
      userId: "user-1",
    });

    await expect(
      updateGameEventTx({
        eventId: "event-1",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-basketball-pass",
        expectedSportId: "sport-waterpolo",
        isLeadToGoal: false,
      }),
    ).rejects.toThrow(
      `Event definition def-basketball-pass does not belong to sport: sport-waterpolo`,
    );
  });

  it("should return false for isSportHydratedForUser when IndexedDB contains definitions without ownerId", async () => {
    const unhydratedSportId = "sport-no-owner";
    const userId = "user-current";

    mockUserPresetsWhere.mockReturnValueOnce({
      count: vi.fn().mockResolvedValueOnce(0),
    });

    expect(await isSportHydratedForUser(unhydratedSportId, userId)).toBe(false);
  });

  it("should preserve null ownerId for system definitions and assign userId only for custom definitions", async () => {
    const definitions = [
      {
        id: "def-system",
        sportId: "sport-1",
        name: "System Goal",
        shortName: "SG",
        isPositive: true,
        isShot: false,
        score: 0,
        isCustom: false,
      },
      {
        id: "def-custom",
        sportId: "sport-1",
        name: "Custom Action",
        shortName: "CA",
        isPositive: true,
        isShot: false,
        score: 0,
        isCustom: true,
      },
    ];

    await replaceSportEventDefinitionsInDb("sport-1", definitions, "user-1");

    expect(db.eventdefinitions.bulkPut).toHaveBeenCalledWith([
      {
        id: "def-system",
        sportId: "sport-1",
        name: "System Goal",
        shortName: "SG",
        isPositive: true,
        isShot: false,
        score: 0,
        isCustom: false,
        ownerId: null,
      },
      {
        id: "def-custom",
        sportId: "sport-1",
        name: "Custom Action",
        shortName: "CA",
        isPositive: true,
        isShot: false,
        score: 0,
        isCustom: true,
        ownerId: "user-1",
      },
    ]);
  });

  it("should return early when saveEventDefinitionsToDb is called with an empty array and omitted sportId", async () => {
    await saveEventDefinitionsToDb([], undefined, "user-1");
    expect(db.eventdefinitions.bulkPut).not.toHaveBeenCalled();
  });

  it("should group definitions by sportId and persist them via Promise.all when sportId argument is omitted", async () => {
    const multiSportDefs = [
      {
        id: "def-s1",
        sportId: "sport-1",
        name: "Goal",
        score: 1,
        shortName: "GL",
        isPositive: true,
        isShot: false,
      },
      {
        id: "def-s2",
        sportId: "sport-2",
        name: "Point",
        shortName: "PT",
        isPositive: true,
        isShot: false,
      },
    ];

    await saveEventDefinitionsToDb(multiSportDefs, undefined, "user-1");

    expect(db.eventdefinitions.bulkPut).toHaveBeenCalledTimes(2);
  });

  it("should preserve existing locationX, locationY, shotLocationX, and shotLocationY when parameters are undefined during updateGameEventTx", async () => {
    const existingEvent = {
      id: "event-coords-1",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "2026-07-22T12:00:00.000Z",
      isLeadToGoal: false,
      locationX: 42.5,
      locationY: 85.0,
      shotLocationX: 15.0,
      shotLocationY: 80.0,
      createdAt: "2026-07-22T12:00:00.000Z",
      sequenceNumber: 1,
      isSynced: 0,
    };

    mockGameEventsGet.mockResolvedValueOnce(existingEvent);
    mockMatchLineupsGet.mockImplementation((id: string) => {
      if (id === "lineup-1") {
        return Promise.resolve({ id, matchId: "match-123" });
      }
      return Promise.resolve(undefined);
    });

    mockSyncQueueFilter.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 10,
          endpoint: `/Matches/match-123/teams/team-456/events`,
          payload: JSON.stringify([
            { id: "event-coords-1", matchLineupId: "lineup-1" },
          ]),
        },
      ]),
    });

    const updated = await updateGameEventTx({
      eventId: "event-coords-1",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      isLeadToGoal: false,
      locationX: undefined,
      locationY: undefined,
      shotLocationX: undefined,
      shotLocationY: undefined,
    });

    expect(updated.locationX).toBe(42.5);
    expect(updated.locationY).toBe(85.0);
    expect(updated.shotLocationX).toBe(15.0);
    expect(updated.shotLocationY).toBe(80.0);
  });

  it("should clear shotLocationX and shotLocationY to null when updating event to a non-shot definition", async () => {
    const existingEvent = {
      id: "event-shot-to-nonshot",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "2026-07-22T12:00:00.000Z",
      isLeadToGoal: false,
      locationX: 42.5,
      locationY: 85.0,
      shotLocationX: 15.0,
      shotLocationY: 80.0,
      createdAt: "2026-07-22T12:00:00.000Z",
      sequenceNumber: 1,
      isSynced: 0,
    };

    mockGameEventsGet.mockResolvedValueOnce(existingEvent);
    mockMatchLineupsGet.mockImplementation((id: string) => {
      if (id === "lineup-1") {
        return Promise.resolve({ id, matchId: "match-123" });
      }
      return Promise.resolve(undefined);
    });

    const nonShotDefinition = {
      id: "def-non-shot",
      sportId: "sport-1",
      name: "Foul",
      shortName: "FL",
      isPositive: false,
      isShot: false,
    };
    mockEventDefinitionsGet
      .mockResolvedValueOnce(nonShotDefinition)
      .mockResolvedValueOnce(nonShotDefinition);

    mockSyncQueueFilter.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        {
          id: 10,
          endpoint: `/Matches/match-123/teams/team-456/events`,
          payload: JSON.stringify([
            { id: "event-shot-to-nonshot", matchLineupId: "lineup-1" },
          ]),
        },
      ]),
    });

    const updated = await updateGameEventTx({
      eventId: "event-shot-to-nonshot",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-non-shot",
      isLeadToGoal: false,
      shotLocationX: 30.0,
      shotLocationY: 70.0,
    });

    expect(updated.shotLocationX).toBeNull();
    expect(updated.shotLocationY).toBeNull();
    expect(mockGameEventsPut).toHaveBeenCalledWith(updated);
    expect(mockSyncQueueUpdate).toHaveBeenCalledWith(10, {
      payload: expect.any(String),
    });
    expect(
      JSON.parse(mockSyncQueueUpdate.mock.lastCall?.[1]?.payload ?? "null"),
    ).toContainEqual(
      expect.objectContaining({
        id: "event-shot-to-nonshot",
        locationX: 42.5,
        locationY: 85.0,
        shotLocationX: null,
        shotLocationY: null,
      }),
    );
  });

  describe("Atomic Active-Period Auto-Exit on Disciplinary Events", () => {
    it("should atomically close open presence and enqueue single-player PUT /presence/terminate on timed exclusion create", async () => {
      mockEventDefinitionsGet.mockResolvedValueOnce({
        id: "def-timed-ex",
        sportId: "sport-1",
        name: "20s Exclusion",
        shortName: "EX",
        isPositive: false,
        isShot: false,
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
      });

      mockPlayerPresencesWhere.mockReturnValueOnce({
        filter: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "pres-open-1",
            matchLineupId: "lineup-1",
            periodNumber: 2,
            timeIn: "2026-07-22T12:00:00.000Z",
            timeOut: null,
          }),
        }),
      });

      const created = await createGameEventTx({
        matchId: "match-123",
        teamId: "team-456",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-timed-ex",
        periodNumber: 2,
        eventTimestamp: "2026-07-22T12:03:00.000Z",
        isLeadToGoal: false,
      });

      expect(created.penaltyDurationSeconds).toBe(20);
      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith("pres-open-1", {
        timeOut: "2026-07-22T12:03:00.000Z",
        isSynced: 0,
      });
      expect(db.syncQueue.add).toHaveBeenCalledTimes(2);
      expect(db.syncQueue.add).toHaveBeenNthCalledWith(2, {
        actionType: "PUT",
        endpoint: "/Matches/match-123/presence/terminate",
        payload: JSON.stringify({
          periodNumber: 2,
          playerLineupIds: ["lineup-1"],
          timeOut: "2026-07-22T12:03:00.000Z",
        }),
        createdAt: "2026-07-22T12:03:00.000Z",
      });
    });

    it("should atomically close open presence on direct DQ (DisqualificationWithSub / DisqualificationNoSub) without timed duration", async () => {
      mockEventDefinitionsGet.mockResolvedValueOnce({
        id: "def-dq",
        sportId: "sport-1",
        name: "Red Card",
        shortName: "RC",
        isPositive: false,
        isShot: false,
        foulImpact: "DisqualificationNoSub",
        penaltyDurationSeconds: null,
      });

      mockPlayerPresencesWhere.mockReturnValueOnce({
        filter: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "pres-open-dq",
            matchLineupId: "lineup-1",
            periodNumber: 1,
            timeIn: "2026-07-22T12:00:00.000Z",
            timeOut: null,
          }),
        }),
      });

      await createGameEventTx({
        matchId: "match-123",
        teamId: "team-456",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-dq",
        periodNumber: 1,
        eventTimestamp: "2026-07-22T12:04:00.000Z",
        isLeadToGoal: false,
      });

      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith("pres-open-dq", {
        timeOut: "2026-07-22T12:04:00.000Z",
        isSynced: 0,
      });
    });

    it("should atomically close open presence when PersonalFoul reaches maxPersonalFouls, and not close before limit or when maxPersonalFouls is null", async () => {
      const pfDef = {
        id: "def-pf",
        sportId: "sport-1",
        name: "Penalty Foul",
        shortName: "PF",
        isPositive: false,
        isShot: false,
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: null,
      };
      mockEventDefinitionsGet.mockResolvedValue(pfDef);

      mockMatchesGet.mockResolvedValue({
        id: "match-123",
        tournamentId: "tourn-1",
      });
      mockTournamentsGet.mockResolvedValue({
        id: "tourn-1",
        configurationId: "cfg-1",
      });
      mockSportConfigurationsGet.mockResolvedValue({
        id: "cfg-1",
        maxPersonalFouls: 3,
      });

      // Only 1 prior foul -> total 2 (< 3) -> should NOT auto-exit
      mockGameEventsWhere.mockReturnValueOnce({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              id: "f1",
              matchLineupId: "lineup-1",
              eventDefinitionId: "def-pf",
              foulImpact: "PersonalFoul",
              penaltyDurationSeconds: null,
            },
          ]),
        }),
      });

      await createGameEventTx({
        matchId: "match-123",
        teamId: "team-456",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-pf",
        periodNumber: 1,
        eventTimestamp: "2026-07-22T12:05:00.000Z",
        isLeadToGoal: false,
      });

      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();

      // 2 prior fouls -> total 3 (== 3) -> SHOULD auto-exit
      mockGameEventsWhere.mockReturnValueOnce({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              id: "f1",
              matchLineupId: "lineup-1",
              eventDefinitionId: "def-pf",
              foulImpact: "PersonalFoul",
              penaltyDurationSeconds: null,
            },
            {
              id: "f2",
              matchLineupId: "lineup-1",
              eventDefinitionId: "def-pf",
              foulImpact: "PersonalFoul",
              penaltyDurationSeconds: null,
            },
          ]),
        }),
      });
      mockPlayerPresencesWhere.mockReturnValueOnce({
        filter: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "pres-foul-out",
            matchLineupId: "lineup-1",
            periodNumber: 2,
            timeIn: "2026-07-22T12:00:00.000Z",
            timeOut: null,
          }),
        }),
      });

      await createGameEventTx({
        matchId: "match-123",
        teamId: "team-456",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-pf",
        periodNumber: 2,
        eventTimestamp: "2026-07-22T12:06:00.000Z",
        isLeadToGoal: false,
      });

      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith("pres-foul-out", {
        timeOut: "2026-07-22T12:06:00.000Z",
        isSynced: 0,
      });
    });

    it("should atomically close open presence when an existing event is edited or reassigned into a timed exclusion or DQ", async () => {
      const existingEvent = {
        id: "evt-edit-dq",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        periodNumber: 1,
        eventTimestamp: "2026-07-22T12:02:00.000Z",
        isLeadToGoal: false,
        foulImpact: "None",
        penaltyDurationSeconds: null,
        createdAt: "2026-07-22T12:02:00.000Z",
        sequenceNumber: 2,
        isSynced: 0,
      };
      mockGameEventsGet.mockResolvedValueOnce(existingEvent);
      mockMatchLineupsGet.mockResolvedValue({
        id: "lineup-1",
        matchId: "match-123",
      });

      const dqDef = {
        id: "def-dq-with-sub",
        sportId: "sport-1",
        name: "DQ With Sub",
        shortName: "DQ",
        isPositive: false,
        isShot: false,
        foulImpact: "DisqualificationWithSub",
        penaltyDurationSeconds: null,
      };
      mockEventDefinitionsGet
        .mockResolvedValueOnce(dqDef)
        .mockResolvedValueOnce(dqDef);

      mockSyncQueueFilter.mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValue([
          {
            id: 15,
            endpoint: "/Matches/match-123/teams/team-456/events",
            payload: JSON.stringify([
              { id: "evt-edit-dq", matchLineupId: "lineup-1" },
            ]),
          },
        ]),
      });

      // Player was substituted back in at 12:04:00Z (after eventTimestamp 12:02:00Z) -> timeOut must clamp to 12:04:00Z
      mockPlayerPresencesWhere.mockReturnValueOnce({
        filter: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "pres-after-sub",
            matchLineupId: "lineup-1",
            periodNumber: 1,
            timeIn: "2026-07-22T12:04:00.000Z",
            timeOut: null,
          }),
        }),
      });

      await updateGameEventTx({
        eventId: "evt-edit-dq",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-dq-with-sub",
        isLeadToGoal: false,
      });

      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith("pres-after-sub", {
        timeOut: "2026-07-22T12:04:00.000Z",
        isSynced: 0,
      });
      expect(db.syncQueue.add).toHaveBeenCalledWith({
        actionType: "PUT",
        endpoint: "/Matches/match-123/presence/terminate",
        payload: JSON.stringify({
          periodNumber: 1,
          playerLineupIds: ["lineup-1"],
          timeOut: "2026-07-22T12:04:00.000Z",
        }),
        createdAt: "2026-07-22T12:04:00.000Z",
      });
    });

    it("should revert previous player's unsynced auto-exit and close new player's presence when reassigning an exclusion", async () => {
      const exitTimestamp = "2026-07-22T23:50:41.000Z";
      const existingEvent = {
        id: "evt-ex-11",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-ex-reassign",
        periodNumber: 2,
        eventTimestamp: exitTimestamp,
        isLeadToGoal: false,
        foulImpact: "PersonalFoul" as const,
        penaltyDurationSeconds: 20,
        createdAt: exitTimestamp,
        sequenceNumber: 10,
        isSynced: 0,
      };

      const exclusionDef = {
        id: "def-ex-reassign",
        sportId: "sport-1",
        name: "Exclusion",
        shortName: "EX",
        isPositive: false,
        isShot: false,
        foulImpact: "PersonalFoul" as const,
        penaltyDurationSeconds: 20,
      };

      const player11ClosedPresence = {
        id: "pres-11-closed",
        matchLineupId: "lineup-11",
        periodNumber: 2,
        timeIn: "2026-07-22T23:35:00.000Z",
        timeOut: exitTimestamp,
        sequenceNumber: 2,
        isSynced: 0,
      };

      const player8OpenPresence = {
        id: "pres-8-open",
        matchLineupId: "lineup-8",
        periodNumber: 2,
        timeIn: "2026-07-22T23:35:00.000Z",
        timeOut: null,
        sequenceNumber: 3,
        isSynced: 0,
      };

      mockGameEventsGet.mockResolvedValueOnce(existingEvent);
      mockMatchLineupsGet.mockImplementation((id: string) => {
        if (id === "lineup-11" || id === "lineup-8") {
          return Promise.resolve({ id, matchId: "match-123" });
        }
        return Promise.resolve(undefined);
      });
      mockEventDefinitionsGet.mockResolvedValue(exclusionDef);
      mockMatchesGet.mockResolvedValue({
        id: "match-123",
        tournamentId: "tourn-1",
      });
      mockTournamentsGet.mockResolvedValue({
        id: "tourn-1",
        configurationId: "cfg-1",
      });
      mockSportConfigurationsGet.mockResolvedValue({
        id: "cfg-1",
        activePlayersLimit: 7,
        maxPersonalFouls: 3,
      });

      mockPlayerPresencesWhere.mockImplementation((arg: unknown) => {
        if (arg === "periodNumber") {
          return {
            equals: vi.fn().mockReturnValue({
              filter: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  { id: "p1", matchLineupId: "l1", timeOut: null },
                  { id: "p2", matchLineupId: "l2", timeOut: null },
                  { id: "p3", matchLineupId: "l3", timeOut: null },
                  { id: "p4", matchLineupId: "l4", timeOut: null },
                  { id: "p5", matchLineupId: "l5", timeOut: null },
                ]),
              }),
            }),
          };
        }
        if (
          typeof arg === "object" &&
          arg !== null &&
          "matchLineupId" in arg &&
          (arg as { matchLineupId: string }).matchLineupId === "lineup-8"
        ) {
          return {
            toArray: vi.fn().mockResolvedValue([player8OpenPresence]),
            filter: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue(player8OpenPresence),
            }),
          };
        }
        if (
          typeof arg === "object" &&
          arg !== null &&
          "matchLineupId" in arg &&
          (arg as { matchLineupId: string }).matchLineupId === "lineup-11"
        ) {
          return {
            toArray: vi.fn().mockResolvedValue([player11ClosedPresence]),
            filter: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue(undefined),
            }),
          };
        }
        return {
          toArray: vi.fn().mockResolvedValue([]),
          filter: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(undefined),
          }),
        };
      });

      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => {
          const items = [
            {
              id: 10,
              actionType: "POST",
              endpoint: "/Matches/match-123/teams/team-456/events",
              payload: JSON.stringify([
                { id: "evt-ex-11", matchLineupId: "lineup-11" },
              ]),
            },
            {
              id: 55,
              actionType: "PUT",
              endpoint: "/Matches/match-123/presence/terminate",
              payload: JSON.stringify({
                periodNumber: 2,
                playerLineupIds: ["lineup-11"],
                timeOut: exitTimestamp,
              }),
              createdAt: exitTimestamp,
            },
          ].filter(predicate);
          return {
            toArray: vi.fn().mockResolvedValue(items),
          };
        },
      );

      await updateGameEventTx({
        eventId: "evt-ex-11",
        matchLineupId: "lineup-8",
        eventDefinitionId: "def-ex-reassign",
        isLeadToGoal: false,
      });

      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith("pres-8-open", {
        timeOut: exitTimestamp,
        isSynced: 0,
      });
      expect(mockSyncQueueDelete).toHaveBeenCalledWith(55);
      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith("pres-11-closed", {
        timeOut: null,
        isSynced: 0,
      });
    });

    it("should revert player's unsynced auto-exit when editing an exclusion into a non-disciplinary action", async () => {
      const exitTimestamp = "2026-07-22T23:50:41.000Z";
      const existingEvent = {
        id: "evt-ex-to-pass",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-ex",
        periodNumber: 2,
        eventTimestamp: exitTimestamp,
        isLeadToGoal: false,
        foulImpact: "PersonalFoul" as const,
        penaltyDurationSeconds: 20,
        createdAt: exitTimestamp,
        sequenceNumber: 10,
        isSynced: 0,
      };

      const passDef = {
        id: "def-2",
        sportId: "sport-1",
        name: "Pass",
        shortName: "PS",
        isPositive: true,
        isShot: false,
        foulImpact: "None" as const,
        penaltyDurationSeconds: null,
      };

      const closedPresence = {
        id: "pres-11-closed",
        matchLineupId: "lineup-11",
        periodNumber: 2,
        timeIn: "2026-07-22T23:35:00.000Z",
        timeOut: exitTimestamp,
        sequenceNumber: 2,
        isSynced: 0,
      };

      mockGameEventsGet.mockResolvedValueOnce(existingEvent);
      mockMatchLineupsGet.mockResolvedValue({
        id: "lineup-11",
        matchId: "match-123",
      });
      mockEventDefinitionsGet.mockResolvedValue(passDef);
      mockPlayerPresencesWhere.mockImplementation((arg: unknown) => {
        if (typeof arg === "object" && arg !== null && "matchLineupId" in arg) {
          return {
            toArray: vi.fn().mockResolvedValue([closedPresence]),
          };
        }
        return {
          equals: vi.fn().mockReturnValue({
            filter: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
      });
      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => {
          const items = [
            {
              id: 10,
              actionType: "POST",
              endpoint: "/Matches/match-123/teams/team-456/events",
              payload: JSON.stringify([
                { id: "evt-ex-to-pass", matchLineupId: "lineup-11" },
              ]),
            },
            {
              id: 56,
              actionType: "PUT",
              endpoint: "/Matches/match-123/presence/terminate",
              payload: JSON.stringify({
                periodNumber: 2,
                playerLineupIds: ["lineup-11"],
                timeOut: exitTimestamp,
              }),
              createdAt: exitTimestamp,
            },
          ].filter(predicate);
          return { toArray: vi.fn().mockResolvedValue(items) };
        },
      );

      await updateGameEventTx({
        eventId: "evt-ex-to-pass",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-2",
        isLeadToGoal: false,
      });

      expect(mockSyncQueueDelete).toHaveBeenCalledWith(56);
      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith("pres-11-closed", {
        timeOut: null,
        isSynced: 0,
      });
    });

    it("should revert unsynced auto-exit when deleting a disciplinary event in an active period", async () => {
      const exitTimestamp = "2026-07-22T23:50:41.000Z";
      mockGameEventsGet.mockResolvedValueOnce({
        id: "evt-del-ex",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-ex",
        periodNumber: 2,
        eventTimestamp: exitTimestamp,
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
        isSynced: 0,
      });
      mockMatchLineupsGet.mockResolvedValueOnce({
        id: "lineup-11",
        matchId: "match-123",
      });

      const closedPresence = {
        id: "pres-11-closed",
        matchLineupId: "lineup-11",
        periodNumber: 2,
        timeIn: "2026-07-22T23:35:00.000Z",
        timeOut: exitTimestamp,
        sequenceNumber: 2,
        isSynced: 0,
      };

      mockPlayerPresencesWhere.mockImplementation((arg: unknown) => {
        if (typeof arg === "object" && arg !== null && "matchLineupId" in arg) {
          return {
            toArray: vi.fn().mockResolvedValue([closedPresence]),
          };
        }
        return {
          equals: vi.fn().mockReturnValue({
            filter: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
      });

      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => {
          const items = [
            {
              id: 10,
              actionType: "POST",
              endpoint: "/Matches/match-123/teams/team-456/events",
              payload: JSON.stringify([{ id: "evt-del-ex" }]),
            },
            {
              id: 57,
              actionType: "PUT",
              endpoint: "/Matches/match-123/presence/terminate",
              payload: JSON.stringify({
                periodNumber: 2,
                playerLineupIds: ["lineup-11"],
                timeOut: exitTimestamp,
              }),
              createdAt: exitTimestamp,
            },
          ].filter(predicate);
          return { toArray: vi.fn().mockResolvedValue(items) };
        },
      );

      await deleteGameEventTx("evt-del-ex");

      expect(mockSyncQueueDelete).toHaveBeenCalledWith(57);
      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith("pres-11-closed", {
        timeOut: null,
        isSynced: 0,
      });
    });

    it("should NOT revert auto-exit when the period has already ended (PeriodEnd anchor type === 1) or active roster is already full", async () => {
      const exitTimestamp = "2026-07-22T23:50:41.000Z";
      mockGameEventsGet.mockResolvedValue({
        id: "evt-del-ended",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-ex",
        periodNumber: 2,
        eventTimestamp: exitTimestamp,
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
        isSynced: 0,
      });
      mockMatchLineupsGet.mockResolvedValue({
        id: "lineup-11",
        matchId: "match-123",
      });
      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => {
          const items = [
            {
              id: 10,
              actionType: "POST",
              endpoint: "/Matches/match-123/teams/team-456/events",
              payload: JSON.stringify([{ id: "evt-del-ended" }]),
            },
            {
              id: 58,
              actionType: "PUT",
              endpoint: "/Matches/match-123/presence/terminate",
              payload: JSON.stringify({
                periodNumber: 2,
                playerLineupIds: ["lineup-11"],
                timeOut: exitTimestamp,
              }),
              createdAt: exitTimestamp,
            },
          ].filter(predicate);
          return { toArray: vi.fn().mockResolvedValue(items) };
        },
      );

      // 1) Period already ended -> must NOT reopen
      mockTimeAnchorsWhere.mockReturnValueOnce({
        equals: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({
              id: "anchor-end-2",
              matchId: "match-123",
              periodNumber: 2,
              type: 1,
              timestamp: "2026-07-22T23:55:00.000Z",
              sequenceNumber: 20,
              isSynced: 0,
            }),
          }),
        }),
      });

      await deleteGameEventTx("evt-del-ended");

      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();
      expect(mockSyncQueueDelete).not.toHaveBeenCalledWith(58);

      // 2) Period active, but active roster is already at activePlayersLimit (2/2) -> must NOT reopen
      mockMatchesGet.mockResolvedValue({
        id: "match-123",
        tournamentId: "tourn-1",
      });
      mockTournamentsGet.mockResolvedValue({
        id: "tourn-1",
        configurationId: "cfg-1",
      });
      mockSportConfigurationsGet.mockResolvedValue({
        id: "cfg-1",
        activePlayersLimit: 2,
        maxPersonalFouls: 3,
      });
      mockPlayerPresencesWhere.mockImplementation((arg: unknown) => {
        if (arg === "periodNumber") {
          return {
            equals: vi.fn().mockReturnValue({
              filter: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  { id: "open-1", matchLineupId: "l1", timeOut: null },
                  { id: "open-2", matchLineupId: "l2", timeOut: null },
                ]),
              }),
            }),
          };
        }
        return {
          toArray: vi.fn().mockResolvedValue([]),
        };
      });

      await deleteGameEventTx("evt-del-ended");

      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();
      expect(mockSyncQueueDelete).not.toHaveBeenCalledWith(58);
    });
  });
});
