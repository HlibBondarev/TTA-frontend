import { useEffect, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useSelector } from "react-redux";
import {
  db,
  type MatchLineupLookup,
  type EventDefinitionLookup,
} from "../../../db/ttaDatabase";
import type { ActionEntry } from "../store/matchSlice";
import type { RootState } from "../../../store";
import { useGameEvents } from "./useGameEvents";

export interface UseEditGameEventModalOptions {
  action: ActionEntry;
  matchId: string;
  onClose: () => void;
}

export const checkIsPositive = (def: EventDefinitionLookup): boolean => {
  const value =
    def.isPositive ?? (def as unknown as Record<string, unknown>).ispositive;
  return !!value;
};

export function useEditGameEventModal({
  action,
  matchId,
  onClose,
}: UseEditGameEventModalOptions) {
  const { user } = useAuth0();
  const auth0UserId = user?.sub ?? user?.email;
  const reduxUserId = useSelector(
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
  const currentUserId = auth0UserId || reduxUserId;

  const { updateGameEvent } = useGameEvents(matchId);

  const [lineups, setLineups] = useState<MatchLineupLookup[]>([]);
  const [eventDefinitions, setEventDefinitions] = useState<
    EventDefinitionLookup[]
  >([]);
  const [playgroundSvg, setPlaygroundSvg] = useState<string | null>(null);

  const [selectedMatchLineupId, setSelectedMatchLineupId] = useState<string>(
    action.matchLineupId,
  );
  const [selectedActionName, setSelectedActionName] = useState<string>(
    action.actionName,
  );
  const [selectedEventDefinitionId, setSelectedEventDefinitionId] =
    useState<string>(action.eventDefinitionId);
  const [isPositive, setIsPositive] = useState<boolean>(action.isPositive);
  const [activeTab, setActiveTab] = useState<"positive" | "negative" | "map">(
    action.isPositive ? "positive" : "negative",
  );

  const [locationX, setLocationX] = useState<number | null>(null);
  const [locationY, setLocationY] = useState<number | null>(null);
  const [isLocationLoaded, setIsLocationLoaded] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Load existing event spatial coordinates from Dexie DB
    db.gameevents
      .get(action.id)
      .then((evt) => {
        if (!isMounted) return;
        if (evt) {
          if (typeof evt.locationX === "number") setLocationX(evt.locationX);
          if (typeof evt.locationY === "number") setLocationY(evt.locationY);
        }
        setIsLocationLoaded(true);
      })
      .catch(() => {
        if (isMounted) {
          setError("Failed to load event coordinates.");
          setIsLocationLoaded(false);
        }
      });

    // Load match, tournament, sport configuration, playground SVG and active event definitions
    db.matches
      .get(matchId)
      .then(async (m) => {
        if (!isMounted || !m?.tournamentId) return;
        const tour = await db.tournaments.get(m.tournamentId);
        if (!tour) return;

        // Load Playground SVG if configuration exists
        if (tour.configurationId) {
          const config = await db.sportconfigurations.get(tour.configurationId);
          if (isMounted && config?.playground) {
            setPlaygroundSvg(config.playground);
          }
        }

        // Load active event definitions for this match's sport
        if (tour.sportId) {
          let defs: EventDefinitionLookup[] = [];
          const normalizedUserId = currentUserId?.trim();

          if (db.usereventpresets && normalizedUserId) {
            const presets = await db.usereventpresets
              .where({ userId: normalizedUserId, sportId: tour.sportId })
              .toArray();

            const enabledDefIds = presets
              .filter((p) => p.isEnabled)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((p) => p.eventDefinitionId);

            if (enabledDefIds.length > 0) {
              const presetDefs =
                await db.eventdefinitions.bulkGet(enabledDefIds);
              defs = presetDefs.filter(
                (d): d is EventDefinitionLookup => d !== undefined,
              );
            }
          }

          // Fallback if no presets found: get default active definitions for this sport
          if (defs.length === 0) {
            const sportDefs = await db.eventdefinitions
              .where("sportId")
              .equals(tour.sportId)
              .toArray();
            defs = sportDefs.filter((d) => !d.ownerId);
          }

          // Ensure current action definition is present even if disabled/unpreset
          if (
            action.eventDefinitionId &&
            !defs.some((d) => d.id === action.eventDefinitionId)
          ) {
            const currentDef = await db.eventdefinitions.get(
              action.eventDefinitionId,
            );
            if (currentDef) {
              defs.push(currentDef);
            }
          }

          if (isMounted) {
            setEventDefinitions(defs);
          }
        }
      })
      .catch(() => {
        if (isMounted) setError("Failed to load match or sport definitions.");
      });

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

    return () => {
      isMounted = false;
    };
  }, [action.id, action.eventDefinitionId, matchId, currentUserId]);

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

  const handleTabClick = (tab: "positive" | "negative" | "map") => {
    if (activeTab !== tab) {
      const isCategorySwitch =
        (activeTab === "positive" && tab === "negative") ||
        (activeTab === "negative" && tab === "positive");

      setActiveTab(tab);

      if (isCategorySwitch) {
        setSelectedActionName("");
        setSelectedEventDefinitionId("");
      }
    }
  };

  const handleLocationSelect = (x: number | null, y: number | null) => {
    setLocationX(x);
    setLocationY(y);
  };

  const handleSave = async () => {
    if (
      !selectedMatchLineupId ||
      !selectedActionName ||
      !selectedEventDefinitionId ||
      isSaving ||
      !isLocationLoaded
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
        locationX,
        locationY,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update action.");
    } finally {
      setIsSaving(false);
    }
  };

  const hasLocation =
    typeof locationX === "number" && typeof locationY === "number";

  return {
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
  };
}
