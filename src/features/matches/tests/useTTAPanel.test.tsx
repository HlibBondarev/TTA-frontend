import { renderHook, act, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTTAPanel } from "../hooks/useTTAPanel";
import matchReducer from "../store/matchSlice";
import presenceReducer from "../../playerpresences/store/presenceSlice";
import uiReducer from "../../../store/slices/uiSlice";
import navigationReducer from "../../../store/slices/navigationSlice";
import { db } from "../../../db/ttaDatabase";
import { isSportHydratedForUser } from "../../../db/eventService";
import type { RootState } from "../../../store";

let mockAuth0User: { sub?: string; id?: string } | null = {
  sub: "auth0|user-123",
};

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    get user() {
      return mockAuth0User;
    },
  }),
}));

vi.mock("../../../db/eventService", () => ({
  clearEventDefinitionsCache: vi.fn(),
  isSportHydratedForUser: vi.fn().mockResolvedValue(true),
}));

const mockWhereEqualsToArray = vi.fn();
const mockUserPresetsWhere = vi.fn();
const mockEventDefinitionsBulkGet = vi.fn();

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matches: {
      get: vi.fn(),
    },
    tournaments: {
      get: vi.fn(),
    },
    sportconfigurations: {
      get: vi.fn(),
    },
    eventdefinitions: {
      bulkGet: (...args: unknown[]) => mockEventDefinitionsBulkGet(...args),
      where: vi.fn(() => ({
        equals: mockWhereEqualsToArray,
      })),
    },
    usereventpresets: {
      where: (...args: unknown[]) => mockUserPresetsWhere(...args),
    },
  },
}));

type TestState = {
  match?: Partial<RootState["match"]>;
  presence?: Partial<RootState["presence"]>;
  ui?: Partial<RootState["ui"]>;
  navigation?: Partial<RootState["navigation"]>;
};

const createTestStore = (preloadedState?: TestState) => {
  return configureStore({
    reducer: {
      match: matchReducer,
      presence: presenceReducer,
      ui: uiReducer,
      navigation: navigationReducer,
    },
    preloadedState: preloadedState as unknown as RootState,
  });
};

const createWrapper = (store: ReturnType<typeof createTestStore>) => {
  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
};

