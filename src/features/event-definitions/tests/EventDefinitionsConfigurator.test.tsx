import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventDefinitionsConfigurator } from "../components/EventDefinitionsConfigurator";
import { eventDefinitionService } from "../../../services/eventDefinitionService";

vi.mock("../../../services/eventDefinitionService", () => ({
  eventDefinitionService: {
    getAvailableForSport: vi.fn(),
    savePreset: vi.fn(),
    createCustom: vi.fn(),
    softDeleteCustom: vi.fn(),
  },
}));

describe("EventDefinitionsConfigurator Component", () => {
  const SPORT_ID = "sport-waterpolo";
  const DEF_ID_1 = "def-1";
  const DEF_ID_2 = "def-2";

  const mockDefinitions = [
    {
      id: DEF_ID_1,
      name: "Goal",
      shortName: "GL",
      isPositive: true,
      isEnabled: true,
      sortOrder: 1,
      isCustom: false,
    },
    {
      id: DEF_ID_2,
      name: "Turnover",
      shortName: "TO",
      isPositive: false,
      isEnabled: true,
      sortOrder: 2,
      isCustom: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(eventDefinitionService.getAvailableForSport).mockResolvedValue(
      mockDefinitions,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loaded action definitions", async () => {
    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    expect(
      screen.getByText("Loading action definitions..."),
    ).toBeInTheDocument();

    expect(await screen.findByText("Goal")).toBeInTheDocument();
    expect(screen.getByText("Turnover")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("renders empty state message when no definitions are returned", async () => {
    vi.mocked(
      eventDefinitionService.getAvailableForSport,
    ).mockResolvedValueOnce([]);

    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    expect(
      await screen.findByText("No definitions available for this sport."),
    ).toBeInTheDocument();
  });

  it("displays error message if fetching definitions fails", async () => {
    vi.mocked(
      eventDefinitionService.getAvailableForSport,
    ).mockRejectedValueOnce(new Error("Network connection error"));

    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    expect(
      await screen.findByText("Network connection error"),
    ).toBeInTheDocument();
  });

  it("allows reordering items up and down", async () => {
    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    await screen.findByText("Goal");

    const moveDownBtns = screen.getAllByTitle("Move Down");
    const moveUpBtns = screen.getAllByTitle("Move Up");

    expect(moveUpBtns[0]).toBeDisabled();
    expect(moveDownBtns[1]).toBeDisabled();

    // Move first item down
    fireEvent.click(moveDownBtns[0]);

    // Save preset to verify reordered order
    vi.mocked(eventDefinitionService.savePreset).mockResolvedValueOnce(
      undefined,
    );
    const saveBtn = screen.getByRole("button", { name: "Save Active Preset" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(eventDefinitionService.savePreset).toHaveBeenCalledWith(SPORT_ID, {
        eventDefinitionIds: [DEF_ID_2, DEF_ID_1],
      });
    });
  });

  it("allows saving active preset and calls onPresetSaved callback", async () => {
    const onPresetSaved = vi.fn();
    vi.mocked(eventDefinitionService.savePreset).mockResolvedValueOnce(
      undefined,
    );

    render(
      <EventDefinitionsConfigurator
        sportId={SPORT_ID}
        onPresetSaved={onPresetSaved}
      />,
    );

    const saveBtn = await screen.findByRole("button", {
      name: "Save Active Preset",
    });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(eventDefinitionService.savePreset).toHaveBeenCalledWith(SPORT_ID, {
        eventDefinitionIds: [DEF_ID_1, DEF_ID_2],
      });
    });

    expect(onPresetSaved).toHaveBeenCalledTimes(1);
  });

  it("displays error message if saving preset fails", async () => {
    vi.mocked(eventDefinitionService.savePreset).mockRejectedValueOnce(
      new Error("Failed to save preset on server"),
    );

    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    const saveBtn = await screen.findByRole("button", {
      name: "Save Active Preset",
    });
    fireEvent.click(saveBtn);

    expect(
      await screen.findByText("Failed to save preset on server"),
    ).toBeInTheDocument();
  });

  it("opens modal, allows filling form, and creates new custom action definition", async () => {
    const customGoalName = "Counter Goal";
    const customGoalShort = "CG";

    vi.mocked(eventDefinitionService.createCustom).mockResolvedValueOnce({
      id: "def-3",
      name: customGoalName,
      shortName: customGoalShort,
      isPositive: true,
      isCustom: true,
    });

    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    const openModalBtn = await screen.findByRole("button", {
      name: /^Custom Action$/i,
    });
    fireEvent.click(openModalBtn);

    expect(screen.getByText("Create Custom Action")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("e.g. Counter Attack Goal"), {
      target: { value: customGoalName },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. CAG"), {
      target: { value: customGoalShort },
    });

    const createBtn = screen.getByRole("button", { name: "Create" });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(eventDefinitionService.createCustom).toHaveBeenCalledWith(
        SPORT_ID,
        {
          name: customGoalName,
          shortName: customGoalShort,
          isPositive: true,
        },
      );
    });
  });

  it("allows closing the custom action modal without submitting", async () => {
    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    const openModalBtn = await screen.findByRole("button", {
      name: /^Custom Action$/i,
    });
    fireEvent.click(openModalBtn);

    expect(screen.getByText("Create Custom Action")).toBeInTheDocument();

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);

    expect(screen.queryByText("Create Custom Action")).not.toBeInTheDocument();
  });

  it("does not trigger custom creation if name or shortName is blank", async () => {
    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    const openModalBtn = await screen.findByRole("button", {
      name: /^Custom Action$/i,
    });
    fireEvent.click(openModalBtn);

    const createBtn = screen.getByRole("button", { name: "Create" });
    fireEvent.click(createBtn);

    expect(eventDefinitionService.createCustom).not.toHaveBeenCalled();
  });

  it("displays error message if custom creation fails", async () => {
    vi.mocked(eventDefinitionService.createCustom).mockRejectedValueOnce(
      new Error("Duplicate definition name"),
    );

    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    const openModalBtn = await screen.findByRole("button", {
      name: /^Custom Action$/i,
    });
    fireEvent.click(openModalBtn);

    fireEvent.change(screen.getByPlaceholderText("e.g. Counter Attack Goal"), {
      target: { value: "Duplicate" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. CAG"), {
      target: { value: "DUP" },
    });

    const createBtn = screen.getByRole("button", { name: "Create" });
    fireEvent.click(createBtn);

    expect(
      await screen.findByText("Duplicate definition name"),
    ).toBeInTheDocument();
  });

  it("does not delete custom definition if confirmation is cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);

    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    const deleteBtn = await screen.findByTitle("Delete Custom Action");
    fireEvent.click(deleteBtn);

    expect(eventDefinitionService.softDeleteCustom).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("invokes softDeleteCustom when delete button is confirmed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    vi.mocked(eventDefinitionService.softDeleteCustom).mockResolvedValueOnce(
      undefined,
    );

    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    const deleteBtn = await screen.findByTitle("Delete Custom Action");
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(eventDefinitionService.softDeleteCustom).toHaveBeenCalledWith(
        DEF_ID_2,
      );
    });

    confirmSpy.mockRestore();
  });

  it("displays error message if softDeleteCustom fails", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    vi.mocked(eventDefinitionService.softDeleteCustom).mockRejectedValueOnce(
      new Error("Forbidden to delete item"),
    );

    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    const deleteBtn = await screen.findByTitle("Delete Custom Action");
    fireEvent.click(deleteBtn);

    expect(
      await screen.findByText("Forbidden to delete item"),
    ).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("calls onChange prop with active event definition IDs on load and toggle", async () => {
    const onChangeMock = vi.fn();

    render(
      <EventDefinitionsConfigurator
        sportId={SPORT_ID}
        onChange={onChangeMock}
      />,
    );

    await waitFor(() => {
      expect(onChangeMock).toHaveBeenCalledWith([DEF_ID_1, DEF_ID_2]);
    });

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);

    await waitFor(() => {
      expect(onChangeMock).toHaveBeenLastCalledWith([DEF_ID_2]);
    });
  });

  it("invokes onLoadStateChange with false on start and true when definitions load successfully", async () => {
    const onLoadStateChangeMock = vi.fn();

    render(
      <EventDefinitionsConfigurator
        sportId={SPORT_ID}
        onLoadStateChange={onLoadStateChangeMock}
      />,
    );

    expect(onLoadStateChangeMock).toHaveBeenCalledWith(false);

    await waitFor(() => {
      expect(onLoadStateChangeMock).toHaveBeenLastCalledWith(true);
    });
  });

  it("invokes onLoadStateChange with false if fetching definitions fails", async () => {
    const onLoadStateChangeMock = vi.fn();
    vi.mocked(
      eventDefinitionService.getAvailableForSport,
    ).mockRejectedValueOnce(new Error("Failed to load"));

    render(
      <EventDefinitionsConfigurator
        sportId={SPORT_ID}
        onLoadStateChange={onLoadStateChangeMock}
      />,
    );

    await waitFor(() => {
      expect(onLoadStateChangeMock).toHaveBeenLastCalledWith(false);
    });
  });
});
