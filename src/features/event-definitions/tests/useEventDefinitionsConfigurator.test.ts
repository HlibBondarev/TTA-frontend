import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useEventDefinitionsConfigurator } from "../hooks/useEventDefinitionsConfigurator";
import { eventDefinitionService } from "../../../services/eventDefinitionService";
import { replaceSportEventDefinitionsInDb } from "../../../db/eventService";
import { db } from "../../../db/ttaDatabase";

let mockAuth0User: { sub?: string; email?: string } | undefined = {
  sub: "auth0|user-123",
};

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    get user() {
      return mockAuth0User;
    },
  }),
}));

let mockReduxState: Record<string, unknown> = {
  auth: { currentUserId: "auth0|user-123" },
};

vi.mock("react-redux", () => ({
  useSelector: (fn: (state: unknown) => unknown) => fn(mockReduxState),
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
    eventdefinitions: {
      put: vi.fn().mockResolvedValue("def-custom"),
    },
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
      name: "Assist",
      shortName: "A",
      isPositive: true,
      isEnabled: true,
      sortOrder: 2,
    },
    {
      id: "def-3",
      name: "Exclusion",
      shortName: "EX",
      isPositive: false,
      isEnabled: true,
      sortOrder: 3,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth0User = { sub: "auth0|user-123" };
    mockReduxState = { auth: { currentUserId: "auth0|user-123" } };
    vi.mocked(eventDefinitionService.getAvailableForSport).mockResolvedValue(
      mockDefinitions,
    );
  });

  it("should load available definitions and sync to Dexie on mount", async () => {
    const onLoadStateChange = vi.fn();
    const onChange = vi.fn();

    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({
        sportId: mockSportId,
        onLoadStateChange,
        onChange,
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
    expect(onChange).toHaveBeenCalledWith(["def-1", "def-2", "def-3"]);
    expect(result.current.definitionsReady).toBe(true);
    expect(result.current.definitions).toHaveLength(3);
  });

  it("should trigger onPresetModified and update isEnabled state when toggling definition", async () => {
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

    const initialCalls = vi.mocked(replaceSportEventDefinitionsInDb).mock.calls
      .length;

    act(() => {
      result.current.handleToggleEnabled("def-1");
    });

    expect(onPresetModified).toHaveBeenCalledTimes(1);
    expect(replaceSportEventDefinitionsInDb).toHaveBeenCalledTimes(
      initialCalls + 1,
    );

    const toggledDef = result.current.definitions.find((d) => d.id === "def-1");
    expect(toggledDef?.isEnabled).toBe(false);
  });

  it("should report error if syncToDexie fails during handleToggleEnabled", async () => {
    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({ sportId: mockSportId }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.definitionsReady).toBe(true);
    expect(result.current.error).toBeNull();

    vi.mocked(replaceSportEventDefinitionsInDb).mockRejectedValueOnce(
      new Error("Dexie sync failed during toggle"),
    );

    act(() => {
      result.current.handleToggleEnabled("def-1");
    });

    await waitFor(() => {
      expect(result.current.error).toBe("Dexie sync failed during toggle");
    });
  });

  it("should ignore handleToggleEnabled if item ID is not found", async () => {
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
      result.current.handleToggleEnabled("non-existent-id");
    });

    expect(onPresetModified).not.toHaveBeenCalled();
  });

  it("should handle moving items up and down within active tab category", async () => {
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
      result.current.handleMove("def-2", "up");
    });

    expect(onPresetModified).toHaveBeenCalledTimes(1);
    expect(result.current.definitions[0].id).toBe("def-2");
    expect(result.current.definitions[1].id).toBe("def-1");

    act(() => {
      result.current.handleMove("def-2", "up");
    });
    expect(onPresetModified).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleMove("def-2", "down");
    });
    expect(onPresetModified).toHaveBeenCalledTimes(2);
    expect(result.current.definitions[0].id).toBe("def-1");
  });

  it("should report error if syncToDexie fails during handleMove", async () => {
    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({ sportId: mockSportId }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.definitionsReady).toBe(true);
    expect(result.current.error).toBeNull();

    vi.mocked(replaceSportEventDefinitionsInDb).mockRejectedValueOnce(
      new Error("Dexie sync failed during move"),
    );

    act(() => {
      result.current.handleMove("def-2", "up");
    });

    await waitFor(() => {
      expect(result.current.error).toBe("Dexie sync failed during move");
    });
  });

  it("should resolve currentUserId from Redux auth.user.id fallback when auth0 and currentUserId are missing", async () => {
    mockAuth0User = undefined;
    mockReduxState = { auth: { user: { id: "redux-user-456" } } };

    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({ sportId: mockSportId }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(replaceSportEventDefinitionsInDb).toHaveBeenCalledWith(
      mockSportId,
      expect.any(Array),
      "redux-user-456",
    );
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
      { eventDefinitionIds: ["def-1", "def-2", "def-3"] },
    );
    expect(onPresetSaved).toHaveBeenCalledTimes(1);
  });

  it("should not save preset if definitions are not ready", async () => {
    vi.mocked(eventDefinitionService.getAvailableForSport).mockRejectedValue(
      new Error("Fetch failed"),
    );

    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({ sportId: mockSportId }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleSavePreset();
    });

    expect(eventDefinitionService.savePreset).not.toHaveBeenCalled();
  });

  it("should handle error during preset saving with generic non-Error exception", async () => {
    vi.mocked(eventDefinitionService.savePreset).mockRejectedValue(
      "String error message",
    );

    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({ sportId: mockSportId }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleSavePreset();
    });

    expect(result.current.error).toBe("Failed to save user preset.");
  });

  it("should create custom definition with negative flag, persist to Dexie dict, update draft state, and switch active tab without refetching available definitions", async () => {
    const createdCustomDef = {
      id: "custom-def-99",
      sportId: mockSportId,
      name: "Custom Foul",
      shortName: "CF",
      isPositive: false,
      isCustom: true,
      isEnabled: false,
      sortOrder: 0,
    };

    vi.mocked(eventDefinitionService.createCustom).mockResolvedValue(
      createdCustomDef,
    );
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

    const getAvailableCallsBefore = vi.mocked(
      eventDefinitionService.getAvailableForSport,
    ).mock.calls.length;

    act(() => {
      result.current.setNewName("Custom Foul");
      result.current.setNewShortName("CF");
      result.current.setNewIsPositive(false);
    });

    const fakeEvent = {
      preventDefault: vi.fn(),
    } as unknown as React.SyntheticEvent<HTMLFormElement>;

    await act(async () => {
      await result.current.handleCreateCustom(fakeEvent);
    });

    expect(eventDefinitionService.createCustom).toHaveBeenCalledWith(
      mockSportId,
      expect.objectContaining({
        name: "Custom Foul",
        shortName: "CF",
        isPositive: false,
      }),
    );

    expect(db.eventdefinitions.put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "custom-def-99",
        name: "Custom Foul",
        isPositive: false,
        isCustom: true,
      }),
    );
    expect(
      vi.mocked(eventDefinitionService.getAvailableForSport).mock.calls.length,
    ).toBe(getAvailableCallsBefore);

    expect(result.current.activeTab).toBe("NEGATIVE");
    expect(onPresetModified).toHaveBeenCalled();

    const addedDef = result.current.definitions.find(
      (d) => d.id === "custom-def-99",
    );
    expect(addedDef).toBeDefined();
    expect(addedDef?.isEnabled).toBe(true);
  });

  it("should fallback to client-generated UUID when server response ID is missing", async () => {
    vi.mocked(eventDefinitionService.createCustom).mockResolvedValue({
      id: undefined,
      sportId: mockSportId,
      name: "Custom Block",
      shortName: "CB",
      isPositive: true,
      isCustom: true,
    } as unknown as Awaited<
      ReturnType<typeof eventDefinitionService.createCustom>
    >);

    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({ sportId: mockSportId }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setNewName("Custom Block");
      result.current.setNewShortName("CB");
    });

    const fakeEvent = {
      preventDefault: vi.fn(),
    } as unknown as React.SyntheticEvent<HTMLFormElement>;

    await act(async () => {
      await result.current.handleCreateCustom(fakeEvent);
    });

    const addedDef = result.current.definitions.find(
      (d) => d.name === "Custom Block",
    );
    expect(addedDef).toBeDefined();
    expect(typeof addedDef?.id).toBe("string");
    expect(addedDef?.id).not.toBeUndefined();
  });

  it("should preserve draft state and call onPresetModified even if Dexie put rejects during creation", async () => {
    const createdCustomDef = {
      id: "custom-def-100",
      sportId: mockSportId,
      name: "Custom Timeout",
      shortName: "CTO",
      isPositive: true,
      isCustom: true,
      isEnabled: false,
      sortOrder: 0,
    };

    vi.mocked(eventDefinitionService.createCustom).mockResolvedValue(
      createdCustomDef,
    );
    vi.mocked(db.eventdefinitions.put).mockRejectedValueOnce(
      new Error("Dexie put failed"),
    );
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
      result.current.setNewName("Custom Timeout");
      result.current.setNewShortName("CTO");
      result.current.setNewIsPositive(true);
    });

    const fakeEvent = {
      preventDefault: vi.fn(),
    } as unknown as React.SyntheticEvent<HTMLFormElement>;

    await act(async () => {
      await result.current.handleCreateCustom(fakeEvent);
    });

    expect(result.current.modalError).toBeNull();
    expect(onPresetModified).toHaveBeenCalled();

    const addedDef = result.current.definitions.find(
      (d) => d.id === "custom-def-100",
    );
    expect(addedDef).toBeDefined();
    expect(addedDef?.isEnabled).toBe(true);
  });

  it("should handle error during custom definition creation", async () => {
    vi.mocked(eventDefinitionService.createCustom).mockRejectedValue(
      new Error("Creation error"),
    );

    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({ sportId: mockSportId }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setNewName("Custom Foul");
      result.current.setNewShortName("CF");
    });

    const fakeEvent = {
      preventDefault: vi.fn(),
    } as unknown as React.SyntheticEvent<HTMLFormElement>;

    await act(async () => {
      await result.current.handleCreateCustom(fakeEvent);
    });

    expect(result.current.modalError).toBe("Creation error");
  });

  it("should cancel custom definition deletion if user rejects confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
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

    await act(async () => {
      await result.current.handleDeleteCustom("def-1");
    });

    expect(eventDefinitionService.softDeleteCustom).not.toHaveBeenCalled();
    expect(onPresetModified).not.toHaveBeenCalled();
  });

  it("should handle error during custom definition deletion", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(eventDefinitionService.softDeleteCustom).mockRejectedValue(
      new Error("Delete failed"),
    );

    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({ sportId: mockSportId }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleDeleteCustom("def-1");
    });

    expect(result.current.error).toBe("Delete failed");
  });

  it("should handle error when loading definitions fails with non-Error object", async () => {
    vi.mocked(eventDefinitionService.getAvailableForSport).mockRejectedValue(
      "Generic network failure",
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

    expect(result.current.error).toBe("Failed to load event definitions.");
    expect(result.current.definitionsReady).toBe(false);
    expect(onLoadStateChange).toHaveBeenCalledWith(false);
  });
});
