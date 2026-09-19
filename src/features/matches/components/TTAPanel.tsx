import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { liveQuery } from "dexie";
import { db, type EventDefinitionLookup } from "../../../db/ttaDatabase";
import { clearEventDefinitionsCache } from "../../../db/eventService";
import type { RootState } from "../../../store";

interface TTDActionsPanelProps {
  onActionSelect: (action: string, isPositive: boolean) => void;
  selectedAction: string | null;
  disabled: boolean;
}

// Helper to safely evaluate isPositive supporting both camelCase and legacy keys
const checkIsPositive = (def: EventDefinitionLookup): boolean => {
  const value =
    def.isPositive ?? (def as unknown as Record<string, unknown>).ispositive;
  return !!value;
};

export const TTDActionsPanel: React.FC<TTDActionsPanelProps> = ({
  onActionSelect,
  selectedAction,
  disabled,
}) => {
  const activeMatchId = useSelector(
    (state: RootState) => state.match.activeMatchId,
  );
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
  const [activeTab, setActiveTab] = useState<"positive" | "negative">(
    "positive",
  );
  const [eventDefinitions, setEventDefinitions] = useState<
    EventDefinitionLookup[]
  >([]);
  const [prevActiveMatchId, setPrevActiveMatchId] = useState(activeMatchId);
  const [prevUserId, setPrevUserId] = useState(currentUserId);

  // Synchronously adjust state during render when activeMatchId or user account changes
  if (prevActiveMatchId !== activeMatchId || prevUserId !== currentUserId) {
    setPrevActiveMatchId(activeMatchId);
    setPrevUserId(currentUserId);
    setEventDefinitions([]);
    clearEventDefinitionsCache();
  }

  // Reactive subscription to Dexie eventdefinitions table filtered by active sport and enabled state
  useEffect(() => {
    const subscription = liveQuery(async () => {
      if (!activeMatchId) return [];

      const match = await db.matches.get(activeMatchId);
      if (!match) return [];

      let targetSportId: string | null = null;
      if (match.tournamentId) {
        const tournament = await db.tournaments.get(match.tournamentId);
        if (tournament?.sportId) {
          targetSportId = tournament.sportId;
        }
      }

      if (!targetSportId) return [];

      const definitions = await db.eventdefinitions
        .where("sportId")
        .equals(targetSportId)
        .toArray();

      return definitions
        .filter((def) => def.isEnabled !== false)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }).subscribe({
      next: (definitions) => {
        setEventDefinitions(definitions || []);
      },
      error: (err) => {
        console.error("Failed to load event definitions from Dexie:", err);
        setEventDefinitions([]);
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [activeMatchId, currentUserId]);

  const positiveActions = eventDefinitions.filter((def) =>
    checkIsPositive(def),
  );
  const negativeActions = eventDefinitions.filter(
    (def) => !checkIsPositive(def),
  );

  const displayedActions =
    activeTab === "positive" ? positiveActions : negativeActions;

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

      {/* Dynamic Actions Grid from IndexedDB */}
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
              className={`p-2 min-h-11 rounded text-xs font-medium transition-all disabled:cursor-not-allowed ${buttonColorStyle}`}
            >
              {def.name}
            </button>
          );
        })}
      </div>
    </div>
  );
};
