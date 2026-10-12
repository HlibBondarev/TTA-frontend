import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useEditGameEventModal } from "../hooks/useEditGameEventModal";
import * as eventService from "../../../db/eventService";
import { db } from "../../../db/ttaDatabase";

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    user: { sub: "user-123", email: "test@example.com" },
  }),
}));

vi.mock("react-redux", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-redux")>();
  return {
    ...actual,
    useDispatch: () => vi.fn(),
    useSelector: (selector: (state: unknown) => unknown) =>
      selector({
        match: { activeMatchId: "match-1" },
        auth: { currentUserId: "user-123" },
      }),
  };
});

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
      }),
    },
    gameevents: {
      get: vi.fn().mockResolvedValue({
        id: "action-123",
        locationX: 35.5,
        locationY: 70.0,
      }),
    },
    usereventpresets: {
      where: vi
        .fn()
        .mockImplementation((query: { userId: string; sportId: string }) => ({
          toArray: vi.fn().mockResolvedValue(
            [
              {
                userId: "user-123",
                sportId: "sport-1",
                eventDefinitionId: "def-1",
                isEnabled: true,
                sortOrder: 1,
              },
              {
                userId: "user-123",
                sportId: "sport-1",
                eventDefinitionId: "def-2",
                isEnabled: true,
                sortOrder: 2,
              },
              {
                userId: "user-123",
                sportId: "sport-1",
                eventDefinitionId: "def-disabled",
                isEnabled: false,
                sortOrder: 3,
              },
              {
                userId: "user-123",
                sportId: "sport-2",
                eventDefinitionId: "def-other-sport",
                isEnabled: true,
                sortOrder: 4,
              },
            ].filter(
              (preset) =>
                preset.userId === query.userId &&
                preset.sportId === query.sportId,
            ),
          ),
        })),
    },
    eventdefinitions: {
      bulkGet: vi.fn().mockImplementation((ids: string[]) => {
        const defsMap: Record<
          string,
          { id: string; name: string; isPositive: boolean }
        > = {
          "def-1": { id: "def-1", name: "Pass", isPositive: true },
          "def-2": { id: "def-2", name: "Goal", isPositive: true },
          "def-disabled": {
            id: "def-disabled",
            name: "Disabled",
            isPositive: true,
          },
          "def-other-sport": {
            id: "def-other-sport",
            name: "Other sport",
            isPositive: true,
          },
          "def-3": { id: "def-3", name: "Foul", isPositive: false },
        };
        return Promise.resolve(
          ids.map((id) => defsMap[id]).filter((item) => item !== undefined),
        );
      }),
      get: vi.fn().mockImplementation((id: string) => {
        const defs: Record<
          string,
          { id: string; name: string; isPositive: boolean }
        > = {
          "def-1": { id: "def-1", name: "Pass", isPositive: true },
          "def-2": { id: "def-2", name: "Goal", isPositive: true },
          "def-disabled": {
            id: "def-disabled",
            name: "Disabled",
            isPositive: true,
          },
          "def-other-sport": {
            id: "def-other-sport",
            name: "Other sport",
            isPositive: true,
          },
          "def-3": { id: "def-3", name: "Foul", isPositive: false },
        };
        return Promise.resolve(defs[id]);
      }),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { id: "def-1", name: "Pass", isPositive: true },
            { id: "def-2", name: "Goal", isPositive: true },
            { id: "def-disabled", name: "Disabled", isPositive: true },
            { id: "def-other-sport", name: "Other sport", isPositive: true },
            { id: "def-3", name: "Foul", isPositive: false },
          ]),
        }),
      }),
    },
    matchlineups: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { id: "lineup-1", number: 7, matchId: "match-1" },
            { id: "lineup-2", number: 10, matchId: "match-1" },
          ]),
        }),
      }),
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
    },
  },
}));

vi.mock("../../../db/eventService", () => ({
  updateGameEventTx: vi.fn(),
}));

