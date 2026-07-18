import React from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../../../store";

export const ActionsLog: React.FC = () => {
  const recentActions = useSelector(
    (state: RootState) => state.match?.recentActions,
  );

  return (
    <div className="w-full bg-gray-950 border-b border-gray-800 p-2">
      <h4 className="text-[9px] uppercase text-gray-500 font-bold mb-1 tracking-widest">
        Last Actions
      </h4>
      {/* Updated to h-25 for canonical 100px height */}
      <div className="h-25 overflow-y-auto space-y-1 pr-1 border border-gray-900 rounded bg-gray-900/50">
        {recentActions?.map((action) => (
          <div
            key={action.id}
            className="flex justify-between items-center text-[10px] font-mono border-b border-gray-800 pb-0.5"
          >
            <span
              className={
                action.isPositive ? "text-emerald-400" : "text-rose-400"
              }
            >
              {`#${action.playerNumber} ${action.actionName}`}
            </span>
            <span className="text-gray-600">
              {new Date(action.timestamp).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
