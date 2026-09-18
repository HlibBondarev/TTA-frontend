import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventDefinitionsConfigurator } from "../components/EventDefinitionsConfigurator";
import { eventDefinitionService } from "../../../services/eventDefinitionService";
import { db } from "../../../db/ttaDatabase";

vi.mock("../../../services/eventDefinitionService", () => ({
  eventDefinitionService: {
    getAvailableForSport: vi.fn(),
    savePreset: vi.fn(),
    createCustom: vi.fn(),
    softDeleteCustom: vi.fn(),
  },
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    eventdefinitions: {
      bulkPut: vi.fn(),
    },
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
          id: expect.any(String),
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

  it("ignores stale definition reloads if a newer fetch request was initiated", async () => {
    const onChangeMock = vi.fn();
    let resolveFirstFetch: (value: typeof mockDefinitions) => void;

    const firstFetchPromise = new Promise<typeof mockDefinitions>((resolve) => {
      resolveFirstFetch = resolve;
    });

    const secondFetchData = [
      {
        id: "def-99",
        name: "Basket",
        shortName: "BSK",
        isPositive: true,
        isEnabled: true,
        sortOrder: 1,
        isCustom: false,
      },
    ];

    vi.mocked(eventDefinitionService.getAvailableForSport)
      .mockReturnValueOnce(firstFetchPromise)
      .mockResolvedValueOnce(secondFetchData);

    const { rerender } = render(
      <EventDefinitionsConfigurator
        sportId="sport-waterpolo"
        onChange={onChangeMock}
      />,
    );

    // Trigger a second load with a different sportId before the first resolves
    rerender(
      <EventDefinitionsConfigurator
        sportId="sport-basketball"
        onChange={onChangeMock}
      />,
    );

    await waitFor(() => {
      expect(onChangeMock).toHaveBeenCalledWith(["def-99"]);
    });

    // Resolve stale first request
    resolveFirstFetch!(mockDefinitions);

    // Ensure stale fetch results do not overwrite state or notify parent
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChangeMock).not.toHaveBeenLastCalledWith([DEF_ID_1, DEF_ID_2]);
  });

  it("invalidates pending fetch requests on unmount via effect cleanup", async () => {
    const onChangeMock = vi.fn();
    let resolvePendingFetch: (value: typeof mockDefinitions) => void;

    const pendingPromise = new Promise<typeof mockDefinitions>((resolve) => {
      resolvePendingFetch = resolve;
    });

    vi.mocked(eventDefinitionService.getAvailableForSport).mockReturnValueOnce(
      pendingPromise,
    );

    const { unmount } = render(
      <EventDefinitionsConfigurator
        sportId={SPORT_ID}
        onChange={onChangeMock}
      />,
    );

    // Unmount component while fetch is pending
    unmount();

    // Resolve stale request after unmount
    resolvePendingFetch!(mockDefinitions);

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Ensure state updates and callbacks were suppressed
    expect(onChangeMock).not.toHaveBeenCalledWith([DEF_ID_1, DEF_ID_2]);
  });

  it("disables Save Active Preset button when definitions are not ready or reload fails", async () => {
    vi.mocked(
      eventDefinitionService.getAvailableForSport,
    ).mockResolvedValueOnce(mockDefinitions);

    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    const saveBtn = await screen.findByRole("button", {
      name: "Save Active Preset",
    });
    expect(saveBtn).not.toBeDisabled();

    // Mock a failed reload after soft delete
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    vi.mocked(eventDefinitionService.softDeleteCustom).mockResolvedValueOnce(
      undefined,
    );
    vi.mocked(
      eventDefinitionService.getAvailableForSport,
    ).mockRejectedValueOnce(new Error("Failed reloading definitions"));

    const deleteBtn = screen.getByTitle("Delete Custom Action");
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Failed reloading definitions",
      );
    });

    expect(saveBtn).toBeDisabled();
    confirmSpy.mockRestore();
  });

  it("disables all interactive controls and prevents mutations when disabled prop is true", async () => {
    vi.mocked(
      eventDefinitionService.getAvailableForSport,
    ).mockResolvedValueOnce(mockDefinitions);

    render(<EventDefinitionsConfigurator sportId={SPORT_ID} disabled={true} />);

    expect(await screen.findByText("Goal")).toBeInTheDocument();

    const openCustomModalBtn = screen.getByRole("button", {
      name: /^Custom Action$/i,
    });
    const savePresetBtn = screen.getByRole("button", {
      name: "Save Active Preset",
    });
    const checkboxes = screen.getAllByRole("checkbox");
    const moveDownBtns = screen.getAllByTitle("Move Down");
    const deleteBtn = screen.getByTitle("Delete Custom Action");

    expect(openCustomModalBtn).toBeDisabled();
    expect(savePresetBtn).toBeDisabled();
    expect(checkboxes[0]).toBeDisabled();
    expect(moveDownBtns[0]).toBeDisabled();
    expect(deleteBtn).toBeDisabled();
  });

  it("aborts custom creation state updates and reload when sportId changes before createCustom resolves", async () => {
    let resolveCreate: (value: {
      id: string;
      name: string;
      shortName: string;
      isPositive: boolean;
      isCustom: boolean;
    }) => void;

    const createPromise = new Promise<{
      id: string;
      name: string;
      shortName: string;
      isPositive: boolean;
      isCustom: boolean;
    }>((resolve) => {
      resolveCreate = resolve;
    });

    vi.mocked(eventDefinitionService.getAvailableForSport).mockResolvedValue(
      mockDefinitions,
    );
    vi.mocked(eventDefinitionService.createCustom).mockReturnValueOnce(
      createPromise,
    );

    const { rerender } = render(
      <EventDefinitionsConfigurator sportId="sport-waterpolo" />,
    );

    await screen.findByText("Goal");

    // Open modal and submit form
    fireEvent.click(screen.getByRole("button", { name: /^Custom Action$/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Counter Attack Goal"), {
      target: { value: "New Goal" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. CAG"), {
      target: { value: "NG" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // Change sport scope while mutation is pending
    rerender(<EventDefinitionsConfigurator sportId="sport-basketball" />);

    // Resolve pending create request
    resolveCreate!({
      id: "def-new",
      name: "New Goal",
      shortName: "NG",
      isPositive: true,
      isCustom: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Ensure reloadDefinitions was not initiated for stale request
    expect(eventDefinitionService.getAvailableForSport).toHaveBeenCalledTimes(
      2,
    ); // Only initial mounts
  });

  it("aborts soft delete reload when sportId changes before softDeleteCustom resolves", async () => {
    let resolveDelete: (value: void) => void;
    const deletePromise = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    vi.mocked(eventDefinitionService.getAvailableForSport).mockResolvedValue(
      mockDefinitions,
    );
    vi.mocked(eventDefinitionService.softDeleteCustom).mockReturnValueOnce(
      deletePromise,
    );

    const { rerender } = render(
      <EventDefinitionsConfigurator sportId="sport-waterpolo" />,
    );

    await screen.findByText("Goal");

    const deleteBtn = screen.getByTitle("Delete Custom Action");
    fireEvent.click(deleteBtn);

    // Change sport scope while delete is pending
    rerender(<EventDefinitionsConfigurator sportId="sport-basketball" />);

    // Resolve pending delete
    resolveDelete!();

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Ensure reload was not triggered for old scope
    expect(eventDefinitionService.getAvailableForSport).toHaveBeenCalledTimes(
      2,
    ); // Only initial mounts

    confirmSpy.mockRestore();
  });

  it("preserves local checkbox selections when reloading definitions after custom creation", async () => {
    vi.mocked(
      eventDefinitionService.getAvailableForSport,
    ).mockResolvedValueOnce(mockDefinitions);

    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    await screen.findByText("Goal");

    // Toggle off the first definition
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).not.toBeChecked();

    // Mock createCustom and updated definitions response
    vi.mocked(eventDefinitionService.createCustom).mockResolvedValueOnce({
      id: "def-3",
      name: "New Custom Action",
      shortName: "NCA",
      isPositive: true,
      isCustom: true,
    });

    const updatedDefinitions = [
      ...mockDefinitions,
      {
        id: "def-3",
        name: "New Custom Action",
        shortName: "NCA",
        isPositive: true,
        isEnabled: true,
        sortOrder: 3,
        isCustom: true,
      },
    ];

    vi.mocked(
      eventDefinitionService.getAvailableForSport,
    ).mockResolvedValueOnce(updatedDefinitions);

    // Open custom action modal and submit form
    fireEvent.click(screen.getByRole("button", { name: /^Custom Action$/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Counter Attack Goal"), {
      target: { value: "New Custom Action" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. CAG"), {
      target: { value: "NCA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByText("New Custom Action")).toBeInTheDocument();
    });

    // Ensure the first definition stayed unchecked according to user selection
    const updatedCheckboxes = screen.getAllByRole("checkbox");
    expect(updatedCheckboxes[0]).not.toBeChecked();
    expect(updatedCheckboxes[1]).toBeChecked();
    expect(updatedCheckboxes[2]).toBeChecked();
  });

  it("syncs loaded event definitions into Dexie IndexedDB on load", async () => {
    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    await screen.findByText("Goal");

    expect(db.eventdefinitions.bulkPut).toHaveBeenCalledWith([
      {
        id: DEF_ID_1,
        sportId: SPORT_ID,
        name: "Goal",
        shortName: "GL",
        isPositive: true,
        isCustom: false,
        isEnabled: true,
        sortOrder: 1,
      },
      {
        id: DEF_ID_2,
        sportId: SPORT_ID,
        name: "Turnover",
        shortName: "TO",
        isPositive: false,
        isCustom: true,
        isEnabled: true,
        sortOrder: 2,
      },
    ]);
  });

  it("syncs updated enabled states to Dexie IndexedDB on checkbox toggle", async () => {
    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    await screen.findByText("Goal");
    vi.mocked(db.eventdefinitions.bulkPut).mockClear();

    const checkboxes = screen.getAllByRole("checkbox");
    // Toggle off the first action (Goal)
    fireEvent.click(checkboxes[0]);

    await waitFor(() => {
      expect(db.eventdefinitions.bulkPut).toHaveBeenCalledWith([
        expect.objectContaining({ id: DEF_ID_1, isEnabled: false }),
        expect.objectContaining({ id: DEF_ID_2, isEnabled: true }),
      ]);
    });
  });

  it("syncs reordered items to Dexie IndexedDB when moving items", async () => {
    render(<EventDefinitionsConfigurator sportId={SPORT_ID} />);

    await screen.findByText("Goal");
    vi.mocked(db.eventdefinitions.bulkPut).mockClear();

    const moveDownBtns = screen.getAllByTitle("Move Down");
    fireEvent.click(moveDownBtns[0]);

    await waitFor(() => {
      expect(db.eventdefinitions.bulkPut).toHaveBeenCalledWith([
        expect.objectContaining({ id: DEF_ID_2, sortOrder: 1 }),
        expect.objectContaining({ id: DEF_ID_1, sortOrder: 2 }),
      ]);
    });
  });
});
