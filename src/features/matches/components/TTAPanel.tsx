import React, { useEffect, useState } from "react";
import { db, type EventDefinitionLookup } from "../../../db/ttaDatabase";

interface TTDActionsPanelProps {
  onActionSelect: (action: string, isPositive: boolean) => void;
  selectedAction: string | null;
  isLeadToGoal: boolean;
  onIsLeadToGoalChange: (isLeadToGoal: boolean) => void;
  disabled: boolean;
}

export const TTDActionsPanel: React.FC<TTDActionsPanelProps> = ({
  onActionSelect,
  selectedAction,
  isLeadToGoal,
  onIsLeadToGoalChange,
  disabled,
}) => {
  const [activeTab, setActiveTab] = useState<"positive" | "negative">(
    "positive",
  );
  const [eventDefinitions, setEventDefinitions] = useState<
    EventDefinitionLookup[]
  >([]);

  // Load dynamic event definitions from IndexedDB
  useEffect(() => {
    let isMounted = true;
    db.eventdefinitions
      .toArray()
      .then((definitions) => {
        if (isMounted) {
          setEventDefinitions(definitions);
        }
      })
      .catch((err) => {
        console.error("Failed to load event definitions from Dexie:", err);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const positiveActions = eventDefinitions.filter((def) => def.isPositive);
  const negativeActions = eventDefinitions.filter((def) => !def.isPositive);

  const displayedActions =
    activeTab === "positive" ? positiveActions : negativeActions;

  return (
    <div
      className={`w-full p-2 bg-gray-900 rounded-xl border border-gray-800 my-2 ${
        disabled ? "opacity-50 pointer-events-none" : ""
      }`}
    >
      <div className="flex border-b border-gray-800 mb-2">
        <button
          type="button"
          onClick={() => setActiveTab("positive")}
          className={`flex-1 py-2 min-h-11 text-xs font-bold uppercase ${
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
          className={`flex-1 py-2 min-h-11 text-xs font-bold uppercase ${
            activeTab === "negative"
              ? "text-rose-400 border-b-2 border-rose-400"
              : "text-gray-500"
          }`}
        >
          Negative
        </button>
      </div>

      {/* Dynamic Actions Grid */}
      <div className="grid grid-cols-3 gap-2">
        {displayedActions.map((def) => (
          <button
            type="button"
            key={def.id}
            onClick={() => onActionSelect(def.name, def.isPositive)}
            className={`p-2 min-h-11 rounded text-xs font-medium transition-all ${
              selectedAction === def.name
                ? "bg-blue-600 text-white"
                : activeTab === "positive"
                  ? "bg-gray-800 text-emerald-200 hover:bg-gray-700"
                  : "bg-gray-800 text-rose-200 hover:bg-gray-700"
            }`}
          >
            {def.name}
          </button>
        ))}
      </div>

      {/* Dynamic Lead To Goal Toggle */}
      <div className="mt-3 pt-2 border-t border-gray-800 flex items-center justify-between px-1">
        <label className="flex items-center space-x-2 text-xs font-semibold text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isLeadToGoal}
            onChange={(e) => onIsLeadToGoalChange(e.target.checked)}
            disabled={disabled || !selectedAction}
            className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900 disabled:opacity-40"
          />
          <span>Leads to Goal (Привів до голу)</span>
        </label>
      </div>
    </div>
  );
};
