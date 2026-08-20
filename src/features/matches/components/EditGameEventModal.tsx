import React, { useEffect, useState } from "react";
import {
  db,
  type MatchLineupLookup,
  type EventDefinitionLookup,
} from "../../../db/ttaDatabase";
import type { ActionEntry } from "../store/matchSlice";
import { useGameEvents } from "../hooks/useGameEvents";
import { ModalDialog } from "./ModalDialog";

interface EditGameEventModalProps {
  isOpen: boolean;
  action: ActionEntry | null;
  matchId: string;
  onClose: () => void;
}

const checkIsPositive = (def: EventDefinitionLookup): boolean => {
  const value =
    def.isPositive ?? (def as unknown as Record<string, unknown>).ispositive;
  return !!value;
};

const EditGameEventModalContent: React.FC<{
  action: ActionEntry;
  matchId: string;
  onClose: () => void;
}> = ({ action, matchId, onClose }) => {
  const { updateGameEvent } = useGameEvents(matchId);

  const [lineups, setLineups] = useState<MatchLineupLookup[]>([]);
  const [eventDefinitions, setEventDefinitions] = useState<
    EventDefinitionLookup[]
  >([]);

  const [selectedMatchLineupId, setSelectedMatchLineupId] = useState<string>(
    action.matchLineupId,
  );
  const [selectedActionName, setSelectedActionName] = useState<string>(
    action.actionName,
  );
  const [selectedEventDefinitionId, setSelectedEventDefinitionId] =
    useState<string>(action.eventDefinitionId);
  const [isPositive, setIsPositive] = useState<boolean>(action.isPositive);
  const [activeTab, setActiveTab] = useState<"positive" | "negative">(
    action.isPositive ? "positive" : "negative",
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    db.matchlineups
      .where("matchId")
      .equals(matchId)
      .toArray()
      .then((items) => {
        if (!isMounted) return;
        items.sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
        setLineups(items);
      })
      .catch(() => {
        if (isMounted) setError("Failed to load match roster.");
      });

    db.eventdefinitions
      .toArray()
      .then((defs) => {
        if (isMounted) setEventDefinitions(defs);
      })
      .catch(() => {
        if (isMounted) setError("Failed to load action definitions.");
      });

    return () => {
      isMounted = false;
    };
  }, [matchId]);

  const positiveActions = eventDefinitions.filter((def) =>
    checkIsPositive(def),
  );
  const negativeActions = eventDefinitions.filter(
    (def) => !checkIsPositive(def),
  );
  const displayedActions =
    activeTab === "positive" ? positiveActions : negativeActions;

  const isGoalAction = selectedActionName.trim().toLowerCase() === "goal";

  const handleActionSelect = (def: EventDefinitionLookup) => {
    const isPos = checkIsPositive(def);
    setSelectedActionName(def.name);
    setSelectedEventDefinitionId(def.id);
    setIsPositive(isPos);
  };

  const handleSave = async () => {
    if (
      !selectedMatchLineupId ||
      !selectedActionName ||
      !selectedEventDefinitionId ||
      isSaving
    )
      return;

    setIsSaving(true);
    setError(null);

    try {
      await updateGameEvent({
        eventId: action.id,
        selectedPlayerId: selectedMatchLineupId,
        actionName: selectedActionName,
        eventDefinitionId: selectedEventDefinitionId,
        isPositive,
        isLeadToGoal: isGoalAction ? false : action.isLeadToGoal,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update action.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalDialog
      isOpen={true}
      onClose={onClose}
      titleId="edit-game-event-title"
      title="Edit Action"
      titleClassName="text-blue-400"
      maxWidthClass="max-w-md"
    >
      <div className="space-y-3 overflow-y-auto pr-1">
        {error && (
          <div
            role="alert"
            className="text-[11px] text-red-400 bg-red-950/60 p-2 rounded border border-red-900"
          >
            {error}
          </div>
        )}

        {/* Player Roster Selection */}
        <div>
          <span className="block text-[10px] uppercase text-gray-400 font-bold mb-1">
            Player (Full Roster)
          </span>
          <div className="grid grid-cols-5 gap-1.5 max-h-48 overflow-y-auto pr-1">
            {lineups.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setSelectedMatchLineupId(l.id)}
                className={`p-1.5 min-h-10 rounded text-xs font-bold transition-all ${
                  selectedMatchLineupId === l.id
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                {`#${l.number ?? ""}`}
              </button>
            ))}
          </div>
        </div>

        {/* Action Type Selection */}
        <div>
          <div className="flex border-b border-gray-800 mb-2">
            <button
              type="button"
              onClick={() => setActiveTab("positive")}
              className={`flex-1 py-1.5 text-[11px] font-bold uppercase transition-all ${
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
              className={`flex-1 py-1.5 text-[11px] font-bold uppercase transition-all ${
                activeTab === "negative"
                  ? "text-rose-400 border-b-2 border-rose-400"
                  : "text-gray-500"
              }`}
            >
              Negative
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5 max-h-56 overflow-y-auto pr-1">
            {displayedActions.map((def) => {
              const isSelected = selectedActionName === def.name;
              return (
                <button
                  key={def.id || def.name}
                  type="button"
                  onClick={() => handleActionSelect(def)}
                  className={`p-2 min-h-10 rounded text-[11px] font-medium transition-all ${
                    isSelected
                      ? "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  {def.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex space-x-2 pt-2 border-t border-gray-800 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-bold uppercase transition-all"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={
            isSaving ||
            !selectedMatchLineupId ||
            !selectedActionName ||
            !selectedEventDefinitionId
          }
          className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 text-white rounded-lg text-xs font-bold uppercase transition-all"
        >
          Save
        </button>
      </div>
    </ModalDialog>
  );
};

export const EditGameEventModal: React.FC<EditGameEventModalProps> = ({
  isOpen,
  action,
  matchId,
  onClose,
}) => {
  if (!isOpen || !action) return null;

  return (
    <EditGameEventModalContent
      key={action.id}
      action={action}
      matchId={matchId}
      onClose={onClose}
    />
  );
};
