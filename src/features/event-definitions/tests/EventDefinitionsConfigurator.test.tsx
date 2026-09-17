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

  it("allows saving active preset", async () => {
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

  it("opens modal and creates new custom action definition", async () => {
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
});
