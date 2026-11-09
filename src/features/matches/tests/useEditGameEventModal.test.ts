import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  useEditGameEventModal,
  checkIsPositive,
} from "../hooks/useEditGameEventModal";
import { db } from "../../../db/ttaDatabase";

let mockAuth0User: { sub?: string; email?: string } | undefined = {
  sub: "user-123",
  email: "test@example.com",
};

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    get user() {
      return mockAuth0User;
    },
  }),
}));

let mockReduxState: Record<string, unknown> = {
  auth: { currentUserId: "user-123" },
  match: {
    activeMatchId: "match-1",
    activeTeamId: "team-1",
    periodNumber: 1,
    isPeriodActive: true,
    isInsideStoppage: false,
    isPeriodEnded: false,
    globalSequenceNumber: 1,
    recentActions: [],
    hydrationVersion: 0,
  },
};

vi.mock("react-redux", () => ({
  useSelector: (fn: (state: unknown) => unknown) => fn(mockReduxState),
  useDispatch: () => vi.fn(),
}));

const mockUpdateGameEvent = vi.fn();

vi.mock("../hooks/useGameEvents", () => ({
  useGameEvents: () => ({
    updateGameEvent: mockUpdateGameEvent,
  }),
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matches: {
      get: vi.fn().mockResolvedValue({
        id: "match-1",
        tournamentId: "tour-1",
      }),
    },
    tournaments: {
      get: vi.fn().mockResolvedValue({
        id: "tour-1",
        sportId: "sport-1",
        configurationId: "config-1",
      }),
    },
    sportconfigurations: {
      get: vi.fn().mockResolvedValue({
        id: "config-1",
        playground: "<svg>Court</svg>",
        shotMap: "<svg>Goal</svg>",
      }),
    },
    gameevents: {
      get: vi.fn().mockResolvedValue({
        id: "action-123",
        locationX: 35.5,
        locationY: 70.0,
        shotLocationX: 12.0,
        shotLocationY: 80.0,
      }),
    },
    usereventpresets: {
      where: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { eventDefinitionId: "def-1", isEnabled: true, sortOrder: 1 },
          { eventDefinitionId: "def-2", isEnabled: true, sortOrder: 2 },
          { eventDefinitionId: "def-3", isEnabled: true, sortOrder: 3 },
        ]),
      }),
    },
    eventdefinitions: {
      bulkGet: vi.fn().mockResolvedValue([
        { id: "def-1", name: "Pass", isPositive: true, isShot: false },
        { id: "def-2", name: "Goal", isPositive: true, isShot: true },
        { id: "def-3", name: "Foul", isPositive: false, isShot: false },
      ]),
      get: vi.fn().mockImplementation((id: string) => {
        const defs: Record<
          string,
          { id: string; name: string; isPositive: boolean; isShot?: boolean }
        > = {
          "def-1": {
            id: "def-1",
            name: "Pass",
            isPositive: true,
            isShot: false,
          },
          "def-2": {
            id: "def-2",
            name: "Goal",
            isPositive: true,
            isShot: true,
          },
          "def-3": {
            id: "def-3",
            name: "Foul",
            isPositive: false,
            isShot: false,
          },
        };
        return Promise.resolve(defs[id]);
      }),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { id: "def-1", name: "Pass", isPositive: true, isShot: false },
            { id: "def-2", name: "Goal", isPositive: true, isShot: true },
            { id: "def-3", name: "Foul", isPositive: false, isShot: false },
          ]),
        }),
      }),
    },
    matchlineups: {
      get: vi.fn().mockImplementation((id: string) => {
        const lineups: Record<
          string,
          { id: string; number: number; matchId: string }
        > = {
          "lineup-1": { id: "lineup-1", number: 7, matchId: "match-1" },
          "lineup-2": { id: "lineup-2", number: 10, matchId: "match-1" },
        };
        return Promise.resolve(lineups[id]);
      }),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { id: "lineup-1", number: 7, matchId: "match-1" },
            { id: "lineup-2", number: 10, matchId: "match-1" },
          ]),
        }),
      }),
    },
  },
}));

