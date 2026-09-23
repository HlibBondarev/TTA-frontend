import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useEventDefinitionsConfigurator } from "../hooks/useEventDefinitionsConfigurator";
import { eventDefinitionService } from "../../../services/eventDefinitionService";
import { replaceSportEventDefinitionsInDb } from "../../../db/eventService";

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

let mockReduxState = {
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
    mockAuth0User = { sub: "auth0|user-123" };
    mockReduxState = { auth: { currentUserId: "auth0|user-123" } };
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

  it("should resolve currentUserId from Auth0 email or Redux state as fallback", async () => {
    mockAuth0User = { email: "user@tta.com" };
    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({ sportId: mockSportId }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(replaceSportEventDefinitionsInDb).toHaveBeenCalledWith(
      mockSportId,
      expect.any(Array),
      "user@tta.com",
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
      { eventDefinitionIds: ["def-1", "def-2"] },
    );
    expect(onPresetSaved).toHaveBeenCalledTimes(1);
  });

  it("should create custom definition and reload definitions", async () => {
    vi.mocked(eventDefinitionService.createCustom).mockResolvedValue(
      {} as unknown as Awaited<
        ReturnType<typeof eventDefinitionService.createCustom>
      >,
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
      result.current.setNewName("Custom Goal");
      result.current.setNewShortName("CG");
      result.current.setNewIsPositive(true);
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
        name: "Custom Goal",
        shortName: "CG",
        isPositive: true,
      }),
    );
    expect(onPresetModified).toHaveBeenCalled();
  });

  it("should delete custom definition when confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(eventDefinitionService.softDeleteCustom).mockResolvedValue(
      undefined,
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

    await act(async () => {
      await result.current.handleDeleteCustom("def-1");
    });

    expect(eventDefinitionService.softDeleteCustom).toHaveBeenCalledWith(
      "def-1",
    );
    expect(onPresetModified).toHaveBeenCalled();
  });

  it("should not perform actions when disabled/locked", async () => {
    const onPresetModified = vi.fn();

    const { result } = renderHook(() =>
      useEventDefinitionsConfigurator({
        sportId: mockSportId,
        disabled: true,
        onPresetModified,
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handleToggleEnabled("def-1");
    });

    expect(onPresetModified).not.toHaveBeenCalled();
  });

  it("should ignore stale requests if request count changes during fetch", async () => {
    let resolveFirstFetch: (value: typeof mockDefinitions) => void = () => {};
    const firstFetchPromise = new Promise<
      Awaited<ReturnType<typeof eventDefinitionService.getAvailableForSport>>
    >((resolve) => {
      resolveFirstFetch = resolve;
    });

    vi.mocked(eventDefinitionService.getAvailableForSport)
      .mockReturnValueOnce(firstFetchPromise)
      .mockResolvedValueOnce(mockDefinitions);

    const { result, rerender } = renderHook(
      ({ sportId }) => useEventDefinitionsConfigurator({ sportId }),
      { initialProps: { sportId: "water-polo" } },
    );

    rerender({ sportId: "swimming" });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      resolveFirstFetch(mockDefinitions);
    });

    expect(eventDefinitionService.getAvailableForSport).toHaveBeenCalledWith(
      "swimming",
    );
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
