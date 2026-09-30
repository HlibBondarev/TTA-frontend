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
    isLocked: false,
    activeCategoryDefs: [
      {
        id: "def-1",
        name: "Goal",
        shortName: "G",
        isPositive: true,
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
    expect(
      screen.getByRole("button", { name: /Confirm Active Preset/i }),
    ).not.toBeDisabled();
  });

  it("should show custom action modal when isModalOpen is true", () => {
    vi.mocked(useEventDefinitionsConfigurator).mockReturnValue({
      ...defaultHookReturn,
      isModalOpen: true,
    });

    render(<EventDefinitionsConfigurator sportId="water-polo" />);

    expect(screen.getByText("Create Custom Action")).toBeInTheDocument();
    expect(screen.getByLabelText("Action Name")).toBeInTheDocument();
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
});
