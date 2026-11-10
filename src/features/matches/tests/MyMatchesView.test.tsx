import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MyMatchesView } from "../components/MyMatchesView";
import navigationReducer from "../../../store/slices/navigationSlice";
import { userMatchService } from "../../../services/userMatchService";
import { db } from "../../../db/ttaDatabase";

vi.mock("../../../services/userMatchService", () => ({
  userMatchService: {
    getCatchedMatches: vi.fn(),
    uncatchMatch: vi.fn(),
    addUserToTrackedMatch: vi.fn(),
  },
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    transaction: vi.fn(),
    matches: {
      bulkPut: vi.fn().mockResolvedValue([]),
      bulkGet: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    tournaments: {
      get: vi.fn(),
    },
    sportconfigurations: {
      get: vi.fn(),
    },
  },
}));

vi.mock("../components/MatchReportModal", () => ({
  MatchReportModal: ({
    isOpen,
    teamId,
    guestTeamId,
    playground,
    shotMap,
  }: {
    isOpen: boolean;
    teamId?: string;
    guestTeamId?: string;
    playground?: string | null;
    shotMap?: string | null;
  }) =>
    isOpen ? (
      <div data-testid="report-modal">
        Mock Report Modal (team: {teamId}, guest: {guestTeamId})
        {playground && <span>Playground: {playground}</span>}
        {shotMap && <span>ShotMap: {shotMap}</span>}
      </div>
    ) : null,
}));

const createTestStore = () => {
  return configureStore({
    reducer: {
      navigation: navigationReducer,
    },
  });
};

