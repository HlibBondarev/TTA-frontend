import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { TTDActionsPanel } from "../components/TTAPanel";

describe("TTDActionsPanel Component", () => {
  it("allows selecting actions and switching tabs", () => {
    const mockOnActionSelect = vi.fn();

    render(
      <TTDActionsPanel
        onActionSelect={mockOnActionSelect}
        selectedAction={null}
        disabled={false}
      />,
    );

    // Default positive actions tab
    expect(screen.getByText("Goal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Pass"));
    expect(mockOnActionSelect).toHaveBeenCalledWith("Pass", true);

    // Switch to negative tab
    fireEvent.click(screen.getByText("Negative"));
    expect(screen.getByText("Turnover")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Foul"));
    expect(mockOnActionSelect).toHaveBeenCalledWith("Foul", false);
  });

  it("applies selected styling and respects disabled prop", () => {
    const { container } = render(
      <TTDActionsPanel
        onActionSelect={vi.fn()}
        selectedAction="Goal"
        disabled={true}
      />,
    );

    expect(screen.getByText("Goal")).toHaveClass("bg-blue-600");
    expect(container.firstChild).toHaveClass(
      "opacity-50",
      "pointer-events-none",
    );
  });
});
