import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
import {
  eventDefinitionService,
  type EventDefinitionResponse,
} from "../../../services/eventDefinitionService";

interface EventDefinitionsConfiguratorProps {
  sportId: string;
  onPresetSaved?: () => void;
  onChange?: (activeIds: string[]) => void;
  onLoadStateChange?: (loaded: boolean) => void;
}

const getTextColorClass = (
  isEnabled: boolean,
  isPositive?: boolean,
): string => {
  if (!isEnabled) {
    return "text-gray-500";
  }
  return isPositive ? "text-emerald-400" : "text-rose-400";
};

export const EventDefinitionsConfigurator: React.FC<
  EventDefinitionsConfiguratorProps
> = ({ sportId, onPresetSaved, onChange, onLoadStateChange }) => {
  const [definitions, setDefinitions] = useState<EventDefinitionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal State for Custom Definition Creation
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newShortName, setNewShortName] = useState("");
  const [newIsPositive, setNewIsPositive] = useState(true);
  const [creating, setCreating] = useState(false);

  const onChangeRef = useRef(onChange);
  const onLoadStateChangeRef = useRef(onLoadStateChange);
  const requestCountRef = useRef(0);

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    onLoadStateChangeRef.current = onLoadStateChange;
  }, [onChange, onLoadStateChange]);

  const notifyParent = useCallback((items: EventDefinitionResponse[]) => {
    if (onChangeRef.current) {
      const activeIds = items
        .filter((def) => def.isEnabled && def.id)
        .map((def) => def.id as string);
      onChangeRef.current(activeIds);
    }
  }, []);

  const reloadDefinitions = useCallback(async () => {
    if (!sportId) return;
    const requestId = ++requestCountRef.current;
    try {
      const data = await eventDefinitionService.getAvailableForSport(sportId);
      if (requestId !== requestCountRef.current) return;

      const sorted = [...data].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
      );
      setDefinitions(sorted);
      notifyParent(sorted);
      setError(null);
      onLoadStateChangeRef.current?.(true);
    } catch (err) {
      if (requestId !== requestCountRef.current) return;

      setError(
        err instanceof Error
          ? err.message
          : "Failed to load event definitions.",
      );
      onLoadStateChangeRef.current?.(false);
    }
  }, [sportId, notifyParent]);

  useEffect(() => {
    const requestId = ++requestCountRef.current;
    onLoadStateChangeRef.current?.(false);

    async function fetchDefinitions() {
      if (!sportId) return;
      try {
        setLoading(true);
        const data = await eventDefinitionService.getAvailableForSport(sportId);
        if (requestId !== requestCountRef.current) return;

        const sorted = [...data].sort(
          (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
        );
        setDefinitions(sorted);
        notifyParent(sorted);
        setError(null);
        onLoadStateChangeRef.current?.(true);
      } catch (err) {
        if (requestId !== requestCountRef.current) return;

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
  }, [sportId, notifyParent]);

  const handleToggleEnabled = (id: string) => {
    setDefinitions((prev) => {
      const updated = prev.map((def) =>
        def.id === id ? { ...def, isEnabled: !def.isEnabled } : def,
      );
      notifyParent(updated);
      return updated;
    });
  };

  const handleMove = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= definitions.length) return;

    const updated = [...definitions];
    const [movedItem] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, movedItem);

    const reordered = updated.map((item, idx) => ({
      ...item,
      sortOrder: idx + 1,
    }));

    setDefinitions(reordered);
    notifyParent(reordered);
  };

  const handleSavePreset = async () => {
    try {
      setSaving(true);
      setError(null);

      const activeIds = definitions
        .filter((def) => def.isEnabled && def.id)
        .map((def) => def.id as string);

      await eventDefinitionService.savePreset(sportId, {
        eventDefinitionIds: activeIds,
      });

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

  const handleCreateCustom = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newName.trim() || !newShortName.trim()) return;

    try {
      setCreating(true);
      setError(null);
      await eventDefinitionService.createCustom(sportId, {
        name: newName.trim(),
        shortName: newShortName.trim(),
        isPositive: newIsPositive,
      });

      setNewName("");
      setNewShortName("");
      setNewIsPositive(true);
      setIsModalOpen(false);

      await reloadDefinitions();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create custom definition.",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteCustom = async (id: string) => {
    if (
      !window.confirm("Are you sure you want to delete this custom definition?")
    ) {
      return;
    }

    try {
      setError(null);
      await eventDefinitionService.softDeleteCustom(id);
      await reloadDefinitions();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to delete custom definition.",
      );
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-center text-xs text-gray-400">
        Loading action definitions...
      </div>
    );
  }

  return (
    <div className="w-full bg-gray-950 text-gray-100 p-3 rounded-xl border border-gray-800 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-200">
            Configure TTA Actions
          </h3>
          <p className="text-[11px] text-gray-400">
            Enable, reorder, or add custom action definitions for this match.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold flex items-center gap-1 transition-colors"
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

      {/* Action List */}
      <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
        {definitions.length === 0 ? (
          <p className="text-xs text-gray-500 italic text-center py-4">
            No definitions available for this sport.
          </p>
        ) : (
          definitions.map((def, index) => {
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
                    aria-label={`Enable ${def.name}`}
                    checked={isEnabled}
                    onChange={() => handleToggleEnabled(defId)}
                    className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-0 cursor-pointer"
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
                  {/* Reorder Buttons */}
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => handleMove(index, "up")}
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
                    disabled={index === definitions.length - 1}
                    onClick={() => handleMove(index, "down")}
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

                  {/* Delete button for user custom items */}
                  {def.isCustom && (
                    <button
                      type="button"
                      onClick={() => handleDeleteCustom(defId)}
                      className="p-1 hover:bg-rose-950 hover:text-rose-400 rounded text-gray-500 transition-colors ml-1"
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
        disabled={saving}
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
                  disabled={creating}
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
