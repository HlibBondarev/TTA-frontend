import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { ActionsLog } from "../components/ActionsLog";
import matchReducer, { type ActionEntry } from "../store/matchSlice";
import * as eventService from "../../../db/eventService";

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matchlineups: {
      get: vi.fn().mockImplementation((id: string) => {
        const lineups: Record<
          string,
          { id: string; number: number; matchId: string }
        > = {
          "lineup-1": { id: "lineup-1", number: 5, matchId: "test-match" },
          "lineup-2": { id: "lineup-2", number: 3, matchId: "test-match" },
        };
        return Promise.resolve(lineups[id]);
      }),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { id: "lineup-1", number: 5, matchId: "test-match" },
            { id: "lineup-2", number: 3, matchId: "test-match" },
          ]),
        }),
      }),
    },
    eventdefinitions: {
      toArray: vi.fn().mockResolvedValue([
        { id: "def-1", name: "Goal", isPositive: true },
        { id: "def-2", name: "Turnover", isPositive: false },
      ]),
    },
  },
}));

vi.mock("../../../db/eventService", () => ({
  updateGameEventTx: vi.fn(),
  deleteGameEventTx: vi.fn(),
  getEventDefinitionByName: vi.fn(),
}));

const createStoreWithActions = (actions: ActionEntry[]) => {
  return configureStore({
    reducer: { match: matchReducer },
    preloadedState: {
      match: {
        activeMatchId: "test-match",
        activeTeamId: "test-team",
        periodNumber: 1,
        homeScore: 0,
        guestScore: 0,
        isPeriodActive: true,
        isInsideStoppage: false,
        isPeriodEnded: false,
        globalSequenceNumber: 2,
        recentActions: actions,
      },
    },
  });
};

describe("ActionsLog Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty actions log message when no actions exist", () => {
    const store = createStoreWithActions([]);
    render(
      <Provider store={store}>
        <ActionsLog />
      </Provider>,
    );

    expect(screen.getByText("Last Actions")).toBeInTheDocument();
    expect(screen.getByText("No actions recorded yet.")).toBeInTheDocument();
  });

  it("renders recent actions with correct formatting and conditional colors", () => {
    const store = createStoreWithActions([
      {
        id: "action-1",
        playerNumber: 5,
        actionName: "Goal",
        isPositive: true,
        timestamp: new Date("2026-07-20T12:00:00Z").toISOString(),
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        isLeadToGoal: false,
        isSynced: 0,
      },
      {
        id: "action-2",
        playerNumber: 3,
        actionName: "Turnover",
        isPositive: false,
        timestamp: new Date("2026-07-20T12:01:00Z").toISOString(),
        matchLineupId: "lineup-2",
        eventDefinitionId: "def-2",
        isLeadToGoal: false,
        isSynced: 0,
      },
    ]);

    render(
      <Provider store={store}>
        <ActionsLog />
      </Provider>,
    );

    expect(screen.getByText("Last Actions")).toBeInTheDocument();

    const positiveAction = screen.getByText("#5 Goal");
    expect(positiveAction).toBeInTheDocument();
    expect(positiveAction).toHaveClass("text-emerald-400");

    const negativeAction = screen.getByText("#3 Turnover");
    expect(negativeAction).toBeInTheDocument();
    expect(negativeAction).toHaveClass("text-rose-400");
  });

  it("allows toggling Goal Lead checkbox for unsynced non-goal actions", async () => {
    vi.mocked(eventService.getEventDefinitionByName).mockResolvedValue({
      id: "def-2",
      sportId: "s1",
      name: "Turnover",
      shortName: "TO",
      isPositive: false,
      createdAt: "",
    });

    vi.mocked(eventService.updateGameEventTx).mockResolvedValue({
      id: "action-2",
      matchLineupId: "lineup-2",
      eventDefinitionId: "def-2",
      periodNumber: 1,
      eventTimestamp: "",
      isLeadToGoal: true,
      createdAt: "",
      sequenceNumber: 1,
      isSynced: 0,
    });

    const store = createStoreWithActions([
      {
        id: "action-2",
        playerNumber: 3,
        actionName: "Turnover",
        isPositive: false,
        timestamp: new Date().toISOString(),
        matchLineupId: "lineup-2",
        eventDefinitionId: "def-2",
        isLeadToGoal: false,
        isSynced: 0,
      },
    ]);

    render(
      <Provider store={store}>
        <ActionsLog />
      </Provider>,
    );

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(eventService.updateGameEventTx).toHaveBeenCalledWith({
        eventId: "action-2",
        matchLineupId: "lineup-2",
        eventDefinitionId: "def-2",
        isLeadToGoal: true,
      });
    });
  });

  it("renders lock icon 🔒 and shows inline error messages without opening modals for synced events (isSynced === 1)", () => {
    const store = createStoreWithActions([
      {
        id: "action-synced",
        playerNumber: 5,
        actionName: "Goal",
        isPositive: true,
        timestamp: new Date().toISOString(),
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        isLeadToGoal: false,
        isSynced: 1,
      },
    ]);

    render(
      <Provider store={store}>
        <ActionsLog />
      </Provider>,
    );

    // 1. Verify lock icon is visible
    expect(screen.getByText("🔒")).toBeInTheDocument();

    // 2. Click edit button -> Displays inline error and blocks modal
    const editBtn = screen.getByTitle("Cannot edit synced event");
    fireEvent.click(editBtn);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Cannot edit a synchronized event.",
    );
    expect(screen.queryByText("Edit Action")).not.toBeInTheDocument();

    // 3. Click delete button -> Displays inline error and blocks confirmation modal
    const deleteBtn = screen.getByTitle("Cannot delete synced event");
    fireEvent.click(deleteBtn);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Cannot delete a synchronized event.",
    );
    expect(screen.queryByText("Delete Action")).not.toBeInTheDocument();
  });

  it("opens custom delete confirmation modal and calls deleteGameEventTx upon confirmation for unsynced events", async () => {
    vi.mocked(eventService.deleteGameEventTx).mockResolvedValue(undefined);

    const store = createStoreWithActions([
      {
        id: "action-del",
        playerNumber: 5,
        actionName: "Turnover",
        isPositive: false,
        timestamp: new Date().toISOString(),
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-2",
        isLeadToGoal: false,
        isSynced: 0,
      },
    ]);

    render(
      <Provider store={store}>
        <ActionsLog />
      </Provider>,
    );

    // 1. Click delete button -> Custom modal appears
    fireEvent.click(screen.getByTitle("Delete Action"));

    expect(
      screen.getByText(
        "Are you sure you want to delete this action? (#5 Turnover)",
      ),
    ).toBeInTheDocument();

    // 2. Click "Cancel" -> Modal closes without calling API
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByText(
        "Are you sure you want to delete this action? (#5 Turnover)",
      ),
    ).not.toBeInTheDocument();
    expect(eventService.deleteGameEventTx).not.toHaveBeenCalled();

    // 3. Click delete button again and confirm -> API is invoked
    fireEvent.click(screen.getByTitle("Delete Action"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(eventService.deleteGameEventTx).toHaveBeenCalledWith("action-del");
    });
  });
});
