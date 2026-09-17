import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
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
  const sportId = "sport-waterpolo";

  const mockDefinitions = [
    {
      id: "def-1",
      name: "Goal",
      shortName: "GL",
      isPositive: true,
      isEnabled: true,
      sortOrder: 1,
      isCustom: false,
    },
    {
      id: "def-2",
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

  it("renders loaded action definitions", async () => {
    render(<EventDefinitionsConfigurator sportId={sportId} />);

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
        sportId={sportId}
        onPresetSaved={onPresetSaved}
      />,
    );

    const saveBtn = await screen.findByRole("button", {
      name: "Save Active Preset",
    });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(eventDefinitionService.savePreset).toHaveBeenCalledWith(sportId, {
        eventDefinitionIds: ["def-1", "def-2"],
      });
      expect(onPresetSaved).toHaveBeenCalledTimes(1);
    });
  });

  it("opens modal and creates new custom action definition", async () => {
    vi.mocked(eventDefinitionService.createCustom).mockResolvedValueOnce({
      id: "def-3",
      name: "Counter Goal",
      shortName: "CG",
      isPositive: true,
      isCustom: true,
    });

    render(<EventDefinitionsConfigurator sportId={sportId} />);

    const openModalBtn = await screen.findByRole("button", {
      name: /^Custom Action$/i,
    });
    fireEvent.click(openModalBtn);

    expect(screen.getByText("Create Custom Action")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("e.g. Counter Attack Goal"), {
      target: { value: "Counter Goal" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. CAG"), {
      target: { value: "CG" },
    });

    const createBtn = screen.getByRole("button", { name: "Create" });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(eventDefinitionService.createCustom).toHaveBeenCalledWith(
        sportId,
        {
          name: "Counter Goal",
          shortName: "CG",
          isPositive: true,
        },
      );
    });
  });

  it("invokes softDeleteCustom when delete button is confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    vi.mocked(eventDefinitionService.softDeleteCustom).mockResolvedValueOnce(
      undefined,
    );

    render(<EventDefinitionsConfigurator sportId={sportId} />);

    const deleteBtn = await screen.findByTitle("Delete Custom Action");
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(eventDefinitionService.softDeleteCustom).toHaveBeenCalledWith(
        "def-2",
      );
    });
  });
});
