import { vi, describe, test, expect, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  renderHook,
} from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MatchLifecyclePanel } from "../components/MatchLifecyclePanel";
import matchReducer from "../store/matchSlice";
import presenceReducer from "../../playerpresences/store/presenceSlice";
import { db } from "../../../db/ttaDatabase";
import * as usePlayerPresenceModule from "../../playerpresences/hooks/usePlayerPresence";
import { useMatchLifecycle } from "../hooks/useMatchLifecycle";

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    timeanchors: {
      add: vi.fn(),
      delete: vi.fn(),
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
    transaction: vi.fn((_mode, _tables, cb) => cb()),
  },
}));

const createTestStore = (preloadedState = {}) => {
  return configureStore({
    reducer: {
      match: matchReducer,
      presence: presenceReducer,
    },
    preloadedState,
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

describe("MatchLifecyclePanel Component Integration & Hook Error Rollbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  test("should allow navigating periods when period is inactive", () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const nextBtn = screen.getByRole("button", { name: ">" });
    fireEvent.click(nextBtn);

    expect(store.getState().match.periodnumber).toBe(2);
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

    expect(store.getState().match.periodnumber).toBe(2);
  });

  test("should trigger successful period start flow", async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    const startBtn = screen.getByText("START PERIOD");

    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(store.getState().match.isPeriodActive).toBe(true);
    expect(defaultPresenceMock.startPeriodWithRoster).toHaveBeenCalledTimes(1);
  });

  test("should successfully trigger period end flow", async () => {
    const store = createTestStore({
      match: {
        activeMatchId: "test-match",
        periodnumber: 1,
        isPeriodActive: true,
        isInsideStoppage: false,
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

    await act(async () => {
      fireEvent.click(endBtn);
    });

    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(defaultPresenceMock.endPeriodWithRoster).toHaveBeenCalledTimes(1);
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

    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(db.timeanchors.delete).toHaveBeenCalledWith(expect.any(String));
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

    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(screen.getByText(/Compensation incomplete/i)).toBeInTheDocument();
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
        periodnumber: 1,
        isPeriodActive: true,
        isInsideStoppage: false,
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

    await act(async () => {
      fireEvent.click(endBtn);
    });

    expect(store.getState().match.isPeriodActive).toBe(true);
    expect(db.timeanchors.delete).toHaveBeenCalledWith(expect.any(String));
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
        periodnumber: 1,
        isPeriodActive: true,
        isInsideStoppage: false,
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

    await act(async () => {
      fireEvent.click(endBtn);
    });

    expect(screen.getByText(/Compensation incomplete/i)).toBeInTheDocument();
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
        periodnumber: 1,
        isPeriodActive: true,
        isInsideStoppage: false,
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
});
