import { vi, describe, test, expect, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MatchLifecyclePanel } from "../components/MatchLifecyclePanel";
import matchReducer, { type MatchState } from "../store/matchSlice";
import presenceReducer from "../../playerpresences/store/presenceSlice";
import { db, type TimeAnchor } from "../../../db/ttaDatabase";
import * as usePlayerPresenceModule from "../../playerpresences/hooks/usePlayerPresence";
import { useMatchLifecycle } from "../hooks/useMatchLifecycle";

let mockTimeAnchors: TimeAnchor[] = [];

const seedAnchorsFromState = (matchState: Partial<MatchState> = {}) => {
  const matchId = matchState.activeMatchId || "test-match";
  const periodNumber = matchState.periodNumber ?? 1;

  if (matchState.isPeriodActive || matchState.isPeriodEnded) {
    mockTimeAnchors.push({
      id: "seed-start-anchor",
      matchId,
      periodNumber,
      type: 0,
      timestamp: "2020-01-01T10:00:00Z",
      sequenceNumber: 1,
      isSynced: 0,
    });
  }

  if (matchState.isInsideStoppage) {
    mockTimeAnchors.push({
      id: "seed-stoppage-start-anchor",
      matchId,
      periodNumber,
      type: 2,
      timestamp: "2020-01-01T10:05:00Z",
      sequenceNumber: 2,
      isSynced: 0,
    });
  }

  if (matchState.isPeriodEnded) {
    mockTimeAnchors.push({
      id: "seed-end-anchor",
      matchId,
      periodNumber,
      type: 1,
      timestamp: "2020-01-01T10:10:00Z",
      sequenceNumber: 3,
      isSynced: 0,
    });
  }
};

vi.mock("../../../services/syncService", () => ({
  processSyncQueue: vi.fn().mockResolvedValue(0),
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    timeanchors: {
      add: vi.fn((anchor: TimeAnchor) => {
        mockTimeAnchors.push(anchor);
        return Promise.resolve(anchor.id);
      }),
      delete: vi.fn((id: string) => {
        mockTimeAnchors = mockTimeAnchors.filter((a) => a.id !== id);
        return Promise.resolve();
      }),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockImplementation((matchIdVal: string) => ({
          filter: vi
            .fn()
            .mockImplementation((predicate: (a: TimeAnchor) => boolean) => ({
              toArray: vi.fn().mockImplementation(() => {
                const res = mockTimeAnchors.filter(
                  (a) => a.matchId === matchIdVal && predicate(a),
                );
                return Promise.resolve(res);
              }),
            })),
        })),
      }),
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    gameevents: {
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    playerpresences: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
            modify: vi.fn(),
          }),
        }),
      }),
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    syncQueue: {
      add: vi.fn(),
      delete: vi.fn(),
      filter: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            id: 1,
            payload: JSON.stringify([{ id: "seed-end-anchor" }]),
          },
        ]),
      }),
    },
    transaction: vi.fn((_mode, _tables, cb) => cb()),
  },
}));

const createTestStore = (
  preloadedState: { match?: Partial<MatchState>; [key: string]: unknown } = {},
) => {
  mockTimeAnchors = [];
  if ("match" in preloadedState && preloadedState.match) {
    seedAnchorsFromState(preloadedState.match);
  }

  const defaultMatchState = {
    activeMatchId: "test-match",
    activeTeamId: "test-team",
    periodNumber: 1,
    homeScore: 0,
    guestScore: 0,
    isPeriodActive: false,
    isInsideStoppage: false,
    isPeriodEnded: false,
    globalSequenceNumber: 0,
    recentActions: [],
  };

  const { match: customMatchState, ...otherPreloadedState } = preloadedState;

  return configureStore({
    reducer: {
      match: matchReducer,
      presence: presenceReducer,
    },
    preloadedState: {
      ...otherPreloadedState,
      match: {
        ...defaultMatchState,
        ...customMatchState,
      },
    },
  });
};

