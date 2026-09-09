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
    vi.mocked(checkUnfinishedMatch).mockReset().mockResolvedValue(null);
    vi.mocked(discardUnfinishedMatch).mockReset().mockResolvedValue(undefined);
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

  it("should display user name when email is missing, or 'User' when both email and name are missing", () => {
    mockUser = { email: "", name: "Coach Alex" } as never;
    const store = createTestStore();
    const { rerender } = render(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );
    expect(screen.getByText("Coach Alex")).toBeDefined();

    mockUser = { email: "", name: "" } as never;
    rerender(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );
    expect(screen.getByText("User")).toBeDefined();
  });

  it("should handle error when checkUnfinishedMatch rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(checkUnfinishedMatch).mockRejectedValueOnce(
      new Error("DB read error"),
    );
    const store = createTestStore();

    render(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to check unfinished match:",
        expect.any(Error),
      );
    });
    consoleSpy.mockRestore();
  });

  it("should handle error when discardUnfinishedMatch rejects in handleDiscard", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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

    vi.mocked(discardUnfinishedMatch).mockRejectedValueOnce(
      new Error("Discard network failure"),
    );

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
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to discard unfinished match:",
        expect.any(Error),
      );
    });
    consoleSpy.mockRestore();
  });

  it("should resolve selectedTeamId or empty string fallback for teamToResume and teamToDiscard", async () => {
    const onResumeMatchMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(checkUnfinishedMatch).mockResolvedValueOnce({
      id: "m-unfinished-selected",
      homeTeamId: "",
      guestTeamId: "",
      selectedTeamId: "team-selected-99",
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
        "m-unfinished-selected",
        "team-selected-99",
      );
    });
  });

  it("should fallback to timestamp token generator when crypto.randomUUID is unavailable", async () => {
    const originalCrypto = globalThis.crypto;
    // @ts-expect-error Mocking missing crypto API
    delete globalThis.crypto;

    const onResumeMatchMock = vi.fn().mockResolvedValue(undefined);
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
        "team-1",
      );
    });

    globalThis.crypto = originalCrypto;
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

    mockUser = { email: "userB@tta.com", sub: "auth0|user-B" };

    rerender(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );

    expect(
      screen.queryByRole("region", { name: "Session Recovery Prompt" }),
    ).toBeNull();

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

  it("should invoke discardUnfinishedMatch with matchId and teamId, then purge prompt when clicking Discard Match button", async () => {
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
      expect(discardUnfinishedMatch).toHaveBeenCalledWith(
        "m-unfinished-123",
        "team-1",
      );
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

    mockUser = { email: "userB@tta.com", sub: "auth0|user-B" };
    rerender(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );

    await waitFor(() => {
      expect(checkUnfinishedMatch).toHaveBeenCalledWith("auth0|user-B");
    });

    resolveDiscard();

    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "Session Recovery Prompt" }),
      ).toBeDefined();
      expect(screen.getByText("ID: m-userB-...")).toBeDefined();
    });
  });

  it("should enable account B's recovery buttons when account switches to User B while User A's recovery operation is pending", async () => {
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

    let resolveUserAResume: () => void = () => {};
    const deferredUserAResume = new Promise<void>((resolve) => {
      resolveUserAResume = resolve;
    });

    const onResumeMatchMock = vi.fn().mockImplementation((matchId) => {
      if (matchId === "m-userA-123") {
        return deferredUserAResume;
      }
      return Promise.resolve();
    });

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
        <MainDashboard onResumeMatch={onResumeMatchMock} />
      </Provider>,
    );

    expect(
      await screen.findByRole("region", { name: "Session Recovery Prompt" }),
    ).toBeDefined();

    const resumeBtnA = screen.getByRole("button", { name: /Resume Match/i });
    fireEvent.click(resumeBtnA);

    expect(onResumeMatchMock).toHaveBeenCalledWith("m-userA-123", "team-1");

    mockUser = { email: "userB@tta.com", sub: "auth0|user-B" };
    rerender(
      <Provider store={store}>
        <MainDashboard onResumeMatch={onResumeMatchMock} />
      </Provider>,
    );

    await waitFor(() => {
      expect(checkUnfinishedMatch).toHaveBeenCalledWith("auth0|user-B");
    });

    const resumeBtnB = await screen.findByRole("button", {
      name: /Resume Match/i,
    });
    const discardBtnB = screen.getByRole("button", {
      name: /Discard Match/i,
    });

    expect(resumeBtnB).not.toBeDisabled();
    expect(discardBtnB).not.toBeDisabled();

    fireEvent.click(resumeBtnB);

    await waitFor(() => {
      expect(onResumeMatchMock).toHaveBeenCalledWith("m-userB-456", "team-3");
    });

    resolveUserAResume();
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

    mockUser = { email: "userB@tta.com", sub: "auth0|user-B" };
    rerender(
      <Provider store={store}>
        <MainDashboard onResumeMatch={onResumeMatchMock} />
      </Provider>,
    );

    resolveResume();

    await waitFor(() => {
      expect(checkUnfinishedMatch).toHaveBeenCalledWith("auth0|user-B");
    });

    expect(
      screen.queryByRole("region", { name: "Session Recovery Prompt" }),
    ).toBeNull();
  });
});
