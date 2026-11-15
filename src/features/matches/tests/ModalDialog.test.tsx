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

  it("calls onClose when clicking the backdrop overlay button", () => {
    const { container } = render(
      <ModalDialog
        isOpen={true}
        onClose={mockOnClose}
        titleId="test-title-id"
        title="Test Modal"
      >
        <div>Modal Content</div>
      </ModalDialog>,
    );

    const backdropBtn = container.querySelector('button[aria-hidden="true"]');
    expect(backdropBtn).not.toBeNull();

    fireEvent.click(backdropBtn!);

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

  it("preserves initial focus restoration and invokes latest onClose when onClose prop changes while open", () => {
    const initialOnClose = vi.fn();
    const updatedOnClose = vi.fn();

    const { rerender } = render(
      <div>
        <button type="button">Trigger Button</button>
        <ModalDialog
          isOpen={false}
          onClose={initialOnClose}
          titleId="test-title-id"
          title="Test Modal"
        >
          <input aria-label="Modal Input" />
        </ModalDialog>
      </div>,
    );

    const triggerBtn = screen.getByRole("button", { name: "Trigger Button" });
    triggerBtn.focus();
    expect(triggerBtn).toHaveFocus();

    // Open modal
    rerender(
      <div>
        <button type="button">Trigger Button</button>
        <ModalDialog
          isOpen={true}
          onClose={initialOnClose}
          titleId="test-title-id"
          title="Test Modal"
        >
          <input aria-label="Modal Input" />
        </ModalDialog>
      </div>,
    );

    const input = screen.getByLabelText("Modal Input");
    input.focus();
    expect(input).toHaveFocus();

    // Update onClose prop while modal stays open
    rerender(
      <div>
        <button type="button">Trigger Button</button>
        <ModalDialog
          isOpen={true}
          onClose={updatedOnClose}
          titleId="test-title-id"
          title="Test Modal"
        >
          <input aria-label="Modal Input" />
        </ModalDialog>
      </div>,
    );

    // Focus should stay on the input rather than resetting to close button
    expect(input).toHaveFocus();

    // Escape should invoke the updated onClose callback
    fireEvent.keyDown(window, { key: "Escape" });
    expect(initialOnClose).not.toHaveBeenCalled();
    expect(updatedOnClose).toHaveBeenCalledTimes(1);

    // Closing modal should restore focus to the original trigger button
    rerender(
      <div>
        <button type="button">Trigger Button</button>
        <ModalDialog
          isOpen={false}
          onClose={updatedOnClose}
          titleId="test-title-id"
          title="Test Modal"
        >
          <input aria-label="Modal Input" />
        </ModalDialog>
      </div>,
    );

    expect(triggerBtn).toHaveFocus();
  });
});
