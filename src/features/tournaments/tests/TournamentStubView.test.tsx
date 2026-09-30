import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { TournamentStubView } from "../components/TournamentStubView";
import navigationReducer from "../../../store/slices/navigationSlice";

const createTestStore = (
  preloadedState?: Parameters<typeof configureStore>[0]["preloadedState"],
) => {
  return configureStore({
    reducer: {
      navigation: navigationReducer,
    },
    preloadedState,
  });
};

describe("TournamentStubView Component", () => {
  beforeEach(() => {
    // Reset mocks if any exist
  });

  it("should render tournament scopes and roles description", () => {
    const store = createTestStore({
      navigation: { currentView: "TOURNAMENT_STUB" },
    });

    render(
      <Provider store={store}>
        <TournamentStubView />
      </Provider>,
    );

    expect(screen.getByText("Tournaments Feature")).toBeDefined();
    expect(screen.getByText("Target Scopes (TargetScope)")).toBeDefined();
    expect(screen.getByText("Permission Roles (AppRole)")).toBeDefined();
    expect(screen.getByText("FullControl")).toBeDefined();
    expect(screen.getByText("Editor")).toBeDefined();
    expect(screen.getByText("Viewer")).toBeDefined();
  });

  it("should navigate back to Hub when clicking Return to Hub button", () => {
    const store = createTestStore({
      navigation: { currentView: "TOURNAMENT_STUB" },
    });

    render(
      <Provider store={store}>
        <TournamentStubView />
      </Provider>,
    );

    expect(store.getState().navigation.currentView).toBe("TOURNAMENT_STUB");

    fireEvent.click(screen.getByRole("button", { name: /Return to Hub/i }));

    expect(store.getState().navigation.currentView).toBe("HUB");
  });
});
