import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MyMatchesView } from "../components/MyMatchesView";
import navigationReducer from "../../../store/slices/navigationSlice";
import { userMatchService } from "../../../services/userMatchService";

vi.mock("../../../services/userMatchService", () => ({
  userMatchService: {
    getCatchedMatches: vi.fn(),
    uncatchMatch: vi.fn(),
    addUserToTrackedMatch: vi.fn(),
  },
}));

vi.mock("../components/MatchReportModal", () => ({
  MatchReportModal: ({
    isOpen,
    teamId,
    guestTeamId,
  }: {
    isOpen: boolean;
    teamId?: string;
    guestTeamId?: string;
  }) =>
    isOpen ? (
      <div data-testid="report-modal">
        Mock Report Modal (team: {teamId}, guest: {guestTeamId})
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
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch and render catched matches list", async () => {
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

  it("should handle uncatch/delete action and update list", async () => {
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
        "home-team-1",
      );
      expect(screen.queryByText("Dolphins")).toBeNull();
    });
  });

  it("should open share modal and submit target email", async () => {
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
        "home-team-1",
        "assistant@tta.com",
      );
    });
  });

  it("should open MatchReportModal with teamId and guestTeamId when clicking View Report button", async () => {
    vi.mocked(userMatchService.getCatchedMatches).mockResolvedValueOnce(
      mockMatches,
    );

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
});
