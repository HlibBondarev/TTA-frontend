import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MainDashboard } from "../components/MainDashboard";
import navigationReducer, {
  type AppCurrentView,
} from "../../../store/slices/navigationSlice";
import {
  checkUnfinishedMatch,
  discardUnfinishedMatch,
} from "../../../services/hydrationService";

const mockLogout = vi.fn();
let mockUser = { email: "coach@tta.com", sub: "auth0|user-coach" };

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    get user() {
      return mockUser;
    },
    logout: mockLogout,
  }),
}));

vi.mock("../../../services/hydrationService", () => ({
  checkUnfinishedMatch: vi.fn().mockResolvedValue(null),
  discardUnfinishedMatch: vi.fn().mockResolvedValue(undefined),
}));

const createTestStore = () => {
  return configureStore({
    reducer: {
      navigation: navigationReducer,
    },
  });
};

describe("MainDashboard Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { email: "coach@tta.com", sub: "auth0|user-coach" };
  });

  it("should render user profile and navigation cards", () => {
    const store = createTestStore();

    render(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );

    expect(screen.getByText("coach@tta.com")).toBeDefined();
    expect(screen.getByText("TTA Hub Navigation")).toBeDefined();
    expect(screen.getByText("Quick Start Match")).toBeDefined();
    expect(screen.getByText("My Tracked Matches")).toBeDefined();
    expect(screen.getByText("Tournaments")).toBeDefined();
  });

  it("should display Session Recovery prompt when an unfinished match is found for current user", async () => {
    vi.mocked(checkUnfinishedMatch).mockResolvedValueOnce({
      id: "m-unfinished-123",
      homeTeamId: "team-1",
      guestTeamId: "team-2",
      tournamentId: "",
      scheduledAt: "",
      matchNumber: null,
      venue: null,
      temperature: null,
      homeScore: null,
      guestScore: null,
      createdAt: "",
      userId: "auth0|user-coach",
    });

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );

    await waitFor(() => {
      expect(checkUnfinishedMatch).toHaveBeenCalledWith("auth0|user-coach");
    });

    expect(
      await screen.findByRole("region", { name: "Session Recovery Prompt" }),
    ).toBeDefined();
    expect(screen.getByText(/Interrupted Match Found/i)).toBeDefined();
  });

  it("should not display unfinished match recovery prompt if current user does not match the unfinished match owner", async () => {
    mockUser = { email: "userB@tta.com", sub: "auth0|user-B" };
    vi.mocked(checkUnfinishedMatch).mockResolvedValueOnce(null);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );

    await waitFor(() => {
      expect(checkUnfinishedMatch).toHaveBeenCalledWith("auth0|user-B");
    });

    expect(
      screen.queryByRole("region", { name: "Session Recovery Prompt" }),
    ).toBeNull();
  });

  it("should clear unfinished match prompt immediately on user account change and not expose previous account's match during deferred lookup", async () => {
    const userAMatch = {
      id: "m-userA-123",
      homeTeamId: "team-1",
      guestTeamId: "team-2",
      tournamentId: "",
      scheduledAt: "",
      matchNumber: null,
      venue: null,
      temperature: null,
      homeScore: null,
      guestScore: null,
      createdAt: "",
      userId: "auth0|user-coach",
    };

    let resolveUserBLookup: (val: null) => void = () => {};
    const deferredUserBLookup = new Promise<null>((resolve) => {
      resolveUserBLookup = resolve;
    });

    vi.mocked(checkUnfinishedMatch).mockImplementation((userId) => {
      if (userId === "auth0|user-coach") {
        return Promise.resolve(userAMatch);
      }
      if (userId === "auth0|user-B") {
        return deferredUserBLookup;
      }
      return Promise.resolve(null);
    });

    const store = createTestStore();

    const { rerender } = render(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );

    expect(
      await screen.findByRole("region", { name: "Session Recovery Prompt" }),
    ).toBeDefined();

    // Switch active user account to User B
    mockUser = { email: "userB@tta.com", sub: "auth0|user-B" };

    rerender(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );

    // Verify Account A's recovery prompt is immediately removed while Account B lookup is pending
    expect(
      screen.queryByRole("region", { name: "Session Recovery Prompt" }),
    ).toBeNull();

    // Resolve deferred lookup for User B (returns null)
    resolveUserBLookup(null);

    await waitFor(() => {
      expect(checkUnfinishedMatch).toHaveBeenCalledWith("auth0|user-B");
    });

    expect(
      screen.queryByRole("region", { name: "Session Recovery Prompt" }),
    ).toBeNull();
  });

  it("should trigger onResumeMatch callback when clicking Resume Match button", async () => {
    const onResumeMatchMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(checkUnfinishedMatch).mockResolvedValueOnce({
      id: "m-unfinished-123",
      homeTeamId: "team-home-abc",
      guestTeamId: "team-guest-xyz",
      tournamentId: "",
      scheduledAt: "",
      matchNumber: null,
      venue: null,
      temperature: null,
      homeScore: null,
      guestScore: null,
      createdAt: "",
      userId: "auth0|user-coach",
    });

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MainDashboard onResumeMatch={onResumeMatchMock} />
      </Provider>,
    );

    const resumeBtn = await screen.findByRole("button", {
      name: /Resume Match/i,
    });
    fireEvent.click(resumeBtn);

    await waitFor(() => {
      expect(onResumeMatchMock).toHaveBeenCalledWith(
        "m-unfinished-123",
        "team-home-abc",
      );
    });
  });

  it("should trigger onResumeMatch with guestTeamId when trackedTeamId or selectedTeamId corresponds to guest team", async () => {
    const onResumeMatchMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(checkUnfinishedMatch).mockResolvedValueOnce({
      id: "m-unfinished-456",
      homeTeamId: "team-home-abc",
      guestTeamId: "team-guest-xyz",
      trackedTeamId: "team-guest-xyz",
      tournamentId: "",
      scheduledAt: "",
      matchNumber: null,
      venue: null,
      temperature: null,
      homeScore: null,
      guestScore: null,
      createdAt: "",
      userId: "auth0|user-coach",
    } as never);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MainDashboard onResumeMatch={onResumeMatchMock} />
      </Provider>,
    );

    const resumeBtn = await screen.findByRole("button", {
      name: /Resume Match/i,
    });
    fireEvent.click(resumeBtn);

    await waitFor(() => {
      expect(onResumeMatchMock).toHaveBeenCalledWith(
        "m-unfinished-456",
        "team-guest-xyz",
      );
    });
  });

  it("should invoke discardUnfinishedMatch and purge prompt when clicking Discard Match button", async () => {
    vi.mocked(checkUnfinishedMatch).mockResolvedValueOnce({
      id: "m-unfinished-123",
      homeTeamId: "team-1",
      guestTeamId: "team-2",
      tournamentId: "",
      scheduledAt: "",
      matchNumber: null,
      venue: null,
      temperature: null,
      homeScore: null,
      guestScore: null,
      createdAt: "",
      userId: "auth0|user-coach",
    });

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );

    const discardBtn = await screen.findByRole("button", {
      name: /Discard Match/i,
    });
    fireEvent.click(discardBtn);

    await waitFor(() => {
      expect(discardUnfinishedMatch).toHaveBeenCalledWith("m-unfinished-123");
      expect(
        screen.queryByRole("region", { name: "Session Recovery Prompt" }),
      ).toBeNull();
    });
  });

  it.each<{ cardText: string; expectedView: AppCurrentView }>([
    { cardText: "Quick Start Match", expectedView: "QUICK_START" },
    { cardText: "My Tracked Matches", expectedView: "MY_MATCHES" },
    { cardText: "Tournaments", expectedView: "TOURNAMENT_STUB" },
  ])(
    "should dispatch setCurrentView('$expectedView') when clicking $cardText card",
    ({ cardText, expectedView }) => {
      const store = createTestStore();

      render(
        <Provider store={store}>
          <MainDashboard />
        </Provider>,
      );

      fireEvent.click(screen.getByText(cardText));

      expect(store.getState().navigation.currentView).toBe(expectedView);
    },
  );

  it("should invoke logout when clicking Log Out button", () => {
    const store = createTestStore();

    render(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Log Out/i }));

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("should preserve newer account's unfinished match if account changes while discard is pending", async () => {
    const userAMatch = {
      id: "m-userA-123",
      homeTeamId: "team-1",
      guestTeamId: "team-2",
      tournamentId: "",
      scheduledAt: "",
      matchNumber: null,
      venue: null,
      temperature: null,
      homeScore: null,
      guestScore: null,
      createdAt: "",
      userId: "auth0|user-coach",
    };

    const userBMatch = {
      id: "m-userB-456",
      homeTeamId: "team-3",
      guestTeamId: "team-4",
      tournamentId: "",
      scheduledAt: "",
      matchNumber: null,
      venue: null,
      temperature: null,
      homeScore: null,
      guestScore: null,
      createdAt: "",
      userId: "auth0|user-B",
    };

    let resolveDiscard: () => void = () => {};
    const deferredDiscard = new Promise<void>((resolve) => {
      resolveDiscard = resolve;
    });

    vi.mocked(discardUnfinishedMatch).mockReturnValueOnce(deferredDiscard);
    vi.mocked(checkUnfinishedMatch).mockImplementation((userId) => {
      if (userId === "auth0|user-coach") {
        return Promise.resolve(userAMatch);
      }
      if (userId === "auth0|user-B") {
        return Promise.resolve(userBMatch);
      }
      return Promise.resolve(null);
    });

    const store = createTestStore();

    const { rerender } = render(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );

    expect(
      await screen.findByRole("region", { name: "Session Recovery Prompt" }),
    ).toBeDefined();

    const discardBtn = screen.getByRole("button", { name: /Discard Match/i });
    fireEvent.click(discardBtn);

    // Switch account to User B while User A's discard is pending
    mockUser = { email: "userB@tta.com", sub: "auth0|user-B" };
    rerender(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );

    await waitFor(() => {
      expect(checkUnfinishedMatch).toHaveBeenCalledWith("auth0|user-B");
    });

    // Resolve User A's discard request
    resolveDiscard();

    // Verify User B's recovery prompt remains visible and wasn't purged
    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "Session Recovery Prompt" }),
      ).toBeDefined();
      expect(screen.getByText("ID: m-userB-...")).toBeDefined();
    });
  });

  it("should not display session recovery prompt if unfinished match lacks userId property", async () => {
    vi.mocked(checkUnfinishedMatch).mockResolvedValueOnce({
      id: "m-no-user-123",
      homeTeamId: "team-1",
      guestTeamId: "team-2",
      tournamentId: "",
      scheduledAt: "",
      matchNumber: null,
      venue: null,
      temperature: null,
      homeScore: null,
      guestScore: null,
      createdAt: "",
    } as never);

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );

    await waitFor(() => {
      expect(checkUnfinishedMatch).toHaveBeenCalledWith("auth0|user-coach");
    });

    expect(
      screen.queryByRole("region", { name: "Session Recovery Prompt" }),
    ).toBeNull();
  });

  it("should invalidate resume request if authenticated user identity changes while resume is in-flight", async () => {
    const userAMatch = {
      id: "m-userA-123",
      homeTeamId: "team-1",
      guestTeamId: "team-2",
      tournamentId: "",
      scheduledAt: "",
      matchNumber: null,
      venue: null,
      temperature: null,
      homeScore: null,
      guestScore: null,
      createdAt: "",
      userId: "auth0|user-coach",
    };

    let resolveResume: () => void = () => {};
    const deferredResume = new Promise<void>((resolve) => {
      resolveResume = resolve;
    });

    const onResumeMatchMock = vi.fn().mockReturnValue(deferredResume);

    vi.mocked(checkUnfinishedMatch).mockImplementation((userId) => {
      if (userId === "auth0|user-coach") {
        return Promise.resolve(userAMatch);
      }
      return Promise.resolve(null);
    });

    const store = createTestStore();

    const { rerender } = render(
      <Provider store={store}>
        <MainDashboard onResumeMatch={onResumeMatchMock} />
      </Provider>,
    );

    const resumeBtn = await screen.findByRole("button", {
      name: /Resume Match/i,
    });
    fireEvent.click(resumeBtn);

    expect(onResumeMatchMock).toHaveBeenCalledWith("m-userA-123", "team-1");

    // Switch active user account while resume is in-flight
    mockUser = { email: "userB@tta.com", sub: "auth0|user-B" };
    rerender(
      <Provider store={store}>
        <MainDashboard onResumeMatch={onResumeMatchMock} />
      </Provider>,
    );

    // Resolve deferred resume call
    resolveResume();

    await waitFor(() => {
      expect(checkUnfinishedMatch).toHaveBeenCalledWith("auth0|user-B");
    });

    // Verify recovery prompt for Account A was cleared and not leaked to Account B
    expect(
      screen.queryByRole("region", { name: "Session Recovery Prompt" }),
    ).toBeNull();
  });
});
