import { vi, describe, test, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MatchResultModal } from "../components/MatchResultModal";
import matchReducer, { type MatchState } from "../store/matchSlice";
import { matchFinalizationService } from "../../../services/matchFinalizationService";
import { reportService } from "../../../services/reportService";

vi.mock("../../../services/matchFinalizationService", () => ({
  matchFinalizationService: {
    finalizeMatch: vi.fn(),
  },
}));

vi.mock("../../../services/reportService", () => ({
  reportService: {
    getTeamSummaryReport: vi.fn(),
    getPlayerDetailedReport: vi.fn(),
  },
}));

const createTestStore = (preloadedMatchState: Partial<MatchState> = {}) => {
  return configureStore({
    reducer: {
      match: matchReducer,
    },
    preloadedState: {
      match: {
        activeMatchId: "test-match-123",
        activeTeamId: "test-team-456",
        periodNumber: 4,
        homeScore: 8,
        guestScore: 5,
        isPeriodActive: false,
        isInsideStoppage: false,
        isPeriodEnded: true,
        globalSequenceNumber: 10,
        recentActions: [],
        ...preloadedMatchState,
      },
    },
  });
};

describe("MatchResultModal Component", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("should render nothing when isOpen is false", () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={false} onClose={mockOnClose} />
      </Provider>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("should render modal and pre-fill scores from Redux when isOpen is true", () => {
    const store = createTestStore({ homeScore: 12, guestScore: 7 });
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Match Result Finalization")).toBeInTheDocument();

    const inputs = screen.getAllByRole("textbox");
    expect(inputs[0]).toHaveValue("12"); // Home score
    expect(inputs[1]).toHaveValue("7"); // Guest score
    expect(inputs[2]).toHaveValue(""); // Temperature
  });

  test("should increment and decrement scores using stepper buttons", () => {
    const store = createTestStore({ homeScore: 2, guestScore: 0 });
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const stepperButtons = screen.getAllByRole("button", { name: /[+-]/ });
    const homeMinus = stepperButtons[0];
    const homePlus = stepperButtons[1];
    const guestMinus = stepperButtons[2];

    const inputs = screen.getAllByRole("textbox");

    // Increment Home Score (2 -> 3)
    fireEvent.click(homePlus);
    expect(inputs[0]).toHaveValue("3");

    // Decrement Home Score (3 -> 2)
    fireEvent.click(homeMinus);
    expect(inputs[0]).toHaveValue("2");

    // Try Decrementing Guest Score below 0 (0 -> 0)
    fireEvent.click(guestMinus);
    expect(inputs[1]).toHaveValue("0");
  });

  test("should disable submit button when scores are invalid", () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const inputs = screen.getAllByRole("textbox");
    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });

    expect(submitBtn).not.toBeDisabled();

    // Set invalid negative/text home score
    fireEvent.change(inputs[0], { target: { value: "-3" } });
    expect(submitBtn).toBeDisabled();

    // Set non-numeric text home score
    fireEvent.change(inputs[0], { target: { value: "abc" } });
    expect(submitBtn).toBeDisabled();

    // Reset home score to valid, set guest score empty
    fireEvent.change(inputs[0], { target: { value: "5" } });
    fireEvent.change(inputs[1], { target: { value: "" } });
    expect(submitBtn).toBeDisabled();
  });

  test("should validate optional temperature input correctly", () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const inputs = screen.getAllByRole("textbox");
    const tempInput = inputs[2];
    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });

    // Invalid temperature string
    fireEvent.change(tempInput, { target: { value: "invalid-temp" } });
    expect(submitBtn).toBeDisabled();
    expect(
      screen.getByText("Enter a valid numeric temperature value."),
    ).toBeInTheDocument();

    // Valid decimal temperature
    fireEvent.change(tempInput, { target: { value: "26.5" } });
    expect(submitBtn).not.toBeDisabled();
    expect(
      screen.queryByText("Enter a valid numeric temperature value."),
    ).toBeNull();
  });

  test("should trigger match finalization pipeline, keep match in Redux, and display report modal on successful submit", async () => {
    vi.mocked(matchFinalizationService.finalizeMatch).mockResolvedValueOnce(
      undefined,
    );
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce([]);

    const store = createTestStore({ homeScore: 10, guestScore: 8 });
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[2], { target: { value: "24.0" } }); // Temperature

    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(matchFinalizationService.finalizeMatch).toHaveBeenCalledWith({
        matchId: "test-match-123",
        activeTeamId: "test-team-456",
        homeScore: 10,
        guestScore: 8,
        temperature: 24.0,
      });
    });

    // Check Redux match state is STILL ACTIVE while report modal is open
    expect(store.getState().match.activeMatchId).toBe("test-match-123");

    // Check post-finalization MatchReportModal rendered
    await waitFor(() => {
      expect(screen.getByText("Team TTA Summary Report")).toBeInTheDocument();
    });
  });

  test("should reset Redux state and call onClose when report modal is closed after finalization", async () => {
    vi.mocked(matchFinalizationService.finalizeMatch).mockResolvedValueOnce(
      undefined,
    );
    vi.mocked(reportService.getTeamSummaryReport).mockResolvedValueOnce([]);

    const store = createTestStore({ homeScore: 10, guestScore: 8 });
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });
    fireEvent.click(submitBtn);

    // Wait for report modal to appear
    await waitFor(() => {
      expect(screen.getByText("Team TTA Summary Report")).toBeInTheDocument();
    });

    // Close report modal
    const closeReportBtn = screen.getByRole("button", {
      name: /close report/i,
    });
    fireEvent.click(closeReportBtn);

    // Check Redux state was reset after closing report
    expect(store.getState().match.activeMatchId).toBeNull();
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  test("should display error message alert when finalization service fails", async () => {
    vi.mocked(matchFinalizationService.finalizeMatch).mockRejectedValueOnce(
      new Error("Network timeout during sync"),
    );

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });
    fireEvent.click(submitBtn);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Network timeout during sync");

    // Ensure Redux state is preserved on failure
    expect(store.getState().match.activeMatchId).toBe("test-match-123");
  });

  test("should call onClose callback when Cancel button is clicked", () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  test("should reject hexadecimal string as temperature input", () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={mockOnClose} />
      </Provider>,
    );

    const inputs = screen.getAllByRole("textbox");
    const tempInput = inputs[2];
    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });

    // Hexadecimal value should fail validation
    fireEvent.change(tempInput, { target: { value: "0x10" } });
    expect(submitBtn).toBeDisabled();
    expect(
      screen.getByText("Enter a valid numeric temperature value."),
    ).toBeInTheDocument();
  });

  test("should display friendly timeout message when finalization request is aborted", async () => {
    const abortError = new Error("signal is aborted without reason");
    abortError.name = "AbortError";

    vi.mocked(matchFinalizationService.finalizeMatch).mockRejectedValueOnce(
      abortError,
    );

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MatchResultModal isOpen={true} onClose={vi.fn()} />
      </Provider>,
    );

    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });
    fireEvent.click(submitBtn);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Request timed out or was cancelled. Please check backend sync and retry.",
    );
  });
});
