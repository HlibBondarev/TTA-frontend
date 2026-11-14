import { useEffect, useRef, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useSelector } from "react-redux";
import { liveQuery } from "dexie";
import DOMPurify from "dompurify";
import {
  db,
  type MatchLineupLookup,
  type EventDefinitionLookup,
} from "../../../db/ttaDatabase";
import { parseSvgDimensions } from "../../../utils/svgUtils";
import type { ActionEntry } from "../store/matchSlice";
import type { RootState } from "../../../store";
import { useGameEvents } from "./useGameEvents";

export interface UseEditGameEventModalOptions {
  action: ActionEntry;
  matchId: string;
  onClose: () => void;
}

interface AuthStateShape {
  auth?: {
    user?: { id?: string };
    currentUserId?: string;
  };
}

export const checkIsPositive = (def: EventDefinitionLookup): boolean => {
  const value =
    def.isPositive ?? (def as unknown as Record<string, unknown>).ispositive;
  return !!value;
};

const selectReduxUserId = (state: RootState): string | undefined => {
  const auth = (state as unknown as AuthStateShape).auth;
  return auth?.currentUserId ?? auth?.user?.id;
};

async function loadSportDefinitions(
  sportId: string,
  currentUserId?: string,
  currentEventDefId?: string,
): Promise<EventDefinitionLookup[]> {
  let defs: EventDefinitionLookup[] = [];
  let hasPresets = false;
  const normalizedUserId = currentUserId?.trim();

  if (db.usereventpresets && normalizedUserId) {
    const presets = await db.usereventpresets
      .where({ userId: normalizedUserId, sportId })
      .toArray();

    hasPresets = presets.length > 0;

    const enabledDefIds = presets
      .filter((p) => p.isEnabled)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => p.eventDefinitionId);

    if (enabledDefIds.length > 0) {
      const presetDefs = await db.eventdefinitions.bulkGet(enabledDefIds);
      defs = presetDefs.filter(
        (d): d is EventDefinitionLookup => d !== undefined,
      );
    }
  }

  // Fallback if no presets exist: get default active definitions for this sport ordered by sortOrder
  if (!hasPresets) {
    const sportDefs = await db.eventdefinitions
      .where("sportId")
      .equals(sportId)
      .toArray();
    defs = sportDefs
      .filter((d) => !d.ownerId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  // Ensure current action definition is present even if disabled/unpreset
  if (currentEventDefId && !defs.some((d) => d.id === currentEventDefId)) {
    const currentDef = await db.eventdefinitions.get(currentEventDefId);
    if (currentDef) {
      defs.push(currentDef);
    }
  }

  return defs;
}

interface MatchSportDetails {
  playground: string | null;
  shotMap: string | null;
  eventDefinitions: EventDefinitionLookup[];
  configurationId?: string | null;
}

async function fetchMatchSportDetails(
  matchId: string,
  currentUserId?: string,
  currentEventDefId?: string,
): Promise<MatchSportDetails> {
  const match = await db.matches.get(matchId);
  if (!match?.tournamentId) {
    return {
      playground: null,
      shotMap: null,
      eventDefinitions: [],
      configurationId: null,
    };
  }

  const tournament = await db.tournaments.get(match.tournamentId);
  if (!tournament) {
    return {
      playground: null,
      shotMap: null,
      eventDefinitions: [],
      configurationId: null,
    };
  }

  let playground: string | null = null;
  let shotMap: string | null = null;
  const configurationId = tournament.configurationId ?? null;

  if (configurationId) {
    const config = await db.sportconfigurations.get(configurationId);
    playground = config?.playground ?? null;
    shotMap = config?.shotMap ?? null;
  }

  let eventDefinitions: EventDefinitionLookup[] = [];
  if (tournament.sportId) {
    eventDefinitions = await loadSportDefinitions(
      tournament.sportId,
      currentUserId,
      currentEventDefId,
    );
  }

  return { playground, shotMap, eventDefinitions, configurationId };
}

interface InitialShotLoadState {
  isShot: boolean | null;
  shotX: number | null;
  shotY: number | null;
}

function applyInitialFieldLocation(
  evt: { locationX?: number | null; locationY?: number | null },
  isEdited: boolean,
  setX: (val: number) => void,
  setY: (val: number) => void,
): void {
  if (isEdited) return;
  if (typeof evt.locationX === "number") {
    setX(evt.locationX);
  }
  if (typeof evt.locationY === "number") {
    setY(evt.locationY);
  }
}

function applyInitialShotLocation(
  evt: { shotLocationX?: number | null; shotLocationY?: number | null },
  loadState: InitialShotLoadState,
  isEdited: boolean,
  setShotX: (val: number) => void,
  setShotY: (val: number) => void,
): void {
  const canApplyImmediately = loadState.isShot === true && !isEdited;
  if (typeof evt.shotLocationX === "number") {
    loadState.shotX = evt.shotLocationX;
    if (canApplyImmediately) {
      setShotX(evt.shotLocationX);
    }
  }
  if (typeof evt.shotLocationY === "number") {
    loadState.shotY = evt.shotLocationY;
    if (canApplyImmediately) {
      setShotY(evt.shotLocationY);
    }
  }
}

export function useEditGameEventModal({
  action,
  matchId,
  onClose,
}: UseEditGameEventModalOptions) {
  const { user } = useAuth0();
  const auth0UserId = user?.sub ?? user?.email;
  const reduxUserId = useSelector(selectReduxUserId);
  const currentUserId = auth0UserId || reduxUserId;

  const { updateGameEvent } = useGameEvents(matchId);

  const [lineups, setLineups] = useState<MatchLineupLookup[]>([]);
  const [eventDefinitions, setEventDefinitions] = useState<
    EventDefinitionLookup[]
  >([]);
  const [playground, setPlayground] = useState<string | null>(null);
  const [shotMap, setShotMap] = useState<string | null>(null);
  const [configurationId, setConfigurationId] = useState<string | null>(null);

  const [selectedMatchLineupId, setSelectedMatchLineupId] = useState<string>(
    action.matchLineupId,
  );
  const [selectedActionName, setSelectedActionName] = useState<string>(
    action.actionName,
  );
  const [selectedEventDefinitionId, setSelectedEventDefinitionId] =
    useState<string>(action.eventDefinitionId);
  const [isPositive, setIsPositive] = useState<boolean>(action.isPositive);
  const [activeTab, setActiveTab] = useState<
    "positive" | "negative" | "map" | "shots"
  >(action.isPositive ? "positive" : "negative");

  const [locationX, setLocationX] = useState<number | null>(null);
  const [locationY, setLocationY] = useState<number | null>(null);
  const [shotLocationX, setShotLocationX] = useState<number | null>(null);
  const [shotLocationY, setShotLocationY] = useState<number | null>(null);
  const [isLocationLoaded, setIsLocationLoaded] = useState(false);
  const [isDefinitionsLoaded, setIsDefinitionsLoaded] = useState(false);

  const isLocationEditedRef = useRef(false);
  const isShotLocationEditedRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    isLocationEditedRef.current = false;
    isShotLocationEditedRef.current = false;
  }, [action.id, action.eventDefinitionId, matchId]);

  useEffect(() => {
    let isMounted = true;
    const initialLoadState: InitialShotLoadState = {
      isShot: null,
      shotX: null,
      shotY: null,
    };

    // Load existing event spatial and shot target coordinates from Dexie DB
    db.gameevents
      .get(action.id)
      .then((evt) => {
        if (!isMounted) return;
        if (evt) {
          applyInitialFieldLocation(
            evt,
            isLocationEditedRef.current,
            setLocationX,
            setLocationY,
          );
          applyInitialShotLocation(
            evt,
            initialLoadState,
            isShotLocationEditedRef.current,
            setShotLocationX,
            setShotLocationY,
          );
        }
        setIsLocationLoaded(true);
      })
      .catch(() => {
        if (isMounted) {
          setError("Failed to load event coordinates.");
          setIsLocationLoaded(false);
        }
      });

    // Load match, tournament, sport configuration, SVGs and active event definitions
    const loadMatchData = async () => {
      try {
        const details = await fetchMatchSportDetails(
          matchId,
          currentUserId,
          action.eventDefinitionId,
        );
        if (!isMounted) return;

        if (details.playground) setPlayground(details.playground);
        if (details.shotMap) setShotMap(details.shotMap);
        if (details.configurationId)
          setConfigurationId(details.configurationId);
        if (details.eventDefinitions.length > 0) {
          setEventDefinitions(details.eventDefinitions);
        }

        const initialEventDef = details.eventDefinitions.find(
          (def) => def.id === action.eventDefinitionId,
        );
        initialLoadState.isShot = Boolean(initialEventDef?.isShot);

        if (initialLoadState.isShot && !isShotLocationEditedRef.current) {
          if (typeof initialLoadState.shotX === "number") {
            setShotLocationX(initialLoadState.shotX);
          }
          if (typeof initialLoadState.shotY === "number") {
            setShotLocationY(initialLoadState.shotY);
          }
        }

        setIsDefinitionsLoaded(true);
      } catch {
        if (isMounted) {
          setError("Failed to load match or sport definitions.");
          setIsDefinitionsLoaded(false);
        }
      }
    };

    void loadMatchData();

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

  // Real-time subscription to sport configuration changes via Dexie liveQuery
  useEffect(() => {
    if (!configurationId) return;

    const subscription = liveQuery(() =>
      db.sportconfigurations.get(configurationId),
    ).subscribe({
      next: (config) => {
        if (config) {
          setPlayground(config.playground ?? null);
          setShotMap(config.shotMap ?? null);
        }
      },
      error: (err) => {
        console.error("Failed to observe sport configuration changes:", err);
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [configurationId]);

  const selectedEventDef = eventDefinitions.find(
    (def) => def.id === selectedEventDefinitionId,
  );
  const isShotDefinition = Boolean(selectedEventDef?.isShot);

  const hasLocation =
    typeof locationX === "number" && typeof locationY === "number";

  const hasShotLocation =
    typeof shotLocationX === "number" && typeof shotLocationY === "number";

  const isShotMapValid = Boolean(
    shotMap &&
    DOMPurify.sanitize(shotMap, {
      USE_PROFILES: { svg: true, svgFilters: true },
    }) &&
    parseSvgDimensions(shotMap),
  );

  const isShotSelected =
    isShotDefinition && (isShotMapValid || hasShotLocation);

  // Fallback away from "shots" tab if action is changed, definition lacks isShot, or shot map & target become unavailable
  if (activeTab === "shots" && !isShotSelected) {
    setActiveTab(isPositive ? "positive" : "negative");
  }

  const positiveActions = eventDefinitions.filter((def) =>
    checkIsPositive(def),
  );
  const negativeActions = eventDefinitions.filter(
    (def) => !checkIsPositive(def),
  );
  const displayedActions =
    activeTab === "positive" ? positiveActions : negativeActions;

  const effectiveActionName = selectedEventDef?.name ?? selectedActionName;
  const isGoalAction = effectiveActionName.trim().toLowerCase() === "goal";

  const handleActionSelect = (def: EventDefinitionLookup) => {
    const isPos = checkIsPositive(def);
    setSelectedActionName(def.name);
    setSelectedEventDefinitionId(def.id);
    setIsPositive(isPos);

    if (!def.isShot) {
      isShotLocationEditedRef.current = true;
      setShotLocationX(null);
      setShotLocationY(null);
      if (activeTab === "shots") {
        setActiveTab(isPos ? "positive" : "negative");
      }
    }
  };

  const handleTabClick = (tab: "positive" | "negative" | "map" | "shots") => {
    if (activeTab !== tab) {
      setActiveTab(tab);
    }
  };

  const handleLocationSelect = (x: number | null, y: number | null) => {
    isLocationEditedRef.current = true;
    setLocationX(x);
    setLocationY(y);
  };

  const handleShotLocationSelect = (x: number | null, y: number | null) => {
    if (isSaving) return;
    isShotLocationEditedRef.current = true;
    setShotLocationX(x);
    setShotLocationY(y);
  };

  const handleSave = async () => {
    if (
      !selectedMatchLineupId ||
      !effectiveActionName ||
      !selectedEventDefinitionId ||
      isSaving ||
      !isLocationLoaded ||
      !isDefinitionsLoaded
    )
      return;

    // Set explicit error if definitions have loaded but the selected definition is missing
    if (!selectedEventDef) {
      setError("Selected action definition was not found.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await updateGameEvent({
        eventId: action.id,
        selectedPlayerId: selectedMatchLineupId,
        actionName: effectiveActionName,
        eventDefinitionId: selectedEventDefinitionId,
        isPositive,
        isLeadToGoal: isGoalAction ? false : action.isLeadToGoal,
        locationX,
        locationY,
        shotLocationX: isShotDefinition ? shotLocationX : null,
        shotLocationY: isShotDefinition ? shotLocationY : null,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update action.");
    } finally {
      setIsSaving(false);
    }
  };

  return {
    lineups,
    displayedActions,
    playground,
    shotMap,
    selectedMatchLineupId,
    selectedEventDefinitionId,
    activeTab,
    locationX,
    locationY,
    shotLocationX,
    shotLocationY,
    hasLocation,
    hasShotLocation,
    isShotSelected,
    isLocationLoaded,
    isDefinitionsLoaded,
    isSaving,
    error,
    setSelectedMatchLineupId,
    handleActionSelect,
    handleTabClick,
    handleLocationSelect,
    handleShotLocationSelect,
    handleSave,
  };
}
