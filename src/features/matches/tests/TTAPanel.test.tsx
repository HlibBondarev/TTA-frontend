import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { TTAPanel } from "../components/TTAPanel";
import { db } from "../../../db/ttaDatabase";
import {
  clearEventDefinitionsCache,
  isSportHydratedForUser,
  setHydratedUserIdForSport,
} from "../../../db/eventService";
import matchReducer, { incrementHydrationVersion } from "../store/matchSlice";

const mockWhereEqualsToArray = vi.hoisted(() => vi.fn());
const mockUserPresetsWhere = vi.hoisted(() => vi.fn());
const mockEventDefinitionsBulkGet = vi.hoisted(() => vi.fn());

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    user: undefined,
  }),
}));

vi.mock("../components/InteractivePlayground", () => ({
  InteractivePlayground: ({
    onLocationSelect,
  }: {
    onLocationSelect: (x: number | null, y: number | null) => void;
  }) => (
    <div data-testid="interactive-playground">
      <button type="button" onClick={() => onLocationSelect(40, 60)}>
        Select Position
      </button>
    </div>
  ),
}));

vi.mock("../components/InteractiveShotMap", () => ({
  InteractiveShotMap: ({
    onShotLocationSelect,
  }: {
    onShotLocationSelect: (x: number | null, y: number | null) => void;
  }) => (
    <div data-testid="interactive-shotMap">
      <button type="button" onClick={() => onShotLocationSelect(75, 45)}>
        Select Shot Target
      </button>
    </div>
  ),
}));

