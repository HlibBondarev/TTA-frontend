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
const mockMatchLineupsWhere = vi.fn();

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
      where: (...args: unknown[]) => mockMatchLineupsWhere(...args),
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
    mockMatchLineupsWhere.mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
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

    it("should NOT revert auto-exit when the period has ended or active roster is at cap (including permanent DisqualificationNoSub reduction), and SHOULD revert below cap", async () => {
      const exitTimestamp = "2026-07-22T23:50:41.000Z";
      const closedPresence11 = {
        id: "pres-11-closed",
        matchLineupId: "lineup-11",
        periodNumber: 2,
        timeIn: "2026-07-22T23:35:00.000Z",
        timeOut: exitTimestamp,
        sequenceNumber: 2,
        isSynced: 0,
      };
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

      const mockPresencesWithOpenCount = (
        openRows: Array<{ id: string; matchLineupId: string; timeOut: null }>,
      ) => {
        mockPlayerPresencesWhere.mockImplementation((arg: unknown) => {
          if (arg === "periodNumber") {
            return {
              equals: vi.fn().mockReturnValue({
                filter: vi.fn(
                  (predicate: (p: (typeof openRows)[0]) => boolean) => ({
                    toArray: vi
                      .fn()
                      .mockResolvedValue(openRows.filter(predicate)),
                  }),
                ),
              }),
            };
          }
          return {
            toArray: vi.fn().mockResolvedValue([closedPresence11]),
            equals: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([closedPresence11]),
            }),
          };
        });
      };

      // 1) Period already ended -> must NOT reopen
      mockPresencesWithOpenCount([]);
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

      // 2) Period active, active roster is already at activePlayersLimit (2/2) -> must NOT reopen
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
      mockMatchLineupsWhere.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { id: "l1", matchId: "match-123" },
            { id: "l2", matchId: "match-123" },
            { id: "lineup-11", matchId: "match-123" },
            { id: "lineup-dq", matchId: "match-123" },
          ]),
        }),
      });
      mockPresencesWithOpenCount([
        { id: "open-1", matchLineupId: "l1", timeOut: null },
        { id: "open-2", matchLineupId: "l2", timeOut: null },
      ]);

      await deleteGameEventTx("evt-del-ended");

      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();
      expect(mockSyncQueueDelete).not.toHaveBeenCalledWith(58);

      // 3) Open count is 1, but a permanent DisqualificationNoSub reduces cap from 2 to 1 -> must NOT reopen
      mockPresencesWithOpenCount([
        { id: "open-1", matchLineupId: "l1", timeOut: null },
      ]);
      mockGameEventsWhere.mockImplementation(() => ({
        equals: vi.fn((lineupId: string) => ({
          toArray: vi.fn().mockResolvedValue(
            lineupId === "lineup-dq"
              ? [
                  {
                    id: "evt-perm-nosub",
                    matchLineupId: "lineup-dq",
                    eventDefinitionId: "def-red",
                    periodNumber: 1,
                    eventTimestamp: "2026-07-22T23:10:00.000Z",
                    foulImpact: "DisqualificationNoSub",
                    penaltyDurationSeconds: null,
                  },
                ]
              : [],
          ),
        })),
      }));

      await deleteGameEventTx("evt-del-ended");

      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();
      expect(mockSyncQueueDelete).not.toHaveBeenCalledWith(58);

      // 4) Open count is 1 with no permanent DisqualificationNoSub (1 < 2) -> DOES reopen
      mockGameEventsWhere.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      });

      await deleteGameEventTx("evt-del-ended");

      expect(mockSyncQueueDelete).toHaveBeenCalledWith(58);
      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith("pres-11-closed", {
        timeOut: null,
        isSynced: 0,
      });
    });

    it("should close an open presence in the active period when an earlier-period event is edited into a match-wide DQ", async () => {
      const existingPeriod1Event = {
        id: "evt-p1-to-dq",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        periodNumber: 1,
        eventTimestamp: "2026-07-22T12:02:00.000Z",
        isLeadToGoal: false,
        foulImpact: "None" as const,
        penaltyDurationSeconds: null,
        createdAt: "2026-07-22T12:02:00.000Z",
        sequenceNumber: 2,
        isSynced: 0,
      };
      mockGameEventsGet.mockResolvedValueOnce(existingPeriod1Event);
      mockMatchLineupsGet.mockResolvedValue({
        id: "lineup-1",
        matchId: "match-123",
      });

      const dqDef = {
        id: "def-dq-matchwide",
        sportId: "sport-1",
        name: "Red Card",
        shortName: "RC",
        isPositive: false,
        isShot: false,
        foulImpact: "DisqualificationNoSub" as const,
        penaltyDurationSeconds: null,
      };
      mockEventDefinitionsGet.mockResolvedValue(dqDef);
      mockSyncQueueFilter.mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValue([
          {
            id: 19,
            endpoint: "/Matches/match-123/teams/team-456/events",
            payload: JSON.stringify([
              { id: "evt-p1-to-dq", matchLineupId: "lineup-1" },
            ]),
          },
        ]),
      });

      // No open presence in period 1, but player is currently open in period 2
      mockPlayerPresencesWhere.mockImplementation((arg: unknown) => {
        if (typeof arg === "object" && arg !== null && "periodNumber" in arg) {
          return {
            filter: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue(undefined),
            }),
          };
        }
        return {
          equals: vi.fn().mockReturnValue({
            filter: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({
                id: "pres-open-p2",
                matchLineupId: "lineup-1",
                periodNumber: 2,
                timeIn: "2026-07-22T12:10:00.000Z",
                timeOut: null,
              }),
            }),
          }),
        };
      });

      await updateGameEventTx({
        eventId: "evt-p1-to-dq",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-dq-matchwide",
        isLeadToGoal: false,
      });

      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith("pres-open-p2", {
        timeOut: "2026-07-22T12:10:00.000Z",
        isSynced: 0,
      });
    });

    it("should keep player exited when another DQ or maxPersonalFouls remains after event deletion, and revert once fouls drop below limit", async () => {
      const exitTimestamp = "2026-07-22T23:50:41.000Z";
      mockMatchLineupsGet.mockResolvedValue({
        id: "lineup-11",
        matchId: "match-123",
      });
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
        if (arg === "periodNumber") {
          return {
            equals: vi.fn().mockReturnValue({
              filter: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  { id: "open-1", matchLineupId: "l1", timeOut: null },
                  {
                    id: "open-other-match",
                    matchLineupId: "other-match-l",
                    timeOut: null,
                  },
                ]),
              }),
            }),
          };
        }
        return {
          toArray: vi.fn().mockResolvedValue([closedPresence]),
        };
      });
      mockMatchLineupsWhere.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { id: "l1", matchId: "match-123" },
            { id: "lineup-11", matchId: "match-123" },
          ]),
        }),
      });

      // 1) Deleting 1 of 4 fouls leaves 3 fouls (>= maxPersonalFouls 3) + legacy definition lookup -> stays exited
      mockGameEventsGet.mockResolvedValueOnce({
        id: "evt-foul-4",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-pf-legacy",
        periodNumber: 2,
        eventTimestamp: exitTimestamp,
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: null,
        isSynced: 0,
      });
      mockEventDefinitionsGet.mockResolvedValueOnce({
        id: "def-pf-legacy",
        sportId: "sport-1",
        name: "Legacy Foul",
        shortName: "LF",
        isPositive: false,
        isShot: false,
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: null,
      });
      mockGameEventsWhere.mockReturnValueOnce({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              id: "evt-foul-1",
              matchLineupId: "lineup-11",
              eventDefinitionId: "def-pf-legacy",
              // foulImpact omitted -> exercises buildDefinitionsMapForEventsInTx lookup
            },
            {
              id: "evt-foul-2",
              matchLineupId: "lineup-11",
              eventDefinitionId: "def-pf",
              foulImpact: "PersonalFoul",
            },
            {
              id: "evt-foul-3",
              matchLineupId: "lineup-11",
              eventDefinitionId: "def-pf",
              foulImpact: "PersonalFoul",
            },
            {
              id: "evt-foul-4",
              matchLineupId: "lineup-11",
              eventDefinitionId: "def-pf",
              foulImpact: "PersonalFoul",
            },
          ]),
        }),
      });
      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                id: 10,
                actionType: "POST",
                endpoint: "/Matches/match-123/teams/team-456/events",
                payload: JSON.stringify([{ id: "evt-foul-4" }]),
              },
              {
                id: 60,
                actionType: "PUT",
                endpoint: "/Matches/match-123/presence/terminate",
                payload: JSON.stringify({
                  periodNumber: 2,
                  playerLineupIds: ["lineup-11"],
                  timeOut: exitTimestamp,
                }),
                createdAt: exitTimestamp,
              },
            ].filter(predicate),
          ),
        }),
      );

      await deleteGameEventTx("evt-foul-4");
      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();

      // 2) Player still has a direct DQ event -> stays exited
      mockGameEventsGet.mockResolvedValueOnce({
        id: "evt-ex-extra",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-ex",
        periodNumber: 2,
        eventTimestamp: exitTimestamp,
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
        isSynced: 0,
      });
      mockGameEventsWhere.mockReturnValueOnce({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              id: "evt-direct-dq",
              matchLineupId: "lineup-11",
              eventDefinitionId: "def-dq",
              foulImpact: "DisqualificationWithSub",
            },
          ]),
        }),
      });
      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                id: 10,
                actionType: "POST",
                endpoint: "/Matches/match-123/teams/team-456/events",
                payload: JSON.stringify([{ id: "evt-ex-extra" }]),
              },
              {
                id: 60,
                actionType: "PUT",
                endpoint: "/Matches/match-123/presence/terminate",
                payload: JSON.stringify({
                  periodNumber: 2,
                  playerLineupIds: ["lineup-11"],
                  timeOut: exitTimestamp,
                }),
                createdAt: exitTimestamp,
              },
            ].filter(predicate),
          ),
        }),
      );

      await deleteGameEventTx("evt-ex-extra");
      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();

      // 3) Deleting 3rd foul leaves 2 fouls (< 3) -> reverts auto-exit
      mockGameEventsGet.mockResolvedValueOnce({
        id: "evt-foul-3",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-pf",
        periodNumber: 2,
        eventTimestamp: exitTimestamp,
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: null,
        isSynced: 0,
      });
      mockGameEventsWhere.mockReturnValueOnce({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              id: "evt-foul-1",
              matchLineupId: "lineup-11",
              eventDefinitionId: "def-pf",
              foulImpact: "PersonalFoul",
            },
            {
              id: "evt-foul-2",
              matchLineupId: "lineup-11",
              eventDefinitionId: "def-pf",
              foulImpact: "PersonalFoul",
            },
            {
              id: "evt-foul-3",
              matchLineupId: "lineup-11",
              eventDefinitionId: "def-pf",
              foulImpact: "PersonalFoul",
            },
          ]),
        }),
      });
      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                id: 10,
                actionType: "POST",
                endpoint: "/Matches/match-123/teams/team-456/events",
                payload: JSON.stringify([{ id: "evt-foul-3" }]),
              },
              {
                id: 60,
                actionType: "PUT",
                endpoint: "/Matches/match-123/presence/terminate",
                payload: JSON.stringify({
                  periodNumber: 2,
                  playerLineupIds: ["lineup-11"],
                  timeOut: exitTimestamp,
                }),
                createdAt: exitTimestamp,
              },
            ].filter(predicate),
          ),
        }),
      );

      await deleteGameEventTx("evt-foul-3");
      expect(mockSyncQueueDelete).toHaveBeenCalledWith(60);
      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith("pres-11-closed", {
        timeOut: null,
        isSynced: 0,
      });
    });

    it("should skip redundant auto-exit on coordinate-only or isLeadToGoal edit so a re-entered player stays open", async () => {
      const existingExclusion = {
        id: "evt-coord-only",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-ex",
        periodNumber: 2,
        eventTimestamp: "2026-07-22T23:40:00.000Z",
        isLeadToGoal: false,
        locationX: 10,
        locationY: 20,
        foulImpact: "PersonalFoul" as const,
        penaltyDurationSeconds: 20,
        createdAt: "2026-07-22T23:40:00.000Z",
        sequenceNumber: 10,
        isSynced: 0,
      };
      mockGameEventsGet.mockResolvedValueOnce(existingExclusion);
      mockMatchLineupsGet.mockResolvedValue({
        id: "lineup-11",
        matchId: "match-123",
      });
      mockPlayerPresencesWhere.mockReturnValue({
        filter: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "pres-reentered",
            matchLineupId: "lineup-11",
            periodNumber: 2,
            timeIn: "2026-07-22T23:41:00.000Z",
            timeOut: null,
          }),
        }),
      });
      mockSyncQueueFilter.mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValue([
          {
            id: 10,
            actionType: "POST",
            endpoint: "/Matches/match-123/teams/team-456/events",
            payload: JSON.stringify([
              { id: "evt-coord-only", matchLineupId: "lineup-11" },
            ]),
          },
        ]),
      });

      await updateGameEventTx({
        eventId: "evt-coord-only",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-ex",
        isLeadToGoal: true,
        locationX: 55,
        locationY: 65,
      });

      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();
      expect(db.syncQueue.add).not.toHaveBeenCalled();
    });

    it("should fall back to eventdefinitions lookup when reassigning a legacy event without disciplinary snapshot", async () => {
      const exitTimestamp = "2026-07-22T23:50:41.000Z";
      const legacyEvent = {
        id: "evt-legacy-reassign",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-legacy-ex",
        periodNumber: 2,
        eventTimestamp: exitTimestamp,
        isLeadToGoal: false,
        createdAt: exitTimestamp,
        sequenceNumber: 10,
        isSynced: 0,
      };
      mockGameEventsGet.mockResolvedValueOnce(legacyEvent);
      mockMatchLineupsGet.mockImplementation((id: string) =>
        Promise.resolve({ id, matchId: "match-123" }),
      );
      mockEventDefinitionsGet.mockResolvedValue({
        id: "def-legacy-ex",
        sportId: "sport-1",
        name: "Legacy Exclusion",
        shortName: "EX",
        isPositive: false,
        isShot: false,
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
      });
      mockPlayerPresencesWhere.mockImplementation((arg: unknown) => {
        if (
          typeof arg === "object" &&
          arg !== null &&
          "matchLineupId" in arg &&
          (arg as { matchLineupId: string }).matchLineupId === "lineup-8"
        ) {
          return {
            filter: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({
                id: "pres-8-open",
                matchLineupId: "lineup-8",
                periodNumber: 2,
                timeIn: "2026-07-22T23:35:00.000Z",
                timeOut: null,
              }),
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
        (predicate: (item: { endpoint: string }) => boolean) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                id: 10,
                actionType: "POST",
                endpoint: "/Matches/match-123/teams/team-456/events",
                payload: JSON.stringify([
                  { id: "evt-legacy-reassign", matchLineupId: "lineup-11" },
                ]),
              },
            ].filter(predicate),
          ),
        }),
      );

      await updateGameEventTx({
        eventId: "evt-legacy-reassign",
        matchLineupId: "lineup-8",
        eventDefinitionId: "def-legacy-ex",
        isLeadToGoal: false,
      });

      expect(mockEventDefinitionsGet).toHaveBeenCalledWith("def-legacy-ex");
      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith("pres-8-open", {
        timeOut: exitTimestamp,
        isSynced: 0,
      });
    });

    it("should NOT revert an exclusion when deleting a non-disciplinary event", async () => {
      const sameTimestamp = "2026-07-22T23:50:41.000Z";
      mockGameEventsGet.mockResolvedValueOnce({
        id: "evt-del-pass",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-2",
        periodNumber: 2,
        eventTimestamp: sameTimestamp,
        foulImpact: "None",
        penaltyDurationSeconds: null,
        isSynced: 0,
      });
      mockMatchLineupsGet.mockResolvedValueOnce({
        id: "lineup-11",
        matchId: "match-123",
      });
      mockPlayerPresencesWhere.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "pres-11-closed",
            matchLineupId: "lineup-11",
            periodNumber: 2,
            timeIn: "2026-07-22T23:35:00.000Z",
            timeOut: sameTimestamp,
            sequenceNumber: 2,
            isSynced: 0,
          },
        ]),
      });
      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                id: 10,
                actionType: "POST",
                endpoint: "/Matches/match-123/teams/team-456/events",
                payload: JSON.stringify([{ id: "evt-del-pass" }]),
              },
              {
                id: 61,
                actionType: "PUT",
                endpoint: "/Matches/match-123/presence/terminate",
                payload: JSON.stringify({
                  periodNumber: 2,
                  playerLineupIds: ["lineup-11"],
                  timeOut: sameTimestamp,
                }),
                createdAt: sameTimestamp,
              },
            ].filter(predicate),
          ),
        }),
      );

      await deleteGameEventTx("evt-del-pass");

      expect(mockSyncQueueDelete).not.toHaveBeenCalledWith(61);
      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();
    });

    it("should revert cross-period foul-limit exit when an earlier-period foul is deleted and exact foul-out timestamp matches, but NOT revert an unlinked clamped earlier-period DQ exit", async () => {
      const p1EventTime = "2026-07-22T12:02:00.000Z";
      const p2TimeIn = "2026-07-22T12:10:00.000Z";
      const p2FoulOutTime = "2026-07-22T12:14:00.000Z";

      mockMatchLineupsGet.mockResolvedValue({
        id: "lineup-11",
        matchId: "match-123",
      });
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

      // Period 1 has ended; Period 2 is still active
      const anchors = [
        {
          id: "anchor-end-1",
          matchId: "match-123",
          periodNumber: 1,
          type: 1,
          timestamp: "2026-07-22T12:08:00.000Z",
          sequenceNumber: 10,
          isSynced: 1,
        },
      ];
      mockTimeAnchorsWhere.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi.fn((predicate: (a: (typeof anchors)[0]) => boolean) => ({
            first: vi.fn().mockResolvedValue(anchors.find(predicate)),
          })),
        }),
      });

      const p1Closed = {
        id: "pres-p1-closed",
        matchLineupId: "lineup-11",
        periodNumber: 1,
        timeIn: "2026-07-22T12:00:00.000Z",
        timeOut: "2026-07-22T12:08:00.000Z",
        sequenceNumber: 1,
        isSynced: 1,
      };

      // 1) Cross-period foul-limit reversal: deleting Period 1 foul #1 drops fouls 3 -> 2 and matches exact Period 2 foul #3 exit (12:14)
      const p2FoulOutClosed = {
        id: "pres-p2-foulout",
        matchLineupId: "lineup-11",
        periodNumber: 2,
        timeIn: p2TimeIn,
        timeOut: p2FoulOutTime,
        sequenceNumber: 15,
        isSynced: 0,
      };
      const p1Foul = {
        id: "evt-p1-foul-1",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-pf",
        periodNumber: 1,
        eventTimestamp: p1EventTime,
        foulImpact: "PersonalFoul" as const,
        penaltyDurationSeconds: null,
        isSynced: 0,
      };
      mockGameEventsGet.mockResolvedValueOnce(p1Foul);
      mockGameEventsWhere.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            p1Foul,
            {
              id: "evt-p2-foul-2",
              matchLineupId: "lineup-11",
              eventDefinitionId: "def-pf",
              periodNumber: 2,
              eventTimestamp: "2026-07-22T12:11:00.000Z",
              foulImpact: "PersonalFoul",
              penaltyDurationSeconds: null,
            },
            {
              id: "evt-p2-foul-3",
              matchLineupId: "lineup-11",
              eventDefinitionId: "def-pf",
              periodNumber: 2,
              eventTimestamp: p2FoulOutTime,
              foulImpact: "PersonalFoul",
              penaltyDurationSeconds: null,
            },
          ]),
        }),
      });
      mockPlayerPresencesWhere.mockImplementation((arg: unknown) => {
        if (arg === "periodNumber") {
          return {
            equals: vi.fn().mockReturnValue({
              filter: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  { id: "open-1", matchLineupId: "l1", timeOut: null },
                ]),
              }),
            }),
          };
        }
        if (arg === "matchLineupId") {
          return {
            equals: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([p1Closed, p2FoulOutClosed]),
            }),
          };
        }
        return {
          toArray: vi.fn().mockResolvedValue([p2FoulOutClosed]),
        };
      });
      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                id: 10,
                actionType: "POST",
                endpoint: "/Matches/match-123/teams/team-456/events",
                payload: JSON.stringify([{ id: "evt-p1-foul-1" }]),
              },
              {
                id: 62,
                actionType: "PUT",
                endpoint: "/Matches/match-123/presence/terminate",
                payload: JSON.stringify({
                  periodNumber: 2,
                  playerLineupIds: ["lineup-11"],
                  timeOut: p2FoulOutTime,
                }),
                createdAt: p2FoulOutTime,
              },
            ].filter(predicate),
          ),
        }),
      );

      await deleteGameEventTx("evt-p1-foul-1");

      expect(mockSyncQueueDelete).toHaveBeenCalledWith(62);
      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith(
        "pres-p2-foulout",
        {
          timeOut: null,
          isSynced: 0,
        },
      );

      // 2) Ambiguous clamped-exit sequence:
      //    - Period-2 timed exclusion (12:05) closed Period-2 presence at clamped timeIn (12:10).
      //    - Period-1 event (12:02) was edited into DQ while player was already off the field (no exit created).
      //    - Period-2 timed exclusion (12:05) was deleted while DQ remained -> DQ guard kept the 12:10 exit queued.
      //    - Deleting the Period-1 DQ (12:02) must NOT reopen the clamped 12:10 presence or delete queue item 66.
      mockSyncQueueDelete.mockClear();
      mockPlayerPresencesUpdate.mockClear();

      const p2ClampedClosed = {
        id: "pres-p2-clamped",
        matchLineupId: "lineup-11",
        periodNumber: 2,
        timeIn: p2TimeIn,
        timeOut: p2TimeIn,
        sequenceNumber: 15,
        isSynced: 0,
      };
      const p2TimedEx = {
        id: "evt-p2-ex-clamped",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-ex",
        periodNumber: 2,
        eventTimestamp: "2026-07-22T12:05:00.000Z",
        foulImpact: "None" as const,
        penaltyDurationSeconds: 20,
        isSynced: 0,
      };
      const p1Dq = {
        id: "evt-p1-dq-unlinked",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-dq",
        periodNumber: 1,
        eventTimestamp: p1EventTime,
        foulImpact: "DisqualificationNoSub" as const,
        penaltyDurationSeconds: null,
        isSynced: 0,
      };

      mockPlayerPresencesWhere.mockImplementation((arg: unknown) => {
        if (arg === "periodNumber") {
          return {
            equals: vi.fn().mockReturnValue({
              filter: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  { id: "open-1", matchLineupId: "l1", timeOut: null },
                ]),
              }),
            }),
          };
        }
        if (arg === "matchLineupId") {
          return {
            equals: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([p1Closed, p2ClampedClosed]),
            }),
          };
        }
        return {
          toArray: vi.fn().mockResolvedValue([p2ClampedClosed]),
        };
      });

      // Step 3: Delete Period-2 timed exclusion while Period-1 DQ remains -> stays exited
      mockGameEventsGet.mockResolvedValueOnce(p2TimedEx);
      mockGameEventsWhere.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([p2TimedEx, p1Dq]),
        }),
      });
      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                id: 20,
                actionType: "POST",
                endpoint: "/Matches/match-123/teams/team-456/events",
                payload: JSON.stringify([{ id: "evt-p2-ex-clamped" }]),
              },
              {
                id: 66,
                actionType: "PUT",
                endpoint: "/Matches/match-123/presence/terminate",
                payload: JSON.stringify({
                  periodNumber: 2,
                  playerLineupIds: ["lineup-11"],
                  timeOut: p2TimeIn,
                }),
                createdAt: p2TimeIn,
              },
            ].filter(predicate),
          ),
        }),
      );

      await deleteGameEventTx("evt-p2-ex-clamped");
      expect(mockSyncQueueDelete).not.toHaveBeenCalledWith(66);
      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();

      // Step 4: Delete Period-1 DQ (12:02) -> clamped exit at 12:10 cannot be unambiguously linked -> stays exited
      mockGameEventsGet.mockResolvedValueOnce(p1Dq);
      mockGameEventsWhere.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([p1Dq]),
        }),
      });
      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                id: 21,
                actionType: "POST",
                endpoint: "/Matches/match-123/teams/team-456/events",
                payload: JSON.stringify([{ id: "evt-p1-dq-unlinked" }]),
              },
              {
                id: 66,
                actionType: "PUT",
                endpoint: "/Matches/match-123/presence/terminate",
                payload: JSON.stringify({
                  periodNumber: 2,
                  playerLineupIds: ["lineup-11"],
                  timeOut: p2TimeIn,
                }),
                createdAt: p2TimeIn,
              },
            ].filter(predicate),
          ),
        }),
      );

      await deleteGameEventTx("evt-p1-dq-unlinked");
      expect(mockSyncQueueDelete).not.toHaveBeenCalledWith(66);
      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();
    });

    it("should document the clamped cross-period DQ tradeoff: creating a Period-1 DQ closes an open Period-2 presence at clamped timeIn, and deleting that DQ intentionally leaves the clamped exit closed", async () => {
      const p1DqTime = "2026-07-22T12:02:00.000Z";
      const p2TimeIn = "2026-07-22T12:10:00.000Z";

      mockEventDefinitionsGet.mockResolvedValue({
        id: "def-dq-cross",
        sportId: "sport-1",
        name: "Red Card",
        shortName: "RC",
        isPositive: false,
        isShot: false,
        foulImpact: "DisqualificationNoSub",
        penaltyDurationSeconds: null,
      });
      mockMatchLineupsGet.mockResolvedValue({
        id: "lineup-11",
        matchId: "match-123",
      });
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

      const p2Presence: {
        id: string;
        matchLineupId: string;
        periodNumber: number;
        timeIn: string;
        timeOut: string | null;
        sequenceNumber: number;
        isSynced: number;
      } = {
        id: "pres-p2-open",
        matchLineupId: "lineup-11",
        periodNumber: 2,
        timeIn: p2TimeIn,
        timeOut: null,
        sequenceNumber: 15,
        isSynced: 0,
      };

      mockPlayerPresencesUpdate.mockImplementation(
        (_id: string, patch: { timeOut?: string | null }) => {
          if (patch.timeOut !== undefined) {
            p2Presence.timeOut = patch.timeOut;
          }
          return Promise.resolve(1);
        },
      );

      mockPlayerPresencesWhere.mockImplementation((arg: unknown) => {
        if (arg === "periodNumber") {
          return {
            equals: vi.fn().mockReturnValue({
              filter: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  { id: "open-1", matchLineupId: "l1", timeOut: null },
                ]),
              }),
            }),
          };
        }
        if (arg === "matchLineupId") {
          return {
            equals: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([p2Presence]),
              filter: vi.fn(
                (predicate: (p: typeof p2Presence) => boolean) => ({
                  first: vi
                    .fn()
                    .mockResolvedValue([p2Presence].find(predicate)),
                }),
              ),
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

      // Step 1: Create Period-1 DQ while player is open in Period 2 -> closes Period-2 presence at clamped timeIn (12:10)
      const createdDq = await createGameEventTx({
        matchId: "match-123",
        teamId: "team-456",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-dq-cross",
        periodNumber: 1,
        eventTimestamp: p1DqTime,
        isLeadToGoal: false,
      });

      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith("pres-p2-open", {
        timeOut: p2TimeIn,
        isSynced: 0,
      });
      expect(p2Presence.timeOut).toBe(p2TimeIn);

      // Step 2: Delete that Period-1 DQ -> clamped exit (12:10 != 12:02) is intentionally NOT auto-reverted
      mockPlayerPresencesUpdate.mockClear();
      mockGameEventsGet.mockResolvedValueOnce(createdDq);
      mockGameEventsWhere.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([createdDq]),
        }),
      });
      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                id: 30,
                actionType: "POST",
                endpoint: "/Matches/match-123/teams/team-456/events",
                payload: JSON.stringify([{ id: createdDq.id }]),
              },
              {
                id: 67,
                actionType: "PUT",
                endpoint: "/Matches/match-123/presence/terminate",
                payload: JSON.stringify({
                  periodNumber: 2,
                  playerLineupIds: ["lineup-11"],
                  timeOut: p2TimeIn,
                }),
                createdAt: p2TimeIn,
              },
            ].filter(predicate),
          ),
        }),
      );

      await deleteGameEventTx(createdDq.id);

      expect(mockSyncQueueDelete).toHaveBeenCalledWith(30);
      expect(mockSyncQueueDelete).not.toHaveBeenCalledWith(67);
      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();
      expect(p2Presence.timeOut).toBe(p2TimeIn);
    });

    it("should reconcile earlier-period foul edited into a served timed exclusion and preserve a still-active same-period exclusion", async () => {
      const p1FoulTime = "2026-07-22T12:02:00.000Z";
      const p2FoulOutTime = "2026-07-22T12:14:00.000Z";

      mockMatchLineupsGet.mockResolvedValue({
        id: "lineup-11",
        matchId: "match-123",
      });
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

      // Period 1 has ended; Period 2 is active
      const anchors = [
        {
          id: "anchor-end-1",
          matchId: "match-123",
          periodNumber: 1,
          type: 1,
          timestamp: "2026-07-22T12:08:00.000Z",
          sequenceNumber: 10,
          isSynced: 1,
        },
      ];
      mockTimeAnchorsWhere.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi.fn((predicate: (a: (typeof anchors)[0]) => boolean) => ({
            first: vi.fn().mockResolvedValue(anchors.find(predicate)),
          })),
        }),
      });

      const timedExNoPersonalFoulDef = {
        id: "def-timed-ex-only",
        sportId: "sport-1",
        name: "Technical Exclusion",
        shortName: "TE",
        isPositive: false,
        isShot: false,
        foulImpact: "None" as const,
        penaltyDurationSeconds: 20,
      };
      mockEventDefinitionsGet.mockResolvedValue(timedExNoPersonalFoulDef);

      const p1FoulEvent = {
        id: "evt-p1-foul-1",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-pf",
        periodNumber: 1,
        eventTimestamp: p1FoulTime,
        isLeadToGoal: false,
        foulImpact: "PersonalFoul" as const,
        penaltyDurationSeconds: null,
        createdAt: p1FoulTime,
        sequenceNumber: 2,
        isSynced: 0,
      };
      mockGameEventsGet.mockResolvedValueOnce(p1FoulEvent);

      mockGameEventsWhere.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            p1FoulEvent,
            {
              id: "evt-p2-foul-2",
              matchLineupId: "lineup-11",
              eventDefinitionId: "def-pf",
              periodNumber: 2,
              eventTimestamp: "2026-07-22T12:11:00.000Z",
              foulImpact: "PersonalFoul",
              penaltyDurationSeconds: null,
            },
            {
              id: "evt-p2-foul-3",
              matchLineupId: "lineup-11",
              eventDefinitionId: "def-pf",
              periodNumber: 2,
              eventTimestamp: p2FoulOutTime,
              foulImpact: "PersonalFoul",
              penaltyDurationSeconds: null,
            },
          ]),
        }),
      });

      const p1Closed = {
        id: "pres-p1-closed",
        matchLineupId: "lineup-11",
        periodNumber: 1,
        timeIn: "2026-07-22T12:00:00.000Z",
        timeOut: "2026-07-22T12:08:00.000Z",
        sequenceNumber: 1,
        isSynced: 1,
      };
      const p2Closed = {
        id: "pres-p2-foulout",
        matchLineupId: "lineup-11",
        periodNumber: 2,
        timeIn: "2026-07-22T12:10:00.000Z",
        timeOut: p2FoulOutTime,
        sequenceNumber: 15,
        isSynced: 0,
      };

      mockPlayerPresencesWhere.mockImplementation((arg: unknown) => {
        if (arg === "periodNumber") {
          return {
            equals: vi.fn().mockReturnValue({
              filter: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  { id: "open-1", matchLineupId: "l1", timeOut: null },
                ]),
              }),
            }),
          };
        }
        if (arg === "matchLineupId") {
          return {
            equals: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([p1Closed, p2Closed]),
            }),
          };
        }
        return {
          toArray: vi.fn().mockResolvedValue([p2Closed]),
          filter: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(undefined),
          }),
        };
      });

      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                id: 10,
                actionType: "POST",
                endpoint: "/Matches/match-123/teams/team-456/events",
                payload: JSON.stringify([
                  { id: "evt-p1-foul-1", matchLineupId: "lineup-11" },
                ]),
              },
              {
                id: 63,
                actionType: "PUT",
                endpoint: "/Matches/match-123/presence/terminate",
                payload: JSON.stringify({
                  periodNumber: 2,
                  playerLineupIds: ["lineup-11"],
                  timeOut: p2FoulOutTime,
                }),
                createdAt: p2FoulOutTime,
              },
            ].filter(predicate),
          ),
        }),
      );

      // 1) Editing Period 1 foul into a served Period 1 timed exclusion drops foul count 3 -> 2 and reverts Period 2 foul-out
      await updateGameEventTx({
        eventId: "evt-p1-foul-1",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-timed-ex-only",
        isLeadToGoal: false,
      });

      expect(mockSyncQueueDelete).toHaveBeenCalledWith(63);
      expect(mockPlayerPresencesUpdate).toHaveBeenCalledWith(
        "pres-p2-foulout",
        {
          timeOut: null,
          isSynced: 0,
        },
      );

      // 2) Editing a Period 2 timed exclusion into another Period 2 timed exclusion preserves the Period 2 exit
      mockSyncQueueDelete.mockClear();
      mockPlayerPresencesUpdate.mockClear();

      const p2ExclusionEvent = {
        id: "evt-p2-ex",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-ex-20",
        periodNumber: 2,
        eventTimestamp: p2FoulOutTime,
        isLeadToGoal: false,
        foulImpact: "PersonalFoul" as const,
        penaltyDurationSeconds: 20,
        createdAt: p2FoulOutTime,
        sequenceNumber: 16,
        isSynced: 0,
      };
      mockGameEventsGet.mockResolvedValueOnce(p2ExclusionEvent);
      mockGameEventsWhere.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([p2ExclusionEvent]),
        }),
      });
      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                id: 11,
                actionType: "POST",
                endpoint: "/Matches/match-123/teams/team-456/events",
                payload: JSON.stringify([
                  { id: "evt-p2-ex", matchLineupId: "lineup-11" },
                ]),
              },
              {
                id: 64,
                actionType: "PUT",
                endpoint: "/Matches/match-123/presence/terminate",
                payload: JSON.stringify({
                  periodNumber: 2,
                  playerLineupIds: ["lineup-11"],
                  timeOut: p2FoulOutTime,
                }),
                createdAt: p2FoulOutTime,
              },
            ].filter(predicate),
          ),
        }),
      );

      await updateGameEventTx({
        eventId: "evt-p2-ex",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-timed-ex-only",
        isLeadToGoal: false,
      });

      expect(mockSyncQueueDelete).not.toHaveBeenCalledWith(64);
      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();
    });

    it("should NOT revert a clamped timed-exclusion exit when deleting an unrelated personal foul or ambiguous earlier event", async () => {
      const clampedExitTime = "2026-07-22T12:04:00.000Z";
      const earlierTimedExTime = "2026-07-22T12:01:00.000Z";
      const personalFoulTime = "2026-07-22T12:02:00.000Z";

      mockMatchLineupsGet.mockResolvedValue({
        id: "lineup-11",
        matchId: "match-123",
      });
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

      // Player re-entered at 12:04; an earlier event at 12:01 was edited into a timed exclusion -> exit clamped to 12:04
      const clampedPresence = {
        id: "pres-clamped-1204",
        matchLineupId: "lineup-11",
        periodNumber: 2,
        timeIn: clampedExitTime,
        timeOut: clampedExitTime,
        sequenceNumber: 12,
        isSynced: 0,
      };

      mockPlayerPresencesWhere.mockImplementation((arg: unknown) => {
        if (arg === "periodNumber") {
          return {
            equals: vi.fn().mockReturnValue({
              filter: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  { id: "open-1", matchLineupId: "l1", timeOut: null },
                ]),
              }),
            }),
          };
        }
        if (arg === "matchLineupId") {
          return {
            equals: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([clampedPresence]),
            }),
          };
        }
        return {
          toArray: vi.fn().mockResolvedValue([clampedPresence]),
        };
      });

      const earlierTimedExEvent = {
        id: "evt-earlier-ex-1201",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-ex",
        periodNumber: 2,
        eventTimestamp: earlierTimedExTime,
        foulImpact: "None" as const,
        penaltyDurationSeconds: 20,
        isSynced: 0,
      };

      // Case A: Personal foul at 12:02 (below foul limit) deleted while 12:01 timed exclusion clamped exit to 12:04
      const belowLimitFoul = {
        id: "evt-pf-1202",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-pf",
        periodNumber: 2,
        eventTimestamp: personalFoulTime,
        foulImpact: "PersonalFoul" as const,
        penaltyDurationSeconds: null,
        isSynced: 0,
      };
      mockGameEventsGet.mockResolvedValueOnce(belowLimitFoul);
      mockGameEventsWhere.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            earlierTimedExEvent,
            belowLimitFoul,
          ]),
        }),
      });
      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                id: 10,
                actionType: "POST",
                endpoint: "/Matches/match-123/teams/team-456/events",
                payload: JSON.stringify([{ id: "evt-pf-1202" }]),
              },
              {
                id: 65,
                actionType: "PUT",
                endpoint: "/Matches/match-123/presence/terminate",
                payload: JSON.stringify({
                  periodNumber: 2,
                  playerLineupIds: ["lineup-11"],
                  timeOut: clampedExitTime,
                }),
                createdAt: clampedExitTime,
              },
            ].filter(predicate),
          ),
        }),
      );

      await deleteGameEventTx("evt-pf-1202");

      expect(mockSyncQueueDelete).not.toHaveBeenCalledWith(65);
      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();

      // Case B: Even when deleting a 3rd foul (dropping 3 -> 2), the clamped 12:01 timed exclusion blocks ambiguous reversal
      const p1Foul = {
        id: "evt-p1-foul-del",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-pf",
        periodNumber: 1,
        eventTimestamp: "2026-07-22T11:55:00.000Z",
        foulImpact: "PersonalFoul" as const,
        penaltyDurationSeconds: null,
        isSynced: 0,
      };
      mockGameEventsGet.mockResolvedValueOnce(p1Foul);
      mockGameEventsWhere.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            p1Foul,
            earlierTimedExEvent,
            {
              id: "evt-pf-2",
              matchLineupId: "lineup-11",
              eventDefinitionId: "def-pf",
              periodNumber: 2,
              eventTimestamp: personalFoulTime,
              foulImpact: "PersonalFoul",
              penaltyDurationSeconds: null,
            },
            {
              id: "evt-pf-3",
              matchLineupId: "lineup-11",
              eventDefinitionId: "def-pf",
              periodNumber: 2,
              eventTimestamp: "2026-07-22T12:03:00.000Z",
              foulImpact: "PersonalFoul",
              penaltyDurationSeconds: null,
            },
          ]),
        }),
      });
      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                id: 11,
                actionType: "POST",
                endpoint: "/Matches/match-123/teams/team-456/events",
                payload: JSON.stringify([{ id: "evt-p1-foul-del" }]),
              },
              {
                id: 65,
                actionType: "PUT",
                endpoint: "/Matches/match-123/presence/terminate",
                payload: JSON.stringify({
                  periodNumber: 2,
                  playerLineupIds: ["lineup-11"],
                  timeOut: clampedExitTime,
                }),
                createdAt: clampedExitTime,
              },
            ].filter(predicate),
          ),
        }),
      );

      await deleteGameEventTx("evt-p1-foul-del");

      expect(mockSyncQueueDelete).not.toHaveBeenCalledWith(65);
      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();

      // Case C: Even when deleting a timed exclusion at 12:02 (clamped to 12:04), the remaining 12:01 timed exclusion makes reversal ambiguous -> rejected
      const secondTimedEx = {
        id: "evt-ex-1202",
        matchLineupId: "lineup-11",
        eventDefinitionId: "def-ex",
        periodNumber: 2,
        eventTimestamp: personalFoulTime,
        foulImpact: "None" as const,
        penaltyDurationSeconds: 20,
        isSynced: 0,
      };
      mockGameEventsGet.mockResolvedValueOnce(secondTimedEx);
      mockGameEventsWhere.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            earlierTimedExEvent,
            secondTimedEx,
          ]),
        }),
      });
      mockSyncQueueFilter.mockImplementation(
        (predicate: (item: { endpoint: string }) => boolean) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                id: 12,
                actionType: "POST",
                endpoint: "/Matches/match-123/teams/team-456/events",
                payload: JSON.stringify([{ id: "evt-ex-1202" }]),
              },
              {
                id: 65,
                actionType: "PUT",
                endpoint: "/Matches/match-123/presence/terminate",
                payload: JSON.stringify({
                  periodNumber: 2,
                  playerLineupIds: ["lineup-11"],
                  timeOut: clampedExitTime,
                }),
                createdAt: clampedExitTime,
              },
            ].filter(predicate),
          ),
        }),
      );

      await deleteGameEventTx("evt-ex-1202");

      expect(mockSyncQueueDelete).not.toHaveBeenCalledWith(65);
      expect(mockPlayerPresencesUpdate).not.toHaveBeenCalled();
    });
  });
});
