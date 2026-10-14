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

  it("calculates percentage coordinates relative to bottom-left corner (0,0) on click with canonical X/Y pitch mapping", () => {
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

    // Click at clickX = 50px (Width = 25%), clickY = 20px from top (Length from bottom = 80%)
    fireEvent.click(clickableArea, { clientX: 50, clientY: 20 });

    // Canonical mapping: locationX (Length) = 80, locationY (Width) = 25
    expect(handleLocationSelect).toHaveBeenCalledWith(80, 25);
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

    // Test Enter key via keyDown
    fireEvent.keyDown(playgroundButton, { key: "Enter" });
    expect(handleLocationSelect).toHaveBeenCalledWith(50, 50);

    // Test Space key via keyDown
    handleLocationSelect.mockClear();
    fireEvent.keyDown(playgroundButton, { key: " " });
    expect(handleLocationSelect).toHaveBeenCalledWith(50, 50);
  });

  it("correctly calculates coordinates for a pointer event at position (0, 0)", () => {
    const handleLocationSelect = vi.fn();
    const { container } = render(
      <InteractivePlayground onLocationSelect={handleLocationSelect} />,
    );

    const clickableArea = container.querySelector(".cursor-crosshair")!;

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

    // Pointer click at clientX: 0, clientY: 0
    fireEvent.click(clickableArea, { clientX: 0, clientY: 0, detail: 1 });

    // Canonical mapping: locationX (Length) = 100% (top edge), locationY (Width) = 0% (left edge)
    expect(handleLocationSelect).toHaveBeenCalledWith(100, 0);
  });

  it("sanitizes malicious SVG markup using DOMPurify before rendering", () => {
    const xssSvg =
      '<svg data-testid="xss-svg"><script>alert("xss")</script><circle cx="10" cy="10" r="5" onload="alert(1)" /></svg>';

    render(
      <InteractivePlayground
        playgroundSvg={xssSvg}
        onLocationSelect={vi.fn()}
      />,
    );

    expect(screen.getByTestId("xss-svg")).toBeInTheDocument();
    expect(document.querySelector("script")).not.toBeInTheDocument();
  });

  it("adjusts location coordinates using arrow keys with canonical pitch orientation (ArrowUp/ArrowDown for Length locationX, ArrowLeft/ArrowRight for Width locationY)", () => {
    const handleLocationSelect = vi.fn();
    const { container } = render(
      <InteractivePlayground
        locationX={50}
        locationY={50}
        onLocationSelect={handleLocationSelect}
      />,
    );

    const playgroundButton = container.querySelector(".cursor-crosshair")!;

    // Press ArrowRight: should increase Width (locationY) from 50 to 55
    fireEvent.keyDown(playgroundButton, { key: "ArrowRight" });
    expect(handleLocationSelect).toHaveBeenCalledWith(50, 55);

    // Press ArrowUp: should increase Length (locationX) from 50 to 55
    fireEvent.keyDown(playgroundButton, { key: "ArrowUp" });
    expect(handleLocationSelect).toHaveBeenCalledWith(55, 50);

    // Press ArrowLeft: should decrease Width (locationY) from 50 to 45
    fireEvent.keyDown(playgroundButton, { key: "ArrowLeft" });
    expect(handleLocationSelect).toHaveBeenCalledWith(50, 45);

    // Press ArrowDown: should decrease Length (locationX) from 50 to 45
    fireEvent.keyDown(playgroundButton, { key: "ArrowDown" });
    expect(handleLocationSelect).toHaveBeenCalledWith(45, 50);
  });
});
