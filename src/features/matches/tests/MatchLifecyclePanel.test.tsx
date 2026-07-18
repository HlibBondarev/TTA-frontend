import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MatchLifecyclePanel } from "../components/MatchLifecyclePanel";
import { useMatchLifecycle } from "../hooks/useMatchLifecycle";
import { usePlayerPresence } from "../../../features/playerpresences/hooks/usePlayerPresence";
import { useSelector } from "react-redux";

vi.mock("../hooks/useMatchLifecycle");
vi.mock("../../../features/playerpresences/hooks/usePlayerPresence");
vi.mock("react-redux", () => ({ useSelector: vi.fn() }));

describe("MatchLifecyclePanel Component", () => {
  const mockStartPeriod = vi.fn();
  const mockEndPeriod = vi.fn();
  const mockStopTime = vi.fn();
  const mockStartTime = vi.fn();
  const mockNextPeriod = vi.fn();
  const mockPrevPeriod = vi.fn();

  const defaultLifecycleMock: ReturnType<typeof useMatchLifecycle> = {
    periodnumber: 1,
    isPeriodActive: false,
    isInsideStoppage: true,
    globalSequenceNumber: 0,
    startPeriod: mockStartPeriod,
    endPeriod: mockEndPeriod,
    stopTime: mockStopTime,
    startTime: mockStartTime,
    nextPeriod: mockNextPeriod,
    prevPeriod: mockPrevPeriod,
  };

  const defaultPresenceMock: ReturnType<typeof usePlayerPresence> = {
    currentPeriod: 1,
    activeLineupIds: [],
    benchLineupIds: [],
    selectedStartingIds: [],
    activePlayersLimit: 7,
    startPeriodWithRoster: vi.fn().mockResolvedValue(undefined),
    endPeriodWithRoster: vi.fn().mockResolvedValue(undefined),
    refreshPresenceFromDB: vi.fn(),
    stageStartingLineup: vi.fn(),
    executeSubstitution: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSelector).mockReturnValue("test-active-match");
    vi.mocked(useMatchLifecycle).mockReturnValue(defaultLifecycleMock);
    vi.mocked(usePlayerPresence).mockReturnValue(defaultPresenceMock);
  });

  it("should render component structure properly", () => {
    render(<MatchLifecyclePanel />);
    // Target the specific element to avoid conflicts
    expect(screen.getByText(/^Period$/i)).toBeInTheDocument();
  });

  it("should allow navigating periods when period is inactive", () => {
    render(<MatchLifecyclePanel />);
    fireEvent.click(screen.getByRole("button", { name: "<" }));
    expect(mockPrevPeriod).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: ">" }));
    expect(mockNextPeriod).toHaveBeenCalledTimes(1);
  });

  it("should trigger successful period start flow", async () => {
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultPresenceMock,
      selectedStartingIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
    });
    render(<MatchLifecyclePanel />);
    await act(async () => {
      // Updated name to "START PERIOD"
      fireEvent.click(screen.getByRole("button", { name: /START PERIOD/i }));
    });
    expect(mockStartPeriod).toHaveBeenCalledTimes(1);
  });

  it("should successfully trigger period end flow", async () => {
    vi.mocked(useMatchLifecycle).mockReturnValue({
      ...defaultLifecycleMock,
      isPeriodActive: true,
    });
    render(<MatchLifecyclePanel />);
    await act(async () => {
      // Updated name to "END PERIOD"
      fireEvent.click(screen.getByRole("button", { name: /END PERIOD/i }));
    });
    expect(mockEndPeriod).toHaveBeenCalledTimes(1);
  });

  it("should display error message on failure", async () => {
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultPresenceMock,
      selectedStartingIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
      startPeriodWithRoster: vi.fn().mockRejectedValue(new Error("Failed")),
    });
    render(<MatchLifecyclePanel />);
    await act(async () => {
      // Updated name to "START PERIOD"
      fireEvent.click(screen.getByRole("button", { name: /START PERIOD/i }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
  });
});
