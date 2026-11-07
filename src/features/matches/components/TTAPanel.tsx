import React from "react";
import { useTTAPanel, type UseTTAPanelOptions } from "../hooks/useTTAPanel";
import { InteractivePlayground } from "./InteractivePlayground";
import { InteractiveShotMap } from "./InteractiveShotMap";

export interface TTAPanelProps extends UseTTAPanelOptions {
  onActionSelect: (
    action: string,
    isPositive: boolean,
    eventDefinitionId?: string,
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
  const {
    activeTab,
    setActiveTab,
    displayedActions,
    checkIsPositive,
    playground,
    shotMap,
    isShotSelected,
  } = useTTAPanel({ userId, selectedActionDefinitionId });

  const handleTabClick = (tab: "positive" | "negative" | "map" | "shots") => {
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
              onClick={() => onActionSelect(def.name, isPos, def.id)}
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

  return (
    <div
      className={`w-full p-2 bg-gray-900 rounded-xl border border-gray-800 my-2 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <div className="flex border-b border-gray-800 mb-2">
        <button
          type="button"
          onClick={() => handleTabClick("positive")}
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
          type="button"
          onClick={() => handleTabClick("negative")}
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
          type="button"
          onClick={() => handleTabClick("map")}
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
            type="button"
            onClick={() => handleTabClick("shots")}
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

      {renderTabContent()}
    </div>
  );
};
