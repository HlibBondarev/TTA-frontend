import React from "react";

interface TTDActionsPanelProps {
  onActionSelect: (action: string, isPositive: boolean) => void;
  selectedAction: string | null;
  disabled: boolean;
}

export const TTDActionsPanel: React.FC<TTDActionsPanelProps> = ({
  onActionSelect,
  selectedAction,
  disabled,
}) => {
  const [activeTab, setActiveTab] = React.useState<"positive" | "negative">(
    "positive",
  );
  return (
    <div
      className={`w-full p-2 bg-gray-900 rounded-xl border border-gray-800 my-2 ${disabled ? "opacity-50 pointer-events-none" : ""}`}
    >
      <div className="flex border-b border-gray-800 mb-2">
        <button
          type="button"
          onClick={() => setActiveTab("positive")}
          className={`flex-1 py-2 text-xs font-bold uppercase ${activeTab === "positive" ? "text-emerald-400 border-b-2 border-emerald-400" : "text-gray-500"}`}
        >
          Positive
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("negative")}
          className={`flex-1 py-2 text-xs font-bold uppercase ${activeTab === "negative" ? "text-rose-400 border-b-2 border-rose-400" : "text-gray-500"}`}
        >
          Negative
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {activeTab === "positive"
          ? ["Goal", "Pass", "Save", "Block", "Steal"].map((act) => (
              <button
                type="button"
                key={act}
                onClick={() => onActionSelect(act, true)}
                className={`p-2 rounded text-xs transition-all ${selectedAction === act ? "bg-blue-600 text-white" : "bg-gray-800 text-emerald-200"}`}
              >
                {act}
              </button>
            ))
          : ["Miss", "Turnover", "Error", "Foul"].map((act) => (
              <button
                type="button"
                key={act}
                onClick={() => onActionSelect(act, false)}
                className={`p-2 rounded text-xs transition-all ${selectedAction === act ? "bg-blue-600 text-white" : "bg-gray-800 text-rose-200"}`}
              >
                {act}
              </button>
            ))}
      </div>
    </div>
  );
};
