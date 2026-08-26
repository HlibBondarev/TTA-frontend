import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MainDashboard } from "../components/MainDashboard";
import navigationReducer, {
  type AppCurrentView,
} from "../../../store/slices/navigationSlice";

const mockLogout = vi.fn();

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    user: { email: "coach@tta.com", name: "Coach User" },
    logout: mockLogout,
  }),
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
