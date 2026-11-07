import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { InteractivePlayground } from "../components/InteractivePlayground";

describe("InteractivePlayground Component", () => {
  it("renders header title and fallback layout when playground is not provided", () => {
    render(<InteractivePlayground onLocationSelect={vi.fn()} />);

    expect(screen.getByText("Field Location Map")).toBeInTheDocument();
    expect(screen.getByText("Standard Court")).toBeInTheDocument();
    expect(screen.getByText("Tap field to select point")).toBeInTheDocument();
  });

  it("renders SVG markup when playground is provided", () => {
    const mockSvg =
      '<svg data-testid="custom-svg"><circle cx="10" cy="10" r="5" /></svg>';

    render(
      <InteractivePlayground playground={mockSvg} onLocationSelect={vi.fn()} />,
    );

    expect(screen.getByTestId("custom-svg")).toBeInTheDocument();
  });

  it("sanitizes malicious SVG markup using DOMPurify before rendering", () => {
    const xssSvg =
      '<svg data-testid="xss-svg"><script>alert("xss")</script><circle cx="10" cy="10" r="5" onload="alert(1)" /></svg>';

    render(
      <InteractivePlayground playground={xssSvg} onLocationSelect={vi.fn()} />,
    );

    expect(screen.getByTestId("xss-svg")).toBeInTheDocument();
    expect(document.querySelector("script")).not.toBeInTheDocument();
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

  it("clamps coordinates to [0, 100] range when click is outside boundaries", () => {
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

    // Click beyond top-right: clientX 250 (Width > 100%), clientY -50 (Length > 100%)
    fireEvent.click(clickableArea, { clientX: 250, clientY: -50 });
    expect(handleLocationSelect).toHaveBeenCalledWith(100, 100);

    // Click beyond bottom-left: clientX -50 (Width < 0%), clientY 150 (Length < 0%)
    handleLocationSelect.mockClear();
    fireEvent.click(clickableArea, { clientX: -50, clientY: 150 });
    expect(handleLocationSelect).toHaveBeenCalledWith(0, 0);
  });

  it("ignores click event when bounding rect has 0 width or height", () => {
    const handleLocationSelect = vi.fn();
    const { container } = render(
      <InteractivePlayground onLocationSelect={handleLocationSelect} />,
    );

    const clickableArea = container.querySelector(".cursor-crosshair")!;

    vi.spyOn(clickableArea, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.click(clickableArea, { clientX: 50, clientY: 20 });
    expect(handleLocationSelect).not.toHaveBeenCalled();
  });

  it("renders coordinate badge, clear button, and pin marker at correct position", () => {
    const { container } = render(
      <InteractivePlayground
        locationX={40}
        locationY={70}
        onLocationSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("X: 40% | Y: 70%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear/i })).toBeInTheDocument();

    const pinMarker = container.querySelector('div[style*="left: 70%"]');
    expect(pinMarker).toBeInTheDocument();
    expect(pinMarker).toHaveStyle({ top: "60%", left: "70%" });
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

  it("prevents interaction and events when disabled prop is true", () => {
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
    expect(handleLocationSelect).not.toHaveBeenCalled();

    fireEvent.keyDown(disabledArea, { key: "ArrowRight" });
    expect(handleLocationSelect).not.toHaveBeenCalled();

    const clearButton = screen.getByRole("button", { name: /clear/i });
    expect(clearButton).toBeDisabled();
    fireEvent.click(clearButton);
    expect(handleLocationSelect).not.toHaveBeenCalled();
  });

  it("supports keyboard-triggered position selection (Enter / Space)", () => {
    const handleLocationSelect = vi.fn();
    const { container } = render(
      <InteractivePlayground onLocationSelect={handleLocationSelect} />,
    );

    const playgroundButton = container.querySelector(".cursor-crosshair")!;

    fireEvent.keyDown(playgroundButton, { key: "Enter" });
    expect(handleLocationSelect).toHaveBeenCalledWith(50, 50);

    handleLocationSelect.mockClear();
    fireEvent.keyDown(playgroundButton, { key: " " });
    expect(handleLocationSelect).toHaveBeenCalledWith(50, 50);
  });

  it("does not trigger Enter / Space selection if coordinates are already set", () => {
    const handleLocationSelect = vi.fn();
    const { container } = render(
      <InteractivePlayground
        locationX={30}
        locationY={40}
        onLocationSelect={handleLocationSelect}
      />,
    );

    const playgroundButton = container.querySelector(".cursor-crosshair")!;

    fireEvent.keyDown(playgroundButton, { key: "Enter" });
    expect(handleLocationSelect).not.toHaveBeenCalled();
  });

  it("adjusts location coordinates using arrow keys with step of 5%", () => {
    const handleLocationSelect = vi.fn();
    const { container } = render(
      <InteractivePlayground
        locationX={50}
        locationY={50}
        onLocationSelect={handleLocationSelect}
      />,
    );

    const playgroundButton = container.querySelector(".cursor-crosshair")!;

    // ArrowRight -> increases Width (locationY) to 55
    fireEvent.keyDown(playgroundButton, { key: "ArrowRight" });
    expect(handleLocationSelect).toHaveBeenCalledWith(50, 55);

    // ArrowUp -> increases Length (locationX) to 55
    fireEvent.keyDown(playgroundButton, { key: "ArrowUp" });
    expect(handleLocationSelect).toHaveBeenCalledWith(55, 50);

    // ArrowLeft -> decreases Width (locationY) to 45
    fireEvent.keyDown(playgroundButton, { key: "ArrowLeft" });
    expect(handleLocationSelect).toHaveBeenCalledWith(50, 45);

    // ArrowDown -> decreases Length (locationX) to 45
    fireEvent.keyDown(playgroundButton, { key: "ArrowDown" });
    expect(handleLocationSelect).toHaveBeenCalledWith(45, 50);
  });

  it("respects 0 and 100 boundaries when using arrow keys", () => {
    const handleLocationSelect = vi.fn();
    const { container, rerender } = render(
      <InteractivePlayground
        locationX={100}
        locationY={100}
        onLocationSelect={handleLocationSelect}
      />,
    );

    const playgroundButton = container.querySelector(".cursor-crosshair")!;

    fireEvent.keyDown(playgroundButton, { key: "ArrowRight" });
    expect(handleLocationSelect).toHaveBeenCalledWith(100, 100);

    fireEvent.keyDown(playgroundButton, { key: "ArrowUp" });
    expect(handleLocationSelect).toHaveBeenCalledWith(100, 100);

    handleLocationSelect.mockClear();

    rerender(
      <InteractivePlayground
        locationX={0}
        locationY={0}
        onLocationSelect={handleLocationSelect}
      />,
    );

    fireEvent.keyDown(playgroundButton, { key: "ArrowLeft" });
    expect(handleLocationSelect).toHaveBeenCalledWith(0, 0);

    fireEvent.keyDown(playgroundButton, { key: "ArrowDown" });
    expect(handleLocationSelect).toHaveBeenCalledWith(0, 0);
  });

  it("ignores non-arrow and non-actionable keys", () => {
    const handleLocationSelect = vi.fn();
    const { container } = render(
      <InteractivePlayground onLocationSelect={handleLocationSelect} />,
    );

    const playgroundButton = container.querySelector(".cursor-crosshair")!;

    fireEvent.keyDown(playgroundButton, { key: "Tab" });
    fireEvent.keyDown(playgroundButton, { key: "a" });

    expect(handleLocationSelect).not.toHaveBeenCalled();
  });
});
