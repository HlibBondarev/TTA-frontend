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

  const [activeTab, setActiveTab] = useState<"positive" | "negative">(
    "positive",
  );
  const [eventDefinitions, setEventDefinitions] = useState<
    EventDefinitionLookup[]
  >([]);
  const [prevActiveMatchId, setPrevActiveMatchId] = useState(activeMatchId);
  const [prevUserId, setPrevUserId] = useState(currentUserId);

  if (prevActiveMatchId !== activeMatchId || prevUserId !== currentUserId) {
    setPrevActiveMatchId(activeMatchId);
    setPrevUserId(currentUserId);
    setEventDefinitions([]);
    clearEventDefinitionsCache();
  }

  useEffect(() => {
    const subscription = liveQuery(async () => {
      if (!activeMatchId) return [];

      const normalizedUserId = currentUserId?.trim();
      if (!normalizedUserId) return [];

      const match = await db.matches.get(activeMatchId);
      if (!match) return [];

      if (match.userId && match.userId !== normalizedUserId) {
        return [];
      }

      let targetSportId: string | null = null;
      if (match.tournamentId) {
        const tournament = await db.tournaments.get(match.tournamentId);
        if (tournament?.sportId) {
          targetSportId = tournament.sportId;
        }
      }

      if (!targetSportId) return [];

      const isHydrated = await isSportHydratedForUser(
        targetSportId,
        normalizedUserId,
      );
      if (!isHydrated) {
        return [];
      }

      if (db.usereventpresets) {
        const presets = await db.usereventpresets
          .where({ userId: normalizedUserId, sportId: targetSportId })
          .toArray();

        const enabledPresets = presets
          .filter((p) => p.isEnabled)
          .sort((a, b) => a.sortOrder - b.sortOrder);

        const defIds = enabledPresets.map((p) => p.eventDefinitionId);
        if (defIds.length === 0) return [];

        const defs = await db.eventdefinitions.bulkGet(defIds);
        return defs.filter((d): d is EventDefinitionLookup => d !== undefined);
      }

      return await db.eventdefinitions
        .where("sportId")
        .equals(targetSportId)
        .toArray();
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
  };
}
