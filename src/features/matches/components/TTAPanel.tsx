import React from "react";
import { useTTAPanel, type UseTTAPanelOptions } from "../hooks/useTTAPanel";

export interface TTAPanelProps extends UseTTAPanelOptions {
  onActionSelect: (action: string, isPositive: boolean) => void;
  selectedAction: string | null;
  disabled: boolean;
}

export const TTAPanel: React.FC<TTAPanelProps> = ({
  onActionSelect,
  selectedAction,
  disabled,
  userId,
}) => {
  const { activeTab, setActiveTab, displayedActions, checkIsPositive } =
    useTTAPanel({ userId });

  return (
    <div
      className={`w-full p-2 bg-gray-900 rounded-xl border border-gray-800 my-2 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <div className="flex border-b border-gray-800 mb-2">
        <button
          type="button"
          onClick={() => setActiveTab("positive")}
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
          onClick={() => setActiveTab("negative")}
          disabled={disabled}
          className={`flex-1 py-2 min-h-11 text-xs font-bold uppercase transition-all disabled:cursor-not-allowed ${
            activeTab === "negative"
              ? "text-rose-400 border-b-2 border-rose-400"
              : "text-gray-500"
          }`}
        >
          Negative
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {displayedActions.map((def) => {
          const isPos = checkIsPositive(def);
          const isSelected = selectedAction === def.name;

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
              onClick={() => onActionSelect(def.name, isPos)}
              disabled={disabled}
              className={`p-2 min-h-11 rounded text-xs font-medium transition-all disabled:cursor-not-allowed ${
                buttonColorStyle
              }`}
            >
              {def.name}
            </button>
          );
        })}
      </div>
    </div>
  );
};
