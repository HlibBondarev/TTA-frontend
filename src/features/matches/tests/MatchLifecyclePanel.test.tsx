import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MatchLifecyclePanel } from "../components/MatchLifecyclePanel";
import { useMatchLifecycle } from "../hooks/useMatchLifecycle";
import { usePlayerPresence } from "../../../features/playerpresences/hooks/usePlayerPresence";
import { useSelector } from "react-redux";
import { db } from "../../../db/ttaDatabase";

vi.mock("../hooks/useMatchLifecycle");
vi.mock("../../../features/playerpresences/hooks/usePlayerPresence");
vi.mock("react-redux", () => ({ useSelector: vi.fn() }));
vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    timeanchors: {
      delete: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

describe("MatchLifecyclePanel Component", () => {
  const mockStartPeriod = vi.fn().mockResolvedValue("anchor-id-start");
  const mockEndPeriod = vi.fn().mockResolvedValue("anchor-id-end");
  const mockRevertStartPeriod = vi.fn().mockImplementation(async () => {
    await db.timeanchors.delete("anchor-id-start");
  });
  const mockRevertEndPeriod = vi.fn().mockImplementation(async () => {
    await db.timeanchors.delete("anchor-id-end");
  });
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
    removeTimeAnchor: vi.fn(),
    revertStartPeriod: mockRevertStartPeriod,
    revertEndPeriod: mockRevertEndPeriod,
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
    refreshPresenceFromDB: vi.fn().mockResolvedValue(undefined),
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
      fireEvent.click(screen.getByRole("button", { name: /END PERIOD/i }));
    });
    expect(mockEndPeriod).toHaveBeenCalledTimes(1);
  });

  it("should perform complete compensation if startPeriodWithRoster fails after anchor write", async () => {
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultPresenceMock,
      selectedStartingIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
      startPeriodWithRoster: vi
        .fn()
        .mockRejectedValue(new Error("Roster persistence failed")),
    });

    render(<MatchLifecyclePanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /START PERIOD/i }));
    });

    expect(mockStartPeriod).toHaveBeenCalledTimes(1);
    expect(db.timeanchors.delete).toHaveBeenCalledWith("anchor-id-start");
    expect(mockRevertStartPeriod).toHaveBeenCalledWith("anchor-id-start");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to start period. Transaction fully reverted.",
    );
  });

  it("should perform complete compensation if endPeriodWithRoster fails after anchor write", async () => {
    vi.mocked(useMatchLifecycle).mockReturnValue({
      ...defaultLifecycleMock,
      isPeriodActive: true,
    });
    vi.mocked(usePlayerPresence).mockReturnValue({
      ...defaultPresenceMock,
      endPeriodWithRoster: vi
        .fn()
        .mockRejectedValue(new Error("Roster termination failed")),
    });

    render(<MatchLifecyclePanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /END PERIOD/i }));
    });

    expect(mockEndPeriod).toHaveBeenCalledTimes(1);
    expect(db.timeanchors.delete).toHaveBeenCalledWith("anchor-id-end");
    expect(mockRevertEndPeriod).toHaveBeenCalledWith("anchor-id-end");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to end period. Transaction fully reverted.",
    );
  });
});
