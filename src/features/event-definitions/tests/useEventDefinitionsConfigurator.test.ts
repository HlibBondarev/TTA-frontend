import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useEventDefinitionsConfigurator } from "../hooks/useEventDefinitionsConfigurator";
import { eventDefinitionService } from "../../../services/eventDefinitionService";
import { replaceSportEventDefinitionsInDb } from "../../../db/eventService";

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    user: { sub: "auth0|user-123" },
  }),
}));

vi.mock("react-redux", () => ({
  useSelector: (fn: (state: unknown) => unknown) =>
    fn({
      auth: { currentUserId: "auth0|user-123" },
    }),
}));

vi.mock("../../../services/eventDefinitionService", () => ({
  eventDefinitionService: {
    getAvailableForSport: vi.fn(),
    savePreset: vi.fn(),
    createCustom: vi.fn(),
    softDeleteCustom: vi.fn(),
  },
}));

vi.mock("../../../db/eventService", () => ({
  replaceSportEventDefinitionsInDb: vi.fn(),
}));

vi.mock("../../../db/ttaDatabase", () => ({
  db: {
    eventdefinitions: {},
  },
}));

describe("useEventDefinitionsConfigurator", () => {
  const mockSportId = "water-polo";

  const mockDefinitions = [
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
      isPositive: false,
      isEnabled: true,
      sortOrder: 2,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(eventDefinitionService.getAvailableForSport).mockResolvedValue(
      mockDefinitions,
    );
  });

  it("should load available definitions and sync to Dexie on mount", async () => {
    const onLoadStateChange = vi.fn();

    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({
        sportId: mockSportId,
        onLoadStateChange,
      }),
    );

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(eventDefinitionService.getAvailableForSport).toHaveBeenCalledWith(
      mockSportId,
    );
    expect(replaceSportEventDefinitionsInDb).toHaveBeenCalled();
    expect(onLoadStateChange).toHaveBeenCalledWith(true);
    expect(result.current.definitionsReady).toBe(true);
    expect(result.current.definitions).toHaveLength(2);
  });

  it("should trigger onPresetModified when toggling definition enabled state", async () => {
    const onPresetModified = vi.fn();

    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({
        sportId: mockSportId,
        onPresetModified,
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handleToggleEnabled("def-1");
    });

    expect(onPresetModified).toHaveBeenCalledTimes(1);
    expect(replaceSportEventDefinitionsInDb).toHaveBeenCalled();
  });

  it("should save preset successfully and trigger onPresetSaved", async () => {
    vi.mocked(eventDefinitionService.savePreset).mockResolvedValue(undefined);
    const onPresetSaved = vi.fn();

    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({
        sportId: mockSportId,
        onPresetSaved,
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleSavePreset();
    });

    expect(eventDefinitionService.savePreset).toHaveBeenCalledWith(
      mockSportId,
      { eventDefinitionIds: ["def-1", "def-2"] },
    );
    expect(onPresetSaved).toHaveBeenCalledTimes(1);
  });

  it("should handle error when loading definitions fails", async () => {
    vi.mocked(eventDefinitionService.getAvailableForSport).mockRejectedValue(
      new Error("Server error"),
    );
    const onLoadStateChange = vi.fn();

    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({
        sportId: mockSportId,
        onLoadStateChange,
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Server error");
    expect(result.current.definitionsReady).toBe(false);
    expect(onLoadStateChange).toHaveBeenCalledWith(false);
  });
});
