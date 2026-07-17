import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MatchLifecyclePanel } from "../components/MatchLifecyclePanel";
import { useMatchLifecycle } from "../hooks/useMatchLifecycle";
import { usePlayerPresence } from "../../../features/playerpresences/hooks/usePlayerPresence";
import { useSelector } from "react-redux";
import { TEST_MATCH_ID } from "../../../App";

vi.mock("../hooks/useMatchLifecycle");
vi.mock("../../../features/playerpresences/hooks/usePlayerPresence");
vi.mock("react-redux", () => ({
  useSelector: vi.fn(),
}));

describe("MatchLifecyclePanel Component", () => {
  const mockStartPeriod = vi.fn();
  const mockEndPeriod = vi.fn();
  const mockStopTime = vi.fn();
  const mockStartTime = vi.fn();
  const mockNextPeriod = vi.fn();
  const mockPrevPeriod = vi.fn();

  const defaultLifecycleMock = {
    periodnumber: 1,
    isPeriodActive: false,
    isInsideStoppage: true,
    globalSequenceNumber: 5,
    startPeriod: mockStartPeriod,
    endPeriod: mockEndPeriod,
    stopTime: mockStopTime,
    startTime: mockStartTime,
    nextPeriod: mockNextPeriod,
    prevPeriod: mockPrevPeriod,
  };

  const mockStartPeriodWithRoster = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);
  const mockEndPeriodWithRoster = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);

  const defaultPresenceMock = {
    selectedStartingIds: [] as string[],
    activePlayersLimit: 7,
    startPeriodWithRoster: mockStartPeriodWithRoster,
    endPeriodWithRoster: mockEndPeriodWithRoster,
    refreshPresenceFromDB: vi.fn(),
    activeLineupIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"] as string[],
    benchLineupIds: [] as string[],
    stageStartingLineup: vi.fn(),
    executeSubstitution: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSelector).mockReturnValue("test-active-match");
    vi.mocked(useMatchLifecycle).mockReturnValue(
      defaultLifecycleMock as unknown as ReturnType<typeof useMatchLifecycle>,
    );
    vi.mocked(usePlayerPresence).mockReturnValue(
      defaultPresenceMock as unknown as ReturnType<typeof usePlayerPresence>,
    );
  });

  it("should render component structure properly with control elements", () => {
    render(<MatchLifecyclePanel />);
    expect(screen.getByText(/Period Control/i)).toBeInTheDocument();
    expect(screen.getByText(/Sequence/i)).toBeInTheDocument();
    expect(screen.getByText(/#\s*5/)).toBeInTheDocument();
    expect(screen.getByText(/In-active/i)).toBeInTheDocument();
  });

  it("should allow navigating periods when period is inactive", () => {
    render(<MatchLifecyclePanel />);
    const prevBtn = screen.getByRole("button", { name: "<" });
    const nextBtn = screen.getByRole("button", { name: ">" });
    fireEvent.click(prevBtn);
    expect(mockPrevPeriod).toHaveBeenCalledTimes(1);
    fireEvent.click(nextBtn);
    expect(mockNextPeriod).toHaveBeenCalledTimes(1);
  });

  it("should block navigation and display active state label when period is active", () => {
    vi.mocked(useMatchLifecycle).mockReturnValue({
      ...defaultLifecycleMock,
      isPeriodActive: true,
      isInsideStoppage: false,
    } as unknown as ReturnType<typeof useMatchLifecycle>);
    render(<MatchLifecyclePanel />);
    expect(screen.getByText(/Live Running/i)).toBeInTheDocument();
    const prevBtn = screen.getByRole("button", { name: "<" });
    const nextBtn = screen.getByRole("button", { name: ">" });
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).toBeDisabled();
  });

  it("should show error when trying to start active period without full starting roster staged", () => {
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultPresenceMock,
      selectedStartingIds: ["p1", "p2"],
    } as unknown as ReturnType<typeof usePlayerPresence>);
    render(<MatchLifecyclePanel />);
    expect(screen.getByText(/Select 5 more player\(s\)/i)).toBeInTheDocument();
    const startBtn = screen.getByRole("button", { name: /start period/i });
    expect(startBtn).toBeDisabled();
    expect(mockStartPeriodWithRoster).not.toHaveBeenCalled();
    expect(mockStartPeriod).not.toHaveBeenCalled();
  });

  it("should trigger successful period start flow when starting lineup criteria is met", async () => {
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultPresenceMock,
      selectedStartingIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
    } as unknown as ReturnType<typeof usePlayerPresence>);
    render(<MatchLifecyclePanel />);
    const startBtn = screen.getByRole("button", { name: /start period/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockStartPeriodWithRoster).toHaveBeenCalledTimes(1);
    expect(mockStartPeriod).toHaveBeenCalledTimes(1);
  });

  it("should successfully trigger period end flow", async () => {
    vi.mocked(useMatchLifecycle).mockReturnValue({
      ...defaultLifecycleMock,
      isPeriodActive: true,
    } as unknown as ReturnType<typeof useMatchLifecycle>);
    render(<MatchLifecyclePanel />);
    const endBtn = screen.getByRole("button", { name: /end period/i });
    await act(async () => {
      fireEvent.click(endBtn);
    });
    expect(mockEndPeriodWithRoster).toHaveBeenCalledTimes(1);
    expect(mockEndPeriod).toHaveBeenCalledTimes(1);
  });

  it("should support stoppage start (Stop) and stop (Start) clicks", () => {
    vi.mocked(useMatchLifecycle).mockReturnValue({
      ...defaultLifecycleMock,
      isPeriodActive: true,
      isInsideStoppage: false,
    } as unknown as ReturnType<typeof useMatchLifecycle>);
    const { rerender } = render(<MatchLifecyclePanel />);
    const stopClockBtn = screen.getByRole("button", { name: "Stop" });
    fireEvent.click(stopClockBtn);
    expect(mockStopTime).toHaveBeenCalledTimes(1);
    vi.mocked(useMatchLifecycle).mockReturnValue({
      ...defaultLifecycleMock,
      isPeriodActive: true,
      isInsideStoppage: true,
    } as unknown as ReturnType<typeof useMatchLifecycle>);
    rerender(<MatchLifecyclePanel />);
    const startClockBtnReloaded = screen.getByRole("button", { name: "Start" });
    fireEvent.click(startClockBtnReloaded);
    expect(mockStartTime).toHaveBeenCalledTimes(1);
  });

  it("should display error message if startPeriodWithRoster throws an Error instance", async () => {
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultPresenceMock,
      selectedStartingIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
      startPeriodWithRoster: vi
        .fn()
        .mockRejectedValue(new Error("Database write failed")),
    } as unknown as ReturnType<typeof usePlayerPresence>);
    render(<MatchLifecyclePanel />);
    const startBtn = screen.getByRole("button", { name: /start period/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Database write failed",
    );
  });

  it("should display generic error message if startPeriodWithRoster throws a non-Error object", async () => {
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultPresenceMock,
      selectedStartingIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
      startPeriodWithRoster: vi
        .fn()
        .mockRejectedValue("Some weird database error string"),
    } as unknown as ReturnType<typeof usePlayerPresence>);
    render(<MatchLifecyclePanel />);
    const startBtn = screen.getByRole("button", { name: /start period/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to start period.",
    );
  });

  it("should display error message if endPeriodWithRoster throws an Error instance", async () => {
    vi.mocked(useMatchLifecycle).mockReturnValue({
      ...defaultLifecycleMock,
      isPeriodActive: true,
    } as unknown as ReturnType<typeof useMatchLifecycle>);
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultPresenceMock,
      endPeriodWithRoster: vi
        .fn()
        .mockRejectedValue(new Error("Database close failed")),
    } as unknown as ReturnType<typeof usePlayerPresence>);
    render(<MatchLifecyclePanel />);
    const endBtn = screen.getByRole("button", { name: /end period/i });
    await act(async () => {
      fireEvent.click(endBtn);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Database close failed",
    );
  });

  it("should display generic error message if endPeriodWithRoster throws a non-Error object", async () => {
    vi.mocked(useMatchLifecycle).mockReturnValue({
      ...defaultLifecycleMock,
      isPeriodActive: true,
    } as unknown as ReturnType<typeof useMatchLifecycle>);
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultPresenceMock,
      endPeriodWithRoster: vi
        .fn()
        .mockRejectedValue("Some weird database close error"),
    } as unknown as ReturnType<typeof usePlayerPresence>);
    render(<MatchLifecyclePanel />);
    const endBtn = screen.getByRole("button", { name: /end period/i });
    await act(async () => {
      fireEvent.click(endBtn);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to end period.",
    );
  });

  it("should fall back to TEST_MATCH_ID if activeMatchId is not defined in Redux state", () => {
    vi.mocked(useSelector).mockReturnValue(undefined);
    render(<MatchLifecyclePanel />);
    expect(usePlayerPresence).toHaveBeenCalledWith(TEST_MATCH_ID);
  });
});
