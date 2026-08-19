import React, { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { db } from "../../../db/ttaDatabase";
import { useAppSelector } from "../../../hooks/hooks";
import { type ActionEntry } from "../store/matchSlice";
import { useGameEvents } from "../hooks/useGameEvents";
import { EditGameEventModal } from "./EditGameEventModal";
import { ModalDialog } from "./ModalDialog";

export const ActionsLog: React.FC = () => {
  const activeMatchId = useAppSelector((state) => state.match.activeMatchId);
  const recentActions = useAppSelector((state) => state.match.recentActions);

  const { updateGameEvent, deleteGameEvent } = useGameEvents(
    activeMatchId || "",
  );

  const [editingAction, setEditingAction] = useState<ActionEntry | null>(null);
  const [actionToDelete, setActionToDelete] = useState<ActionEntry | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [syncedMap, setSyncedMap] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!error) return;

    const timer = setTimeout(() => {
      setError(null);
    }, 2000);

    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!db?.gameevents) return;

    const subscription = liveQuery(async () => {
      if (!db?.gameevents || recentActions.length === 0) return {};
      try {
        const ids = recentActions.map((a) => a.id);
        const events = await db.gameevents.where("id").anyOf(ids).toArray();
        const map: Record<string, number> = {};
        events?.forEach((e) => {
          map[e.id] = e.isSynced;
        });
        return map;
      } catch {
        return {};
      }
    }).subscribe({
      next: (map) => setSyncedMap(map || {}),
      error: (err) => console.error("Failed to query synced events:", err),
    });

    return () => subscription.unsubscribe();
  }, [recentActions]);

  const isActionSynced = (action: ActionEntry): boolean => {
    const dbSynced = syncedMap[action.id];
    if (dbSynced !== undefined) {
      return dbSynced === 1;
    }
    return Boolean(
      action.isSynced === 1 || (action.isSynced as unknown) === true,
    );
  };

  const handleToggleLeadToGoal = async (action: ActionEntry) => {
    if (isActionSynced(action)) {
      setError("Cannot edit a synchronized event.");
      return;
    }

    try {
      setError(null);
      await updateGameEvent({
        eventId: action.id,
        selectedPlayerId: action.matchLineupId,
        actionName: action.actionName,
        isPositive: action.isPositive,
        isLeadToGoal: !action.isLeadToGoal,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update Goal Lead flag.",
      );
    }
  };

  const handleDeleteClick = (action: ActionEntry) => {
    if (isActionSynced(action)) {
      setError("Cannot delete a synchronized event.");
      return;
    }
    setError(null);
    setActionToDelete(action);
  };

  const handleConfirmDelete = async () => {
    if (!actionToDelete) return;

    if (isActionSynced(actionToDelete)) {
      setError("Cannot delete a synchronized event.");
      setActionToDelete(null);
      return;
    }

    try {
      setError(null);
      await deleteGameEvent(actionToDelete.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete game event.",
      );
    } finally {
      setActionToDelete(null);
    }
  };

  const handleOpenEditModal = (action: ActionEntry) => {
    if (isActionSynced(action)) {
      setError("Cannot edit a synchronized event.");
      return;
    }
    setError(null);
    setEditingAction(action);
  };

  return (
    <>
      <div className="w-full bg-gray-950 border-b border-gray-800 p-2">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-[9px] uppercase text-gray-500 font-bold tracking-widest">
            Last Actions
          </h4>
          {error && (
            <span
              className="text-[9px] text-red-400 font-semibold truncate max-w-48 transition-opacity duration-300"
              role="alert"
            >
              {error}
            </span>
          )}
        </div>

        <div className="h-32 overflow-y-auto space-y-1 pr-1 border border-gray-900 rounded bg-gray-900/50">
          {recentActions.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[11px] text-gray-600 italic">
              No actions recorded yet.
            </div>
          ) : (
            recentActions.map((act) => {
              const formattedTime = new Date(act.timestamp).toLocaleTimeString(
                [],
                {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                },
              );

              const isGoalAction =
                act.actionName.trim().toLowerCase() === "goal";
              const isSynced = isActionSynced(act);

              return (
                <div
                  key={act.id}
                  className="flex justify-between items-center text-[10px] font-mono border-b border-gray-800/80 pb-1 pt-0.5 px-1"
                >
                  <div className="flex items-center space-x-1.5 min-w-0">
                    <span
                      className={`font-bold ${
                        act.isPositive ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      #{act.playerNumber} {act.actionName}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <label
                      className={`flex items-center space-x-1 text-[9px] ${
                        isSynced || isGoalAction
                          ? "text-gray-600 cursor-not-allowed"
                          : "text-gray-400 cursor-pointer"
                      }`}
                      title={
                        isSynced
                          ? "Cannot edit synchronized event"
                          : isGoalAction
                            ? "Goal action cannot lead to goal"
                            : "Toggle Leads to Goal"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={act.isLeadToGoal}
                        disabled={isSynced || isGoalAction}
                        onChange={() => handleToggleLeadToGoal(act)}
                        aria-label={`Toggle leads to goal for action #${act.playerNumber} ${act.actionName}`}
                        className="w-3 h-3 rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-0 disabled:opacity-30"
                      />
                      <span>GL</span>
                    </label>

                    <span
                      className="w-4 inline-flex justify-center text-[10px] select-none"
                      title={
                        isSynced ? "Synchronized event (locked)" : undefined
                      }
                    >
                      {isSynced ? (
                        <span className="text-yellow-500/80" aria-hidden="true">
                          🔒
                        </span>
                      ) : null}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(act)}
                      className={`p-0.5 transition-colors ${
                        isSynced
                          ? "text-gray-600 hover:text-gray-500 cursor-pointer"
                          : "text-gray-400 hover:text-blue-400"
                      }`}
                      title={
                        isSynced ? "Cannot edit synced event" : "Edit Action"
                      }
                      aria-label={`Edit action #${act.playerNumber} ${act.actionName}`}
                    >
                      <span aria-hidden="true">✏️</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteClick(act)}
                      className={`p-0.5 transition-colors ${
                        isSynced
                          ? "text-gray-600 hover:text-gray-500 cursor-pointer"
                          : "text-gray-400 hover:text-rose-400"
                      }`}
                      title={
                        isSynced
                          ? "Cannot delete synced event"
                          : "Delete Action"
                      }
                      aria-label={`Delete action #${act.playerNumber} ${act.actionName}`}
                    >
                      <span aria-hidden="true">🗑️</span>
                    </button>

                    <span className="text-gray-600 text-[9px]">
                      {formattedTime}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {editingAction && activeMatchId && (
        <EditGameEventModal
          isOpen={Boolean(editingAction)}
          action={editingAction}
          matchId={activeMatchId}
          onClose={() => setEditingAction(null)}
        />
      )}

      {actionToDelete && (
        <ModalDialog
          isOpen={Boolean(actionToDelete)}
          onClose={() => setActionToDelete(null)}
          titleId="delete-action-title"
          title="Delete Action"
          titleClassName="text-rose-400"
          maxWidthClass="max-w-sm"
        >
          <p className="text-xs text-gray-300">
            Are you sure you want to delete this action? (#
            {actionToDelete.playerNumber} {actionToDelete.actionName})
          </p>

          <div className="flex space-x-2 pt-2">
            <button
              type="button"
              onClick={() => setActionToDelete(null)}
              className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-bold uppercase transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              className="flex-1 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold uppercase transition-all"
            >
              Delete
            </button>
          </div>
        </ModalDialog>
      )}
    </>
  );
};
