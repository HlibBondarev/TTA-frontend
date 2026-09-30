import React, { useEffect, useRef } from "react";

interface ModalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  titleId: string;
  title: string;
  titleClassName?: string;
  maxWidthClass?: string;
  children: React.ReactNode;
}

export const ModalDialog: React.FC<ModalDialogProps> = ({
  isOpen,
  onClose,
  titleId,
  title,
  titleClassName = "text-blue-400",
  maxWidthClass = "max-w-sm",
  children,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previousActiveElement.current = document.activeElement as HTMLElement;

    const getFocusableElements = () => {
      if (!dialogRef.current) return [];
      return Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (el) =>
          el.getAttribute("tabindex") !== "-1" &&
          el.getAttribute("aria-hidden") !== "true" &&
          !el.hasAttribute("disabled"),
      );
    };

    const focusables = getFocusableElements();
    if (focusables.length > 0) {
      focusables[0].focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab") {
        const currentFocusables = getFocusableElements();
        if (currentFocusables.length === 0) return;

        const firstElement = currentFocusables[0];
        const lastElement = currentFocusables.at(-1);

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement?.focus();
          }
        } else if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      open={isOpen}
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 overflow-y-auto w-full h-full max-w-none max-h-none border-0 bg-transparent text-white m-0"
    >
      {/* Backdrop overlay button */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm cursor-default border-0 p-0 m-0 w-full h-full block"
      />

      {/* Dialog content box */}
      <div
        className={`relative z-10 w-full ${maxWidthClass} rounded-xl border border-gray-800 bg-gray-900 p-4 text-white shadow-2xl space-y-4 max-h-[92vh] flex flex-col justify-between`}
      >
        <div className="flex justify-between items-center border-b border-gray-800 pb-2 shrink-0">
          <h3
            id={titleId}
            className={`text-xs font-bold uppercase tracking-wider ${titleClassName}`}
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-gray-400 hover:text-white text-xs font-bold"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
};
