import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { EditGameEventModal } from "../components/EditGameEventModal";
import matchReducer from "../store/matchSlice";
import * as eventService from "../../../db/eventService";
import { db } from "../../../db/ttaDatabase";

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    user: { sub: "user-123", email: "test@example.com" },
  }),
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    matches: {
      get: vi.fn().mockResolvedValue({
        id: "match-1",
        tournamentId: "tour-1",
      }),
    },
    tournaments: {
      get: vi.fn().mockResolvedValue({
        id: "tour-1",
        sportId: "sport-1",
        configurationId: "config-1",
      }),
    },
    sportconfigurations: {
      get: vi.fn().mockResolvedValue({
        id: "config-1",
        playground: '<svg viewBox="0 0 1000 500">Court</svg>',
        shotMap: '<svg viewBox="0 0 100 100">Goal</svg>',
      }),
    },
    gameevents: {
      get: vi.fn().mockResolvedValue({
        id: "action-123",
        locationX: 35.5,
        locationY: 70.0,
        shotLocationX: null,
        shotLocationY: null,
      }),
    },
    usereventpresets: {
      where: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { eventDefinitionId: "def-1", isEnabled: true, sortOrder: 1 },
          { eventDefinitionId: "def-2", isEnabled: true, sortOrder: 2 },
          { eventDefinitionId: "def-3", isEnabled: true, sortOrder: 3 },
        ]),
      }),
    },
    eventdefinitions: {
      bulkGet: vi.fn().mockResolvedValue([
        { id: "def-1", name: "Pass", isPositive: true, isShot: false },
        { id: "def-2", name: "Goal", isPositive: true, isShot: true },
        { id: "def-3", name: "Foul", isPositive: false, isShot: false },
      ]),
      get: vi.fn().mockImplementation((id: string) => {
        const defs: Record<
          string,
          { id: string; name: string; isPositive: boolean; isShot?: boolean }
        > = {
          "def-1": {
            id: "def-1",
            name: "Pass",
            isPositive: true,
            isShot: false,
          },
          "def-2": {
            id: "def-2",
            name: "Goal",
            isPositive: true,
            isShot: true,
          },
          "def-3": {
            id: "def-3",
            name: "Foul",
            isPositive: false,
            isShot: false,
          },
        };
        return Promise.resolve(defs[id]);
      }),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { id: "def-1", name: "Pass", isPositive: true, isShot: false },
            { id: "def-2", name: "Goal", isPositive: true, isShot: true },
            { id: "def-3", name: "Foul", isPositive: false, isShot: false },
          ]),
        }),
      }),
    },
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
  },
}));

