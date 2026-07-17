import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

// Mock TTAConsole to isolate App rendering
vi.mock("../features/matches/components/TTAConsole", () => ({
  TTAConsole: () => <div data-testid="tta-console">TTAConsole Mock</div>,
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

  it("should bootstrap, seed, and render the TTAConsole", async () => {
    render(<App />, { wrapper });

    // Verify seeding was initiated
    await waitFor(() => {
      expect(seedTestData).toHaveBeenCalledTimes(1);
    });

    // Verify TTAConsole is rendered
    expect(screen.getByTestId("tta-console")).toBeInTheDocument();
  });

  it("should handle seeding error gracefully", async () => {
    vi.mocked(seedTestData).mockRejectedValueOnce(new Error("Seeding Fault"));

    render(<App />, { wrapper });

    // Since we removed error handling UI in App.tsx (per requirement),
    // we ensure the app still mounts without crashing
    await waitFor(() => {
      expect(seedTestData).toHaveBeenCalled();
    });

    // TTAConsole will still render as App component doesn't stop execution on seed error
    expect(screen.getByTestId("tta-console")).toBeInTheDocument();
  });
});
