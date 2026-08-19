import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { ModalDialog } from "../components/ModalDialog";

describe("ModalDialog Component", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <ModalDialog
        isOpen={false}
        onClose={mockOnClose}
        titleId="test-title-id"
        title="Test Modal"
      >
        <div>Modal Content</div>
      </ModalDialog>,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders correctly with dialog role, title, and ARIA attributes when isOpen is true", () => {
    render(
      <ModalDialog
        isOpen={true}
        onClose={mockOnClose}
        titleId="test-title-id"
        title="Test Modal"
      >
        <div>Modal Content</div>
      </ModalDialog>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "test-title-id");

    expect(screen.getByText("Test Modal")).toBeInTheDocument();
    expect(screen.getByText("Modal Content")).toBeInTheDocument();
  });

  it("calls onClose when close button ✕ is clicked", () => {
    render(
      <ModalDialog
        isOpen={true}
        onClose={mockOnClose}
        titleId="test-title-id"
        title="Test Modal"
      >
        <div>Modal Content</div>
      </ModalDialog>,
    );

    const closeBtn = screen.getByRole("button", { name: "Close dialog" });
    fireEvent.click(closeBtn);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when pressing the Escape key", () => {
    render(
      <ModalDialog
        isOpen={true}
        onClose={mockOnClose}
        titleId="test-title-id"
        title="Test Modal"
      >
        <div>Modal Content</div>
      </ModalDialog>,
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when clicking the backdrop overlay", () => {
    render(
      <ModalDialog
        isOpen={true}
        onClose={mockOnClose}
        titleId="test-title-id"
        title="Test Modal"
      >
        <div>Modal Content</div>
      </ModalDialog>,
    );

    const dialog = screen.getByRole("dialog");
    const overlay = dialog.parentElement!;

    fireEvent.click(overlay);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("traps Tab key focus inside the dialog", () => {
    render(
      <ModalDialog
        isOpen={true}
        onClose={mockOnClose}
        titleId="test-title-id"
        title="Test Modal"
      >
        <button type="button">First Focusable</button>
        <button type="button">Second Focusable</button>
      </ModalDialog>,
    );

    const closeBtn = screen.getByRole("button", { name: "Close dialog" });
    const secondBtn = screen.getByRole("button", { name: "Second Focusable" });

    // Initial focus on first element (close button)
    expect(closeBtn).toHaveFocus();

    // Tab forward from last element loops to first element
    secondBtn.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(closeBtn).toHaveFocus();

    // Shift+Tab backward from first element loops to last element
    closeBtn.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(secondBtn).toHaveFocus();
  });
});
