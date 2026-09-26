import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
import { useSelector } from "react-redux";
import { useAuth0 } from "@auth0/auth0-react";
import {
  eventDefinitionService,
  type EventDefinitionResponse,
} from "../../../services/eventDefinitionService";
import { replaceSportEventDefinitionsInDb } from "../../../db/eventService";
import { db, type EventDefinitionLookup } from "../../../db/ttaDatabase";
import type { RootState } from "../../../store";

export type TabType = "POSITIVE" | "NEGATIVE";

export interface UseEventDefinitionsConfiguratorOptions {
  sportId: string;
  disabled?: boolean;
  onPresetSaved?: () => void;
  onPresetModified?: () => void;
  onChange?: (activeIds: string[]) => void;
  onLoadStateChange?: (loaded: boolean) => void;
}

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

export function useEventDefinitionsConfigurator({
  sportId,
  disabled = false,
  onPresetSaved,
  onPresetModified,
  onChange,
  onLoadStateChange,
}: UseEventDefinitionsConfiguratorOptions) {
  const { user } = useAuth0();
  const auth0UserId = user?.sub ?? user?.email;
  const reduxUserId = useSelector(
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
  const currentUserId = auth0UserId ?? reduxUserId;

  const [definitions, setDefinitions] = useState<EventDefinitionResponse[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("POSITIVE");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [definitionsReady, setDefinitionsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const requestId = requestCountRef.current;
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
      if (requestId !== requestCountRef.current) return;
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

      const serverMap = new Map<string, EventDefinitionResponse>(
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
    syncToDexie(finalDefinitions).catch((err) => {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to sync action definitions.",
      );
    });
    onPresetModified?.();
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
    syncToDexie(reordered).catch((err) => {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to sync action definitions.",
      );
    });
    onPresetModified?.();
  };

  const handleSavePreset = async () => {
    if (isLocked || !definitionsReady) return;
    const requestId = requestCountRef.current;
    try {
      setSaving(true);
      setError(null);

      const activeIds = definitions
        .filter((def) => def.isEnabled && def.id)
        .map((def) => def.id as string);

      await eventDefinitionService.savePreset(sportId, {
        eventDefinitionIds: activeIds,
      });

      if (requestId !== requestCountRef.current) return;

      await syncToDexie(definitions);

      if (requestId !== requestCountRef.current) return;

      if (onPresetSaved) {
        onPresetSaved();
      }
    } catch (err) {
      if (requestId !== requestCountRef.current) return;

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

      const clientGeneratedId = crypto.randomUUID();
      const createdResponse = await eventDefinitionService.createCustom(
        sportId,
        {
          id: clientGeneratedId,
          name: newName.trim(),
          shortName: newShortName.trim(),
          isPositive: newIsPositive,
        },
      );

      if (requestId !== requestCountRef.current) return;

      const effectiveId = createdResponse?.id ?? clientGeneratedId;

      if (db.eventdefinitions) {
        try {
          const dictionaryRecord: EventDefinitionLookup = {
            id: effectiveId,
            sportId,
            name: createdResponse?.name ?? newName.trim(),
            shortName: createdResponse?.shortName ?? newShortName.trim(),
            isPositive: Boolean(createdResponse?.isPositive ?? newIsPositive),
            isCustom: true,
            ownerId: currentUserId ?? null,
          };
          await db.eventdefinitions.put(dictionaryRecord);
        } catch (dexieErr) {
          console.warn(
            "Failed to persist custom event definition to Dexie:",
            dexieErr,
          );
        }
      }

      if (requestId !== requestCountRef.current) return;

      const draftItem: EventDefinitionResponse = {
        id: effectiveId,
        sportId: createdResponse?.sportId ?? sportId,
        name: createdResponse?.name ?? newName.trim(),
        shortName: createdResponse?.shortName ?? newShortName.trim(),
        isPositive: Boolean(createdResponse?.isPositive ?? newIsPositive),
        isCustom: true,
        isEnabled: true,
        sortOrder: 0,
      };

      const combined = [...definitionsRef.current, draftItem];
      const reordered = groupDefinitionsByEnabled(combined);

      setDefinitions(reordered);
      notifyParent(reordered);

      setActiveTab(newIsPositive ? "POSITIVE" : "NEGATIVE");
      setNewName("");
      setNewShortName("");
      setNewIsPositive(true);
      setModalError(null);
      setIsModalOpen(false);

      onPresetModified?.();
    } catch (err) {
      if (requestId !== requestCountRef.current) return;

      setModalError(
        err instanceof Error
          ? err.message
          : "Failed to create custom definition.",
      );
    } finally {
      if (requestId === requestCountRef.current) {
        setCreating(false);
      }
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
      onPresetModified?.();
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

  return {
    definitions,
    activeTab,
    loading,
    saving,
    creating,
    deleting,
    definitionsReady,
    error,
    isModalOpen,
    modalError,
    newName,
    newShortName,
    newIsPositive,
    isLocked,
    activeCategoryDefs,
    activePositiveCount,
    activeNegativeCount,
    setActiveTab,
    setIsModalOpen,
    setModalError,
    setNewName,
    setNewShortName,
    setNewIsPositive,
    setCreating,
    handleToggleEnabled,
    handleMove,
    handleSavePreset,
    handleCreateCustom,
    handleDeleteCustom,
  };
}
