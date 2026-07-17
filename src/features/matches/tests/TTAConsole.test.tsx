import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { TTAConsole } from "../components/TTAConsole";
import matchReducer from "../store/matchSlice";
import presenceReducer from "../../playerpresences/store/presenceSlice";

describe("TTAConsole Component", () => {
  const store = configureStore({
    reducer: {
      match: matchReducer,
      presence: presenceReducer,
    },
    preloadedState: {
      match: {
        activeMatchId: "test-id",
        periodnumber: 1,
        homescore: 0,
        guestscore: 0,
        isPeriodActive: false,
        isInsideStoppage: false,
        globalSequenceNumber: 0,
      },
    },
  });

  test("renders TTAConsole components correctly", () => {
    render(
      <Provider store={store}>
        <TTAConsole />
      </Provider>,
    );

    expect(screen.getByText(/TTA Match Recorder/i)).toBeDefined();
  });
});
