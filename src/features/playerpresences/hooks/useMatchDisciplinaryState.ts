import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { liveQuery } from "dexie";
import {
  db,
  type EventDefinitionLookup,
  type GameEvent,
  type PlayerPresence,
} from "../../../db/ttaDatabase";
import {
  computePlayerDisciplinaryMap,
  type PlayerDisciplinaryStatus,
} from "../../../utils/disciplinaryUtils";
import type { RootState } from "../../../store";

export interface MatchDisciplinaryState {
  maxPersonalFouls: number | null;
  disciplinaryByLineupId: Record<string, PlayerDisciplinaryStatus>;
}

const EMPTY_DISCIPLINARY_STATE: MatchDisciplinaryState = {
  maxPersonalFouls: null,
  disciplinaryByLineupId: {},
};

const loadMatchMaxPersonalFouls = async (
  matchId: string,
): Promise<number | null> => {
  if (!db?.matches?.get || !db?.tournaments?.get || !db?.sportconfigurations?.get) {
    return null;
  }

  const match = await db.matches.get(matchId);
  if (!match?.tournamentId) return null;

  const tournament = await db.tournaments.get(match.tournamentId);
  if (!tournament?.configurationId) return null;

  const config = await db.sportconfigurations.get(tournament.configurationId);
  return typeof config?.maxPersonalFouls === "number"
    ? config.maxPersonalFouls
    : null;
};

const loadDefinitionsMap = async (
  events: GameEvent[],
): Promise<Map<string, EventDefinitionLookup>> => {
  const map = new Map<string, EventDefinitionLookup>();
  if (!db?.eventdefinitions?.where || events.length === 0) {
    return map;
  }

  const defIds = Array.from(
    new Set(events.map((e) => e.eventDefinitionId).filter(Boolean)),
  );
  if (defIds.length === 0) return map;

  const defs = await db.eventdefinitions.where("id").anyOf(defIds).toArray();
  for (const def of defs) {
    map.set(def.id, def);
  }
  return map;
};

const loadPeriodPresences = async (
  lineupIdSet: ReadonlySet<string>,
  currentPeriod: number,
): Promise<PlayerPresence[]> => {
  if (!db?.playerpresences?.where) {
    return [];
  }

  const rawPresences = await db.playerpresences
    .where("periodNumber")
    .equals(currentPeriod)
    .toArray();
  return rawPresences.filter((p) => lineupIdSet.has(p.matchLineupId));
};

export interface UseMatchDisciplinaryStateParams {
  matchId: string;
  currentPeriod: number;
  isPeriodActive: boolean;
  activeLineupIds: string[];
  activePlayersLimit: number;
}

/**
 * Reactively computes each lineup player's disciplinary state (personal fouls, warning,
 * DQ lock, and timed-exclusion bench highlight) from IndexedDB via Dexie liveQuery.
 */
export function useMatchDisciplinaryState({
  matchId,
  currentPeriod,
  isPeriodActive,
  activeLineupIds,
  activePlayersLimit,
}: UseMatchDisciplinaryStateParams): MatchDisciplinaryState {
  const hydrationVersion = useSelector(
    (state: RootState) => state.match?.hydrationVersion ?? 0,
  );
  const [state, setState] = useState<MatchDisciplinaryState>(
    EMPTY_DISCIPLINARY_STATE,
  );

  const activeLineupIdsKey = useMemo(
    () => activeLineupIds.join(","),
    [activeLineupIds],
  );

  useEffect(() => {
    const normalizedMatchId = matchId?.trim();
    if (
      !normalizedMatchId ||
      !db?.matchlineups?.where ||
      !db?.gameevents?.where
    ) {
      return;
    }

    const activeIdsList = activeLineupIdsKey
      ? activeLineupIdsKey.split(",")
      : [];

    const subscription = liveQuery(async (): Promise<MatchDisciplinaryState> => {
      const [maxPersonalFouls, lineups] = await Promise.all([
        loadMatchMaxPersonalFouls(normalizedMatchId),
        db.matchlineups.where("matchId").equals(normalizedMatchId).toArray(),
      ]);

      const lineupIds = lineups.map((l) => l.id);
      if (lineupIds.length === 0) {
        return { maxPersonalFouls, disciplinaryByLineupId: {} };
      }

      const lineupIdSet = new Set(lineupIds);
      const [gameEvents, periodPresences] = await Promise.all([
        db.gameevents.where("matchLineupId").anyOf(lineupIds).toArray(),
        loadPeriodPresences(lineupIdSet, currentPeriod),
      ]);

      const eventDefinitionsById = await loadDefinitionsMap(gameEvents);

      const disciplinaryByLineupId = computePlayerDisciplinaryMap({
        lineupIds,
        gameEvents,
        eventDefinitionsById,
        periodPresences,
        currentPeriod,
        isPeriodActive,
        activeLineupIds: activeIdsList,
        activePlayersLimit,
        maxPersonalFouls,
      });

      return {
        maxPersonalFouls,
        disciplinaryByLineupId,
      };
    }).subscribe({
      next: (nextState) => {
        setState(nextState ?? EMPTY_DISCIPLINARY_STATE);
      },
      error: (err) => {
        console.error("Failed to compute match disciplinary state:", err);
        setState(EMPTY_DISCIPLINARY_STATE);
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [
    matchId,
    currentPeriod,
    isPeriodActive,
    activeLineupIdsKey,
    activePlayersLimit,
    hydrationVersion,
  ]);

  if (!matchId?.trim()) {
    return EMPTY_DISCIPLINARY_STATE;
  }

  return state;
}
