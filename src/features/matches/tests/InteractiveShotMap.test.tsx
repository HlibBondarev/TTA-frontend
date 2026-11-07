import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { InteractiveShotMap } from "../components/InteractiveShotMap";

describe("InteractiveShotMap Component", () => {
  const validSvg = `<svg viewBox="0 0 100 50" data-testid="goal-svg"><rect width="100" height="50" /></svg>`;

  it("returns null when shotMap is not provided or invalid", () => {
    const { container } = render(
      <InteractiveShotMap shotMap={null} onShotLocationSelect={vi.fn()} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders header title, sanitized SVG, and prompt when shotMap is provided", () => {
    render(
      <InteractiveShotMap shotMap={validSvg} onShotLocationSelect={vi.fn()} />,
    );

    expect(screen.getByText("Goal Shot Map")).toBeInTheDocument();
    expect(screen.getByTestId("goal-svg")).toBeInTheDocument();
    expect(
      screen.getByText("Tap goal frame to select target point"),
    ).toBeInTheDocument();
  });

  it("sanitizes malicious SVG markup using DOMPurify before rendering", () => {
    const xssSvg = `<svg viewBox="0 0 100 50" data-testid="xss-svg"><script>alert("xss")</script><circle cx="10" cy="10" r="5" /></svg>`;

    render(
      <InteractiveShotMap shotMap={xssSvg} onShotLocationSelect={vi.fn()} />,
    );

    expect(screen.getByTestId("xss-svg")).toBeInTheDocument();
    expect(document.querySelector("script")).not.toBeInTheDocument();
  });

  it("calculates percentage coordinates relative to bottom-left corner (0,0) on click", () => {
    const handleShotLocationSelect = vi.fn();
    render(
      <InteractiveShotMap
        shotMap={validSvg}
        onShotLocationSelect={handleShotLocationSelect}
      />,
    );

    const clickableArea = screen.getByLabelText("Goal Shot Location Map");

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

    // Click at clickX = 50px (X = 25%), clickY = 20px from top (Y from bottom = 80%)
    fireEvent.click(clickableArea, { clientX: 50, clientY: 20 });

    expect(handleShotLocationSelect).toHaveBeenCalledWith(25, 80);
  });

  it("clamps coordinates to [0, 100] range when click is outside boundaries", () => {
    const handleShotLocationSelect = vi.fn();
    render(
      <InteractiveShotMap
        shotMap={validSvg}
        onShotLocationSelect={handleShotLocationSelect}
      />,
    );

    const clickableArea = screen.getByLabelText("Goal Shot Location Map");

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

    // Click beyond top-right: clientX 250 (X > 100%), clientY -50 (Y > 100%)
    fireEvent.click(clickableArea, { clientX: 250, clientY: -50 });
    expect(handleShotLocationSelect).toHaveBeenCalledWith(100, 100);

    // Click beyond bottom-left: clientX -50 (X < 0%), clientY 150 (Y < 0%)
    handleShotLocationSelect.mockClear();
    fireEvent.click(clickableArea, { clientX: -50, clientY: 150 });
    expect(handleShotLocationSelect).toHaveBeenCalledWith(0, 0);
  });

  it("ignores click event when bounding rect has 0 width or height", () => {
    const handleShotLocationSelect = vi.fn();
    render(
      <InteractiveShotMap
        shotMap={validSvg}
        onShotLocationSelect={handleShotLocationSelect}
      />,
    );

    const clickableArea = screen.getByLabelText("Goal Shot Location Map");

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
    expect(handleShotLocationSelect).not.toHaveBeenCalled();
  });

  it("renders coordinates badge, clear button, and pin marker at correct position", () => {
    const { container } = render(
      <InteractiveShotMap
        shotMap={validSvg}
        shotLocationX={75.5}
        shotLocationY={40.2}
        onShotLocationSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("X: 75.5% | Y: 40.2%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear/i })).toBeInTheDocument();

    const pinMarker = container.querySelector('div[style*="left: 75.5%"]');
    expect(pinMarker).toBeInTheDocument();
    expect(pinMarker).toHaveStyle({ top: "59.8%", left: "75.5%" });
  });

  it("calls onShotLocationSelect with null values when Clear button is clicked", () => {
    const handleShotLocationSelect = vi.fn();

    render(
      <InteractiveShotMap
        shotMap={validSvg}
        shotLocationX={50}
        shotLocationY={50}
        onShotLocationSelect={handleShotLocationSelect}
      />,
    );

    const clearButton = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clearButton);

    expect(handleShotLocationSelect).toHaveBeenCalledWith(null, null);
  });

  it("prevents interaction and events when disabled prop is true", () => {
    const handleShotLocationSelect = vi.fn();
    render(
      <InteractiveShotMap
        shotMap={validSvg}
        disabled={true}
        shotLocationX={50}
        shotLocationY={50}
        onShotLocationSelect={handleShotLocationSelect}
      />,
    );

    const disabledArea = screen.getByLabelText("Goal Shot Location Map");
    fireEvent.click(disabledArea);
    expect(handleShotLocationSelect).not.toHaveBeenCalled();

    fireEvent.keyDown(disabledArea, { key: "ArrowRight" });
    expect(handleShotLocationSelect).not.toHaveBeenCalled();

    const clearButton = screen.getByRole("button", { name: /clear/i });
    expect(clearButton).toBeDisabled();
    fireEvent.click(clearButton);
    expect(handleShotLocationSelect).not.toHaveBeenCalled();
  });

  it("supports keyboard-triggered position selection (Enter / Space)", () => {
    const handleShotLocationSelect = vi.fn();
    render(
      <InteractiveShotMap
        shotMap={validSvg}
        onShotLocationSelect={handleShotLocationSelect}
      />,
    );

    const button = screen.getByLabelText("Goal Shot Location Map");

    fireEvent.keyDown(button, { key: "Enter" });
    expect(handleShotLocationSelect).toHaveBeenCalledWith(50, 50);

    handleShotLocationSelect.mockClear();
    fireEvent.keyDown(button, { key: " " });
    expect(handleShotLocationSelect).toHaveBeenCalledWith(50, 50);
  });

  it("does not trigger Enter / Space selection if coordinates are already set", () => {
    const handleShotLocationSelect = vi.fn();
    render(
      <InteractiveShotMap
        shotMap={validSvg}
        shotLocationX={30}
        shotLocationY={40}
        onShotLocationSelect={handleShotLocationSelect}
      />,
    );

    const button = screen.getByLabelText("Goal Shot Location Map");

    fireEvent.keyDown(button, { key: "Enter" });
    expect(handleShotLocationSelect).not.toHaveBeenCalled();
  });

  it("adjusts shot coordinates using arrow keys with step of 5%", () => {
    const handleShotLocationSelect = vi.fn();
    render(
      <InteractiveShotMap
        shotMap={validSvg}
        shotLocationX={50}
        shotLocationY={50}
        onShotLocationSelect={handleShotLocationSelect}
      />,
    );

    const button = screen.getByLabelText("Goal Shot Location Map");

    // ArrowRight -> increases X to 55
    fireEvent.keyDown(button, { key: "ArrowRight" });
    expect(handleShotLocationSelect).toHaveBeenCalledWith(55, 50);

    // ArrowUp -> increases Y to 55
    fireEvent.keyDown(button, { key: "ArrowUp" });
    expect(handleShotLocationSelect).toHaveBeenCalledWith(50, 55);

    // ArrowLeft -> decreases X to 45
    fireEvent.keyDown(button, { key: "ArrowLeft" });
    expect(handleShotLocationSelect).toHaveBeenCalledWith(45, 50);

    // ArrowDown -> decreases Y to 45
    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(handleShotLocationSelect).toHaveBeenCalledWith(50, 45);
  });

  it("respects 0 and 100 boundaries when using arrow keys", () => {
    const handleShotLocationSelect = vi.fn();
    const { rerender } = render(
      <InteractiveShotMap
        shotMap={validSvg}
        shotLocationX={100}
        shotLocationY={100}
        onShotLocationSelect={handleShotLocationSelect}
      />,
    );

    const button = screen.getByLabelText("Goal Shot Location Map");

    fireEvent.keyDown(button, { key: "ArrowRight" });
    expect(handleShotLocationSelect).toHaveBeenCalledWith(100, 100);

    fireEvent.keyDown(button, { key: "ArrowUp" });
    expect(handleShotLocationSelect).toHaveBeenCalledWith(100, 100);

    handleShotLocationSelect.mockClear();

    rerender(
      <InteractiveShotMap
        shotMap={validSvg}
        shotLocationX={0}
        shotLocationY={0}
        onShotLocationSelect={handleShotLocationSelect}
      />,
    );

    fireEvent.keyDown(button, { key: "ArrowLeft" });
    expect(handleShotLocationSelect).toHaveBeenCalledWith(0, 0);

    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(handleShotLocationSelect).toHaveBeenCalledWith(0, 0);
  });

  it("ignores non-arrow and non-actionable keys", () => {
    const handleShotLocationSelect = vi.fn();
    render(
      <InteractiveShotMap
        shotMap={validSvg}
        onShotLocationSelect={handleShotLocationSelect}
      />,
    );

    const button = screen.getByLabelText("Goal Shot Location Map");

    fireEvent.keyDown(button, { key: "Tab" });
    fireEvent.keyDown(button, { key: "a" });

    expect(handleShotLocationSelect).not.toHaveBeenCalled();
  });

  it("renders coordinates badge and Clear button even when shotMap is null", () => {
    const handleShotLocationSelect = vi.fn();
    render(
      <InteractiveShotMap
        shotMap={null}
        shotLocationX={40}
        shotLocationY={60}
        onShotLocationSelect={handleShotLocationSelect}
      />,
    );

    expect(screen.getByText("Goal Shot Map")).toBeInTheDocument();
    expect(screen.getByText("X: 40% | Y: 60%")).toBeInTheDocument();

    const clearButton = screen.getByRole("button", { name: /clear/i });
    expect(clearButton).toBeInTheDocument();

    fireEvent.click(clearButton);
    expect(handleShotLocationSelect).toHaveBeenCalledWith(null, null);

    expect(
      screen.queryByLabelText("Goal Shot Location Map"),
    ).not.toBeInTheDocument();
  });
});