describe("MyMatchesView Component", () => {
  const mockMatches = [
    {
      id: "match-101",
      tournamentId: "tourn-1",
      tournamentName: "Training Cup",
      homeTeamId: "home-team-1",
      homeTeamName: "Dolphins",
      guestTeamId: "guest-team-2",
      guestTeamName: "Sharks",
      scheduledAt: "2026-08-25T15:00:00.000Z",
      matchNumber: "1",
      venue: "Pool 1",
      temperature: 25,
      homeScore: 8,
      guestScore: 6,
      createdAt: "2026-08-25T14:00:00.000Z",
      trackedTeamId: "guest-team-2",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.transaction)
      .mockReset()
      .mockImplementation((async (
        _mode: string,
        _tables: unknown,
        callback: () => Promise<void>,
      ) => {
        await callback();
      }) as unknown as typeof db.transaction);
    vi.mocked(db.matches.bulkPut).mockResolvedValue([] as never);
    vi.mocked(db.matches.bulkGet).mockResolvedValue([] as never);
    vi.mocked(db.matches.delete).mockResolvedValue(undefined as never);
    vi.mocked(db.matches.get).mockResolvedValue(undefined as never);
  });

  it("should fetch, render catched matches list, and sync to IndexedDB for finalized matches inside a transaction", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce(
      mockMatches,
    );

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(screen.getByText("Loading tracked matches...")).toBeDefined();

    expect(await screen.findByText("Dolphins")).toBeDefined();
    expect(screen.getByText("Sharks")).toBeDefined();
    expect(screen.getByText("8 : 6")).toBeDefined();

    await waitFor(() => {
      expect(db.transaction).toHaveBeenCalledWith(
        "rw",
        db.matches,
        expect.any(Function),
      );
      expect(db.matches.bulkPut).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: "match-101",
            homeScore: 8,
            guestScore: 6,
          }),
        ]),
      );
    });
  });

  it("should filter out unfinalized or invalid score matches and render only completed matches", async () => {
    const mixedMatches = [
      ...mockMatches,
      {
        id: "match-unfinalized-999",
        tournamentId: "tourn-1",
        tournamentName: "Training Cup",
        homeTeamId: "home-team-1",
        homeTeamName: "Falcons",
        guestTeamId: "guest-team-2",
        guestTeamName: "Eagles",
        scheduledAt: "2026-09-25T10:00:00.000Z",
        matchNumber: "2",
        venue: "Pool 2",
        temperature: 24,
        homeScore: null,
        guestScore: null,
        createdAt: "2026-09-25T09:00:00.000Z",
        trackedTeamId: "home-team-1",
      },
      {
        id: "match-invalid-score-888",
        tournamentId: "tourn-1",
        tournamentName: "Training Cup",
        homeTeamId: "home-team-1",
        homeTeamName: "Hawks",
        guestTeamId: "guest-team-2",
        guestTeamName: "Owls",
        scheduledAt: "2026-09-25T11:00:00.000Z",
        matchNumber: "3",
        venue: "Pool 3",
        temperature: 24,
        homeScore: Number.NaN,
        guestScore: "6" as unknown as number,
        createdAt: "2026-09-25T09:00:00.000Z",
        trackedTeamId: "home-team-1",
      },
    ];

    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce(
      mixedMatches as never,
    );

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("Dolphins")).toBeDefined();
    expect(screen.queryByText("Falcons")).toBeNull();
    expect(screen.queryByText("Eagles")).toBeNull();
    expect(screen.queryByText("Hawks")).toBeNull();
    expect(screen.queryByText("Owls")).toBeNull();
  });

  it("should render empty state message when no tracked matches exist on successful fetch", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce([]);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("No tracked matches found.")).toBeDefined();
  });

  it("should render error banner and hide empty list state when fetching catched matches fails", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockRejectedValueOnce(
      new Error("Failed to connect to backend"),
    );

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText("Failed to connect to backend")).toBeDefined();
    expect(screen.queryByText("No tracked matches found.")).toBeNull();
  });

  it("should open report modal and pass SVGs fetched from IndexedDB configuration", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce(
      mockMatches,
    );
    vi.mocked(db.tournaments.get).mockResolvedValueOnce({
      id: "tourn-1",
      configurationId: "config-100",
    } as never);
    vi.mocked(db.sportconfigurations.get).mockResolvedValueOnce({
      id: "config-100",
      playground: "<svg>Waterpolo Pool</svg>",
      shotMap: "<svg>Waterpolo Goal</svg>",
    } as never);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("Dolphins")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /View Report/i }));

    const reportModal = await screen.findByTestId("report-modal");
    expect(reportModal).toBeDefined();
    expect(
      screen.getByText("Playground: <svg>Waterpolo Pool</svg>"),
    ).toBeDefined();
    expect(
      screen.getByText("ShotMap: <svg>Waterpolo Goal</svg>"),
    ).toBeDefined();
  });

  it("should handle uncatch/delete action using trackedTeamId, delete from Dexie, and update list", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce(
      mockMatches,
    );
    vi.mocked(userMatchService.uncatchMatch).mockResolvedValueOnce(undefined);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("Dolphins")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Delete/i }));

    await waitFor(() => {
      expect(userMatchService.uncatchMatch).toHaveBeenCalledWith(
        "match-101",
        "guest-team-2",
      );
      expect(db.matches.delete).toHaveBeenCalledWith("match-101");
      expect(screen.queryByText("Dolphins")).toBeNull();
    });
  });

  it("should handle uncatch/delete error gracefully when uncatchMatch fails", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce(
      mockMatches,
    );
    vi.mocked(userMatchService.uncatchMatch).mockRejectedValueOnce(
      new Error("Delete failed"),
    );

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("Dolphins")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Delete/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText("Delete failed")).toBeDefined();
    });
  });

  it("should open share modal and submit target email using trackedTeamId", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce(
      mockMatches,
    );
    vi.mocked(userMatchService.addUserToTrackedMatch).mockResolvedValueOnce(
      undefined,
    );

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("Dolphins")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Share/i }));

    expect(screen.getByText("Share Match with User")).toBeDefined();

    const input = screen.getByPlaceholderText("user@example.com");
    fireEvent.change(input, { target: { value: "assistant@tta.com" } });

    fireEvent.click(screen.getByRole("button", { name: /Confirm Share/i }));

    await waitFor(() => {
      expect(userMatchService.addUserToTrackedMatch).toHaveBeenCalledWith(
        "match-101",
        "guest-team-2",
        "assistant@tta.com",
      );
    });
  });

  it("should handle share error gracefully when addUserToTrackedMatch fails", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce(
      mockMatches,
    );
    vi.mocked(userMatchService.addUserToTrackedMatch).mockRejectedValueOnce(
      new Error("Share error"),
    );

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("Dolphins")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Share/i }));

    const input = screen.getByPlaceholderText("user@example.com");
    fireEvent.change(input, { target: { value: "assistant@tta.com" } });

    fireEvent.click(screen.getByRole("button", { name: /Confirm Share/i }));

    await waitFor(() => {
      expect(screen.getByText("Share error")).toBeDefined();
    });
  });

  it("should support home team tracked context (isTrackedHome = true) and fallback invalid date formatting", async () => {
    const homeTrackedMatch = {
      ...mockMatches[0],
      trackedTeamId: "home-team-1",
      scheduledAt: "invalid-date-string",
    };

    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce([
      homeTrackedMatch,
    ]);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("Invalid Date")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /View Report/i }));

    const reportModal = await screen.findByTestId("report-modal");
    expect(reportModal).toBeDefined();
    expect(reportModal).toHaveTextContent(
      "Mock Report Modal (team: home-team-1, guest: guest-team-2)",
    );
  });

  it("should navigate to Hub when clicking Back to Menu button", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce([]);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /Back to Menu/i }),
    );

    expect(store.getState().navigation.currentView).toBe("HUB");
  });

  it("should skip overwriting existing local unfinished drafts when caching API matches", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce(
      mockMatches,
    );

    // Mock existing local match in IndexedDB as an unfinished draft (scores null or undefined)
    vi.mocked(db.matches.bulkGet).mockResolvedValueOnce([
      {
        id: "match-101",
        tournamentId: "tourn-1",
        homeTeamId: "home-team-1",
        guestTeamId: "guest-team-2",
        scheduledAt: "2026-08-25T15:00:00.000Z",
        homeScore: undefined,
        guestScore: null,
      },
    ] as never);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("Dolphins")).toBeDefined();

    await waitFor(() => {
      expect(db.matches.bulkGet).toHaveBeenCalledWith(["match-101"]);
      // bulkPut should NOT be called since the record is an unfinished local draft
      expect(db.matches.bulkPut).not.toHaveBeenCalled();
    });
  });

  it("should execute bulkGet, filter, and bulkPut strictly inside the Dexie transaction callback", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce(
      mockMatches,
    );

    let isInsideTransaction = false;
    let bulkGetCalledInsideCallback = false;
    let bulkPutCalledInsideCallback = false;

    vi.mocked(db.transaction).mockImplementationOnce((async (
      _mode: string,
      _tables: unknown,
      callback: () => Promise<void>,
    ) => {
      isInsideTransaction = true;
      try {
        await callback();
      } finally {
        isInsideTransaction = false;
      }
    }) as unknown as typeof db.transaction);

    vi.mocked(db.matches.bulkGet).mockImplementation((async () => {
      if (isInsideTransaction) {
        bulkGetCalledInsideCallback = true;
      }
      return [];
    }) as unknown as typeof db.matches.bulkGet);

    vi.mocked(db.matches.bulkPut).mockImplementation((async () => {
      if (isInsideTransaction) {
        bulkPutCalledInsideCallback = true;
      }
      return [];
    }) as unknown as typeof db.matches.bulkPut);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("Dolphins")).toBeDefined();

    await waitFor(() => {
      expect(db.transaction).toHaveBeenCalledWith(
        "rw",
        db.matches,
        expect.any(Function),
      );
      expect(bulkGetCalledInsideCallback).toBe(true);
      expect(bulkPutCalledInsideCallback).toBe(true);
      expect(db.matches.bulkPut).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: "match-101",
            homeScore: 8,
            guestScore: 6,
          }),
        ]),
      );
    });
  });

  it("should skip bulkPut when transaction-time read returns an active local draft", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce(
      mockMatches,
    );

    let competingDraftWritten = false;

    vi.mocked(db.transaction).mockImplementationOnce((async (
      _mode: string,
      _tables: unknown,
      callback: () => Promise<void>,
    ) => {
      // Competing process wrote an unfinished draft to IndexedDB right before transaction read completes
      competingDraftWritten = true;
      await callback();
    }) as unknown as typeof db.transaction);

    vi.mocked(db.matches.bulkGet).mockImplementation((async (ids: string[]) => {
      if (competingDraftWritten) {
        // Return active local draft written concurrently by competing process
        return [
          {
            id: ids[0],
            tournamentId: "tourn-1",
            homeTeamId: "home-team-1",
            guestTeamId: "guest-team-2",
            scheduledAt: "2026-08-25T15:00:00.000Z",
            matchNumber: "1",
            venue: "Pool 1",
            temperature: 25,
            homeScore: null,
            guestScore: null,
            createdAt: "2026-08-25T14:00:00.000Z",
          },
        ];
      }
      return [];
    }) as unknown as typeof db.matches.bulkGet);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("Dolphins")).toBeDefined();

    await waitFor(() => {
      expect(db.transaction).toHaveBeenCalledWith(
        "rw",
        db.matches,
        expect.any(Function),
      );
      expect(db.matches.bulkGet).toHaveBeenCalledWith(["match-101"]);
      // Draft record returned during transaction read: bulkPut is skipped
      expect(db.matches.bulkPut).not.toHaveBeenCalled();
    });
  });

  it("should ignore stale report-opening requests if a newer report request is triggered concurrently", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce([
      {
        ...mockMatches[0],
        id: "match-slow-1",
        tournamentId: "",
        homeTeamName: "Slow Team 1",
      },
      {
        ...mockMatches[0],
        id: "match-fast-2",
        homeTeamName: "Fast Team 2",
        trackedTeamId: "home-team-1",
      },
    ]);

    let resolveSlowGet: (value: unknown) => void;
    const slowPromise = new Promise((resolve) => {
      resolveSlowGet = resolve;
    });

    vi.mocked(db.matches.get).mockImplementation(((id: string) => {
      if (id === "match-slow-1") {
        return slowPromise as never;
      }
      return Promise.resolve(undefined) as never;
    }) as never);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("Slow Team 1")).toBeDefined();

    const viewReportButtons = screen.getAllByRole("button", {
      name: /View Report/i,
    });

    // Trigger report opening for the first match (pending slow async Dexie lookup)
    fireEvent.click(viewReportButtons[0]);
    expect(db.matches.get).toHaveBeenCalledWith("match-slow-1");

    // Immediately trigger report opening for the second match
    fireEvent.click(viewReportButtons[1]);

    // Fast match resolves modal first
    const reportModal = await screen.findByTestId("report-modal");
    expect(reportModal).toHaveTextContent("team: home-team-1");

    // Resolve and flush slowPromise inside act
    await act(async () => {
      resolveSlowGet!({ id: "match-slow-1", tournamentId: "tourn-1" });
      await slowPromise;
    });

    // Verify modal state was not overwritten by the stale initial request
    expect(screen.getByTestId("report-modal")).toHaveTextContent(
      "team: home-team-1",
    );
    expect(screen.getByTestId("report-modal")).not.toHaveTextContent(
      "team: guest-team-2",
    );
  });

  it("should protect unfinished local draft from deletion and show user-facing feedback when handleUncatch is invoked", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce(
      mockMatches,
    );
    vi.mocked(db.matches.get).mockResolvedValueOnce({
      id: "match-101",
      tournamentId: "tourn-1",
      homeTeamId: "home-team-1",
      guestTeamId: "guest-team-2",
      scheduledAt: "2026-08-25T15:00:00.000Z",
      homeScore: null,
      guestScore: null,
    } as never);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("Dolphins")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Delete/i }));

    await waitFor(() => {
      expect(db.matches.get).toHaveBeenCalledWith("match-101");
      expect(userMatchService.uncatchMatch).not.toHaveBeenCalled();
      expect(db.matches.delete).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeDefined();
      expect(
        screen.getByText(
          /deletion is blocked to preserve the active local draft/i,
        ),
      ).toBeDefined();
      expect(screen.getByText("Dolphins")).toBeDefined();
    });
  });

  it("should skip local deletion inside atomic transaction if an active draft is created concurrently during uncatch API call", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce(
      mockMatches,
    );

    let competitorDraftCreated = false;
    vi.mocked(userMatchService.uncatchMatch).mockImplementationOnce(
      async () => {
        // Competing draft appears while the uncatch API call is in flight
        competitorDraftCreated = true;
      },
    );

    vi.mocked(db.matches.get).mockResolvedValueOnce(undefined as never);

    vi.mocked(db.matches.get).mockImplementation(((id: string) => {
      if (competitorDraftCreated) {
        return Promise.resolve({
          id,
          homeScore: null,
          guestScore: null,
        }) as never;
      }
      return Promise.resolve(undefined) as never;
    }) as never);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("Dolphins")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Delete/i }));

    await waitFor(() => {
      expect(userMatchService.uncatchMatch).toHaveBeenCalledWith(
        "match-101",
        "guest-team-2",
      );
      expect(db.transaction).toHaveBeenCalledTimes(2);
      expect(db.matches.delete).not.toHaveBeenCalled();
    });
  });

  it("should merge existing local record fields (such as userId, selectedTeamId) when sync bulkPut is executed", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce(
      mockMatches,
    );

    vi.mocked(db.matches.bulkGet).mockResolvedValueOnce([
      {
        id: "match-101",
        tournamentId: "tourn-1",
        homeTeamId: "home-team-1",
        guestTeamId: "guest-team-2",
        scheduledAt: "2026-08-25T15:00:00.000Z",
        homeScore: 7,
        guestScore: 5,
        userId: "user-owner-123",
        selectedTeamId: "guest-team-2",
      },
    ] as never);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MyMatchesView />
      </Provider>,
    );

    expect(await screen.findByText("Dolphins")).toBeDefined();

    await waitFor(() => {
      expect(db.matches.bulkPut).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "match-101",
          homeScore: 8,
          guestScore: 6,
          userId: "user-owner-123",
          selectedTeamId: "guest-team-2",
        }),
      ]);
    });
  });
});
