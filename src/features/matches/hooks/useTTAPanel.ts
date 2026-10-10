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

export interface UseTTAPanelOptions {
  userId?: string;
}

const checkIsPositive = (def: EventDefinitionLookup): boolean => {
  const value =
    def.isPositive ?? (def as unknown as Record<string, unknown>).ispositive;
  return !!value;
};

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

  const [activeTab, setActiveTab] = useState<"positive" | "negative" | "map">(
    "positive",
  );
  const [eventDefinitions, setEventDefinitions] = useState<
    EventDefinitionLookup[]
  >([]);
  const [playgroundSvg, setPlaygroundSvg] = useState<string | null>(null);
  const [prevActiveMatchId, setPrevActiveMatchId] = useState(activeMatchId);
  const [prevUserId, setPrevUserId] = useState(currentUserId);

  if (prevActiveMatchId !== activeMatchId || prevUserId !== currentUserId) {
    setPrevActiveMatchId(activeMatchId);
    setPrevUserId(currentUserId);
    setEventDefinitions([]);
    setPlaygroundSvg(null);
    clearEventDefinitionsCache();
  }

  useEffect(() => {
    const subscription = liveQuery(async () => {
      if (!activeMatchId) return { definitions: [], playgroundSvg: null };

      const normalizedUserId = currentUserId?.trim();
      if (!normalizedUserId) return { definitions: [], playgroundSvg: null };

      const match = await db.matches.get(activeMatchId);
      if (!match) return { definitions: [], playgroundSvg: null };

      if (match.userId && match.userId !== normalizedUserId) {
        return { definitions: [], playgroundSvg: null };
      }

      let targetSportId: string | null = null;
      let targetConfigId: string | null = null;
      if (match.tournamentId) {
        const tournament = await db.tournaments.get(match.tournamentId);
        if (tournament?.sportId) {
          targetSportId = tournament.sportId;
        }
        if (tournament?.configurationId) {
          targetConfigId = tournament.configurationId;
        }
      }

      if (!targetSportId) return { definitions: [], playgroundSvg: null };

      let loadedPlaygroundSvg: string | null = null;
      if (targetConfigId) {
        const sportConfig = await db.sportconfigurations.get(targetConfigId);
        if (sportConfig?.playground) {
          loadedPlaygroundSvg = sportConfig.playground;
        }
      }

      const isHydrated = await isSportHydratedForUser(
        targetSportId,
        normalizedUserId,
      );
      if (!isHydrated) {
        return { definitions: [], playgroundSvg: loadedPlaygroundSvg };
      }

      let loadedDefinitions: EventDefinitionLookup[] = [];

      if (db.usereventpresets) {
        const presets = await db.usereventpresets
          .where({ userId: normalizedUserId, sportId: targetSportId })
          .toArray();

        const enabledPresets = presets
          .filter((p) => p.isEnabled)
          .sort((a, b) => a.sortOrder - b.sortOrder);

        const defIds = enabledPresets.map((p) => p.eventDefinitionId);
        if (defIds.length > 0) {
          const defs = await db.eventdefinitions.bulkGet(defIds);
          loadedDefinitions = defs.filter(
            (d): d is EventDefinitionLookup => d !== undefined,
          );
        }
      } else {
        loadedDefinitions = await db.eventdefinitions
          .where("sportId")
          .equals(targetSportId)
          .toArray();
      }

      return {
        definitions: loadedDefinitions,
        playgroundSvg: loadedPlaygroundSvg,
      };
    }).subscribe({
      next: (data) => {
        setEventDefinitions(data?.definitions || []);
        setPlaygroundSvg(data?.playgroundSvg || null);
      },
      error: (err) => {
        console.error("Failed to load event definitions from Dexie:", err);
        setEventDefinitions([]);
        setPlaygroundSvg(null);
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [activeMatchId, currentUserId, hydrationVersion]);

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
    playgroundSvg,
  };
}
