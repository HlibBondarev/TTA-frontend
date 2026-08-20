import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { EditGameEventModal } from "../components/EditGameEventModal";
import matchReducer from "../store/matchSlice";
import * as eventService from "../../../db/eventService";
import { db } from "../../../db/ttaDatabase";

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matchlineups: {
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
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { id: "lineup-1", number: 7, matchId: "match-1" },
            { id: "lineup-2", number: 10, matchId: "match-1" },
          ]),
        }),
      }),
    },
    eventdefinitions: {
      toArray: vi.fn().mockResolvedValue([
        { id: "def-1", name: "Pass", isPositive: true },
        { id: "def-2", name: "Goal", isPositive: true },
        { id: "def-3", name: "Foul", ispositive: false },
      ]),
    },
  },
}));

vi.mock("../../../db/eventService", () => ({
  updateGameEventTx: vi.fn(),
  getEventDefinitionByName: vi.fn(),
}));

const createStore = () =>
  configureStore({
    reducer: { match: matchReducer },
    preloadedState: {
      match: {
        activeMatchId: "match-1",
        activeTeamId: "team-1",
        periodNumber: 1,
        isPeriodActive: true,
        isInsideStoppage: false,
        isPeriodEnded: false,
        globalSequenceNumber: 1,
        recentActions: [],
      },
    },
  });

describe("EditGameEventModal Component", () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when isOpen is false or action is null", () => {
    const store = createStore();
    const { container } = render(
      <Provider store={store}>
        <EditGameEventModal
          isOpen={false}
          action={sampleAction}
          matchId="match-1"
          onClose={vi.fn()}
        />
      </Provider>,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders full roster player buttons and action types when open", async () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <EditGameEventModal
          isOpen={true}
          action={sampleAction}
          matchId="match-1"
          onClose={vi.fn()}
        />
      </Provider>,
    );

    expect(screen.getByText("Edit Action")).toBeInTheDocument();
    expect(await screen.findByText("#7")).toBeInTheDocument();
    expect(screen.getByText("#10")).toBeInTheDocument();
    expect(screen.getByText("Pass")).toBeInTheDocument();
  });

  it("allows switching between Positive and Negative action tabs", async () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <EditGameEventModal
          isOpen={true}
          action={sampleAction}
          matchId="match-1"
          onClose={vi.fn()}
        />
      </Provider>,
    );

    expect(await screen.findByText("Pass")).toBeInTheDocument();

    const negativeTab = screen.getByRole("button", { name: "Negative" });
    fireEvent.click(negativeTab);

    expect(screen.getByText("Foul")).toBeInTheDocument();
    expect(screen.queryByText("Pass")).not.toBeInTheDocument();
  });

  it("forces isLeadToGoal to false when switching action to Goal", async () => {
    vi.mocked(eventService.updateGameEventTx).mockResolvedValue({
      id: "action-123",
      matchLineupId: "lineup-2",
      eventDefinitionId: "def-2",
      periodNumber: 1,
      eventTimestamp: "",
      isLeadToGoal: false,
      createdAt: "",
      sequenceNumber: 1,
      isSynced: 0,
    });

    const mockOnClose = vi.fn();
    const store = createStore();

    render(
      <Provider store={store}>
        <EditGameEventModal
          isOpen={true}
          action={sampleAction} // action with isLeadToGoal: true
          matchId="match-1"
          onClose={mockOnClose}
        />
      </Provider>,
    );

    // Select player #10
    const player10Btn = await screen.findByText("#10");
    fireEvent.click(player10Btn);

    // Select new action "Goal" (def-2)
    const goalBtn = screen.getByText("Goal");
    fireEvent.click(goalBtn);

    // Save changes
    const saveBtn = screen.getByRole("button", { name: /Save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(eventService.getEventDefinitionByName).not.toHaveBeenCalled();
      expect(eventService.updateGameEventTx).toHaveBeenCalledWith({
        eventId: "action-123",
        matchLineupId: "lineup-2",
        eventDefinitionId: "def-2",
        isLeadToGoal: false, // forced to false for Goal actions
      });
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("preserves isLeadToGoal flag as true when saving a non-goal action", async () => {
    vi.mocked(eventService.updateGameEventTx).mockResolvedValue({
      id: "action-123",
      matchLineupId: "lineup-2",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "",
      isLeadToGoal: true,
      createdAt: "",
      sequenceNumber: 1,
      isSynced: 0,
    });

    const mockOnClose = vi.fn();
    const store = createStore();

    render(
      <Provider store={store}>
        <EditGameEventModal
          isOpen={true}
          action={sampleAction} // action with isLeadToGoal: true and actionName: "Pass"
          matchId="match-1"
          onClose={mockOnClose}
        />
      </Provider>,
    );

    // Select player #10
    const player10Btn = await screen.findByText("#10");
    fireEvent.click(player10Btn);

    // Save changes without switching to "Goal"
    const saveBtn = screen.getByRole("button", { name: /Save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(eventService.updateGameEventTx).toHaveBeenCalledWith({
        eventId: "action-123",
        matchLineupId: "lineup-2",
        eventDefinitionId: "def-1",
        isLeadToGoal: true, // preserves existing isLeadToGoal: true
      });
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("displays error alert when updateGameEventTx fails on save", async () => {
    vi.mocked(eventService.updateGameEventTx).mockRejectedValueOnce(
      new Error("Database write error"),
    );

    const store = createStore();

    render(
      <Provider store={store}>
        <EditGameEventModal
          isOpen={true}
          action={sampleAction}
          matchId="match-1"
          onClose={vi.fn()}
        />
      </Provider>,
    );

    const saveBtn = await screen.findByRole("button", { name: /Save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Database write error",
      );
    });
  });

  it("handles loading errors for match roster and action definitions", async () => {
    vi.mocked(db.matchlineups.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockRejectedValueOnce(new Error("Roster error")),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

    vi.mocked(db.eventdefinitions.toArray).mockRejectedValueOnce(
      new Error("Defs error"),
    );

    const store = createStore();

    render(
      <Provider store={store}>
        <EditGameEventModal
          isOpen={true}
          action={sampleAction}
          matchId="match-1"
          onClose={vi.fn()}
        />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("closes modal on Cancel button and close button click", async () => {
    const mockOnClose = vi.fn();
    const store = createStore();

    render(
      <Provider store={store}>
        <EditGameEventModal
          isOpen={true}
          action={sampleAction}
          matchId="match-1"
          onClose={mockOnClose}
        />
      </Provider>,
    );

    const cancelBtn = await screen.findByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    const closeBtn = screen.getByText("✕");
    fireEvent.click(closeBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(2);
  });
});
