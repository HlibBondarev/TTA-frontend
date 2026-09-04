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

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    user: { email: "coach@tta.com", name: "Coach User" },
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

  it("should display Session Recovery prompt when an unfinished match is found", async () => {
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
    });

    const store = createTestStore();

    render(
      <Provider store={store}>
        <MainDashboard />
      </Provider>,
    );

    expect(
      await screen.findByRole("region", { name: "Session Recovery Prompt" }),
    ).toBeDefined();
    expect(screen.getByText(/Interrupted Match Found/i)).toBeDefined();
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
});
