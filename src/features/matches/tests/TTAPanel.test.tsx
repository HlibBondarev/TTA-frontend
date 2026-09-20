import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { TTDActionsPanel } from "../components/TTAPanel";
import { db } from "../../../db/ttaDatabase";
import {
  clearEventDefinitionsCache,
  isSportHydratedForUser,
  setHydratedUserIdForSport,
} from "../../../db/eventService";
import matchReducer, { incrementHydrationVersion } from "../store/matchSlice";

const mockWhereEqualsToArray = vi.hoisted(() => vi.fn());

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    user: undefined,
  }),
}));

vi.mock("../../../db/eventService", () => ({
  clearEventDefinitionsCache: vi.fn(),
  isSportHydratedForUser: vi.fn().mockReturnValue(true),
  setHydratedUserIdForSport: vi.fn(),
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matches: {
      get: vi.fn(),
    },
    tournaments: {
      get: vi.fn(),
    },
    eventdefinitions: {
      toArray: vi.fn(),
      where: vi.fn(() => ({
        equals: mockWhereEqualsToArray,
      })),
    },
  },
}));

// Mock dexie's liveQuery to asynchronously notify observers during unit test execution
vi.mock("dexie", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dexie")>();
  return {
    ...actual,
    liveQuery: (fn: () => Promise<unknown>) => ({
      subscribe: (observer: {
        next: (val: unknown) => void;
        error?: (err: unknown) => void;
      }) => {
        fn()
          .then((data) => observer.next(data))
          .catch((err) => observer.error?.(err));
        return { unsubscribe: vi.fn() };
      },
    }),
  };
});

const createTestStore = (
  activeMatchId: string | null = "test-match-1",
  currentUserId: string | null = "user-1",
) =>
  configureStore({
    reducer: {
      match: matchReducer,
      auth: (state = { currentUserId }) => state,
    },
    preloadedState: {
      match: {
        activeMatchId,
        activeTeamId: "team-1",
        periodNumber: 1,
        homeScore: 0,
        guestScore: 0,
        isPeriodActive: true,
        isInsideStoppage: false,
        isPeriodEnded: false,
        globalSequenceNumber: 1,
        recentActions: [],
        hydrationVersion: 0,
      },
      auth: {
        currentUserId,
      },
    },
  });

