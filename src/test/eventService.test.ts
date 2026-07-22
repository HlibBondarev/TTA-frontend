import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../db/ttaDatabase";
import {
  loadEventDefinitionsCache,
  clearEventDefinitionsCache,
  getEventDefinitionByName,
  createGameEventTx,
} from "../db/eventService";

vi.mock("../db/ttaDatabase", () => ({
  db: {
    eventdefinitions: {
      toArray: vi.fn(),
    },
    gameevents: {
      add: vi.fn(),
    },
    transaction: vi.fn((_mode, _tables, cb) => cb()),
  },
}));

describe("Event Database Service (eventService)", () => {
  const mockDefinitions = [
    {
      id: "def-1",
      sportid: "sport-1",
      name: "Goal",
      shortname: "GL",
      ispositive: true,
      createdat: "2026-07-22T10:00:00.000Z",
    },
    {
      id: "def-2",
      sportid: "sport-1",
      name: "Pass",
      shortname: "PS",
      ispositive: true,
      createdat: "2026-07-22T10:00:00.000Z",
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

    // Second load should use cache and not hit DB again
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

  it("should create and persist a GameEvent entity atomically", async () => {
    const params = {
      matchlineupid: "lineup-1",
      eventdefinitionid: "def-1",
      periodnumber: 1,
      eventtimestamp: "2026-07-22T12:00:00.000Z",
      isleadtogoal: true,
      sequenceNumber: 5,
    };

    const createdEvent = await createGameEventTx(params);

    expect(createdEvent).toEqual({
      id: expect.any(String),
      matchlineupid: "lineup-1",
      eventdefinitionid: "def-1",
      periodnumber: 1,
      eventtimestamp: "2026-07-22T12:00:00.000Z",
      isleadtogoal: true,
      createdat: expect.any(String),
      sequenceNumber: 5,
      isSynced: 0,
    });

    expect(db.transaction).toHaveBeenCalledWith(
      "rw",
      [db.gameevents],
      expect.any(Function),
    );
    expect(db.gameevents.add).toHaveBeenCalledWith(createdEvent);
  });
});
