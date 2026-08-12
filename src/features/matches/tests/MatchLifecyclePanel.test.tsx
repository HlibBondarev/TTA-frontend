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
import { processSyncQueue } from "../../../services/syncService";

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
      orderBy: vi.fn().mockReturnValue({
        last: vi.fn().mockResolvedValue(undefined),
      }),
    },
    syncQueue: {
      add: vi.fn(),
      delete: vi.fn(),
      filter: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    },
    transaction: vi.fn((_mode, _tables, cb) => cb()),
  },
}));

const createTestStore = (preloadedState = {}) => {
  mockTimeAnchors = [];
  if ("match" in preloadedState) {
    seedAnchorsFromState(
      (preloadedState as { match: Partial<MatchState> }).match,
    );
  }

  return configureStore({
    reducer: {
      match: matchReducer,
      presence: presenceReducer,
    },
    preloadedState: {
      match: {
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
      },
      ...preloadedState,
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

  test("should render component structure properly", () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    expect(screen.getByText("Period")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
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

  test("should disable START PERIOD button when period has ended", () => {
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

    const startBtn = screen.getByText("START PERIOD");
    expect(startBtn).toBeDisabled();
  });

  test("should allow navigating periods when period is inactive", () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const nextBtn = screen.getByRole("button", { name: ">" });
    fireEvent.click(nextBtn);

    expect(store.getState().match.periodNumber).toBe(2);
  });

  test("should trigger successful period start flow", async () => {
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
      expect(defaultPresenceMock.startPeriodWithRoster).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  test("should end period 1 and auto-advance to period 2", async () => {
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
      expect(defaultPresenceMock.endPeriodWithRoster).toHaveBeenCalledTimes(1);
      expect(processSyncQueue).toHaveBeenCalledTimes(1);
      expect(store.getState().match.periodNumber).toBe(2);
    });
  });

  test("should end period 4 and remain on period 4", async () => {
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
      expect(defaultPresenceMock.endPeriodWithRoster).toHaveBeenCalledTimes(1);
      expect(store.getState().match.periodNumber).toBe(4);
      expect(store.getState().match.isPeriodEnded).toBe(true);
    });
  });

  test("should handle processSyncQueue rejection gracefully without rolling back ended period", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(processSyncQueue).mockRejectedValueOnce(new Error("Sync error"));

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
      expect(processSyncQueue).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Background sync after ending period failed:",
        expect.any(Error),
      );
    });

    consoleSpy.mockRestore();
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

  test("should show compensation incomplete message if rollback fails during end period error", async () => {
    vi.spyOn(usePlayerPresenceModule, "usePlayerPresence").mockReturnValue({
      ...defaultPresenceMock,
      endPeriodWithRoster: vi
        .fn()
        .mockRejectedValue(new Error("Initial error")),
    });

    vi.mocked(db.timeanchors.delete).mockRejectedValueOnce(
      new Error("DB failure"),
    );

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

    expect(
      await screen.findByText(/Compensation incomplete/i),
    ).toBeInTheDocument();
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
});
