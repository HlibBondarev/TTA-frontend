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

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matches: {
      get: vi.fn(),
    },
    tournaments: {
      get: vi.fn(),
    },
    eventdefinitions: {
      where: vi.fn(() => ({
        equals: mockWhereEqualsToArray,
      })),
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
      name: "Goal",
      isPositive: true,
      isEnabled: true,
      sortOrder: 1,
    },
    {
      id: "def-2",
      sportId: "sport-wp",
      name: "Foul",
      isPositive: false,
      isEnabled: true,
      sortOrder: 2,
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
    } as unknown as Awaited<ReturnType<typeof db.tournaments.get>>);
    mockWhereEqualsToArray.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockDefinitions),
    });
  });

  it("should initialize with default positive tab and load action definitions from Dexie", async () => {
    const store = createTestStore({
      match: { activeMatchId: "match-123" },
    });

    const { result } = renderHook(() => useTTAPanel(), {
      wrapper: createWrapper(store),
    });

    expect(result.current.activeTab).toBe("positive");

    await waitFor(() => {
      expect(result.current.displayedActions).toHaveLength(1);
      expect(result.current.displayedActions[0].name).toBe("Goal");
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

  it("should return empty actions array if sport is not hydrated for the current user", async () => {
    vi.mocked(isSportHydratedForUser).mockResolvedValueOnce(false);

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

    // Change active match
    store.dispatch({
      type: "match/setActiveMatch",
      payload: { matchId: "match-456", teamId: "team-1" },
    });

    rerender();

    expect(result.current.displayedActions).toEqual([]);
  });
});
