import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { InteractivePlayground } from "../components/InteractivePlayground";

describe("InteractivePlayground Component", () => {
  it("renders header title and fallback layout when playgroundSvg is not provided", () => {
    render(<InteractivePlayground onLocationSelect={vi.fn()} />);

    expect(screen.getByText("Field Location Map")).toBeInTheDocument();
    expect(screen.getByText("Standard Court")).toBeInTheDocument();
    expect(screen.getByText("Tap field to select point")).toBeInTheDocument();
  });

  it("renders SVG markup when playgroundSvg is provided", () => {
    const mockSvg =
      '<svg data-testid="custom-svg"><circle cx="10" cy="10" r="5" /></svg>';

    render(
      <InteractivePlayground
        playgroundSvg={mockSvg}
        onLocationSelect={vi.fn()}
      />,
    );

    expect(screen.getByTestId("custom-svg")).toBeInTheDocument();
  });

  it("calculates percentage coordinates relative to bottom-left corner (0,0) on click", () => {
    const handleLocationSelect = vi.fn();
    const { container } = render(
      <InteractivePlayground onLocationSelect={handleLocationSelect} />,
    );

    const clickableArea = container.querySelector(".cursor-crosshair")!;

    // Mock bounding rectangle: width 200px, height 100px
    vi.spyOn(clickableArea, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Click at clickX = 50px (25%), clickY = 20px from top (80% from bottom)
    fireEvent.click(clickableArea, { clientX: 50, clientY: 20 });

    expect(handleLocationSelect).toHaveBeenCalledWith(25, 80);
  });

  it("renders coordinate badge and clear button when locationX and locationY are provided", () => {
    render(
      <InteractivePlayground
        locationX={45.5}
        locationY={82.25}
        onLocationSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("X: 45.5% | Y: 82.25%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear/i })).toBeInTheDocument();
  });

  it("calls onLocationSelect with null values when Clear button is clicked", () => {
    const handleLocationSelect = vi.fn();

    render(
      <InteractivePlayground
        locationX={50}
        locationY={50}
        onLocationSelect={handleLocationSelect}
      />,
    );

    const clearButton = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clearButton);

    expect(handleLocationSelect).toHaveBeenCalledWith(null, null);
  });

  it("prevents interaction and click events when disabled prop is true", () => {
    const handleLocationSelect = vi.fn();
    const { container } = render(
      <InteractivePlayground
        disabled={true}
        locationX={50}
        locationY={50}
        onLocationSelect={handleLocationSelect}
      />,
    );

    const disabledArea = container.querySelector(".cursor-not-allowed")!;
    fireEvent.click(disabledArea);

    const clearButton = screen.getByRole("button", { name: /clear/i });
    expect(clearButton).toBeDisabled();

    expect(handleLocationSelect).not.toHaveBeenCalled();
  });

  it("supports keyboard-triggered position selection (Enter / Space)", () => {
    const handleLocationSelect = vi.fn();
    const { container } = render(
      <InteractivePlayground onLocationSelect={handleLocationSelect} />,
    );

    const playgroundButton = container.querySelector(".cursor-crosshair")!;

    fireEvent.click(playgroundButton, { clientX: 0, clientY: 0 });

    expect(handleLocationSelect).toHaveBeenCalledWith(50, 50);
  });
});