vi.mock("../../../db/eventService", () => ({
  updateGameEventTx: vi.fn(),
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
        hydrationVersion: 0,
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

  it("allows switching between Positive and Negative action tabs and preserves selection", async () => {
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

    const saveBtn = screen.getByRole("button", { name: /Save/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
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
          action={sampleAction}
          matchId="match-1"
          onClose={mockOnClose}
        />
      </Provider>,
    );

    const player10Btn = await screen.findByText("#10");
    fireEvent.click(player10Btn);

    const goalBtn = screen.getByText("Goal");
    fireEvent.click(goalBtn);

    const saveBtn = screen.getByRole("button", { name: /Save/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(eventService.updateGameEventTx).toHaveBeenCalledWith({
        eventId: "action-123",
        matchLineupId: "lineup-2",
        eventDefinitionId: "def-2",
        expectedSportId: "sport-1",
        isLeadToGoal: false,
        locationX: 35.5,
        locationY: 70,
        shotLocationX: null,
        shotLocationY: null,
        userId: "user-123",
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
          action={sampleAction}
          matchId="match-1"
          onClose={mockOnClose}
        />
      </Provider>,
    );

    const player10Btn = await screen.findByText("#10");
    fireEvent.click(player10Btn);

    const saveBtn = screen.getByRole("button", { name: /Save/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(eventService.updateGameEventTx).toHaveBeenCalledWith({
        eventId: "action-123",
        matchLineupId: "lineup-2",
        eventDefinitionId: "def-1",
        expectedSportId: "sport-1",
        isLeadToGoal: true,
        locationX: 35.5,
        locationY: 70,
        shotLocationX: null,
        shotLocationY: null,
        userId: "user-123",
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
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Database write error",
    );
  });

  it("handles loading errors for match roster and action definitions", async () => {
    vi.mocked(db.matchlineups.where).mockReturnValueOnce({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockRejectedValueOnce(new Error("Roster error")),
      }),
    } as unknown as ReturnType<typeof db.matchlineups.where>);

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

    expect(await screen.findByRole("alert")).toBeInTheDocument();
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

    const closeBtn = await screen.findByText("✕");
    fireEvent.click(closeBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(2);
  });

  it("allows switching to Map tab, renders field layout, and passes spatial coordinates on save", async () => {
    vi.mocked(eventService.updateGameEventTx).mockResolvedValue({
      id: "action-123",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "",
      isLeadToGoal: false,
      locationX: 35.5,
      locationY: 70.0,
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
          action={sampleAction}
          matchId="match-1"
          onClose={mockOnClose}
        />
      </Provider>,
    );

    const mapTab = await screen.findByRole("button", { name: /Map/i });
    fireEvent.click(mapTab);

    expect(await screen.findByText("Field Location Map")).toBeInTheDocument();
    expect(screen.getByText("X: 35.5% | Y: 70%")).toBeInTheDocument();

    const saveBtn = screen.getByRole("button", { name: /Save/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(eventService.updateGameEventTx).toHaveBeenCalledWith({
        eventId: "action-123",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-1",
        expectedSportId: "sport-1",
        isLeadToGoal: true,
        locationX: 35.5,
        locationY: 70.0,
        shotLocationX: null,
        shotLocationY: null,
        userId: "user-123",
      });
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("allows clearing coordinates on Map tab during action editing", async () => {
    vi.mocked(eventService.updateGameEventTx).mockResolvedValue({
      id: "action-123",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "",
      isLeadToGoal: false,
      locationX: null,
      locationY: null,
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
          action={sampleAction}
          matchId="match-1"
          onClose={mockOnClose}
        />
      </Provider>,
    );

    const mapTab = await screen.findByRole("button", { name: /Map/i });
    fireEvent.click(mapTab);

    const clearBtn = await screen.findByRole("button", { name: /Clear/i });
    fireEvent.click(clearBtn);

    const saveBtn = screen.getByRole("button", { name: /Save/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(eventService.updateGameEventTx).toHaveBeenCalledWith(
        expect.objectContaining({
          locationX: null,
          locationY: null,
        }),
      );
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("disables Save button while db.gameevents.get coordinate loading is pending", async () => {
    let resolveGameEvents: (value: unknown) => void;
    const pendingPromise = new Promise((resolve) => {
      resolveGameEvents = resolve;
    });

    vi.mocked(db.gameevents.get).mockReturnValueOnce(
      pendingPromise as unknown as ReturnType<typeof db.gameevents.get>,
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

    const saveBtn = screen.getByRole("button", { name: /Save/i });
    expect(saveBtn).toBeDisabled();

    await act(async () => {
      resolveGameEvents!({
        id: "action-123",
        locationX: 35.5,
        locationY: 70.0,
      });
    });

    await waitFor(() => {
      expect(saveBtn).not.toBeDisabled();
    });
  });

  it("displays error alert and keeps Save button disabled if db.gameevents.get fails", async () => {
    vi.mocked(db.gameevents.get).mockRejectedValueOnce(
      new Error("Failed to load coordinates"),
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

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to load event coordinates.",
    );

    const saveBtn = screen.getByRole("button", { name: /Save/i });
    expect(saveBtn).toBeDisabled();
  });

  it("does not render SHOTS tab when selected action has isShot !== true", async () => {
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
    expect(
      screen.queryByRole("button", { name: /SHOTS/i }),
    ).not.toBeInTheDocument();
  });

  it("renders SHOTS tab dynamically when an action with isShot === true is selected", async () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <EditGameEventModal
          isOpen={true}
          action={{ ...sampleAction, eventDefinitionId: "def-2" }}
          matchId="match-1"
          onClose={vi.fn()}
        />
      </Provider>,
    );

    expect(
      await screen.findByRole("button", { name: /SHOTS/i }),
    ).toBeInTheDocument();
  });

  it("allows switching to SHOTS tab, selecting target coordinates on the shot map, and saving them", async () => {
    vi.mocked(eventService.updateGameEventTx).mockResolvedValue({
      id: "action-123",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-2",
      periodNumber: 1,
      eventTimestamp: "",
      isLeadToGoal: false,
      locationX: 35.5,
      locationY: 70.0,
      shotLocationX: 25,
      shotLocationY: 80,
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
          action={{ ...sampleAction, eventDefinitionId: "def-2" }}
          matchId="match-1"
          onClose={mockOnClose}
        />
      </Provider>,
    );

    const saveBtn = await screen.findByRole("button", { name: /Save/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());

    const shotsTab = screen.getByRole("button", { name: /SHOTS/i });
    fireEvent.click(shotsTab);

    expect(await screen.findByText("Goal Shot Map")).toBeInTheDocument();

    const shotMapArea = screen.getByLabelText("Goal Shot Location Map");
    vi.spyOn(shotMapArea, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Click at (50, 20) on 200x100 rect -> X: 25%, Y: 80%
    fireEvent.click(shotMapArea, { clientX: 50, clientY: 20 });
    expect(screen.getByText("X: 25% | Y: 80%")).toBeInTheDocument();

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(eventService.updateGameEventTx).toHaveBeenCalledWith({
        eventId: "action-123",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-2",
        expectedSportId: "sport-1",
        isLeadToGoal: false,
        locationX: 35.5,
        locationY: 70.0,
        shotLocationX: 25,
        shotLocationY: 80,
        userId: "user-123",
      });
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("preserves existing saved shot coordinates when opening SHOTS tab and saving without changes", async () => {
    vi.mocked(db.gameevents.get).mockResolvedValueOnce({
      id: "action-123",
      locationX: 35.5,
      locationY: 70.0,
      shotLocationX: 10.0,
      shotLocationY: 85.0,
    });

    vi.mocked(eventService.updateGameEventTx).mockResolvedValue({
      id: "action-123",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-2",
      periodNumber: 1,
      eventTimestamp: "",
      isLeadToGoal: false,
      locationX: 35.5,
      locationY: 70.0,
      shotLocationX: 10.0,
      shotLocationY: 85.0,
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
          action={{ ...sampleAction, eventDefinitionId: "def-2" }}
          matchId="match-1"
          onClose={mockOnClose}
        />
      </Provider>,
    );

    const saveBtn = await screen.findByRole("button", { name: /Save/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());

    const shotsTab = screen.getByRole("button", { name: /SHOTS/i });
    fireEvent.click(shotsTab);

    expect(await screen.findByText("Goal Shot Map")).toBeInTheDocument();
    expect(screen.getByText("X: 10% | Y: 85%")).toBeInTheDocument();

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(eventService.updateGameEventTx).toHaveBeenCalledWith({
        eventId: "action-123",
        matchLineupId: "lineup-1",
        eventDefinitionId: "def-2",
        expectedSportId: "sport-1",
        isLeadToGoal: false,
        locationX: 35.5,
        locationY: 70.0,
        shotLocationX: 10.0,
        shotLocationY: 85.0,
        userId: "user-123",
      });
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("resets shotLocationX and shotLocationY to null when action switches to a non-shot action", async () => {
    vi.mocked(db.gameevents.get).mockResolvedValueOnce({
      id: "action-123",
      locationX: 35.5,
      locationY: 70.0,
      shotLocationX: 15.0,
      shotLocationY: 85.0,
    });

    vi.mocked(eventService.updateGameEventTx).mockResolvedValue({
      id: "action-123",
      matchLineupId: "lineup-1",
      eventDefinitionId: "def-1",
      periodNumber: 1,
      eventTimestamp: "",
      isLeadToGoal: true,
      locationX: 35.5,
      locationY: 70.0,
      shotLocationX: null,
      shotLocationY: null,
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
          action={{ ...sampleAction, eventDefinitionId: "def-2" }}
          matchId="match-1"
          onClose={mockOnClose}
        />
      </Provider>,
    );

    const saveBtn = await screen.findByRole("button", { name: /Save/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());

    // Open SHOTS tab to verify existing non-null shot coordinates loaded into the modal
    const shotsTab = screen.getByRole("button", { name: /SHOTS/i });
    fireEvent.click(shotsTab);

    expect(await screen.findByText("Goal Shot Map")).toBeInTheDocument();
    expect(screen.getByText("X: 15% | Y: 85%")).toBeInTheDocument();

    // Switch back to Positive tab and change action from Goal (isShot: true) to Pass (isShot: false)
    fireEvent.click(screen.getByRole("button", { name: "Positive" }));
    fireEvent.click(screen.getByText("Pass"));

    expect(
      screen.queryByRole("button", { name: /SHOTS/i }),
    ).not.toBeInTheDocument();

    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(eventService.updateGameEventTx).toHaveBeenCalledWith(
        expect.objectContaining({
          eventDefinitionId: "def-1",
          shotLocationX: null,
          shotLocationY: null,
        }),
      );
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("disables Save button and displays loading message while definitions loading is pending", async () => {
    let resolveMatch: (value: unknown) => void;
    const pendingMatchPromise = new Promise((resolve) => {
      resolveMatch = resolve;
    });

    vi.mocked(db.matches.get).mockReturnValueOnce(
      pendingMatchPromise as unknown as ReturnType<typeof db.matches.get>,
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

    expect(
      screen.getByText("Loading action definitions..."),
    ).toBeInTheDocument();

    const saveBtn = screen.getByRole("button", { name: /Save/i });
    expect(saveBtn).toBeDisabled();

    await act(async () => {
      resolveMatch!({
        id: "match-1",
        tournamentId: "tour-1",
      });
    });

    await waitFor(() => {
      expect(saveBtn).not.toBeDisabled();
    });
  });
});
