import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useAuth0 } from "@auth0/auth0-react";
import { liveQuery } from "dexie";
import { db, type EventDefinitionLookup } from "../../../db/ttaDatabase";
import {
  clearEventDefinitionsCache,
  isSportHydratedForUser,
} from "../../../db/eventService";
import type { RootState } from "../../../store";
import { parseSvgDimensions } from "../../../utils/svgUtils";

export interface UseTTAPanelOptions {
  userId?: string;
  selectedActionDefinitionId?: string | null;
  hasShotLocation?: boolean;
}

const checkIsPositive = (def: EventDefinitionLookup): boolean => {
  const value =
    def.isPositive ?? (def as unknown as Record<string, unknown>).ispositive;
  return !!value;
};

async function getMatchSportAndConfig(tournamentId?: string | null) {
  if (!tournamentId) return { targetSportId: null, targetConfigId: null };
  const tournament = await db.tournaments.get(tournamentId);
  return {
    targetSportId: tournament?.sportId || null,
    targetConfigId: tournament?.configurationId || null,
  };
}

async function getSvgs(targetConfigId: string | null) {
  if (!targetConfigId) return { playground: null, shotMap: null };
  const sportConfig = await db.sportconfigurations.get(targetConfigId);
  return {
    playground: sportConfig?.playground || null,
    shotMap: sportConfig?.shotMap ?? null,
  };
}

async function fetchDefaultSportDefinitions(
  targetSportId: string,
): Promise<EventDefinitionLookup[]> {
  const sportDefs = await db.eventdefinitions
    .where("sportId")
    .equals(targetSportId)
    .toArray();
  return sportDefs
    .filter((d) => !d.ownerId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

async function getEventDefinitionsForSport(
  targetSportId: string,
  normalizedUserId: string,
): Promise<EventDefinitionLookup[]> {
  if (!db.usereventpresets) {
    return fetchDefaultSportDefinitions(targetSportId);
  }

  const presets = await db.usereventpresets
    .where({ userId: normalizedUserId, sportId: targetSportId })
    .toArray();

  if (presets.length === 0) {
    return fetchDefaultSportDefinitions(targetSportId);
  }

  const enabledDefIds = presets
    .filter((p) => p.isEnabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => p.eventDefinitionId);

  if (enabledDefIds.length === 0) return [];

  const defs = await db.eventdefinitions.bulkGet(enabledDefIds);
  return defs.filter((d): d is EventDefinitionLookup => d !== undefined);
}

export function useTTAPanel(options?: UseTTAPanelOptions) {
  const activeMatchId = useSelector(
    (state: RootState) => state.match.activeMatchId,
  );
  const hydrationVersion = useSelector(
    (state: RootState) => state.match.hydrationVersion,
  );
  const { user } = useAuth0();
  const auth0UserId = user?.sub || user?.id;
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
  const currentUserId = options?.userId?.trim() || auth0UserId || reduxUserId;

  const [activeTab, setActiveTab] = useState<
    "positive" | "negative" | "map" | "shots"
  >("positive");
  const [eventDefinitions, setEventDefinitions] = useState<
    EventDefinitionLookup[]
  >([]);
  const [playground, setPlayground] = useState<string | null>(null);
  const [shotMap, setShotMap] = useState<string | null>(null);
  const [prevActiveMatchId, setPrevActiveMatchId] = useState(activeMatchId);
  const [prevUserId, setPrevUserId] = useState(currentUserId);

  if (prevActiveMatchId !== activeMatchId || prevUserId !== currentUserId) {
    setPrevActiveMatchId(activeMatchId);
    setPrevUserId(currentUserId);
    setEventDefinitions([]);
    setPlayground(null);
    setShotMap(null);
    clearEventDefinitionsCache();
  }

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const emptyResult = {
        definitions: [],
        playground: null,
        shotMap: null,
      };
      if (!activeMatchId) return emptyResult;

      const normalizedUserId = currentUserId?.trim();
      if (!normalizedUserId) return emptyResult;

      const match = await db.matches.get(activeMatchId);
      if (!match || (match.userId && match.userId !== normalizedUserId)) {
        return emptyResult;
      }

      const { targetSportId, targetConfigId } = await getMatchSportAndConfig(
        match.tournamentId,
      );
      if (!targetSportId) return emptyResult;

      const { playground: loadedPlayground, shotMap: loadedShotMap } =
        await getSvgs(targetConfigId);

      const isHydrated = await isSportHydratedForUser(
        targetSportId,
        normalizedUserId,
      );
      if (!isHydrated) {
        return {
          definitions: [],
          playground: loadedPlayground,
          shotMap: loadedShotMap,
        };
      }

      const loadedDefinitions = await getEventDefinitionsForSport(
        targetSportId,
        normalizedUserId,
      );

      return {
        definitions: loadedDefinitions,
        playground: loadedPlayground,
        shotMap: loadedShotMap,
      };
    }).subscribe({
      next: (data) => {
        setEventDefinitions(data?.definitions || []);
        setPlayground(data?.playground || null);
        setShotMap(data?.shotMap || null);
      },
      error: (err) => {
        console.error("Failed to load event definitions from Dexie:", err);
        setEventDefinitions([]);
        setPlayground(null);
        setShotMap(null);
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [activeMatchId, currentUserId, hydrationVersion]);

  const selectedActionDef = eventDefinitions.find(
    (def) => def.id === options?.selectedActionDefinitionId,
  );

  const isShotSelected =
    Boolean(selectedActionDef?.isShot) &&
    (Boolean(parseSvgDimensions(shotMap)) || Boolean(options?.hasShotLocation));

  // Switch away from "shots" tab during render if current action is no longer a shot
  if (activeTab === "shots" && !isShotSelected) {
    const fallbackTab =
      selectedActionDef && !checkIsPositive(selectedActionDef)
        ? "negative"
        : "positive";
    setActiveTab(fallbackTab);
  }

  const positiveActions = eventDefinitions.filter((def) =>
    checkIsPositive(def),
  );
  const negativeActions = eventDefinitions.filter(
    (def) => !checkIsPositive(def),
  );

  const displayedActions =
    activeTab === "positive" ? positiveActions : negativeActions;

  return {
    activeTab,
    setActiveTab,
    displayedActions,
    checkIsPositive,
    playground,
    shotMap,
    isShotSelected,
  };
}
