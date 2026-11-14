import React, { useId, useRef } from "react";
import { useTTAPanel, type UseTTAPanelOptions } from "../hooks/useTTAPanel";
import { InteractivePlayground } from "./InteractivePlayground";
import { InteractiveShotMap } from "./InteractiveShotMap";

type TabKey = "positive" | "negative" | "map" | "shots";

export interface TTAPanelProps extends UseTTAPanelOptions {
  onActionSelect: (
    action: string,
    isPositive: boolean,
    eventDefinitionId?: string,
    isShot?: boolean,
  ) => void;
  onTabChange?: () => void;
  selectedActionDefinitionId: string | null;
  disabled: boolean;
  pendingLocation?: { locationX: number; locationY: number } | null;
  onLocationSelect?: (x: number | null, y: number | null) => void;
  pendingShotLocation?: { shotLocationX: number; shotLocationY: number } | null;
  onShotLocationSelect?: (x: number | null, y: number | null) => void;
}

export const TTAPanel: React.FC<TTAPanelProps> = ({
  onActionSelect,
  onTabChange,
  selectedActionDefinitionId,
  disabled,
  userId,
  pendingLocation,
  onLocationSelect,
  pendingShotLocation,
  onShotLocationSelect,
}) => {
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});

  const {
    activeTab,
    setActiveTab,
    displayedActions,
    checkIsPositive,
    playground,
    shotMap,
    isShotSelected,
  } = useTTAPanel({
    userId,
    selectedActionDefinitionId,
    hasShotLocation:
      pendingShotLocation?.shotLocationX != null &&
      pendingShotLocation?.shotLocationY != null,
  });

  const availableTabs: TabKey[] = isShotSelected
    ? ["positive", "negative", "map", "shots"]
    : ["positive", "negative", "map"];

  const handleTabClick = (tab: TabKey) => {
    if (activeTab !== tab) {
      const isCategorySwitch =
        (activeTab === "positive" && tab === "negative") ||
        (activeTab === "negative" && tab === "positive");

      setActiveTab(tab);

      if (isCategorySwitch && onTabChange) {
        onTabChange();
      }
    }
  };

  const handleTabKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    currentTab: TabKey,
  ) => {
    if (disabled) return;
    const currentIndex = availableTabs.indexOf(currentTab);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % availableTabs.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + availableTabs.length) % availableTabs.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = availableTabs.length - 1;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      const nextTab = availableTabs[nextIndex];
      handleTabClick(nextTab);
      tabRefs.current[nextTab]?.focus();
    }
  };

  const renderTabContent = () => {
    if (activeTab === "shots") {
      return (
        <InteractiveShotMap
          shotMap={shotMap}
          shotLocationX={pendingShotLocation?.shotLocationX ?? null}
          shotLocationY={pendingShotLocation?.shotLocationY ?? null}
          disabled={disabled}
          onShotLocationSelect={onShotLocationSelect ?? (() => {})}
        />
      );
    }

    if (activeTab === "map") {
      return (
        <InteractivePlayground
          playground={playground}
          locationX={pendingLocation?.locationX ?? null}
          locationY={pendingLocation?.locationY ?? null}
          disabled={disabled}
          onLocationSelect={onLocationSelect ?? (() => {})}
        />
      );
    }

    return (
      <div className="grid grid-cols-3 gap-2">
        {displayedActions.map((def) => {
          const isPos = checkIsPositive(def);
          const isSelected =
            Boolean(def.id) && selectedActionDefinitionId === def.id;

          let buttonColorStyle = "bg-gray-800 text-rose-200 hover:bg-gray-700";
          if (isSelected) {
            buttonColorStyle = "bg-blue-600 text-white";
          } else if (activeTab === "positive") {
            buttonColorStyle = "bg-gray-800 text-emerald-200 hover:bg-gray-700";
          }

          return (
            <button
              type="button"
              key={def.id || def.name}
              onClick={() =>
                onActionSelect(def.name, isPos, def.id, def.isShot)
              }
              disabled={disabled}
              className={`p-2 min-h-11 rounded text-xs font-medium transition-all disabled:cursor-not-allowed ${buttonColorStyle}`}
            >
              {def.name}
            </button>
          );
        })}
      </div>
    );
  };

  const panelId = `${baseId}-panel`;

  return (
    <div
      className={`w-full p-2 bg-gray-900 rounded-xl border border-gray-800 my-2 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <div
        role="tablist"
        aria-label="Action and map tabs"
        className="flex border-b border-gray-800 mb-2"
      >
        <button
          ref={(el) => {
            tabRefs.current.positive = el;
          }}
          id={`${baseId}-tab-positive`}
          type="button"
          role="tab"
          aria-selected={activeTab === "positive"}
          aria-controls={panelId}
          tabIndex={activeTab === "positive" ? 0 : -1}
          onClick={() => handleTabClick("positive")}
          onKeyDown={(e) => handleTabKeyDown(e, "positive")}
          disabled={disabled}
          className={`flex-1 py-2 min-h-11 text-xs font-bold uppercase transition-all disabled:cursor-not-allowed ${
            activeTab === "positive"
              ? "text-emerald-400 border-b-2 border-emerald-400"
              : "text-gray-500"
          }`}
        >
          Positive
        </button>
        <button
          ref={(el) => {
            tabRefs.current.negative = el;
          }}
          id={`${baseId}-tab-negative`}
          type="button"
          role="tab"
          aria-selected={activeTab === "negative"}
          aria-controls={panelId}
          tabIndex={activeTab === "negative" ? 0 : -1}
          onClick={() => handleTabClick("negative")}
          onKeyDown={(e) => handleTabKeyDown(e, "negative")}
          disabled={disabled}
          className={`flex-1 py-2 min-h-11 text-xs font-bold uppercase transition-all disabled:cursor-not-allowed ${
            activeTab === "negative"
              ? "text-rose-400 border-b-2 border-rose-400"
              : "text-gray-500"
          }`}
        >
          Negative
        </button>
        <button
          ref={(el) => {
            tabRefs.current.map = el;
          }}
          id={`${baseId}-tab-map`}
          type="button"
          role="tab"
          aria-selected={activeTab === "map"}
          aria-controls={panelId}
          tabIndex={activeTab === "map" ? 0 : -1}
          onClick={() => handleTabClick("map")}
          onKeyDown={(e) => handleTabKeyDown(e, "map")}
          disabled={disabled}
          className={`flex-1 py-2 min-h-11 text-xs font-bold uppercase transition-all disabled:cursor-not-allowed flex items-center justify-center space-x-1 ${
            activeTab === "map"
              ? "text-blue-400 border-b-2 border-blue-400"
              : "text-gray-500"
          }`}
        >
          <span>Map</span>
          {pendingLocation && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          )}
        </button>

        {/* Dynamic 4th tab: SHOTS */}
        {isShotSelected && (
          <button
            ref={(el) => {
              tabRefs.current.shots = el;
            }}
            id={`${baseId}-tab-shots`}
            type="button"
            role="tab"
            aria-selected={activeTab === "shots"}
            aria-controls={panelId}
            tabIndex={activeTab === "shots" ? 0 : -1}
            onClick={() => handleTabClick("shots")}
            onKeyDown={(e) => handleTabKeyDown(e, "shots")}
            disabled={disabled}
            className={`flex-1 py-2 min-h-11 text-xs font-bold uppercase transition-all disabled:cursor-not-allowed flex items-center justify-center space-x-1 ${
              activeTab === "shots"
                ? "text-amber-400 border-b-2 border-amber-400"
                : "text-gray-500"
            }`}
          >
            <span>SHOTS</span>
            {pendingShotLocation && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>
        )}
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${activeTab}`}
      >
        {renderTabContent()}
      </div>
    </div>
  );
};
