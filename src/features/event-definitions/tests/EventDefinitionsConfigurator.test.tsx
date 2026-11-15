import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { EventDefinitionsConfigurator } from "../components/EventDefinitionsConfigurator";
import { useEventDefinitionsConfigurator } from "../hooks/useEventDefinitionsConfigurator";

vi.mock("../hooks/useEventDefinitionsConfigurator");

describe("EventDefinitionsConfigurator Component", () => {
  const defaultHookReturn = {
    definitions: [
      {
        id: "def-1",
        name: "Goal",
        shortName: "G",
        isPositive: true,
        isShot: true,
        isEnabled: true,
        sortOrder: 1,
      },
    ],
    activeTab: "POSITIVE" as const,
    loading: false,
    saving: false,
    creating: false,
    deleting: false,
    definitionsReady: true,
    error: null,
    isModalOpen: false,
    isConfirmZeroModalOpen: false,
    modalError: null,
    newName: "",
    newShortName: "",
    newIsShot: false,
    isLocked: false,
    activeCategoryDefs: [
      {
        id: "def-1",
        name: "Goal",
        shortName: "G",
        isPositive: true,
        isShot: true,
        isEnabled: true,
        sortOrder: 1,
      },
    ],
    activePositiveCount: 1,
    activeNegativeCount: 0,
    isAllActiveCategorySelected: true,
    isActiveCategoryIndeterminate: false,
    setActiveTab: vi.fn(),
    setIsModalOpen: vi.fn(),
    setIsConfirmZeroModalOpen: vi.fn(),
    setModalError: vi.fn(),
    setNewName: vi.fn(),
    setNewShortName: vi.fn(),
    setNewIsShot: vi.fn(),
    setCreating: vi.fn(),
    handleToggleEnabled: vi.fn(),
    handleToggleAll: vi.fn(),
    handleMove: vi.fn(),
    handleSavePreset: vi.fn(),
    handleConfirmDefaultPreset: vi.fn(),
    handleCancelDefaultPreset: vi.fn(),
    handleCreateCustom: vi.fn(),
    handleDeleteCustom: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue(
      defaultHookReturn,
    );
  });

  it("should render action items and save button when loaded", () => {
    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(screen.getByText("Configure TTA Actions")).toBeInTheDocument();
    expect(screen.getByText("Goal")).toBeInTheDocument();
    expect(screen.getByText("Shot")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirm Active Preset/i }),
    ).not.toBeDisabled();
  });

  it("should render loading state when loading is true", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      loading: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(
      screen.getByText("Loading action definitions..."),
    ).toBeInTheDocument();
  });

  it("should render main component error alert when error prop is present", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      error: "Failed to fetch event definitions",
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to fetch event definitions",
    );
  });

  it("should display empty category message and disable Select all checkbox when activeCategoryDefs is empty", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      activeCategoryDefs: [],
      activePositiveCount: 0,
      isAllActiveCategorySelected: false,
      isActiveCategoryIndeterminate: false,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(
      screen.getByText("No positive definitions available."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Select all positive actions/i }),
    ).toBeDisabled();
    expect(screen.getByText("0 / 0")).toBeInTheDocument();
  });

  it("should trigger setActiveTab when clicking tab buttons", () => {
    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const negativeTab = screen.getByRole("button", { name: /NEGATIVE/i });
    fireEvent.click(negativeTab);

    expect(defaultHookReturn.setActiveTab).toHaveBeenCalledWith("NEGATIVE");
  });

  it("should render full long action name without truncation alongside shortName, Shot, and Custom badges", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      activeCategoryDefs: [
        {
          id: "def-custom-shot",
          name: "Counter Attack Goal",
          shortName: "CAG+",
          isPositive: true,
          isShot: true,
          isCustom: true,
          isEnabled: true,
          sortOrder: 1,
        },
      ],
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const titleElement = screen.getByText("Counter Attack Goal");
    expect(titleElement).toBeInTheDocument();
    expect(titleElement).not.toHaveClass("truncate");
    expect(screen.getByText("CAG+")).toBeInTheDocument();
    expect(screen.getByText("Shot")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("should render Delete Custom Action button before Move Up and Move Down buttons for custom rows", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      activeCategoryDefs: [
        {
          id: "def-custom-1",
          name: "Counter Attack Goal",
          shortName: "CAG+",
          isPositive: true,
          isShot: true,
          isCustom: true,
          isEnabled: true,
          sortOrder: 1,
        },
      ],
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const deleteButton = screen.getByTitle("Delete Custom Action");
    const moveUpButton = screen.getByTitle("Move Up");
    const moveDownButton = screen.getByTitle("Move Down");

    expect(
      deleteButton.compareDocumentPosition(moveUpButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      moveUpButton.compareDocumentPosition(moveDownButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("should render Select all checkbox for active category, reflect checked/indeterminate states, and trigger handleToggleAll", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      activeTab: "NEGATIVE",
      activeCategoryDefs: [
        {
          id: "def-neg-1",
          name: "Exclusion",
          shortName: "EX",
          isPositive: false,
          isEnabled: true,
          sortOrder: 1,
        },
        {
          id: "def-neg-2",
          name: "Turnover",
          shortName: "TO",
          isPositive: false,
          isEnabled: false,
          sortOrder: 2,
        },
      ],
      activeNegativeCount: 1,
      isAllActiveCategorySelected: false,
      isActiveCategoryIndeterminate: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const selectAllCheckbox = screen.getByRole("checkbox", {
      name: /Select all negative actions/i,
    }) as HTMLInputElement;

    expect(selectAllCheckbox.checked).toBe(false);
    expect(selectAllCheckbox.indeterminate).toBe(true);
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    fireEvent.click(selectAllCheckbox);
    expect(defaultHookReturn.handleToggleAll).toHaveBeenCalledTimes(1);
  });

  it("should preserve indeterminate state on Select all checkbox when loading transitions from true to false", () => {
    const partialPositiveDefs = [
      {
        id: "def-1",
        name: "Goal",
        shortName: "G",
        isPositive: true,
        isEnabled: true,
        sortOrder: 1,
      },
      {
        id: "def-2",
        name: "Assist",
        shortName: "A",
        isPositive: true,
        isEnabled: false,
        sortOrder: 2,
      },
    ];

    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      loading: true,
      activeCategoryDefs: partialPositiveDefs,
      activePositiveCount: 1,
      isAllActiveCategorySelected: false,
      isActiveCategoryIndeterminate: true,
    });

    const { rerender } = render(
      <EventDefinitionsConfigurator sportId="water-polo" />,
    );

    expect(
      screen.getByText("Loading action definitions..."),
    ).toBeInTheDocument();

    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      loading: false,
      activeCategoryDefs: partialPositiveDefs,
      activePositiveCount: 1,
      isAllActiveCategorySelected: false,
      isActiveCategoryIndeterminate: true,
    });

    rerender(<EventDefinitionsConfigurator sportId="water-polo" />);

    const selectAllCheckbox = screen.getByRole("checkbox", {
      name: /Select all positive actions/i,
    }) as HTMLInputElement;

    expect(selectAllCheckbox.checked).toBe(false);
    expect(selectAllCheckbox.indeterminate).toBe(true);
  });

  it("should trigger handleMove up and down for list items", () => {
    const twoDefs = [
      {
        id: "def-1",
        name: "Goal",
        shortName: "G",
        isPositive: true,
        isEnabled: true,
        sortOrder: 1,
      },
      {
        id: "def-2",
        name: "Exclusion",
        shortName: "EX",
        isPositive: true,
        isEnabled: true,
        sortOrder: 2,
      },
    ];
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      activeCategoryDefs: twoDefs,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const moveUpButtons = screen.getAllByTitle("Move Up");
    const moveDownButtons = screen.getAllByTitle("Move Down");

    expect(moveUpButtons[0]).toBeDisabled();
    expect(moveDownButtons[1]).toBeDisabled();

    fireEvent.click(moveDownButtons[0]);
    expect(defaultHookReturn.handleMove).toHaveBeenCalledWith("def-1", "down");

    fireEvent.click(moveUpButtons[1]);
    expect(defaultHookReturn.handleMove).toHaveBeenCalledWith("def-2", "up");
  });

  it("should trigger handleDeleteCustom when clicking delete button on custom action", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      activeCategoryDefs: [
        {
          id: "def-custom-1",
          name: "Counter Attack Goal",
          shortName: "CAG",
          isPositive: true,
          isCustom: true,
          isEnabled: true,
          sortOrder: 1,
        },
      ],
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const deleteButton = screen.getByTitle("Delete Custom Action");
    fireEvent.click(deleteButton);

    expect(defaultHookReturn.handleDeleteCustom).toHaveBeenCalledWith(
      "def-custom-1",
    );
  });

  it("should disable interactive buttons when isLocked is true", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isLocked: true,
      activeCategoryDefs: [
        {
          id: "def-custom-1",
          name: "Custom Action",
          shortName: "CA",
          isPositive: true,
          isCustom: true,
          isEnabled: true,
          sortOrder: 1,
        },
      ],
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(
      screen.getByRole("button", { name: /^Positive Action$/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: /Select all positive actions/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: /Enable Custom Action/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Confirm Active Preset/i }),
    ).toBeDisabled();
    expect(screen.getByTitle("Delete Custom Action")).toBeDisabled();
  });

  it("should render Negative Action header button when activeTab is NEGATIVE", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      activeTab: "NEGATIVE",
      activeCategoryDefs: [],
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const addButton = screen.getByRole("button", {
      name: /^Negative Action$/i,
    });
    expect(addButton).toBeInTheDocument();
    expect(addButton).not.toBeDisabled();
  });

  it("should open custom action modal when Positive Action header button is clicked", () => {
    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const openModalButton = screen.getByRole("button", {
      name: /^Positive Action$/i,
    });
    fireEvent.click(openModalButton);

    expect(defaultHookReturn.setCreating).toHaveBeenCalledWith(false);
    expect(defaultHookReturn.setIsModalOpen).toHaveBeenCalledWith(true);
  });

  it("should make background controls inert and disable category tabs while custom action modal is open", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const positiveTab = screen.getByRole("button", {
      name: /^POSITIVE\s*\d+$/,
    });
    const negativeTab = screen.getByRole("button", {
      name: /^NEGATIVE\s*\d+$/,
    });
    const savePresetButton = screen.getByRole("button", {
      name: /^Confirm Active Preset$/i,
    });

    expect(positiveTab).toBeDisabled();
    expect(negativeTab).toBeDisabled();
    expect(positiveTab.closest("[inert]")).not.toBeNull();
    expect(savePresetButton.closest("[inert]")).not.toBeNull();
  });

  it("should restore focus to the header trigger on close even after creating toggles while dialog is open", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: false,
      creating: false,
    });

    const { rerender } = render(
      <EventDefinitionsConfigurator sportId="water-polo" />,
    );

    const headerTrigger = screen.getByRole("button", {
      name: /^Positive Action$/i,
    });
    headerTrigger.focus();
    expect(document.activeElement).toBe(headerTrigger);

    // Open dialog
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: true,
      creating: false,
    });
    rerender(<EventDefinitionsConfigurator sportId="water-polo" />);

    const closeButton = screen.getByRole("button", { name: /Close dialog/i });
    expect(document.activeElement).toBe(closeButton);

    // Simulate user focusing an input and submitting (creating transitions false -> true -> false)
    const nameInput = screen.getByLabelText("Action Name");
    nameInput.focus();
    expect(document.activeElement).toBe(nameInput);

    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: true,
      creating: true,
      isLocked: true,
    });
    rerender(<EventDefinitionsConfigurator sportId="water-polo" />);

    // Focus must not be yanked back to closeButton while creating changes
    expect(document.activeElement).toBe(nameInput);

    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: true,
      creating: false,
      isLocked: false,
    });
    rerender(<EventDefinitionsConfigurator sportId="water-polo" />);

    // Close dialog and verify focus returns to the original header trigger
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: false,
      creating: false,
    });
    rerender(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(document.activeElement).toBe(headerTrigger);
  });

  it("should show custom action modal with POSITIVE type banner, quick-switch button, and without positive checkbox", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      activeTab: "POSITIVE",
      isModalOpen: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(screen.getByText("Create Custom Action")).toBeInTheDocument();
    expect(screen.getByText("Type:")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Switch to Negative/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Positive action \(Green indicator\)/i),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Action Name")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Shot action \(Goal target map enabled\)/i),
    ).toBeInTheDocument();
  });

  it("should switch to NEGATIVE tab from modal quick-switch button", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      activeTab: "POSITIVE",
      isModalOpen: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const switchButton = screen.getByRole("button", {
      name: /Switch to Negative/i,
    });
    fireEvent.click(switchButton);

    expect(defaultHookReturn.setActiveTab).toHaveBeenCalledWith("NEGATIVE");
  });

  it("should switch to POSITIVE tab from modal quick-switch button when activeTab is NEGATIVE", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      activeTab: "NEGATIVE",
      isModalOpen: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const switchButton = screen.getByRole("button", {
      name: /Switch to Positive/i,
    });
    fireEvent.click(switchButton);

    expect(defaultHookReturn.setActiveTab).toHaveBeenCalledWith("POSITIVE");
  });

  it("should disable modal quick-switch button when creating is true", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      activeTab: "POSITIVE",
      isModalOpen: true,
      creating: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(
      screen.getByRole("button", { name: /Switch to Negative/i }),
    ).toBeDisabled();
  });

  it("should close custom action modal on Escape when creating is false, and ignore Escape when creating is true", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: true,
      creating: true,
    });

    const { rerender } = render(
      <EventDefinitionsConfigurator sportId="water-polo" />,
    );

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(defaultHookReturn.setIsModalOpen).not.toHaveBeenCalled();

    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: true,
      creating: false,
    });

    rerender(<EventDefinitionsConfigurator sportId="water-polo" />);

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(defaultHookReturn.setIsModalOpen).toHaveBeenCalledWith(false);
  });

  it("should move focus into the create-action dialog on open, trap Tab navigation, and restore focus to header trigger on close", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: false,
    });

    const { rerender } = render(
      <EventDefinitionsConfigurator sportId="water-polo" />,
    );

    const headerTrigger = screen.getByRole("button", {
      name: /^Positive Action$/i,
    });
    headerTrigger.focus();
    expect(document.activeElement).toBe(headerTrigger);

    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: true,
    });

    rerender(<EventDefinitionsConfigurator sportId="water-polo" />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    const closeButton = screen.getByRole("button", { name: /Close dialog/i });
    const createButton = screen.getByRole("button", { name: /^Create$/i });

    expect(document.activeElement).toBe(closeButton);

    // Shift+Tab on first focusable wraps to last focusable inside dialog
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(createButton);

    // Tab on last focusable wraps to first focusable inside dialog
    fireEvent.keyDown(window, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(closeButton);

    // Closing dialog restores focus to header trigger
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: false,
    });

    rerender(<EventDefinitionsConfigurator sportId="water-polo" />);
    expect(document.activeElement).toBe(headerTrigger);
  });

  it("should handle custom action creation form input changes", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: true,
      newName: "",
      newShortName: "",
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const nameInput = screen.getByLabelText("Action Name");
    const shortNameInput = screen.getByLabelText("Short Name / Abbreviation");
    const isShotCheckbox = screen.getByLabelText(
      /Shot action \(Goal target map enabled\)/i,
    );

    fireEvent.change(nameInput, { target: { value: "Center Shot" } });
    expect(defaultHookReturn.setNewName).toHaveBeenCalledWith("Center Shot");

    fireEvent.change(shortNameInput, { target: { value: "CS" } });
    expect(defaultHookReturn.setNewShortName).toHaveBeenCalledWith("CS");

    fireEvent.click(isShotCheckbox);
    expect(defaultHookReturn.setNewIsShot).toHaveBeenCalled();
  });

  it("should submit custom action creation form when required fields are populated", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: true,
      newName: "Center Shot",
      newShortName: "CS",
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const nameInput = screen.getByLabelText("Action Name");
    const form = nameInput.closest("form");
    expect(form).not.toBeNull();

    if (form) {
      fireEvent.submit(form);
    }

    expect(defaultHookReturn.handleCreateCustom).toHaveBeenCalledTimes(1);
  });

  it("should display modalError inside creation modal if present", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: true,
      modalError: "Action definition with this short name already exists",
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Action definition with this short name already exists",
    );
  });

  it("should close modal when Cancel button is clicked in custom action modal", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const cancelButton = screen.getByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelButton);

    expect(defaultHookReturn.setIsModalOpen).toHaveBeenCalledWith(false);
  });

  it("should show saving state text on preset save button when saving is true", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      saving: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(
      screen.getByRole("button", { name: /Saving Preset\.\.\./i }),
    ).toBeInTheDocument();
  });

  it("should trigger handleSavePreset when clicking save button", () => {
    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const saveButton = screen.getByRole("button", {
      name: /Confirm Active Preset/i,
    });
    fireEvent.click(saveButton);

    expect(defaultHookReturn.handleSavePreset).toHaveBeenCalledTimes(1);
  });

  it("should trigger handleToggleEnabled when clicking action checkbox", () => {
    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const checkbox = screen.getByRole("checkbox", { name: /Enable Goal/i });
    fireEvent.click(checkbox);

    expect(defaultHookReturn.handleToggleEnabled).toHaveBeenCalledWith("def-1");
  });

  it("should show zero-action confirmation modal when isConfirmZeroModalOpen is true", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isConfirmZeroModalOpen: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(screen.getByText("No Actions Selected")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You haven't selected any TTA actions, so your current preset was not modified. Your previously saved preset will be used, or standard default actions if no preset exists.",
      ),
    ).toBeInTheDocument();
  });

  it("should trigger handleConfirmDefaultPreset when clicking Confirm button in zero-action modal", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isConfirmZeroModalOpen: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const confirmButton = screen.getByRole("button", {
      name: /^Confirm$/i,
    });
    fireEvent.click(confirmButton);

    expect(defaultHookReturn.handleConfirmDefaultPreset).toHaveBeenCalledTimes(
      1,
    );
  });

  it("should trigger handleCancelDefaultPreset when clicking Cancel button in zero-action modal", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isConfirmZeroModalOpen: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const cancelButton = screen.getByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelButton);

    expect(defaultHookReturn.handleCancelDefaultPreset).toHaveBeenCalledTimes(
      1,
    );
  });

  it("should trigger handleCancelDefaultPreset when pressing Escape in zero-action modal", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isConfirmZeroModalOpen: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });

    expect(defaultHookReturn.handleCancelDefaultPreset).toHaveBeenCalledTimes(
      1,
    );
  });
});
