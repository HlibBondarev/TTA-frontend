import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { TTDActionsPanel } from "../components/TTAPanel";
import { db } from "../../../db/ttaDatabase";

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    eventdefinitions: {
      toArray: vi.fn(),
    },
  },
}));

// Mock dexie's liveQuery to asynchronously notify observers during unit test execution
vi.mock("dexie", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dexie")>();
  return {
    ...actual,
    liveQuery: (fn: () => Promise<unknown>) => ({
      subscribe: (observer: {
        next: (val: unknown) => void;
        error?: (err: unknown) => void;
      }) => {
        fn()
          .then((data) => observer.next(data))
          .catch((err) => observer.error?.(err));
        return { unsubscribe: vi.fn() };
      },
    }),
  };
});

describe("TTDActionsPanel Component", () => {
  const mockEventDefinitions = [
    {
      id: "1",
      sportId: "s1",
      name: "Goal",
      shortName: "GL",
      isPositive: true,
      createdAt: "",
    },
    {
      id: "2",
      sportId: "s1",
      name: "Pass",
      shortName: "PS",
      isPositive: true,
      createdAt: "",
    },
    {
      id: "3",
      sportId: "s1",
      name: "Turnover",
      shortName: "TO",
      isPositive: false,
      createdAt: "",
    },
    {
      id: "4",
      sportId: "s1",
      name: "Foul",
      shortName: "FL",
      isPositive: false,
      createdAt: "",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.eventdefinitions.toArray).mockResolvedValue(
      mockEventDefinitions,
    );
  });

  it("allows selecting actions loaded dynamically from Dexie DB and switching tabs", async () => {
    const mockOnActionSelect = vi.fn();
    const mockOnIsLeadToGoalChange = vi.fn();

    render(
      <TTDActionsPanel
        onActionSelect={mockOnActionSelect}
        selectedAction={null}
        isLeadToGoal={false}
        onIsLeadToGoalChange={mockOnIsLeadToGoalChange}
        disabled={false}
      />,
    );

    // Wait for dynamic event definitions to resolve and render
    expect(await screen.findByText("Goal")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Pass"));
    expect(mockOnActionSelect).toHaveBeenCalledWith("Pass", true);

    // Switch to negative tab
    fireEvent.click(screen.getByText("Negative"));
    expect(await screen.findByText("Turnover")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Foul"));
    expect(mockOnActionSelect).toHaveBeenCalledWith("Foul", false);
  });

  it("applies selected styling and toggles isLeadToGoal checkbox", async () => {
    const mockOnIsLeadToGoalChange = vi.fn();

    render(
      <TTDActionsPanel
        onActionSelect={vi.fn()}
        selectedAction="Goal"
        isLeadToGoal={true}
        onIsLeadToGoalChange={mockOnIsLeadToGoalChange}
        disabled={false}
      />,
    );

    const goalBtn = await screen.findByText("Goal");
    expect(goalBtn).toHaveClass("bg-blue-600");

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);
    expect(mockOnIsLeadToGoalChange).toHaveBeenCalledWith(false);
  });

  it("respects disabled prop", async () => {
    const { container } = render(
      <TTDActionsPanel
        onActionSelect={vi.fn()}
        selectedAction={null}
        isLeadToGoal={false}
        onIsLeadToGoalChange={vi.fn()}
        disabled={true}
      />,
    );

    expect(container.firstChild).toHaveClass(
      "opacity-50",
      "pointer-events-none",
    );
  });
});
