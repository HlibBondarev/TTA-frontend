import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { App } from "../App";
import { seedTestData } from "../db/seed";
import matchReducer from "../features/matches/store/matchSlice";
import presenceReducer from "../features/playerpresences/store/presenceSlice";

// Mock the seeding module
vi.mock("../db/seed", () => ({
  seedTestData: vi.fn().mockResolvedValue(undefined),
}));

// Mock sub-components to test App rendering states isolated
vi.mock("../features/playerpresences/components/PlayerPresencePanel", () => ({
  PlayerPresencePanel: () => (
    <div data-testid="presence-panel">PlayerPresencePanel Mock</div>
  ),
}));

vi.mock("../features/matches/components/MatchLifecyclePanel", () => ({
  MatchLifecyclePanel: () => (
    <div data-testid="lifecycle-panel">MatchLifecyclePanel Mock</div>
  ),
}));

const createTestStore = () => {
  return configureStore({
    reducer: {
      match: matchReducer,
      presence: presenceReducer,
    },
  });
};

describe("App Bootstrapping Component", () => {
  let store: ReturnType<typeof createTestStore>;
  let wrapper: React.FC<{ children: React.ReactNode }>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createTestStore();
    wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
  });

  it("should render database loading state at first", async () => {
    render(<App />, { wrapper });
    expect(screen.getByText("Loading database...")).toBeInTheDocument();

    // Await the microtask lifecycle to prevent unwrapped state update warnings
    await waitFor(() => {
      expect(seedTestData).toHaveBeenCalled();
    });
  });

  it("should successfully bootstrap, seed, and render sub-panels", async () => {
    render(<App />, { wrapper });

    await waitFor(() => {
      expect(seedTestData).toHaveBeenCalledTimes(1);
    });

    // Check header
    expect(screen.getByText("TTA Match Recorder")).toBeInTheDocument();
    expect(
      screen.getByText("Offline Game Tracking Console"),
    ).toBeInTheDocument();

    // Verify subpanels rendered successfully after state transition
    expect(screen.getByTestId("presence-panel")).toBeInTheDocument();
    expect(screen.getByTestId("lifecycle-panel")).toBeInTheDocument();
  });

  it("should handle seeding error and render the fail state", async () => {
    vi.mocked(seedTestData).mockRejectedValueOnce(new Error("Seeding Fault"));

    render(<App />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Initialization Error")).toBeInTheDocument();
    });

    expect(screen.getByText("Seeding Fault")).toBeInTheDocument();

    // Assert retry button is available and triggers reload with robust regex search
    const retryBtn = screen.getByRole("button", { name: /retry loading/i });
    expect(retryBtn).toBeInTheDocument();

    // Mock window reload behavior cleanly without using "any" or deleting read-only props
    const reloadMock = vi.fn();
    const originalLocation = window.location;

    // Type-safe mock casted through unknown to Location
    const mockLocation = {
      reload: reloadMock,
    } as unknown as Location;

    Object.defineProperty(window, "location", {
      configurable: true,
      value: mockLocation,
    });

    fireEvent.click(retryBtn);
    expect(reloadMock).toHaveBeenCalledTimes(1);

    // Restore original window.location safely
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });
});