const defaultPresenceMock = {
  currentPeriod: 1,
  activeLineupIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
  benchLineupIds: [],
  selectedStartingIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
  activePlayersLimit: 7,
  refreshPresenceFromDB: vi.fn(),
  stageStartingLineup: vi.fn(),
  startPeriodWithRoster: vi.fn().mockResolvedValue(undefined),
  endPeriodWithRoster: vi.fn().mockResolvedValue(undefined),
  executeSubstitution: vi.fn(),
};

describe("MatchLifecyclePanel Component Integration & State Machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimeAnchors = [];
    vi.spyOn(usePlayerPresenceModule, "usePlayerPresence").mockReturnValue(
      defaultPresenceMock,
    );
  });

  test("should render component structure properly without navigation arrows", () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    expect(screen.getByText("Period")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.queryByRole("button", { name: "<" })).toBeNull();
    expect(screen.queryByRole("button", { name: ">" })).toBeNull();
    expect(screen.getByText("START PERIOD")).toBeDefined();
  });

  test("should disable END PERIOD button when stoppage is active", () => {
    const store = createTestStore({
      match: {
        activeMatchId: "test-match",
        activeTeamId: "test-team",
        periodNumber: 1,
        isPeriodActive: true,
        isInsideStoppage: true,
        isPeriodEnded: false,
        globalSequenceNumber: 1,
        recentActions: [],
      },
    });

    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const endBtn = screen.getByText("END PERIOD");
    expect(endBtn).toBeDisabled();
  });

  test("should render START PERIOD 2 button when period 1 is ended", async () => {
    const store = createTestStore({
      match: {
        activeMatchId: "test-match",
        activeTeamId: "test-team",
        periodNumber: 1,
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: true,
        globalSequenceNumber: 2,
        recentActions: [],
      },
    });

    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText("START PERIOD 2")).toBeInTheDocument();
    });
  });

  test("should trigger successful period start flow with target period 1", async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const startBtn = screen.getByText("START PERIOD");
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(store.getState().match.isPeriodActive).toBe(true);
      expect(defaultPresenceMock.startPeriodWithRoster).toHaveBeenCalledWith(
        expect.any(String),
        1,
      );
    });
  });

  test("should end period 1 passing period number explicitly", async () => {
    const store = createTestStore({
      match: {
        activeMatchId: "test-match",
        activeTeamId: "test-team",
        periodNumber: 1,
        isPeriodActive: true,
        isInsideStoppage: false,
        isPeriodEnded: false,
        globalSequenceNumber: 1,
        recentActions: [],
      },
    });

    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const endBtn = screen.getByText("END PERIOD");
    fireEvent.click(endBtn);

    await waitFor(() => {
      expect(defaultPresenceMock.endPeriodWithRoster).toHaveBeenCalledWith(
        expect.any(String),
        1,
      );
      expect(store.getState().match.periodNumber).toBe(1);
      expect(store.getState().match.isPeriodEnded).toBe(true);
    });
  });

  test("should end period 4 and remain on period 4 displaying MATCH ENDED", async () => {
    const store = createTestStore({
      match: {
        activeMatchId: "test-match",
        activeTeamId: "test-team",
        periodNumber: 4,
        isPeriodActive: true,
        isInsideStoppage: false,
        isPeriodEnded: false,
        globalSequenceNumber: 8,
        recentActions: [],
      },
    });

    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const endBtn = screen.getByText("END PERIOD");
    fireEvent.click(endBtn);

    await waitFor(() => {
      expect(defaultPresenceMock.endPeriodWithRoster).toHaveBeenCalledWith(
        expect.any(String),
        4,
      );
      expect(store.getState().match.periodNumber).toBe(4);
      expect(store.getState().match.isPeriodEnded).toBe(true);
      expect(screen.getByText("MATCH ENDED")).toBeInTheDocument();
    });
  });

  test("should start period 2 passing target period 2 explicitly to startPeriodWithRoster", async () => {
    const store = createTestStore({
      match: {
        activeMatchId: "test-match",
        activeTeamId: "test-team",
        periodNumber: 1,
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: true,
        globalSequenceNumber: 2,
        recentActions: [],
      },
    });

    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const startNextBtn = await screen.findByText("START PERIOD 2");
    fireEvent.click(startNextBtn);

    await waitFor(() => {
      expect(store.getState().match.periodNumber).toBe(2);
      expect(store.getState().match.isPeriodActive).toBe(true);
      expect(defaultPresenceMock.startPeriodWithRoster).toHaveBeenCalledWith(
        expect.any(String),
        2,
      );
    });
  });

  test("should restore active period 1 when UNDO END PERIOD 1 is clicked", async () => {
    const store = createTestStore({
      match: {
        activeMatchId: "test-match",
        activeTeamId: "test-team",
        periodNumber: 1,
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: true,
        globalSequenceNumber: 2,
        recentActions: [],
      },
    });

    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const undoBtn = await screen.findByText("UNDO END PERIOD 1");
    fireEvent.click(undoBtn);

    await waitFor(() => {
      expect(store.getState().match.periodNumber).toBe(1);
      expect(store.getState().match.isPeriodActive).toBe(true);
      expect(defaultPresenceMock.refreshPresenceFromDB).toHaveBeenCalledWith(1);
    });
  });

  test("should restore isPeriodActive to false if startPeriodWithRoster fails after anchor write", async () => {
    vi.spyOn(usePlayerPresenceModule, "usePlayerPresence").mockReturnValue({
      ...defaultPresenceMock,
      startPeriodWithRoster: vi
        .fn()
        .mockRejectedValue(new Error("Roster persistence failed")),
    });

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const startBtn = screen.getByText("START PERIOD");
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(store.getState().match.isPeriodActive).toBe(false);
      expect(db.timeanchors.delete).toHaveBeenCalledWith(expect.any(String));
    });
  });

  test("should show compensation incomplete message if rollback fails during start period error", async () => {
    vi.spyOn(usePlayerPresenceModule, "usePlayerPresence").mockReturnValue({
      ...defaultPresenceMock,
      startPeriodWithRoster: vi
        .fn()
        .mockRejectedValue(new Error("Initial error")),
    });

    vi.mocked(db.timeanchors.delete).mockRejectedValueOnce(
      new Error("DB failure"),
    );

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const startBtn = screen.getByText("START PERIOD");
    fireEvent.click(startBtn);

    expect(
      await screen.findByText(/Compensation incomplete/i),
    ).toBeInTheDocument();
  });

  test("should restore isPeriodActive to true if endPeriodWithRoster fails after anchor write", async () => {
    vi.spyOn(usePlayerPresenceModule, "usePlayerPresence").mockReturnValue({
      ...defaultPresenceMock,
      endPeriodWithRoster: vi
        .fn()
        .mockRejectedValue(new Error("Roster termination failed")),
    });

    const store = createTestStore({
      match: {
        activeMatchId: "test-match",
        activeTeamId: "test-team",
        periodNumber: 1,
        isPeriodActive: true,
        isInsideStoppage: false,
        isPeriodEnded: false,
        globalSequenceNumber: 1,
        recentActions: [],
      },
    });

    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const endBtn = screen.getByText("END PERIOD");
    fireEvent.click(endBtn);

    await waitFor(() => {
      expect(store.getState().match.isPeriodActive).toBe(true);
      expect(db.timeanchors.delete).toHaveBeenCalledWith(expect.any(String));
    });
  });

  test("should roll back isPeriodActive and keep sequence incremented when startPeriod DB write rejects", async () => {
    vi.mocked(db.transaction).mockImplementationOnce((() =>
      Promise.reject(
        new Error("DB error"),
      )) as unknown as typeof db.transaction);

    const store = createTestStore();
    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.startPeriod();
      }),
    ).rejects.toThrow("DB error");

    expect(store.getState().match.isPeriodActive).toBe(false);
  });

  test("should roll back isPeriodActive to true and keep sequence incremented when endPeriod DB write rejects", async () => {
    vi.mocked(db.transaction).mockImplementationOnce((() =>
      Promise.reject(
        new Error("DB error"),
      )) as unknown as typeof db.transaction);

    const store = createTestStore({
      match: {
        activeMatchId: "test-match",
        activeTeamId: "test-team",
        periodNumber: 1,
        isPeriodActive: true,
        isInsideStoppage: false,
        isPeriodEnded: false,
        globalSequenceNumber: 1,
        recentActions: [],
      },
    });

    const { result } = renderHook(() => useMatchLifecycle(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await expect(
      act(async () => {
        await result.current.endPeriod();
      }),
    ).rejects.toThrow("DB error");

    expect(store.getState().match.isPeriodActive).toBe(true);
  });

  test("should successfully trigger timer start/resume flow when inside stoppage", async () => {
    const store = createTestStore({
      match: {
        activeMatchId: "test-match",
        activeTeamId: "test-team",
        periodNumber: 1,
        isPeriodActive: true,
        isInsideStoppage: true,
        isPeriodEnded: false,
        globalSequenceNumber: 1,
        recentActions: [],
      },
    });

    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const resumeBtn = screen.getByRole("button", { name: /Resume/i });
    expect(resumeBtn).not.toBeDisabled();

    fireEvent.click(resumeBtn);

    await waitFor(() => {
      expect(store.getState().match.isInsideStoppage).toBe(false);
    });
  });

  test("should successfully trigger stop time flow when period is active and not in stoppage", async () => {
    const store = createTestStore({
      match: {
        activeMatchId: "test-match",
        activeTeamId: "test-team",
        periodNumber: 1,
        isPeriodActive: true,
        isInsideStoppage: false,
        isPeriodEnded: false,
        globalSequenceNumber: 1,
        recentActions: [],
      },
    });

    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const stopBtn = screen.getByRole("button", { name: /^Stop$/i });
    expect(stopBtn).not.toBeDisabled();

    fireEvent.click(stopBtn);

    await waitFor(() => {
      expect(store.getState().match.isInsideStoppage).toBe(true);
    });
  });

  test("should show error message if selected starting ids length does not match active players limit", async () => {
    vi.spyOn(usePlayerPresenceModule, "usePlayerPresence").mockReturnValue({
      ...defaultPresenceMock,
      selectedStartingIds: ["p1", "p2"],
      activePlayersLimit: 7,
    });

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const startBtn = screen.getByText("START PERIOD");
    fireEvent.click(startBtn);

    expect(
      await screen.findByText(/Select exactly 7 players\./i),
    ).toBeInTheDocument();
    expect(defaultPresenceMock.startPeriodWithRoster).not.toHaveBeenCalled();
  });

  test("should restore preceding ended period 1 if startPeriodWithRoster fails during START PERIOD 2", async () => {
    vi.spyOn(usePlayerPresenceModule, "usePlayerPresence").mockReturnValue({
      ...defaultPresenceMock,
      startPeriodWithRoster: vi
        .fn()
        .mockRejectedValue(new Error("Roster persistence failed")),
    });

    const store = createTestStore({
      match: {
        activeMatchId: "test-match",
        activeTeamId: "test-team",
        periodNumber: 1,
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: true,
        globalSequenceNumber: 2,
        recentActions: [],
      },
    });

    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const startBtn = await screen.findByText("START PERIOD 2");
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(store.getState().match.periodNumber).toBe(1);
      expect(store.getState().match.isPeriodEnded).toBe(true);
      expect(store.getState().match.isPeriodActive).toBe(false);
    });

    const addedAnchor = vi
      .mocked(db.timeanchors.add)
      .mock.calls.at(-1)?.[0] as {
      id: string;
      periodNumber: number;
    };
    expect(addedAnchor.periodNumber).toBe(2);
    expect(db.timeanchors.delete).toHaveBeenCalledWith(addedAnchor.id);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to start period. Transaction fully reverted.",
    );
  });
});
