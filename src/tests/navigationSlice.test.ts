import { describe, it, expect } from "vitest";
import navigationReducer, {
  setCurrentView,
  navigateToHub,
  navigateToMyMatches,
  type NavigationState,
} from "../store/slices/navigationSlice";

describe("navigationSlice Reducer", () => {
  const initialState: NavigationState = {
    currentView: "HUB",
  };

  it("should return the default initial state", () => {
    expect(navigationReducer(undefined, { type: "UNKNOWN" })).toEqual(
      initialState,
    );
  });

  it("should handle setCurrentView", () => {
    const nextState = navigationReducer(
      initialState,
      setCurrentView("QUICK_START"),
    );
    expect(nextState.currentView).toBe("QUICK_START");
  });

  it("should handle navigateToHub", () => {
    const modifiedState: NavigationState = { currentView: "MY_MATCHES" };
    const nextState = navigationReducer(modifiedState, navigateToHub());
    expect(nextState.currentView).toBe("HUB");
  });

  it("should handle navigateToMyMatches", () => {
    const modifiedState: NavigationState = { currentView: "QUICK_START" };
    const nextState = navigationReducer(modifiedState, navigateToMyMatches());
    expect(nextState.currentView).toBe("MY_MATCHES");
  });
});