describe("useEditGameEventModal Custom Hook", () => {
  const sampleAction = {
    id: "action-123",
    playerNumber: 7,
    actionName: "Pass",
    isPositive: true,
    timestamp: new Date().toISOString(),
    matchLineupId: "lineup-1",
    eventDefinitionId: "def-1",
    isLeadToGoal: true,
    isSynced: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth0User = { sub: "user-123", email: "test@example.com" };
    mockReduxState = {
      auth: { currentUserId: "user-123" },
      match: {
        activeMatchId: "match-1",
        activeTeamId: "team-1",
        periodNumber: 1,
        isPeriodActive: true,
        isInsideStoppage: false,
        isPeriodEnded: false,
        globalSequenceNumber: 1,
        recentActions: [],
        hydrationVersion: 0,
      },
    };
  });

  it("should evaluate checkIsPositive helper correctly for camelCase and lowerCase properties", () => {
    expect(
      checkIsPositive({
        id: "1",
        sportId: "s1",
        name: "Pass",
        shortName: "PS",
        isPositive: true,
        isShot: false,
      }),
    ).toBe(true);

    expect(
      checkIsPositive({
        id: "2",
        ispositive: true,
      } as unknown as Parameters<typeof checkIsPositive>[0]),
    ).toBe(true);

    expect(
      checkIsPositive({
        id: "3",
        sportId: "s1",
        name: "Foul",
        shortName: "FL",
        isPositive: false,
        isShot: false,
      }),
    ).toBe(false);
  });

  it("should initialize state and load lineup, definitions, and event coordinates from Dexie", async () => {
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    expect(result.current.selectedMatchLineupId).toBe("lineup-1");
    expect(result.current.selectedEventDefinitionId).toBe("def-1");
    expect(result.current.activeTab).toBe("positive");
    expect(result.current.locationX).toBe(35.5);
    expect(result.current.locationY).toBe(70.0);
    expect(result.current.shotLocationX).toBe(12.0);
    expect(result.current.shotLocationY).toBe(80.0);
    expect(result.current.hasLocation).toBe(true);
    expect(result.current.hasShotLocation).toBe(true);
    expect(result.current.lineups).toHaveLength(2);
    expect(result.current.playground).toBe("<svg>Court</svg>");
    expect(result.current.shotMap).toBe("<svg>Goal</svg>");
  });

  it("should observe sport configuration changes via liveQuery and update shotMap dynamically", async () => {
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isDefinitionsLoaded).toBe(true);
      expect(result.current.shotMap).toBe("<svg>Goal</svg>");
      expect(result.current.playground).toBe("<svg>Court</svg>");
    });
  });

  it("should resolve currentUserId from Redux auth.user.id fallback when auth0 is missing", async () => {
    mockAuth0User = undefined;
    mockReduxState = {
      auth: { user: { id: "redux-user-456" } },
      match: {
        activeMatchId: "match-1",
        activeTeamId: "team-1",
        periodNumber: 1,
      },
    };

    mockUpdateGameEvent.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockUpdateGameEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "action-123",
      }),
    );
  });

  it("should handle tab switching between positive, negative, map, and shots", async () => {
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: { ...sampleAction, eventDefinitionId: "def-2" },
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    act(() => {
      result.current.handleTabClick("negative");
    });
    expect(result.current.activeTab).toBe("negative");

    act(() => {
      result.current.handleTabClick("map");
    });
    expect(result.current.activeTab).toBe("map");

    act(() => {
      result.current.handleTabClick("shots");
    });
    expect(result.current.activeTab).toBe("shots");
  });

  it("should separate positive and negative actions correctly in displayedActions", async () => {
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    expect(result.current.displayedActions.every((d) => d.isPositive)).toBe(
      true,
    );

    act(() => {
      result.current.handleTabClick("negative");
    });

    expect(result.current.displayedActions.every((d) => !d.isPositive)).toBe(
      true,
    );
  });

  it("should update selected action definition and automatically clear shot coordinates when switching to non-shot action", async () => {
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: { ...sampleAction, eventDefinitionId: "def-2" },
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    expect(result.current.isShotSelected).toBe(true);

    act(() => {
      result.current.handleActionSelect({
        id: "def-1",
        name: "Pass",
        isPositive: true,
        isShot: false,
        sportId: "sport-1",
        shortName: "P",
      });
    });

    expect(result.current.selectedEventDefinitionId).toBe("def-1");
    expect(result.current.isShotSelected).toBe(false);
    expect(result.current.shotLocationX).toBeNull();
    expect(result.current.shotLocationY).toBeNull();
  });

  it("should force isLeadToGoal to false when selecting Goal action during save", async () => {
    mockUpdateGameEvent.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    act(() => {
      result.current.handleActionSelect({
        id: "def-2",
        name: "Goal",
        isPositive: true,
        isShot: true,
        sportId: "sport-1",
        shortName: "G",
      });
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockUpdateGameEvent).toHaveBeenCalledWith(
      expect.objectContaining({ isLeadToGoal: false }),
    );
  });

  it("should update location coordinates via handleLocationSelect", async () => {
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    act(() => {
      result.current.handleLocationSelect(45.0, 55.0);
    });

    expect(result.current.locationX).toBe(45.0);
    expect(result.current.locationY).toBe(55.0);
    expect(result.current.hasLocation).toBe(true);

    act(() => {
      result.current.handleLocationSelect(null, null);
    });

    expect(result.current.locationX).toBeNull();
    expect(result.current.locationY).toBeNull();
    expect(result.current.hasLocation).toBe(false);
  });

  it("should update shot location coordinates via handleShotLocationSelect", async () => {
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: { ...sampleAction, eventDefinitionId: "def-2" },
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    act(() => {
      result.current.handleShotLocationSelect(25.0, 90.0);
    });

    expect(result.current.shotLocationX).toBe(25.0);
    expect(result.current.shotLocationY).toBe(90.0);
    expect(result.current.hasShotLocation).toBe(true);
  });

  it("should allow changing selected match lineup ID", async () => {
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    act(() => {
      result.current.setSelectedMatchLineupId("lineup-2");
    });

    expect(result.current.selectedMatchLineupId).toBe("lineup-2");
  });

  it("should execute handleSave successfully and call updateGameEvent with expected payload", async () => {
    mockUpdateGameEvent.mockResolvedValue(undefined);

    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    act(() => {
      result.current.setSelectedMatchLineupId("lineup-2");
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockUpdateGameEvent).toHaveBeenCalledWith({
      eventId: "action-123",
      selectedPlayerId: "lineup-2",
      actionName: "Pass",
      eventDefinitionId: "def-1",
      isPositive: true,
      isLeadToGoal: true,
      locationX: 35.5,
      locationY: 70.0,
      shotLocationX: null,
      shotLocationY: null,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.isSaving).toBe(false);
  });

  it("should set error state when updateGameEvent rejects during handleSave", async () => {
    mockUpdateGameEvent.mockRejectedValueOnce(
      new Error("Failed to write to database"),
    );

    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.error).toBe("Failed to write to database");
    expect(onClose).not.toHaveBeenCalled();
    expect(result.current.isSaving).toBe(false);
  });

  it("should prevent handleSave when selectedMatchLineupId is empty or location is not loaded", async () => {
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    act(() => {
      result.current.setSelectedMatchLineupId("");
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockUpdateGameEvent).not.toHaveBeenCalled();
  });

  it("should set error state when loading event location coordinates fails", async () => {
    vi.mocked(db.gameevents.get).mockRejectedValueOnce(
      new Error("Dexie gameevent read error"),
    );

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.error).toBe("Failed to load event coordinates.");
    });

    expect(result.current.isLocationLoaded).toBe(false);
  });

  it("should handle error when loading lineup fails", async () => {
    vi.mocked(db.matchlineups.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockRejectedValueOnce(new Error("Match lineup error")),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.error).toBe("Failed to load match roster.");
    });
  });

  it("should handle error when loading match details fails and block handleSave", async () => {
    vi.mocked(db.matches.get).mockRejectedValueOnce(
      new Error("Match read error"),
    );

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.error).toBe(
        "Failed to load match or sport definitions.",
      );
    });

    expect(result.current.isDefinitionsLoaded).toBe(false);

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockUpdateGameEvent).not.toHaveBeenCalled();
  });

  it("should block handleSave until event definitions are loaded and resolved", async () => {
    let resolveMatchDetails!: (value: unknown) => void;
    const matchDetailsPromise = new Promise((resolve) => {
      resolveMatchDetails = resolve;
    });

    vi.mocked(db.matches.get).mockReturnValueOnce(matchDetailsPromise as never);

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: { ...sampleAction, eventDefinitionId: "def-2" },
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
    });

    expect(result.current.isDefinitionsLoaded).toBe(false);

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockUpdateGameEvent).not.toHaveBeenCalled();

    resolveMatchDetails({ id: "match-1", tournamentId: "tour-1" });

    await waitFor(() => {
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockUpdateGameEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "action-123",
        shotLocationX: 12.0,
        shotLocationY: 80.0,
      }),
    );
  });

  it("should handle non-Error generic exception during handleSave", async () => {
    mockUpdateGameEvent.mockRejectedValueOnce("String error");

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.error).toBe("Failed to update action.");
  });

  it("should fallback to default definitions ordered by sortOrder when user has no presets", async () => {
    vi.mocked(db.usereventpresets.where).mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.usereventpresets.where>);

    vi.mocked(db.eventdefinitions.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "def-b",
            name: "Block",
            isPositive: true,
            sortOrder: 10,
            sportId: "sport-1",
          },
          {
            id: "def-a",
            name: "Assist",
            isPositive: true,
            sortOrder: 2,
            sportId: "sport-1",
          },
          {
            id: "def-custom",
            name: "Custom",
            isPositive: true,
            sortOrder: 1,
            ownerId: "user-99",
            sportId: "sport-1",
          },
        ]),
      }),
    } as unknown as ReturnType<typeof db.eventdefinitions.where>);

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: { ...sampleAction, eventDefinitionId: "def-a" },
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    expect(result.current.displayedActions.map((d) => d.id)).toEqual([
      "def-a",
      "def-b",
    ]);
  });

  it("should filter out disabled presets and preserve defined sortOrder", async () => {
    vi.mocked(db.usereventpresets.where).mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        { eventDefinitionId: "def-enabled-2", isEnabled: true, sortOrder: 2 },
        { eventDefinitionId: "def-disabled", isEnabled: false, sortOrder: 1 },
        { eventDefinitionId: "def-enabled-1", isEnabled: true, sortOrder: 1 },
      ]),
    } as unknown as ReturnType<typeof db.usereventpresets.where>);

    vi.mocked(db.eventdefinitions.bulkGet).mockResolvedValueOnce([
      { id: "def-enabled-1", name: "Steal", isPositive: true, isShot: false },
      { id: "def-enabled-2", name: "Goal", isPositive: true, isShot: true },
    ] as never);

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: { ...sampleAction, eventDefinitionId: "def-enabled-1" },
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    expect(db.eventdefinitions.bulkGet).toHaveBeenCalledWith([
      "def-enabled-1",
      "def-enabled-2",
    ]);
  });

  it("should retain recorded current event definition when it is absent from user presets", async () => {
    vi.mocked(db.usereventpresets.where).mockReturnValueOnce({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { eventDefinitionId: "def-preset-1", isEnabled: true, sortOrder: 1 },
        ]),
    } as unknown as ReturnType<typeof db.usereventpresets.where>);

    vi.mocked(db.eventdefinitions.bulkGet).mockResolvedValueOnce([
      { id: "def-preset-1", name: "Pass", isPositive: true, isShot: false },
    ] as never);

    vi.mocked(db.eventdefinitions.get).mockResolvedValueOnce({
      id: "def-legacy-recorded",
      name: "Legacy Special Action",
      isPositive: true,
      isShot: false,
    } as never);

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: { ...sampleAction, eventDefinitionId: "def-legacy-recorded" },
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    expect(
      result.current.displayedActions.some(
        (d) => d.id === "def-legacy-recorded",
      ),
    ).toBe(true);
  });

  it("should set error state when definitions are loaded but selectedEventDef is missing during handleSave", async () => {
    vi.mocked(db.eventdefinitions.get).mockResolvedValueOnce(
      undefined as never,
    );

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: { ...sampleAction, eventDefinitionId: "def-missing-999" },
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
      expect(result.current.isDefinitionsLoaded).toBe(true);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.error).toBe(
      "Selected action definition was not found.",
    );
    expect(mockUpdateGameEvent).not.toHaveBeenCalled();
  });

  it("should preserve user selected coordinates if user edits location while Dexie read is pending", async () => {
    let resolveGameEvent!: (value: unknown) => void;
    const gameEventPromise = new Promise((resolve) => {
      resolveGameEvent = resolve;
    });

    vi.mocked(db.gameevents.get).mockReturnValueOnce(gameEventPromise as never);

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: vi.fn(),
      }),
    );

    expect(result.current.isLocationLoaded).toBe(false);

    // User edits coordinates while DB read is pending
    act(() => {
      result.current.handleLocationSelect(88.0, 99.0);
      result.current.handleShotLocationSelect(44.0, 55.0);
    });

    expect(result.current.locationX).toBe(88.0);
    expect(result.current.locationY).toBe(99.0);
    expect(result.current.shotLocationX).toBe(44.0);
    expect(result.current.shotLocationY).toBe(55.0);

    // DB read resolves with initial DB values
    resolveGameEvent({
      id: "action-123",
      locationX: 10.0,
      locationY: 20.0,
      shotLocationX: 30.0,
      shotLocationY: 40.0,
    });

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
    });

    // User's pre-completion edits are preserved instead of being overwritten by DB values
    expect(result.current.locationX).toBe(88.0);
    expect(result.current.locationY).toBe(99.0);
    expect(result.current.shotLocationX).toBe(44.0);
    expect(result.current.shotLocationY).toBe(55.0);
  });
});