vi.mock("../../../db/eventService", () => ({
  clearEventDefinitionsCache: vi.fn(),
  isSportHydratedForUser: vi.fn().mockResolvedValue(true),
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
    sportconfigurations: {
      get: vi.fn(),
    },
    eventdefinitions: {
      toArray: vi.fn(),
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
          .then((data: unknown) => observer.next(data))
          .catch((err: unknown) => observer.error?.(err));
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

describe("TTAPanel Component", () => {
  const mockEventDefinitions = [
    {
      id: "1",
      sportId: "s1",
      name: "Goal",
      shortName: "GL",
      isPositive: true,
      isShot: true,
      createdAt: "",
    },
    {
      id: "2",
      sportId: "s1",
      name: "Pass",
      shortName: "PS",
      isPositive: true,
      isShot: false,
      createdAt: "",
    },
    {
      id: "3",
      sportId: "s1",
      name: "Turnover",
      shortName: "TO",
      isPositive: false,
      isShot: false,
      createdAt: "",
    },
    {
      id: "4",
      sportId: "s1",
      name: "Foul",
      shortName: "FL",
      isPositive: false,
      isShot: false,
      createdAt: "",
    },
    {
      id: "5",
      sportId: "s1",
      name: "Disabled Action",
      shortName: "DA",
      isPositive: true,
      createdAt: "",
    },
    {
      id: "6",
      sportId: "s1",
      name: "Penalty",
      shortName: "PEN+",
      isPositive: true,
      createdAt: "",
    },
    {
      id: "7",
      sportId: "s1",
      name: "Penalty",
      shortName: "PEN-",
      isPositive: false,
      createdAt: "",
    },
  ];

  const mockPresets = [
    {
      userId: "user-1",
      eventDefinitionId: "1",
      sportId: "s1",
      sortOrder: 1,
      isEnabled: true,
    },
    {
      userId: "user-1",
      eventDefinitionId: "2",
      sportId: "s1",
      sortOrder: 2,
      isEnabled: true,
    },
    {
      userId: "user-1",
      eventDefinitionId: "3",
      sportId: "s1",
      sortOrder: 3,
      isEnabled: true,
    },
    {
      userId: "user-1",
      eventDefinitionId: "4",
      sportId: "s1",
      sortOrder: 4,
      isEnabled: true,
    },
    {
      userId: "user-1",
      eventDefinitionId: "6",
      sportId: "s1",
      sortOrder: 6,
      isEnabled: true,
    },
    {
      userId: "user-1",
      eventDefinitionId: "7",
      sportId: "s1",
      sortOrder: 7,
      isEnabled: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSportHydratedForUser).mockResolvedValue(true);
    vi.mocked(db.matches.get).mockResolvedValue({
      id: "test-match-1",
      tournamentId: "tour-1",
    } as never);
    vi.mocked(db.tournaments.get).mockResolvedValue({
      id: "tour-1",
      sportId: "s1",
      configurationId: "config-1",
    } as never);
    vi.mocked(db.sportconfigurations.get).mockResolvedValue({
      id: "config-1",
      playground: "<svg>Playground</svg>",
      shotMap: '<svg viewBox="0 0 100 100">Goal Frame</svg>',
    } as never);

    mockUserPresetsWhere.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(mockPresets),
    });
    mockEventDefinitionsBulkGet.mockImplementation(async (ids: string[]) =>
      ids
        .map((id) => mockEventDefinitions.find((d) => d.id === id))
        .filter(Boolean),
    );

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
        <TTAPanel
          onActionSelect={mockOnActionSelect}
          selectedActionDefinitionId={null}
          disabled={false}
        />
      </Provider>,
    );

    expect(await screen.findByText("Goal")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Pass"));
    expect(mockOnActionSelect).toHaveBeenCalledWith("Pass", true, "2", false);

    fireEvent.click(screen.getByText("Negative"));
    expect(await screen.findByText("Turnover")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Foul"));
    expect(mockOnActionSelect).toHaveBeenCalledWith("Foul", false, "4", false);
  });

  it("forwards action name, isPositive, eventDefinitionId, and isShot when an action button is clicked", async () => {
    const mockOnActionSelect = vi.fn();
    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTAPanel
          onActionSelect={mockOnActionSelect}
          selectedActionDefinitionId={null}
          disabled={false}
        />
      </Provider>,
    );

    const goalButton = await screen.findByText("Goal");
    fireEvent.click(goalButton);

    expect(mockOnActionSelect).toHaveBeenCalledWith("Goal", true, "1", true);
  });

  it("triggers onTabChange callback ONLY when switching between POSITIVE and NEGATIVE tabs", async () => {
    const mockOnTabChange = vi.fn();
    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTAPanel
          onActionSelect={vi.fn()}
          onTabChange={mockOnTabChange}
          selectedActionDefinitionId={null}
          disabled={false}
        />
      </Provider>,
    );

    await screen.findByText("Goal");

    // 1. Transitioning Positive -> Map must NOT clear pending action
    fireEvent.click(screen.getByText("Map"));
    expect(mockOnTabChange).not.toHaveBeenCalled();

    // 2. Transitioning Map -> Negative must NOT clear pending action
    fireEvent.click(screen.getByText("Negative"));
    expect(mockOnTabChange).not.toHaveBeenCalled();

    // 3. Direct transition Negative -> Positive MUST trigger onTabChange (1st call)
    fireEvent.click(screen.getByText("Positive"));
    expect(mockOnTabChange).toHaveBeenCalledTimes(1);

    // 4. Direct transition Positive -> Negative MUST trigger onTabChange (2nd call)
    fireEvent.click(screen.getByText("Negative"));
    expect(mockOnTabChange).toHaveBeenCalledTimes(2);
  });

  it("allows switching to Map tab and interacting with InteractivePlayground", async () => {
    const mockOnLocationSelect = vi.fn();
    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTAPanel
          onActionSelect={vi.fn()}
          onLocationSelect={mockOnLocationSelect}
          selectedActionDefinitionId={null}
          disabled={false}
        />
      </Provider>,
    );

    await screen.findByText("Goal");

    fireEvent.click(screen.getByText("Map"));

    expect(screen.getByTestId("interactive-playground")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Select Position"));
    expect(mockOnLocationSelect).toHaveBeenCalledWith(40, 60);
  });

  it("hides SHOTS tab by default when no action is selected or a non-shot action is selected", async () => {
    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId="2" // Pass (isShot: false)
          disabled={false}
        />
      </Provider>,
    );

    await screen.findByText("Goal");
    expect(screen.queryByText("SHOTS")).not.toBeInTheDocument();
  });

  it("shows SHOTS tab when an action with isShot === true is selected", async () => {
    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId="1" // Goal (isShot: true)
          disabled={false}
        />
      </Provider>,
    );

    await screen.findByText("Goal");
    expect(screen.getByText("SHOTS")).toBeInTheDocument();
  });

  it("hides SHOTS tab when shot action is selected but neither shotMap nor pendingShotLocation is available", async () => {
    vi.mocked(db.sportconfigurations.get).mockResolvedValueOnce({
      id: "config-1",
      playground: "<svg>Playground</svg>",
      shotMap: null,
    } as never);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId="1"
          disabled={false}
        />
      </Provider>,
    );

    await screen.findByText("Goal");
    expect(screen.queryByText("SHOTS")).not.toBeInTheDocument();
  });

  it("shows SHOTS tab when shotMap is null if pendingShotLocation is already present", async () => {
    vi.mocked(db.sportconfigurations.get).mockResolvedValueOnce({
      id: "config-1",
      playground: "<svg>Playground</svg>",
      shotMap: null,
    } as never);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId="1"
          pendingShotLocation={{ shotLocationX: 50, shotLocationY: 50 }}
          disabled={false}
        />
      </Provider>,
    );

    await screen.findByText("Goal");
    expect(screen.getByText("SHOTS")).toBeInTheDocument();
  });

  it("allows switching to SHOTS tab and interacting with InteractiveShotMap", async () => {
    const mockOnShotLocationSelect = vi.fn();
    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTAPanel
          onActionSelect={vi.fn()}
          onShotLocationSelect={mockOnShotLocationSelect}
          selectedActionDefinitionId="1" // Goal (isShot: true)
          disabled={false}
        />
      </Provider>,
    );

    await screen.findByText("Goal");

    fireEvent.click(screen.getByText("SHOTS"));

    expect(screen.getByTestId("interactive-shotMap")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Select Shot Target"));
    expect(mockOnShotLocationSelect).toHaveBeenCalledWith(75, 45);
  });

  it("renders a pulse indicator on SHOTS tab when pendingShotLocation is present", async () => {
    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId="1"
          pendingShotLocation={{ shotLocationX: 80, shotLocationY: 50 }}
          disabled={false}
        />
      </Provider>,
    );

    await screen.findByText("Goal");
    const shotsTab = screen.getByRole("tab", { name: /SHOTS/i });
    expect(shotsTab.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("applies selected styling strictly based on selectedActionDefinitionId", async () => {
    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId="1"
          disabled={false}
        />
      </Provider>,
    );

    const goalBtn = await screen.findByText("Goal");
    expect(goalBtn).toHaveClass("bg-blue-600");
  });

  it("does not highlight actions with identical names in other tabs if definition ID does not match", async () => {
    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId="7"
          disabled={false}
        />
      </Provider>,
    );

    const positivePenaltyBtn = await screen.findByText("Penalty");
    expect(positivePenaltyBtn).not.toHaveClass("bg-blue-600");
  });

  it("filters out disabled event definitions from display", async () => {
    const store = createTestStore();

    const presetsWithDisabled = [
      ...mockPresets,
      {
        userId: "user-1",
        eventDefinitionId: "5",
        sportId: "s1",
        sortOrder: 5,
        isEnabled: false,
      },
    ];

    mockUserPresetsWhere.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValueOnce(presetsWithDisabled),
    });

    render(
      <Provider store={store}>
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId={null}
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
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId={null}
          disabled={true}
        />
      </Provider>,
    );

    expect(container.firstChild).toHaveClass("opacity-50");

    const positiveTabBtn = screen.getByRole("tab", { name: /Positive/i });
    expect(positiveTabBtn).toBeDisabled();

    const negativeTabBtn = screen.getByRole("tab", { name: /Negative/i });
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
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId={null}
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
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId={null}
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
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId={null}
          disabled={false}
        />
      </Provider>,
    );

    expect(await screen.findByText("Goal")).toBeInTheDocument();

    const newUserStore = createTestStore("test-match-1", "user-2");
    rerender(
      <Provider store={newUserStore}>
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId={null}
          disabled={false}
        />
      </Provider>,
    );

    expect(clearEventDefinitionsCache).toHaveBeenCalled();
  });

  it("gates action rendering on account switch until new account sport snapshot replaces records", async () => {
    let hydratedUser = "user-A";
    vi.mocked(isSportHydratedForUser).mockImplementation(
      async (_sportId, userId) => !userId || userId === hydratedUser,
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
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId={null}
          disabled={false}
        />
      </Provider>,
    );

    expect(await screen.findByText("Goal")).toBeInTheDocument();

    hydratedUser = "user-A";
    const storeUserB = createTestStore("test-match-1", "user-B");
    rerender(
      <Provider store={storeUserB}>
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId={null}
          disabled={false}
        />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Goal")).not.toBeInTheDocument();
    });

    setHydratedUserIdForSport("s1", "user-B");

    rerender(
      <Provider store={storeUserB}>
        <TTAPanel
          key="user-B-hydrated"
          onActionSelect={vi.fn()}
          selectedActionDefinitionId={null}
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
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId={null}
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
    vi.mocked(isSportHydratedForUser).mockImplementation(
      async () => isHydrated,
    );

    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId={null}
          disabled={false}
        />
      </Provider>,
    );

    await waitFor(() => {
      expect(isSportHydratedForUser).toHaveBeenCalledWith("s1", "user-1");
    });
    expect(screen.queryByText("Goal")).not.toBeInTheDocument();
    vi.mocked(isSportHydratedForUser).mockClear();

    isHydrated = true;
    store.dispatch(incrementHydrationVersion());

    await waitFor(() => {
      expect(isSportHydratedForUser).toHaveBeenCalledWith("s1", "user-1");
    });
    expect(await screen.findByText("Goal")).toBeInTheDocument();
  });

  it("exposes WAI-ARIA tablist, tab, and tabpanel semantics and supports keyboard navigation", async () => {
    const store = createTestStore();

    render(
      <Provider store={store}>
        <TTAPanel
          onActionSelect={vi.fn()}
          selectedActionDefinitionId="1" // Goal (isShot: true) so SHOTS tab is available
          disabled={false}
        />
      </Provider>,
    );

    await screen.findByText("Goal");

    const tablist = screen.getByRole("tablist");
    expect(tablist).toBeInTheDocument();

    const positiveTab = screen.getByRole("tab", { name: /Positive/i });
    const negativeTab = screen.getByRole("tab", { name: /Negative/i });
    const mapTab = screen.getByRole("tab", { name: /Map/i });
    const shotsTab = screen.getByRole("tab", { name: /SHOTS/i });
    const tabpanel = screen.getByRole("tabpanel");

    expect(positiveTab).toHaveAttribute("aria-selected", "true");
    expect(shotsTab).toHaveAttribute("aria-selected", "false");
    expect(tabpanel).toHaveAttribute("aria-labelledby", positiveTab.id);
    expect(positiveTab).toHaveAttribute("aria-controls", tabpanel.id);

    // Navigate with End directly to SHOTS tab
    positiveTab.focus();
    fireEvent.keyDown(positiveTab, { key: "End" });

    expect(shotsTab).toHaveAttribute("aria-selected", "true");
    expect(positiveTab).toHaveAttribute("aria-selected", "false");
    expect(document.activeElement).toBe(shotsTab);
    expect(tabpanel).toHaveAttribute("aria-labelledby", shotsTab.id);
    expect(screen.getByTestId("interactive-shotMap")).toBeInTheDocument();

    // Wrap around with ArrowRight back to Positive tab
    fireEvent.keyDown(shotsTab, { key: "ArrowRight" });
    expect(positiveTab).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(positiveTab);

    // Move backward with ArrowLeft to wrap to SHOTS, then Home to Positive
    fireEvent.keyDown(positiveTab, { key: "ArrowLeft" });
    expect(shotsTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(shotsTab, { key: "Home" });
    expect(positiveTab).toHaveAttribute("aria-selected", "true");
    expect(negativeTab).toHaveAttribute("aria-selected", "false");
    expect(mapTab).toHaveAttribute("aria-selected", "false");
  });
});
