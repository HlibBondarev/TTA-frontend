import React from "react";
import type { ActionEntry } from "../store/matchSlice";
import { ModalDialog } from "./ModalDialog";
import { InteractivePlayground } from "./InteractivePlayground";
import { useEditGameEventModal } from "../hooks/useEditGameEventModal";

interface EditGameEventModalProps {
  isOpen: boolean;
  action: ActionEntry | null;
  matchId: string;
  onClose: () => void;
}

const EditGameEventModalContent: React.FC<{
  action: ActionEntry;
  matchId: string;
  onClose: () => void;
}> = ({ action, matchId, onClose }) => {
  const {
    lineups,
    displayedActions,
    playgroundSvg,
    selectedMatchLineupId,
    selectedEventDefinitionId,
    activeTab,
    locationX,
    locationY,
    hasLocation,
    isLocationLoaded,
    isSaving,
    error,
    setSelectedMatchLineupId,
    handleActionSelect,
    handleTabClick,
    handleLocationSelect,
    handleSave,
  } = useEditGameEventModal({ action, matchId, onClose });

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
          <div className="grid grid-cols-5 gap-1.5 max-h-36 overflow-y-auto pr-1">
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

        {/* Action Type & Location Navigation Tabs */}
        <div>
          <div className="flex border-b border-gray-800 mb-2">
            <button
              type="button"
              onClick={() => handleTabClick("positive")}
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
              onClick={() => handleTabClick("negative")}
              className={`flex-1 py-1.5 text-[11px] font-bold uppercase transition-all ${
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
              className={`flex-1 py-1.5 text-[11px] font-bold uppercase transition-all flex items-center justify-center space-x-1 ${
                activeTab === "map"
                  ? "text-blue-400 border-b-2 border-blue-400"
                  : "text-gray-500"
              }`}
            >
              <span>Map</span>
              {hasLocation && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              )}
            </button>
          </div>

          {activeTab === "map" ? (
            <InteractivePlayground
              playgroundSvg={playgroundSvg}
              locationX={locationX}
              locationY={locationY}
              onLocationSelect={handleLocationSelect}
            />
          ) : (
            <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-1">
              {displayedActions.map((def) => {
                const isSelected =
                  Boolean(def.id) && selectedEventDefinitionId === def.id;
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
          )}
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
            !isLocationLoaded ||
            !selectedMatchLineupId ||
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
