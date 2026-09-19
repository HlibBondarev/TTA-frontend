import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
import { useSelector } from "react-redux";
import {
  eventDefinitionService,
  type EventDefinitionResponse,
} from "../../../services/eventDefinitionService";
import { replaceSportEventDefinitionsInDb } from "../../../db/eventService";
import { db, type EventDefinitionLookup } from "../../../db/ttaDatabase";
import type { RootState } from "../../../store";

interface EventDefinitionsConfiguratorProps {
  sportId: string;
  disabled?: boolean;
  onPresetSaved?: () => void;
  onChange?: (activeIds: string[]) => void;
  onLoadStateChange?: (loaded: boolean) => void;
}

type TabType = "POSITIVE" | "NEGATIVE";

const getTextColorClass = (
  isEnabled: boolean,
  isPositive?: boolean,
): string => {
  if (!isEnabled) {
    return "text-gray-500";
  }
  return isPositive ? "text-emerald-400" : "text-rose-400";
};

const groupDefinitionsByEnabled = (
  items: EventDefinitionResponse[],
): EventDefinitionResponse[] => {
  const positive = items.filter((d) => d.isPositive);
  const negative = items.filter((d) => !d.isPositive);

  const sortCategory = (cat: EventDefinitionResponse[]) => [
    ...cat.filter((d) => d.isEnabled),
    ...cat.filter((d) => !d.isEnabled),
  ];

  return [...sortCategory(positive), ...sortCategory(negative)].map(
    (item, idx) => ({
      ...item,
      sortOrder: idx + 1,
    }),
  );
};

export const EventDefinitionsConfigurator: React.FC<
  EventDefinitionsConfiguratorProps