describe("TTDActionsPanel Component", () => {
  const mockEventDefinitions = [
    {
      id: "1",
      sportId: "s1",
      name: "Goal",
      shortName: "GL",
      isPositive: true,
      isEnabled: true,
      sortOrder: 1,
      createdAt: "",
    },
    {
      id: "2",
      sportId: "s1",
      name: "Pass",
      shortName: "PS",
      isPositive: true,
      isEnabled: true,
      sortOrder: 2,
      createdAt: "",
    },
    {
      id: "3",
      sportId: "s1",
      name: "Turnover",
      shortName: "TO",
      isPositive: false,
      isEnabled: true,
      sortOrder: 3,
      createdAt: "",
    },
    {
      id: "4",
      sportId: "s1",
      name: "Foul",
      shortName: "FL",
      isPositive: false,
      isEnabled: true,
      sortOrder: 4,
      createdAt: "",
    },
    {
      id: "5",
      sportId: "s1",
      name: "Disabled Action",
      shortName: "DA",
      isPositive: true,
      isEnabled: false,
      sortOrder: 5,
      createdAt: "",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSportHydratedForUser).mockReturnValue(true);
    vi.mocked(db.matches.get).mockResolvedValue({
      id: "test-match-1",
      tournamentId: "tour-1",
    } as never);
    vi.mocked(db.tournaments.get).mockResolvedValue({
      id: "tour-1",
      sportId: "s1",
    } as never);

    mockWhereEqualsToArray.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockEventDefinitions),
    });
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValue(
      mockEventDefinitions,
    );
  });

  it("allows selecting actions loaded dynamically from Dexie DB and switching tabs", async () => {
    const mockOnActionSelect = vi.fn();
    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTDActionsPanel
          onActionSelect={mockOnActionSelect}
          selectedAction={null}
          disabled={false}
        />
      </Provider>,
    );

    expect(await screen.findByText("Goal")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Pass"));
    expect(mockOnActionSelect).toHaveBeenCalledWith("Pass", true);

    fireEvent.click(screen.getByText("Negative"));
    expect(await screen.findByText("Turnover")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Foul"));
    expect(mockOnActionSelect).toHaveBeenCalledWith("Foul", false);
  });

  it("applies selected styling to the active action button", async () => {
    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTDActionsPanel
          onActionSelect={vi.fn()}
          selectedAction="Goal"
          disabled={false}
        />
      </Provider>,
    );

    const goalBtn = await screen.findByText("Goal");
    expect(goalBtn).toHaveClass("bg-blue-600");
  });

  it("filters out disabled event definitions from display", async () => {
    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTDActionsPanel
          onActionSelect={vi.fn()}
          selectedAction={null}
          disabled={false}
        />
      </Provider>,
    );

    await screen.findByText("Goal");
    expect(screen.queryByText("Disabled Action")).not.toBeInTheDocument();
  });

  it("respects disabled prop for tabs and action buttons", async () => {
    const store = createTestStore();

    const { container } = render(
      <Provider store={store}>
        <TTDActionsPanel
          onActionSelect={vi.fn()}
          selectedAction={null}
          disabled={true}
        />
      </Provider>,
    );

    expect(container.firstChild).toHaveClass("opacity-50");

    const positiveTabBtn = screen.getByRole("button", { name: /Positive/i });
    expect(positiveTabBtn).toBeDisabled();

    const negativeTabBtn = screen.getByRole("button", { name: /Negative/i });
    expect(negativeTabBtn).toBeDisabled();

    const actionBtn = await screen.findByText("Goal");
    expect(actionBtn).toBeDisabled();
  });

  it("returns empty event definitions when targetSportId cannot be resolved", async () => {
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "test-match-1",
      tournamentId: "tour-without-sport",
    } as never);
    vi.mocked(db.tournaments.get).mockResolvedValueOnce({
      id: "tour-without-sport",
      sportId: null,
    } as never);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTDActionsPanel
          onActionSelect={vi.fn()}
          selectedAction={null}
          disabled={false}
        />
      </Provider>,
    );

    await waitFor(() => {
      expect(db.tournaments.get).toHaveBeenCalledWith("tour-without-sport");
    });
    expect(screen.queryByText("Goal")).not.toBeInTheDocument();
    expect(db.eventdefinitions.where).not.toHaveBeenCalled();
  });

  it("clears event definitions on Dexie liveQuery subscription error", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.mocked(db.matches.get).mockRejectedValueOnce(
      new Error("Dexie query error"),
    );

    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTDActionsPanel
          onActionSelect={vi.fn()}
          selectedAction={null}
          disabled={false}
        />
      </Provider>,
    );

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to load event definitions from Dexie:",
        expect.any(Error),
      );
    });

    expect(screen.queryByText("Goal")).not.toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it("clears event definition cache and resets state when currentUserId changes", async () => {
    const store = createTestStore("test-match-1", "user-1");

    const { rerender } = render(
      <Provider store={store}>
        <TTDActionsPanel
          onActionSelect={vi.fn()}
          selectedAction={null}
          disabled={false}
        />
      </Provider>,
    );

    expect(await screen.findByText("Goal")).toBeInTheDocument();

    const newUserStore = createTestStore("test-match-1", "user-2");
    rerender(
      <Provider store={newUserStore}>
        <TTDActionsPanel
          onActionSelect={vi.fn()}
          selectedAction={null}
          disabled={false}
        />
      </Provider>,
    );

    expect(clearEventDefinitionsCache).toHaveBeenCalled();
  });

  it("gates action rendering on account switch until new account sport snapshot replaces records", async () => {
    let hydratedUser = "user-A";
    vi.mocked(isSportHydratedForUser).mockImplementation(
      (_sportId, userId) => !userId || userId === hydratedUser,
    );
    vi.mocked(setHydratedUserIdForSport).mockImplementation(
      (_sportId, userId) => {
        if (userId) hydratedUser = userId;
      },
    );

    const storeUserA = createTestStore("test-match-1", "user-A");
    setHydratedUserIdForSport("s1", "user-A");

    const { rerender } = render(
      <Provider store={storeUserA}>
        <TTDActionsPanel
          onActionSelect={vi.fn()}
          selectedAction={null}
          disabled={false}
        />
      </Provider>,
    );

    expect(await screen.findByText("Goal")).toBeInTheDocument();

    // Switch to user-B before user-B's hydration for s1 completes
    hydratedUser = "user-A";
    const storeUserB = createTestStore("test-match-1", "user-B");
    rerender(
      <Provider store={storeUserB}>
        <TTDActionsPanel
          onActionSelect={vi.fn()}
          selectedAction={null}
          disabled={false}
        />
      </Provider>,
    );

    // Actions from user-A must NOT be rendered for user-B (gated)
    await waitFor(() => {
      expect(screen.queryByText("Goal")).not.toBeInTheDocument();
    });

    // Simulate user-B snapshot hydration completing
    setHydratedUserIdForSport("s1", "user-B");

    // Force re-render with key to re-mount component and trigger liveQuery effect with updated hydration state
    rerender(
      <Provider store={storeUserB}>
        <TTDActionsPanel
          key="user-B-hydrated"
          onActionSelect={vi.fn()}
          selectedAction={null}
          disabled={false}
        />
      </Provider>,
    );

    expect(await screen.findByText("Goal")).toBeInTheDocument();
  });

  it("fails closed and renders no actions when userId is absent or unhydrated", async () => {
    const noUserStore = createTestStore("test-match-1", null);

    render(
      <Provider store={noUserStore}>
        <TTDActionsPanel
          onActionSelect={vi.fn()}
          selectedAction={null}
          disabled={false}
        />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Goal")).not.toBeInTheDocument();
    });
  });

  it("re-queries Dexie DB and renders actions automatically when Redux hydration signal updates", async () => {
    let isHydrated = false;
    vi.mocked(isSportHydratedForUser).mockImplementation(() => isHydrated);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTDActionsPanel
          onActionSelect={vi.fn()}
          selectedAction={null}
          disabled={false}
        />
      </Provider>,
    );

    // Wait for initial hydration check while isHydrated is false
    await waitFor(() => {
      expect(isSportHydratedForUser).toHaveBeenCalledWith("s1", "user-1");
    });
    expect(screen.queryByText("Goal")).not.toBeInTheDocument();
    vi.mocked(isSportHydratedForUser).mockClear();

    // Simulate successful hydration: update marker and dispatch production action
    isHydrated = true;
    store.dispatch(incrementHydrationVersion());

    // Wait for second hydration check triggered by hydrationVersion update
    await waitFor(() => {
      expect(isSportHydratedForUser).toHaveBeenCalledWith("s1", "user-1");
    });
    expect(await screen.findByText("Goal")).toBeInTheDocument();
  });
});
