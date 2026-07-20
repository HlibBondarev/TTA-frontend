import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { ActionsLog } from "../components/ActionsLog";
import matchReducer from "../store/matchSlice";

describe("ActionsLog Component", () => {
  it("renders recent actions with correct formatting and conditional colors", () => {
    const store = configureStore({
      reducer: { match: matchReducer },
      preloadedState: {
        match: {
          activeMatchId: "test-match",
          periodnumber: 1,
          homescore: 0,
          guestscore: 0,
          isPeriodActive: true,
          isInsideStoppage: false,
          globalSequenceNumber: 2,
          recentActions: [
            {
              id: "action-1",
              playerNumber: 5,
              actionName: "Goal",
              isPositive: true,
              timestamp: new Date("2026-07-20T12:00:00Z").toISOString(),
            },
            {
              id: "action-2",
              playerNumber: 3,
              actionName: "Turnover",
              isPositive: false,
              timestamp: new Date("2026-07-20T12:01:00Z").toISOString(),
            },
          ],
        },
      },
    });

    render(
      <Provider store={store}>
        <ActionsLog />
      </Provider>,
    );

    expect(screen.getByText("Last Actions")).toBeInTheDocument();

    const positiveAction = screen.getByText("#5 Goal");
    expect(positiveAction).toBeInTheDocument();
    expect(positiveAction).toHaveClass("text-emerald-400");

    const negativeAction = screen.getByText("#3 Turnover");
    expect(negativeAction).toBeInTheDocument();
    expect(negativeAction).toHaveClass("text-rose-400");
  });
});
