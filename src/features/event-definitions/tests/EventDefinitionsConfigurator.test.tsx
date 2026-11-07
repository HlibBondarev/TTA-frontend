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
    newIsPositive: true,
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
    setActiveTab: vi.fn(),
    setIsModalOpen: vi.fn(),
    setIsConfirmZeroModalOpen: vi.fn(),
    setModalError: vi.fn(),
    setNewName: vi.fn(),
    setNewShortName: vi.fn(),
    setNewIsPositive: vi.fn(),
    setNewIsShot: vi.fn(),
    setCreating: vi.fn(),
    handleToggleEnabled: vi.fn(),
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

  it("should display empty category message when activeCategoryDefs is empty", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      activeCategoryDefs: [],
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(
      screen.getByText("No positive definitions available."),
    ).toBeInTheDocument();
  });

  it("should trigger setActiveTab when clicking tab buttons", () => {
    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const negativeTab = screen.getByRole("button", { name: /NEGATIVE/i });
    fireEvent.click(negativeTab);

    expect(defaultHookReturn.setActiveTab).toHaveBeenCalledWith("NEGATIVE");
  });

  it("should render badges for isShot and isCustom definitions", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      activeCategoryDefs: [
        {
          id: "def-custom-shot",
          name: "Center Shot",
          shortName: "CS",
          isPositive: true,
          isShot: true,
          isCustom: true,
          isEnabled: true,
          sortOrder: 1,
        },
      ],
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(screen.getByText("Center Shot")).toBeInTheDocument();
    expect(screen.getByText("CS")).toBeInTheDocument();
    expect(screen.getByText("Shot")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
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
      screen.getByRole("button", { name: /^Custom Action$/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: /Enable Custom Action/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Confirm Active Preset/i }),
    ).toBeDisabled();
    expect(screen.getByTitle("Delete Custom Action")).toBeDisabled();
  });

  it("should open custom action modal when Custom Action header button is clicked", () => {
    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    const openModalButton = screen.getByRole("button", {
      name: /^Custom Action$/i,
    });
    fireEvent.click(openModalButton);

    expect(defaultHookReturn.setCreating).toHaveBeenCalledWith(false);
    expect(defaultHookReturn.setModalError).toHaveBeenCalledWith(null);
    expect(defaultHookReturn.setIsModalOpen).toHaveBeenCalledWith(true);
  });

  it("should show custom action modal when isModalOpen is true including isShot checkbox", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(screen.getByText("Create Custom Action")).toBeInTheDocument();
    expect(screen.getByLabelText("Action Name")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Shot action \(Goal target map enabled\)/i),
    ).toBeInTheDocument();
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
    const isPositiveCheckbox = screen.getByLabelText(
      /Positive action \(Green indicator\)/i,
    );
    const isShotCheckbox = screen.getByLabelText(
      /Shot action \(Goal target map enabled\)/i,
    );

    fireEvent.change(nameInput, { target: { value: "Center Shot" } });
    expect(defaultHookReturn.setNewName).toHaveBeenCalledWith("Center Shot");

    fireEvent.change(shortNameInput, { target: { value: "CS" } });
    expect(defaultHookReturn.setNewShortName).toHaveBeenCalledWith("CS");

    fireEvent.click(isPositiveCheckbox);
    expect(defaultHookReturn.setNewIsPositive).toHaveBeenCalled();

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