> = ({
  sportId,
  disabled = false,
  onPresetSaved,
  onChange,
  onLoadStateChange,
}) => {
  const currentUserId = useSelector(
    (state: RootState) =>
      (
        state as unknown as {
          auth?: { user?: { id?: string }; currentUserId?: string };
        }
      ).auth?.currentUserId ??
      (
        state as unknown as {
          auth?: { user?: { id?: string }; currentUserId?: string };
        }
      ).auth?.user?.id,
  );

  const [definitions, setDefinitions] = useState<EventDefinitionResponse[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("POSITIVE");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [definitionsReady, setDefinitionsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal State for Custom Definition Creation
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newShortName, setNewShortName] = useState("");
  const [newIsPositive, setNewIsPositive] = useState(true);

  const onChangeRef = useRef(onChange);
  const onLoadStateChangeRef = useRef(onLoadStateChange);
  const requestCountRef = useRef(0);
  const definitionsRef = useRef(definitions);

  const isLocked = disabled || saving || creating || deleting;

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    onLoadStateChangeRef.current = onLoadStateChange;
    definitionsRef.current = definitions;
  }, [onChange, onLoadStateChange, definitions]);

  const notifyParent = useCallback((items: EventDefinitionResponse[]) => {
    if (onChangeRef.current) {
      const activeIds = items
        .filter((def) => def.isEnabled && def.id)
        .map((def) => def.id as string);
      onChangeRef.current(activeIds);
    }
  }, []);

  const syncToDexie = useCallback(
    async (items: EventDefinitionResponse[]) => {
      if (!sportId || !db.eventdefinitions) return;
      const recordsToPut: EventDefinitionLookup[] = items
        .filter((def): def is EventDefinitionResponse & { id: string } =>
          Boolean(def.id),
        )
        .map((def, idx) => ({
          id: def.id,
          sportId,
          name: def.name ?? "",
          shortName: def.shortName ?? "",
          isPositive: Boolean(def.isPositive),
          isCustom: def.isCustom,
          isEnabled: def.isEnabled ?? true,
          sortOrder: def.sortOrder ?? idx + 1,
        }));
      await replaceSportEventDefinitionsInDb(
        sportId,
        recordsToPut,
        currentUserId,
      );
    },
    [sportId, currentUserId],
  );

  const reloadDefinitions = useCallback(async () => {
    if (!sportId) return;
    const requestId = ++requestCountRef.current;
    setDefinitionsReady(false);
    onLoadStateChangeRef.current?.(false);

    try {
      const data = await eventDefinitionService.getAvailableForSport(sportId);
      if (requestId !== requestCountRef.current) return;

      const serverMap = new Map(
        data.filter((def) => def.id).map((def) => [def.id as string, def]),
      );

      const existingOrdered: EventDefinitionResponse[] = [];
      for (const localDef of definitionsRef.current) {
        if (localDef.id && serverMap.has(localDef.id)) {
          const serverDef = serverMap.get(localDef.id)!;
          existingOrdered.push({
            ...serverDef,
            isEnabled: localDef.isEnabled ?? true,
          });
          serverMap.delete(localDef.id);
        }
      }

      const newServerDefs = Array.from(serverMap.values())
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((def) => ({
          ...def,
          isEnabled: def.isEnabled ?? true,
        }));

      const combined = [...existingOrdered, ...newServerDefs];
      const grouped = groupDefinitionsByEnabled(combined);

      setDefinitions(grouped);
      notifyParent(grouped);
      await syncToDexie(grouped);
      if (requestId !== requestCountRef.current) return;

      setError(null);
      setDefinitionsReady(true);
      onLoadStateChangeRef.current?.(true);
    } catch (err) {
      if (requestId !== requestCountRef.current) return;

      setDefinitionsReady(false);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load event definitions.",
      );
      onLoadStateChangeRef.current?.(false);
    }
  }, [sportId, notifyParent, syncToDexie]);

  useEffect(() => {
    const requestId = ++requestCountRef.current;

    async function fetchDefinitions() {
      if (!sportId) return;
      try {
        setLoading(true);
        setDefinitionsReady(false);
        onLoadStateChangeRef.current?.(false);

        const data = await eventDefinitionService.getAvailableForSport(sportId);
        if (requestId !== requestCountRef.current) return;

        const sorted = [...data].sort(
          (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
        );

        const normalized = sorted.map((def) => ({
          ...def,
          isEnabled: def.isEnabled ?? true,
        }));

        const grouped = groupDefinitionsByEnabled(normalized);

        setDefinitions(grouped);
        notifyParent(grouped);
        await syncToDexie(grouped);
        if (requestId !== requestCountRef.current) return;

        setError(null);
        setDefinitionsReady(true);
        onLoadStateChangeRef.current?.(true);
      } catch (err) {
        if (requestId !== requestCountRef.current) return;

        setDefinitionsReady(false);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load event definitions.",
        );
        notifyParent([]);
        onLoadStateChangeRef.current?.(false);
      } finally {
        if (requestId === requestCountRef.current) {
          setLoading(false);
        }
      }
    }

    void fetchDefinitions();

    return () => {
      requestCountRef.current += 1;
    };
  }, [sportId, notifyParent, syncToDexie]);

  const handleToggleEnabled = (id: string) => {
    if (isLocked) return;

    const targetIndex = definitions.findIndex((d) => d.id === id);
    if (targetIndex === -1) return;

    const targetItem = definitions[targetIndex];
    const newEnabledState = !targetItem.isEnabled;
    const targetIsPositive = targetItem.isPositive;

    const currentCategory = definitions.filter(
      (d) => Boolean(d.isPositive) === Boolean(targetIsPositive),
    );

    const remainingCategory = currentCategory.filter((d) => d.id !== id);
    const updatedTargetItem = { ...targetItem, isEnabled: newEnabledState };

    let reorderedCategory: EventDefinitionResponse[] = [];

    if (!newEnabledState) {
      reorderedCategory = [...remainingCategory, updatedTargetItem];
    } else {
      const lastEnabledIdx = remainingCategory.findLastIndex(
        (d) => d.isEnabled,
      );
      if (lastEnabledIdx === -1) {
        reorderedCategory = [updatedTargetItem, ...remainingCategory];
      } else {
        reorderedCategory = [
          ...remainingCategory.slice(0, lastEnabledIdx + 1),
          updatedTargetItem,
          ...remainingCategory.slice(lastEnabledIdx + 1),
        ];
      }
    }

    let catPointer = 0;
    const reorderedDefinitions = definitions.map((d) => {
      if (Boolean(d.isPositive) === Boolean(targetIsPositive)) {
        const newItem = reorderedCategory[catPointer];
        catPointer++;
        return newItem;
      }
      return d;
    });

    const finalDefinitions = reorderedDefinitions.map((item, idx) => ({
      ...item,
      sortOrder: idx + 1,
    }));

    setDefinitions(finalDefinitions);
    notifyParent(finalDefinitions);
    void syncToDexie(finalDefinitions);
  };

  const handleMove = (id: string, direction: "up" | "down") => {
    if (isLocked) return;

    const filteredCategory = definitions.filter((d) =>
      activeTab === "POSITIVE" ? d.isPositive : !d.isPositive,
    );

    const categoryIndex = filteredCategory.findIndex((d) => d.id === id);
    if (categoryIndex === -1) return;

    const targetCategoryIndex =
      direction === "up" ? categoryIndex - 1 : categoryIndex + 1;
    if (
      targetCategoryIndex < 0 ||
      targetCategoryIndex >= filteredCategory.length
    )
      return;

    const currentItem = filteredCategory[categoryIndex];
    const targetItem = filteredCategory[targetCategoryIndex];

    const mainIdx1 = definitions.findIndex((d) => d.id === currentItem.id);
    const mainIdx2 = definitions.findIndex((d) => d.id === targetItem.id);

    if (mainIdx1 === -1 || mainIdx2 === -1) return;

    const updated = [...definitions];
    const temp = updated[mainIdx1];
    updated[mainIdx1] = updated[mainIdx2];
    updated[mainIdx2] = temp;

    const reordered = updated.map((item, idx) => ({
      ...item,
      sortOrder: idx + 1,
    }));

    setDefinitions(reordered);
    notifyParent(reordered);
    void syncToDexie(reordered);
  };

  const handleSavePreset = async () => {
    if (isLocked || !definitionsReady) return;
    try {
      setSaving(true);
      setError(null);

      const activeIds = definitions
        .filter((def) => def.isEnabled && def.id)
        .map((def) => def.id as string);

      await eventDefinitionService.savePreset(sportId, {
        eventDefinitionIds: activeIds,
      });

      await syncToDexie(definitions);

      if (onPresetSaved) {
        onPresetSaved();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save user preset.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCustom = async (
    e: React.SyntheticEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();
    if (isLocked || !newName.trim() || !newShortName.trim()) return;

    const requestId = requestCountRef.current;

    try {
      setCreating(true);
      setModalError(null);

      await eventDefinitionService.createCustom(sportId, {
        id: crypto.randomUUID(),
        name: newName.trim(),
        shortName: newShortName.trim(),
        isPositive: newIsPositive,
      });

      if (requestId !== requestCountRef.current) return;

      setActiveTab(newIsPositive ? "POSITIVE" : "NEGATIVE");
      setNewName("");
      setNewShortName("");
      setNewIsPositive(true);
      setModalError(null);
      setIsModalOpen(false);

      await reloadDefinitions();
    } catch (err) {
      if (requestId !== requestCountRef.current) return;

      setModalError(
        err instanceof Error
          ? err.message
          : "Failed to create custom definition.",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteCustom = async (id: string) => {
    if (isLocked) return;
    if (
      !window.confirm("Are you sure you want to delete this custom definition?")
    ) {
      return;
    }

    const requestId = requestCountRef.current;

    try {
      setDeleting(true);
      setError(null);
      await eventDefinitionService.softDeleteCustom(id);
      if (requestId !== requestCountRef.current) return;

      await reloadDefinitions();
    } catch (err) {
      if (requestId !== requestCountRef.current) return;

      setError(
        err instanceof Error
          ? err.message
          : "Failed to delete custom definition.",
      );
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-center text-xs text-gray-400">
        Loading action definitions...
      </div>
    );
  }

  const positiveDefinitions = definitions.filter((def) => def.isPositive);
  const negativeDefinitions = definitions.filter((def) => !def.isPositive);

  const activeCategoryDefs =
    activeTab === "POSITIVE" ? positiveDefinitions : negativeDefinitions;

  const activePositiveCount = positiveDefinitions.filter(
    (d) => d.isEnabled,
  ).length;
  const activeNegativeCount = negativeDefinitions.filter(
    (d) => d.isEnabled,
  ).length;

  return (
    <div className="w-full bg-gray-950 text-gray-100 p-3 rounded-xl border border-gray-800 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-200">
            Configure TTA Actions
          </h3>
          <p className="text-[11px] text-gray-400">
            Enable, reorder, or add custom action definitions.
          </p>
        </div>
        <button
          type="button"
          disabled={isLocked}
          onClick={() => {
            setCreating(false);
            setModalError(null);
            setIsModalOpen(true);
          }}
          className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-semibold flex items-center gap-1 transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          Custom Action
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="p-2 text-xs bg-red-950/80 border border-red-800 text-red-200 rounded-lg"
        >
          {error}
        </div>
      )}

      {/* Tabs Header */}
      <div className="grid grid-cols-2 gap-1 bg-gray-900 p-1 rounded-lg border border-gray-800 text-xs font-bold">
        <button
          type="button"
          onClick={() => setActiveTab("POSITIVE")}
          className={`py-1.5 rounded-md transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "POSITIVE"
              ? "bg-gray-800 text-emerald-400 border border-emerald-500/40 shadow-sm"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          <span>POSITIVE</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-300 font-mono">
            {activePositiveCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("NEGATIVE")}
          className={`py-1.5 rounded-md transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "NEGATIVE"
              ? "bg-gray-800 text-rose-400 border border-rose-500/40 shadow-sm"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          <span>NEGATIVE</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-950 border border-rose-800 text-rose-300 font-mono">
            {activeNegativeCount}
          </span>
        </button>
      </div>

      {/* Action List */}
      <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
        {activeCategoryDefs.length === 0 ? (
          <p className="text-xs text-gray-500 italic text-center py-4">
            No {activeTab.toLowerCase()} definitions available.
          </p>
        ) : (
          activeCategoryDefs.map((def, catIndex) => {
            const defId = def.id;
            if (!defId) return null;

            const isEnabled = Boolean(def.isEnabled);
            const textColorClass = getTextColorClass(isEnabled, def.isPositive);

            return (
              <div
                key={defId}
                className={`flex items-center justify-between p-2 rounded-lg border text-xs transition-colors ${
                  isEnabled
                    ? "bg-gray-900 border-gray-800 text-gray-200"
                    : "bg-gray-950/50 border-gray-900 text-gray-500"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    disabled={isLocked}
                    aria-label={`Enable ${def.name}`}
                    checked={isEnabled}
                    onChange={() => handleToggleEnabled(defId)}
                    className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      className={`font-semibold truncate ${textColorClass}`}
                    >
                      {def.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">
                      {def.shortName}
                    </span>
                    {def.isCustom && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950 border border-amber-800 text-amber-300">
                        Custom
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={isLocked || catIndex === 0}
                    onClick={() => handleMove(defId, "up")}
                    className="p-1 hover:bg-gray-800 rounded disabled:opacity-20 text-gray-400"
                    title="Move Up"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 15l7-7 7 7"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    disabled={
                      isLocked || catIndex === activeCategoryDefs.length - 1
                    }
                    onClick={() => handleMove(defId, "down")}
                    className="p-1 hover:bg-gray-800 rounded disabled:opacity-20 text-gray-400"
                    title="Move Down"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>

                  {def.isCustom && (
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleDeleteCustom(defId)}
                      className="p-1 hover:bg-rose-950 hover:text-rose-400 rounded text-gray-500 disabled:opacity-20 transition-colors ml-1"
                      title="Delete Custom Action"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <button
        type="button"
        onClick={handleSavePreset}
        disabled={isLocked || !definitionsReady}
        className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 text-white font-bold rounded-lg text-xs uppercase tracking-wider transition-colors"
      >
        {saving ? "Saving Preset..." : "Save Active Preset"}
      </button>

      {/* Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 w-full max-w-sm space-y-3">
            <h4 className="text-sm font-bold text-gray-200">
              Create Custom Action
            </h4>

            {modalError && (
              <div
                role="alert"
                className="p-2 text-xs bg-red-950/80 border border-red-800 text-red-200 rounded-lg"
              >
                {modalError}
              </div>
            )}

            <form onSubmit={handleCreateCustom} className="space-y-3">
              <div>
                <label
                  htmlFor="customActionName"
                  className="block text-[11px] text-gray-400 mb-1"
                >
                  Action Name
                </label>
                <input
                  id="customActionName"
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Counter Attack Goal"
                  className="w-full px-2.5 py-1.5 bg-gray-950 border border-gray-800 rounded text-xs text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label
                  htmlFor="customActionShortName"
                  className="block text-[11px] text-gray-400 mb-1"
                >
                  Short Name / Abbreviation
                </label>
                <input
                  id="customActionShortName"
                  type="text"
                  required
                  maxLength={5}
                  value={newShortName}
                  onChange={(e) => setNewShortName(e.target.value)}
                  placeholder="e.g. CAG"
                  className="w-full px-2.5 py-1.5 bg-gray-950 border border-gray-800 rounded text-xs text-gray-200 uppercase focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isPositiveCheck"
                  checked={newIsPositive}
                  onChange={(e) => setNewIsPositive(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-0 cursor-pointer"
                />
                <label
                  htmlFor="isPositiveCheck"
                  className="text-xs text-gray-300 cursor-pointer"
                >
                  Positive action (Green indicator)
                </label>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || isLocked}
                  className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