describe("useEditGameEventModal Hook", () => {
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

  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads initial data correctly", async () => {
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: mockOnClose,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
    });

    expect(result.current.selectedMatchLineupId).toBe("lineup-1");
    expect(result.current.selectedEventDefinitionId).toBe("def-1");
    expect(result.current.activeTab).toBe("positive");
    expect(result.current.locationX).toBe(35.5);
    expect(result.current.locationY).toBe(70.0);
    expect(result.current.hasLocation).toBe(true);
    expect(result.current.playgroundSvg).toBe("<svg>Court</svg>");
    expect(result.current.lineups).toHaveLength(2);
    expect(result.current.displayedActions).toHaveLength(2);
    expect(result.current.displayedActions.map((def) => def.id)).toEqual([
      "def-1",
      "def-2",
    ]);
  });

  it("preserves action selection when switching between positive and negative tabs", async () => {
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: mockOnClose,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
    });

    expect(result.current.selectedEventDefinitionId).toBe("def-1");

    act(() => {
      result.current.handleTabClick("negative");
    });

    expect(result.current.activeTab).toBe("negative");
    // Selection is preserved even on tab switch
    expect(result.current.selectedEventDefinitionId).toBe("def-1");

    act(() => {
      result.current.handleTabClick("positive");
    });

    expect(result.current.activeTab).toBe("positive");
    expect(result.current.selectedEventDefinitionId).toBe("def-1");
  });

  it("preserves action selection when switching to map tab and back", async () => {
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: mockOnClose,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
    });

    act(() => {
      result.current.handleTabClick("map");
    });

    expect(result.current.activeTab).toBe("map");
    expect(result.current.selectedEventDefinitionId).toBe("def-1");

    act(() => {
      result.current.handleTabClick("positive");
    });

    expect(result.current.activeTab).toBe("positive");
    expect(result.current.selectedEventDefinitionId).toBe("def-1");
  });

  it("handles action selection by definition object", async () => {
    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: mockOnClose,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
    });

    act(() => {
      result.current.handleActionSelect({
        id: "def-2",
        name: "Goal",
        shortName: "G",
        sportId: "sport-1",
        isPositive: true,
      });
    });

    expect(result.current.selectedEventDefinitionId).toBe("def-2");
  });

  it("updates game event and closes modal on handleSave", async () => {
    vi.mocked(eventService.updateGameEventTx).mockResolvedValueOnce({
      id: "action-123",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "",
      isLeadToGoal: true,
      createdAt: "",
      sequenceNumber: 1,
      isSynced: 0,
    });

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: mockOnClose,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(eventService.updateGameEventTx).toHaveBeenCalledWith({
      eventId: "action-123",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      expectedSportId: "sport-1",
      isLeadToGoal: true,
      locationX: 35.5,
      locationY: 70.0,
      userId: "user-123",
    });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("forces isLeadToGoal to false when saving a Goal action", async () => {
    vi.mocked(eventService.updateGameEventTx).mockResolvedValueOnce({
      id: "action-123",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-2",
      periodNumber: 1,
      eventTimestamp: "",
      isLeadToGoal: false,
      createdAt: "",
      sequenceNumber: 1,
      isSynced: 0,
    });

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: mockOnClose,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
    });

    act(() => {
      result.current.handleActionSelect({
        id: "def-2",
        name: "Goal",
        shortName: "G",
        sportId: "sport-1",
        isPositive: true,
      });
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(eventService.updateGameEventTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventDefinitionId: "def-2",
        isLeadToGoal: false,
      }),
    );
  });

  it("sets error message when updateGameEventTx fails", async () => {
    vi.mocked(eventService.updateGameEventTx).mockRejectedValueOnce(
      new Error("Save failed"),
    );

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: mockOnClose,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.error).toBe("Save failed");
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("does not load sport defaults if user has a preset with all actions disabled", async () => {
    vi.mocked(db.usereventpresets.where).mockReturnValueOnce({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { eventDefinitionId: "def-1", isEnabled: false, sortOrder: 1 },
        ]),
    } as unknown as ReturnType<typeof db.usereventpresets.where>);

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: sampleAction,
        matchId: "match-1",
        onClose: mockOnClose,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
    });

    // Should retain only the current recorded event definition (def-1) without falling back to default sport definitions
    expect(result.current.displayedActions).toHaveLength(1);
    expect(result.current.displayedActions[0].id).toBe("def-1");
  });

  it("retains current recorded definition in displayedActions even if it is not in active presets", async () => {
    (
      db.eventdefinitions.get as unknown as ReturnType<typeof vi.fn>
    ).mockImplementationOnce((id: string) => {
      if (id === "def-unpreset") {
        return Promise.resolve({
          id: "def-unpreset",
          name: "Unpreset Action",
          isPositive: true,
        });
      }
      return Promise.resolve({
        id,
        name: "Default Action",
        isPositive: true,
      });
    });

    const unpresetAction = {
      ...sampleAction,
      eventDefinitionId: "def-unpreset",
    };

    const { result } = renderHook(() =>
      useEditGameEventModal({
        action: unpresetAction,
        matchId: "match-1",
        onClose: mockOnClose,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLocationLoaded).toBe(true);
    });

    // Should include active preset definitions (def-1, def-2) AND retain def-unpreset
    expect(result.current.displayedActions.map((def) => def.id)).toEqual([
      "def-1",
      "def-2",
      "def-unpreset",
    ]);
  });
});
