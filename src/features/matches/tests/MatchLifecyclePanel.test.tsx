import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MatchLifecyclePanel } from "../components/MatchLifecyclePanel";
import matchReducer from "../store/matchSlice";
import presenceReducer from "../../../features/playerpresences/store/presenceSlice";
import { usePlayerPresence } from "../../../features/playerpresences/hooks/usePlayerPresence";
import { db } from "../../../db/ttaDatabase";

vi.mock("../../../features/playerpresences/hooks/usePlayerPresence");
vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    timeanchors: {
      add: vi.fn().mockResolvedValue("anchor-id"),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

const createTestStore = (preloadedState = {}) => {
  return configureStore({
    reducer: {
      match: matchReducer,
      presence: presenceReducer,
    },
    preloadedState: {
      match: {
        activeMatchId: "test-match-id",
        periodnumber: 1,
        homescore: 0,
        guestscore: 0,
        isPeriodActive: false,
        isInsideStoppage: true,
        globalSequenceNumber: 0,
        recentActions: [],
        ...preloadedState,
      },
    },
  });
};

describe("MatchLifecyclePanel Component Integration", () => {
  const defaultPresenceMock: ReturnType<typeof usePlayerPresence> = {
    currentPeriod: 1,
    activeLineupIds: [],
    benchLineupIds: [],
    selectedStartingIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
    activePlayersLimit: 7,
    startPeriodWithRoster: vi.fn().mockResolvedValue(undefined),
    endPeriodWithRoster: vi.fn().mockResolvedValue(undefined),
    refreshPresenceFromDB: vi.fn().mockResolvedValue(undefined),
    stageStartingLineup: vi.fn(),
    executeSubstitution: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePlayerPresence).mockReturnValue(defaultPresenceMock);
  });

  it("should render component structure properly", () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );
    expect(screen.getByText(/^Period$/i)).toBeInTheDocument();
  });

  it("should allow navigating periods when period is inactive", () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "<" }));
    expect(store.getState().match.periodnumber).toBe(1); // Blocked below 1 or handled by action

    fireEvent.click(screen.getByRole("button", { name: ">" }));
    expect(store.getState().match.periodnumber).toBe(2);
  });

  it("should trigger successful period start flow", async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /START PERIOD/i }));
    });

    expect(store.getState().match.isPeriodActive).toBe(true);
    expect(defaultPresenceMock.startPeriodWithRoster).toHaveBeenCalledTimes(1);
  });

  it("should successfully trigger period end flow", async () => {
    const store = createTestStore({ isPeriodActive: true });
    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /END PERIOD/i }));
    });

    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(defaultPresenceMock.endPeriodWithRoster).toHaveBeenCalledTimes(1);
  });

  it("should restore isPeriodActive to false if startPeriodWithRoster fails after anchor write", async () => {
    const store = createTestStore();
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultPresenceMock,
      startPeriodWithRoster: vi
        .fn()
        .mockRejectedValue(new Error("Roster persistence failed")),
    });

    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /START PERIOD/i }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to start period. Transaction fully reverted.",
    );
    expect(store.getState().match.isPeriodActive).toBe(false);
    expect(db.timeanchors.delete).toHaveBeenCalledWith(expect.any(String));
  });

  it("should restore isPeriodActive to true if endPeriodWithRoster fails after anchor write", async () => {
    const store = createTestStore({ isPeriodActive: true });
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultPresenceMock,
      endPeriodWithRoster: vi
        .fn()
        .mockRejectedValue(new Error("Roster termination failed")),
    });

    render(
      <Provider store={store}>
        <MatchLifecyclePanel />
      </Provider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /END PERIOD/i }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to end period. Transaction fully reverted.",
    );
    expect(store.getState().match.isPeriodActive).toBe(true);
    expect(db.timeanchors.delete).toHaveBeenCalledWith(expect.any(String));
  });
});