describe("useTTAPanel Custom Hook", () => {
  const mockDefinitions = [
    {
      id: "def-1",
      sportId: "sport-wp",
      name: "Goal Shot",
      shortName: "GS",
      isPositive: true,
      isShot: true,
      sortOrder: 1,
    },
    {
      id: "def-2",
      sportId: "sport-wp",
      name: "Foul",
      shortName: "FL",
      isPositive: false,
      isShot: false,
      sortOrder: 2,
    },
  ];

  const mockPresets = [
    {
      userId: "auth0|user-123",
      eventDefinitionId: "def-1",
      sportId: "sport-wp",
      sortOrder: 1,
      isEnabled: true,
    },
    {
      userId: "auth0|user-123",
      eventDefinitionId: "def-2",
      sportId: "sport-wp",
      sortOrder: 2,
      isEnabled: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth0User = { sub: "auth0|user-123" };
    vi.mocked(isSportHydratedForUser).mockResolvedValue(true);
    vi.mocked(db.matches.get).mockResolvedValue({
      id: "match-123",
      userId: "auth0|user-123",
      tournamentId: "tourn-1",
    } as unknown as Awaited<ReturnType<typeof db.matches.get>>);
    vi.mocked(db.tournaments.get).mockResolvedValue({
      id: "tourn-1",
      sportId: "sport-wp",
      configurationId: "config-1",
    } as unknown as Awaited<ReturnType<typeof db.tournaments.get>>);
    vi.mocked(db.sportconfigurations.get).mockResolvedValue({
      id: "config-1",
      playground: "<svg>Pool</svg>",
      shotMap: "<svg>Goal Frame</svg>",
    } as unknown as Awaited<ReturnType<typeof db.sportconfigurations.get>>);
    mockWhereEqualsToArray.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockDefinitions),
    });
    mockUserPresetsWhere.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockPresets),
    });
    mockEventDefinitionsBulkGet.mockResolvedValue(mockDefinitions);
  });

  it("should initialize with default positive tab and load action definitions, playground, and shotMap SVGs", async () => {
    const store = createTestStore({
      match: { activeMatchId: "match-123" },
    });

    const { result } = renderHook(() => useTTAPanel(), {
      wrapper: createWrapper(store),
    });

    expect(result.current.activeTab).toBe("positive");

    await waitFor(() => {
      expect(result.current.displayedActions).toHaveLength(1);
      expect(result.current.displayedActions[0].name).toBe("Goal Shot");
      expect(result.current.playground).toBe("<svg>Pool</svg>");
      expect(result.current.shotMap).toBe("<svg>Goal Frame</svg>");
    });
  });

  it("should detect when a shot action is selected via selectedActionDefinitionId", async () => {
    const store = createTestStore({
      match: { activeMatchId: "match-123" },
    });

    const { result, rerender } = renderHook((props) => useTTAPanel(props), {
      wrapper: createWrapper(store),
      initialProps: { selectedActionDefinitionId: "def-2" }, // Foul (isShot: false)
    });

    await waitFor(() => {
      expect(result.current.displayedActions).toHaveLength(1);
    });

    expect(result.current.isShotSelected).toBe(false);

    rerender({ selectedActionDefinitionId: "def-1" }); // Goal Shot (isShot: true)

    expect(result.current.isShotSelected).toBe(true);
  });

  it("should allow switching to 'shots' tab when a shot action is selected", async () => {
    const store = createTestStore({
      match: { activeMatchId: "match-123" },
    });

    const { result } = renderHook(
      () => useTTAPanel({ selectedActionDefinitionId: "def-1" }),
      { wrapper: createWrapper(store) },
    );

    await waitFor(() => {
      expect(result.current.isShotSelected).toBe(true);
    });

    act(() => {
      result.current.setActiveTab("shots");
    });

    expect(result.current.activeTab).toBe("shots");
  });

  it("should automatically fall back from 'shots' tab to category tab when action is changed to non-shot", async () => {
    const store = createTestStore({
      match: { activeMatchId: "match-123" },
    });

    const { result, rerender } = renderHook((props) => useTTAPanel(props), {
      wrapper: createWrapper(store),
      initialProps: { selectedActionDefinitionId: "def-1" },
    });

    await waitFor(() => {
      expect(result.current.isShotSelected).toBe(true);
    });

    act(() => {
      result.current.setActiveTab("shots");
    });
    expect(result.current.activeTab).toBe("shots");

    // Change action to Foul (isShot: false, isPositive: false)
    rerender({ selectedActionDefinitionId: "def-2" });

    expect(result.current.isShotSelected).toBe(false);
    expect(result.current.activeTab).toBe("negative");
  });

  it("should fall back to default system definitions sorted by sortOrder ASC when user has no presets", async () => {
    mockUserPresetsWhere.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const unsortedDefaultDefinitions = [
      {
        id: "def-3",
        sportId: "sport-wp",
        name: "Steal",
        shortName: "ST",
        isPositive: true,
        sortOrder: 3,
      },
      {
        id: "def-1",
        sportId: "sport-wp",
        name: "Goal Shot",
        shortName: "GS",
        isPositive: true,
        isShot: true,
        sortOrder: 1,
      },
      {
        id: "def-2",
        sportId: "sport-wp",
        name: "Pass",
        shortName: "PS",
        isPositive: true,
        sortOrder: 2,
      },
    ];

    mockWhereEqualsToArray.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue(unsortedDefaultDefinitions),
    });

    const store = createTestStore({
      match: { activeMatchId: "match-123" },
    });

    const { result } = renderHook(() => useTTAPanel(), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(result.current.displayedActions).toHaveLength(3);
      expect(result.current.displayedActions.map((d) => d.id)).toEqual([
        "def-1",
        "def-2",
        "def-3",
      ]);
    });
  });

  it("should switch displayed actions when activeTab is changed to negative", async () => {
    const store = createTestStore({
      match: { activeMatchId: "match-123" },
    });

    const { result } = renderHook(() => useTTAPanel(), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(result.current.displayedActions).toHaveLength(1);
    });

    act(() => {
      result.current.setActiveTab("negative");
    });

    expect(result.current.activeTab).toBe("negative");
    expect(result.current.displayedActions).toHaveLength(1);
    expect(result.current.displayedActions[0].name).toBe("Foul");
  });

  it("should support switching to 'map' tab", async () => {
    const store = createTestStore({
      match: { activeMatchId: "match-123" },
    });

    const { result } = renderHook(() => useTTAPanel(), {
      wrapper: createWrapper(store),
    });

    act(() => {
      result.current.setActiveTab("map");
    });

    expect(result.current.activeTab).toBe("map");
  });

  it("should return empty actions array if match userId belongs to another user", async () => {
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "match-123",
      userId: "auth0|other-user",
      tournamentId: "tourn-1",
    } as unknown as Awaited<ReturnType<typeof db.matches.get>>);

    const store = createTestStore({
      match: { activeMatchId: "match-123" },
    });

    const { result } = renderHook(() => useTTAPanel(), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(result.current.displayedActions).toEqual([]);
    });
  });

  it("should return empty definitions when sport is not yet hydrated for user", async () => {
    vi.mocked(isSportHydratedForUser).mockResolvedValueOnce(false);

    const store = createTestStore({
      match: { activeMatchId: "match-123" },
    });

    const { result } = renderHook(() => useTTAPanel(), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(result.current.playground).toBe("<svg>Pool</svg>");
      expect(result.current.shotMap).toBe("<svg>Goal Frame</svg>");
      expect(result.current.displayedActions).toEqual([]);
    });
  });

  it("should reset definitions when activeMatchId changes", async () => {
    const store = createTestStore({
      match: { activeMatchId: "match-123" },
    });

    const { result, rerender } = renderHook(() => useTTAPanel(), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(result.current.displayedActions).toHaveLength(1);
    });

    store.dispatch({
      type: "match/setActiveMatch",
      payload: { matchId: "match-456", teamId: "team-1" },
    });

    rerender();

    expect(result.current.displayedActions).toEqual([]);
  });

  it("should keep isShotSelected false when shot action is selected without shotMap or existing shot coordinates", async () => {
    vi.mocked(db.sportconfigurations.get).mockResolvedValueOnce({
      id: "config-1",
      playground: "<svg>Pool</svg>",
      shotMap: null,
    } as unknown as Awaited<ReturnType<typeof db.sportconfigurations.get>>);

    const store = createTestStore({
      match: { activeMatchId: "match-123" },
    });

    const { result, rerender } = renderHook((props) => useTTAPanel(props), {
      wrapper: createWrapper(store),
      initialProps: {
        selectedActionDefinitionId: "def-1",
        hasShotLocation: false,
      },
    });

    await waitFor(() => {
      expect(result.current.displayedActions).toHaveLength(1);
    });

    expect(result.current.shotMap).toBeNull();
    expect(result.current.isShotSelected).toBe(false);

    rerender({
      selectedActionDefinitionId: "def-1",
      hasShotLocation: true,
    });

    expect(result.current.isShotSelected).toBe(true);
  });
});
