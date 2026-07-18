import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { App, TEST_MATCH_ID } from "../App";
import { seedTestData } from "../db/seed";
import matchReducer from "../features/matches/store/matchSlice";
import presenceReducer from "../features/playerpresences/store/presenceSlice";

vi.mock("../db/seed", () => ({
  seedTestData: vi.fn().mockResolvedValue(undefined),
}));

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

  it("should initialize Redux state and render console on successful seeding", async () => {
    render(<App />, { wrapper });

    await waitFor(() => {
      expect(seedTestData).toHaveBeenCalledTimes(1);
      // Assert Redux state initialization
      expect(store.getState().match.activeMatchId).toBe(TEST_MATCH_ID);
      expect(store.getState().presence.activePlayersLimit).toBe(7);
    });

    expect(screen.getByTestId("tta-console")).toBeInTheDocument();
  });

  it("should initialize Redux state even if seeding fails", async () => {
    vi.mocked(seedTestData).mockRejectedValueOnce(new Error("Seeding Fault"));

    render(<App />, { wrapper });

    await waitFor(() => {
      expect(seedTestData).toHaveBeenCalled();
      // Assert Redux state is initialized despite seeding failure
      expect(store.getState().match.activeMatchId).toBe(TEST_MATCH_ID);
      expect(store.getState().presence.activePlayersLimit).toBe(7);
    });

    expect(screen.getByTestId("tta-console")).toBeInTheDocument();
  });
});
