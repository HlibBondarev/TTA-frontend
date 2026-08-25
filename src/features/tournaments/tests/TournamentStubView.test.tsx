import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { TournamentStubView } from "../components/TournamentStubView";
import navigationReducer from "../../../store/slices/navigationSlice";

const createTestStore = () => {
  return configureStore({
    reducer: {
      navigation: navigationReducer,
    },
  });
};

describe("TournamentStubView Component", () => {
  beforeEach(() => {
    const store = createTestStore();
    store.dispatch({
      type: "navigation/setCurrentView",
      payload: "TOURNAMENT_STUB",
    });
  });

  it("should render tournament scopes and roles description", () => {
    const store = createTestStore();

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
    const store = createTestStore();

    render(
      <Provider store={store}>
        <TournamentStubView />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Return to Hub/i }));

    expect(store.getState().navigation.currentView).toBe("HUB");
  });
});
