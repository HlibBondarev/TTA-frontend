import React from "react";
import { useTTAPanel, type UseTTAPanelOptions } from "../hooks/useTTAPanel";
import { InteractivePlayground } from "./InteractivePlayground";

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
  playgroundSvg?: string | null;
  onLocationSelect?: (x: number | null, y: number | null) => void;
}

export const TTAPanel: React.FC<TTAPanelProps> = ({
  onActionSelect,
  onTabChange,
  selectedActionDefinitionId,
  disabled,
  userId,
  pendingLocation,
  playgroundSvg,
  onLocationSelect,
}) => {
  const { activeTab, setActiveTab, displayedActions, checkIsPositive } =
    useTTAPanel({ userId });

  const handleTabClick = (tab: "positive" | "negative" | "map") => {
    if (activeTab !== tab) {
      // Скидаємо дію ТІЛЬКИ при перемиканні між Positive та Negative
      const isCategorySwitch =
        (activeTab === "positive" && tab === "negative") ||
        (activeTab === "negative" && tab === "positive");

      setActiveTab(tab);

      if (isCategorySwitch && onTabChange) {
        onTabChange();
      }
    }
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
      </div>

      {activeTab === "map" ? (
        <InteractivePlayground
          playgroundSvg={playgroundSvg}
          locationX={pendingLocation?.locationX ?? null}
          locationY={pendingLocation?.locationY ?? null}
          disabled={disabled}
          onLocationSelect={onLocationSelect ?? (() => {})}
        />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {displayedActions.map((def) => {
            const isPos = checkIsPositive(def);
            const isSelected =
              Boolean(def.id) && selectedActionDefinitionId === def.id;

            let buttonColorStyle =
              "bg-gray-800 text-rose-200 hover:bg-gray-700";
            if (isSelected) {
              buttonColorStyle = "bg-blue-600 text-white";
            } else if (activeTab === "positive") {
              buttonColorStyle =
                "bg-gray-800 text-emerald-200 hover:bg-gray-700";
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
      )}
    </div>
  );
};
