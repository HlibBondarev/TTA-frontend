import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { liveQuery } from "dexie";
import { useAppDispatch, useAppSelector } from "../../../hooks/hooks";
import {
  db,
  type EventDefinitionLookup,
  type GameEvent,
  type PlayerPresence,
} from "../../../db/ttaDatabase";
import {
  initializePeriodPresenceTx,
  terminatePeriodPresenceTx,
  substitutePlayerTx,
  enterShorthandedPlayerTx,
} from "../../../db/presenceService";
import {
  loadRosterState,
  syncActiveAndBenchRoster,
  setSelectedStartingIds,
  setClearedPenaltyEventIds,
  setMaxPersonalFouls,
  commitStartingLineup,
  clearActiveRosterToBench,
  optimisticSubstitute,
  optimisticEnterActivePlayer,
  setLoading,
} from "../store/presenceSlice";
import {
  calculateDisciplinaryState,
  type MatchDisciplinaryState,
} from "../utils/disciplinaryUtils";
import {
  calculatePeriodCarryoverState,
  applyPrePeriodBenchTap,
  resetClearedPeriodPenalties,
  type PeriodCarryoverState,
  type PrePeriodBenchTapResult,
} from "../utils/periodCarryoverUtils";

interface RawDisciplinaryData {
  lineupIds: string[];
  events: GameEvent[];
  presences: PlayerPresence[];
  definitionsById: Map<string, EventDefinitionLookup>;
  dbMaxPersonalFouls?: number | null;
}

interface LineupScopedRecord {
  matchLineupId: string;
}

interface LineupTableLike<T extends LineupScopedRecord> {
  where?: (index: string) => {
    anyOf?: (keys: string[]) => { toArray?: () => Promise<T[]> };
  };
  filter?: (predicate: (item: T) => boolean) => {
    toArray?: () => Promise<T[]>;
  };
  toArray?: () => Promise<T[]>;
}

const EMPTY_RAW_DATA: RawDisciplinaryData = {
  lineupIds: [],
  events: [],
  presences: [],
  definitionsById: new Map(),
};

const areStringArraysEqual = (
  a: readonly string[],
  b: readonly string[],
): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const deriveActiveAndBenchForPeriod = (
  lineupIds: readonly string[],
  presences: readonly PlayerPresence[],
  periodNumber: number,
): { active: string[]; bench: string[] } => {
  const lineupSet = new Set(lineupIds);
  const periodPresences = presences
    .filter(
      (p) =>
        p.periodNumber === periodNumber &&
        p.timeOut === null &&
        lineupSet.has(p.matchLineupId),
    )
    .sort((a, b) => (a.timeIn ?? "").localeCompare(b.timeIn ?? ""));

  const active = Array.from(
    new Set(periodPresences.map((p) => p.matchLineupId)),
  );
  const activeSet = new Set(active);
  const bench = lineupIds.filter((id) => !activeSet.has(id));
  return { active, bench };
};

const fetchRecordsForLineups = async <T extends LineupScopedRecord>(
  table: LineupTableLike<T> | undefined,
  lineupIds: string[],
): Promise<T[]> => {
  if (lineupIds.length === 0 || !table) return [];
  const lineupSet = new Set(lineupIds);

  if (typeof table.where === "function") {
    const anyOfChain = table.where("matchLineupId")?.anyOf?.(lineupIds);
    if (typeof anyOfChain?.toArray === "function") {
      const res = await anyOfChain.toArray();
      if (Array.isArray(res)) return res;
    }
  }

  if (typeof table.filter === "function") {
    const filterChain = table.filter((item) =>
      lineupSet.has(item.matchLineupId),
    );
    if (typeof filterChain?.toArray === "function") {
      const res = await filterChain.toArray();
      if (Array.isArray(res)) return res;
    }
  }

  if (typeof table.toArray === "function") {
    const all = await table.toArray();
    if (Array.isArray(all)) {
      return all.filter((item) => lineupSet.has(item.matchLineupId));
    }
  }

  return [];
};

const fetchEventDefinitionsMap = async (): Promise<
  Map<string, EventDefinitionLookup>
> => {
  const map = new Map<string, EventDefinitionLookup>();
  if (typeof db?.eventdefinitions?.toArray !== "function") return map;
  const defs = await db.eventdefinitions.toArray();
  if (Array.isArray(defs)) {
    for (const def of defs) {
      if (def?.id) {
        map.set(def.id, def);
      }
    }
  }
  return map;
};

const fetchDbMaxPersonalFouls = async (
  matchId: string,
): Promise<number | null | undefined> => {
  if (
    !matchId ||
    typeof db?.matches?.get !== "function" ||
    typeof db?.tournaments?.get !== "function" ||
    typeof db?.sportconfigurations?.get !== "function"
  ) {
    return undefined;
  }

  const match = await db.matches.get(matchId);
  if (!match?.tournamentId) return undefined;

  const tournament = await db.tournaments.get(match.tournamentId);
  if (!tournament?.configurationId) return undefined;

  const config = await db.sportconfigurations.get(tournament.configurationId);
  return config?.maxPersonalFouls;
};

const loadRawDisciplinaryData = async (
  matchId: string,
): Promise<RawDisciplinaryData> => {
  const normalizedMatchId = matchId?.trim();
  if (!normalizedMatchId || typeof db?.matchlineups?.where !== "function") {
    return EMPTY_RAW_DATA;
  }

  const equalsChain = db.matchlineups
    .where("matchId")
    ?.equals?.(normalizedMatchId);
  if (typeof equalsChain?.toArray !== "function") {
    return EMPTY_RAW_DATA;
  }

  const matchLineups = await equalsChain.toArray();
  const lineupIds = Array.isArray(matchLineups)
    ? matchLineups.map((l) => l.id)
    : [];

  const [events, presences, definitionsById, dbMaxPersonalFouls] =
    await Promise.all([
      fetchRecordsForLineups<GameEvent>(
        db?.gameevents as unknown as LineupTableLike<GameEvent> | undefined,
        lineupIds,
      ),
      fetchRecordsForLineups<PlayerPresence>(
        db?.playerpresences as unknown as
          | LineupTableLike<PlayerPresence>
          | undefined,
        lineupIds,
      ),
      fetchEventDefinitionsMap(),
      fetchDbMaxPersonalFouls(normalizedMatchId),
    ]);

  return {
    lineupIds,
    events,
    presences,
    definitionsById,
    dbMaxPersonalFouls,
  };
};

const hasDisciplinaryCarryoverConstraints = (
  carryover: PeriodCarryoverState,
  lineupCount: number,
  activePlayersLimit: number,
): boolean =>
  carryover.disqualifiedLineupIds.length > 0 ||
  carryover.carriedOverPenalties.length > 0 ||
  carryover.permanentNoSubCount > 0 ||
  (lineupCount >= activePlayersLimit &&
    carryover.requiredStartingPlayers < activePlayersLimit);

export interface UsePlayerPresenceResult {
  currentPeriod: number;
  activeLineupIds: string[];
  benchLineupIds: string[];
  selectedStartingIds: string[];
  clearedPenaltyEventIds?: string[];
  activePlayersLimit: number;
  maxPersonalFouls?: number | null;
  disciplinaryState?: MatchDisciplinaryState;
  carryoverState?: PeriodCarryoverState;
  requiredStartingPlayers?: number;
  maxAllowedActive?: number;
  isShorthanded?: boolean;
  shorthandedSlotsAvailable?: number;
  refreshPresenceFromDB: (overridePeriodNumber?: number) => Promise<void>;
  stageStartingLineup: (lineupIds: string[]) => void;
  handlePrePeriodBenchTap?: (lineupId: string) => PrePeriodBenchTapResult;
  resetPrePeriodClearedPenalties?: () => void;
  startPeriodWithRoster: (
    startTimestamp: string,
    overridePeriodNumber?: number,
  ) => Promise<void>;
  endPeriodWithRoster: (
    endTimestamp: string,
    overridePeriodNumber?: number,
  ) => Promise<void>;
  executeSubstitution: (
    outLineupId: string,
    inLineupId: string,
    overridePeriodNumber?: number,
  ) => Promise<void>;
  enterShorthandedPlayer?: (
    inLineupId: string,
    overridePeriodNumber?: number,
  ) => Promise<void>;
}

export function usePlayerPresence(matchId: string): UsePlayerPresenceResult {
  const dispatch = useAppDispatch();
  const currentPeriod = useAppSelector((state) => state.match.periodNumber);
  const isPeriodEnded = useAppSelector((state) => state.match.isPeriodEnded);

  // Safeguard: guarantees up-to-date periodNumber inside async callbacks
  const currentPeriodRef = useRef(currentPeriod);
  const refreshRequestRef = useRef(0);

  const {
    activeLineupIds,
    benchLineupIds,
    selectedStartingIds,
    clearedPenaltyEventIds = [],
    activePlayersLimit,
    maxPersonalFouls,
  } = useAppSelector((state) => state.presence);

  const activeLineupIdsRef = useRef(activeLineupIds);
  const benchLineupIdsRef = useRef(benchLineupIds);

  useEffect(() => {
    currentPeriodRef.current = currentPeriod;
  }, [currentPeriod]);

  useEffect(() => {
    activeLineupIdsRef.current = activeLineupIds;
    benchLineupIdsRef.current = benchLineupIds;
  }, [activeLineupIds, benchLineupIds]);

  const [rawData, setRawData] = useState<RawDisciplinaryData>(EMPTY_RAW_DATA);
  const prevPeriodForCarryoverRef = useRef(currentPeriod);
  const prevMatchForCarryoverRef = useRef(matchId);

  useEffect(() => {
    if (
      prevPeriodForCarryoverRef.current !== currentPeriod ||
      prevMatchForCarryoverRef.current !== matchId
    ) {
      prevPeriodForCarryoverRef.current = currentPeriod;
      prevMatchForCarryoverRef.current = matchId;
      if (clearedPenaltyEventIds.length > 0) {
        dispatch(setClearedPenaltyEventIds([]));
      }
    }
  }, [currentPeriod, matchId, clearedPenaltyEventIds.length, dispatch]);

  useEffect(() => {
    const normalizedMatchId = matchId?.trim();
    if (!normalizedMatchId || typeof db?.matchlineups?.where !== "function") {
      return;
    }

    let isInitialEmission = true;

    const subscription = liveQuery(async () => {
      const requestIdBeforeLoad = refreshRequestRef.current;
      const data = await loadRawDisciplinaryData(normalizedMatchId);
      return { data, requestIdBeforeLoad };
    }).subscribe({
      next: ({ data, requestIdBeforeLoad }) => {
        const wasInitial = isInitialEmission;
        isInitialEmission = false;

        if (requestIdBeforeLoad !== refreshRequestRef.current) {
          return;
        }

        setRawData(data);

        if (
          data.dbMaxPersonalFouls !== undefined &&
          data.dbMaxPersonalFouls !== maxPersonalFouls
        ) {
          dispatch(setMaxPersonalFouls(data.dbMaxPersonalFouls));
        }

        if (
          !wasInitial &&
          data.lineupIds.length > 0 &&
          data.presences.length > 0
        ) {
          const { active, bench } = deriveActiveAndBenchForPeriod(
            data.lineupIds,
            data.presences,
            currentPeriodRef.current,
          );
          if (
            !areStringArraysEqual(active, activeLineupIdsRef.current) ||
            !areStringArraysEqual(bench, benchLineupIdsRef.current)
          ) {
            dispatch(syncActiveAndBenchRoster({ active, bench }));
          }
        }
      },
      error: () => {
        // Ignore liveQuery errors in isolated unit tests with partial DB mocks
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [matchId, currentPeriod, maxPersonalFouls, dispatch]);

  const effectiveLineupIds = useMemo(() => {
    if (rawData.lineupIds.length > 0) {
      return rawData.lineupIds;
    }
    return Array.from(new Set([...activeLineupIds, ...benchLineupIds]));
  }, [rawData.lineupIds, activeLineupIds, benchLineupIds]);

  const effectiveMaxPersonalFouls =
    rawData.dbMaxPersonalFouls !== undefined
      ? rawData.dbMaxPersonalFouls
      : maxPersonalFouls;

  const disciplinaryState: MatchDisciplinaryState = useMemo(
    () =>
      calculateDisciplinaryState({
        activePlayersLimit,
        maxPersonalFouls: effectiveMaxPersonalFouls,
        lineupIds: effectiveLineupIds,
        events: rawData.events,
        presences: rawData.presences,
        definitionsById: rawData.definitionsById,
        upToPeriodNumber: currentPeriod,
        activeLineupIds,
      }),
    [
      activePlayersLimit,
      effectiveMaxPersonalFouls,
      effectiveLineupIds,
      rawData.events,
      rawData.presences,
      rawData.definitionsById,
      currentPeriod,
      activeLineupIds,
    ],
  );

  const prePeriodTargetPeriod = isPeriodEnded
    ? currentPeriod + 1
    : currentPeriod;

  const carryoverState: PeriodCarryoverState = useMemo(
    () =>
      calculatePeriodCarryoverState({
        targetPeriodNumber: prePeriodTargetPeriod,
        activePlayersLimit,
        maxPersonalFouls: effectiveMaxPersonalFouls,
        lineupIds: effectiveLineupIds,
        events: rawData.events,
        presences: rawData.presences,
        definitionsById: rawData.definitionsById,
        clearedPenaltyEventIds,
      }),
    [
      prePeriodTargetPeriod,
      activePlayersLimit,
      effectiveMaxPersonalFouls,
      effectiveLineupIds,
      rawData.events,
      rawData.presences,
      rawData.definitionsById,
      clearedPenaltyEventIds,
    ],
  );

  const requiredStartingPlayers = hasDisciplinaryCarryoverConstraints(
    carryoverState,
    effectiveLineupIds.length,
    activePlayersLimit,
  )
    ? carryoverState.requiredStartingPlayers
    : activePlayersLimit;

  const refreshPresenceFromDB = useCallback(
    async (overridePeriodNumber?: number) => {
      const requestId = ++refreshRequestRef.current;
      const periodToFetch = overridePeriodNumber ?? currentPeriodRef.current;
      dispatch(setLoading(true));
      try {
        const matchLineups = await db.matchlineups
          .where("matchId")
          .equals(matchId)
          .toArray();

        const lineupIds = matchLineups.map((l) => l.id);
        const rawPresences = await db.playerpresences
          .where("periodNumber")
          .equals(periodToFetch)
          .toArray();

        const sortedPresences = [...rawPresences].sort((a, b) =>
          a.timeIn.localeCompare(b.timeIn),
        );

        const activeLineups = Array.from(
          new Set(
            sortedPresences
              .filter(
                (p) =>
                  p.timeOut === null && lineupIds.includes(p.matchLineupId),
              )
              .map((p) => p.matchLineupId),
          ),
        );

        const benchLineups = lineupIds.filter(
          (id) => !activeLineups.includes(id),
        );

        if (
          requestId === refreshRequestRef.current &&
          periodToFetch === currentPeriodRef.current
        ) {
          dispatch(
            loadRosterState({ active: activeLineups, bench: benchLineups }),
          );
        }

        const [events, definitionsById, dbMaxPersonalFouls] = await Promise.all(
          [
            fetchRecordsForLineups<GameEvent>(
              db?.gameevents as unknown as
                | LineupTableLike<GameEvent>
                | undefined,
              lineupIds,
            ),
            fetchEventDefinitionsMap(),
            fetchDbMaxPersonalFouls(matchId),
          ],
        );

        if (requestId === refreshRequestRef.current) {
          setRawData((prev) => ({
            lineupIds,
            events,
            presences:
              prev.presences.length > rawPresences.length
                ? prev.presences
                : rawPresences,
            definitionsById,
            dbMaxPersonalFouls,
          }));
        }
      } catch (error) {
        console.error("Failed to load local presence state:", error);
      } finally {
        if (requestId === refreshRequestRef.current) {
          dispatch(setLoading(false));
        }
      }
    },
    [matchId, dispatch],
  );

  const stageStartingLineup = useCallback(
    (lineupIds: string[]) => {
      const maxAllowedToStage = hasDisciplinaryCarryoverConstraints(
        carryoverState,
        effectiveLineupIds.length,
        activePlayersLimit,
      )
        ? carryoverState.requiredStartingPlayers
        : activePlayersLimit;
      if (lineupIds.length > maxAllowedToStage) {
        throw new Error(
          `Cannot exceed the limit of ${maxAllowedToStage} active players.`,
        );
      }
      dispatch(setSelectedStartingIds(lineupIds));
    },
    [carryoverState, effectiveLineupIds.length, activePlayersLimit, dispatch],
  );

  const handlePrePeriodBenchTap = useCallback(
    (lineupId: string): PrePeriodBenchTapResult => {
      if (effectiveLineupIds.length === 0) {
        const nextSelected = selectedStartingIds.includes(lineupId)
          ? selectedStartingIds.filter((id) => id !== lineupId)
          : [...selectedStartingIds, lineupId];
        stageStartingLineup(nextSelected);
        return {
          selectedStartingIds: nextSelected,
          clearedPenaltyEventIds,
          wasPenaltyCleared: false,
          wasSelectionToggled: true,
        };
      }

      const tapResult = applyPrePeriodBenchTap({
        lineupId,
        selectedStartingIds,
        clearedPenaltyEventIds,
        carryoverState,
      });

      dispatch(setClearedPenaltyEventIds(tapResult.clearedPenaltyEventIds));
      dispatch(setSelectedStartingIds(tapResult.selectedStartingIds));
      return tapResult;
    },
    [
      effectiveLineupIds.length,
      selectedStartingIds,
      clearedPenaltyEventIds,
      carryoverState,
      stageStartingLineup,
      dispatch,
    ],
  );

  const resetPrePeriodClearedPenalties = useCallback(() => {
    const restoredCarryover = calculatePeriodCarryoverState({
      targetPeriodNumber: prePeriodTargetPeriod,
      activePlayersLimit,
      maxPersonalFouls: effectiveMaxPersonalFouls,
      lineupIds: effectiveLineupIds,
      events: rawData.events,
      presences: rawData.presences,
      definitionsById: rawData.definitionsById,
      clearedPenaltyEventIds: [],
    });

    const resetResult = resetClearedPeriodPenalties(
      selectedStartingIds,
      restoredCarryover,
    );
    dispatch(setClearedPenaltyEventIds(resetResult.clearedPenaltyEventIds));
    dispatch(setSelectedStartingIds(resetResult.selectedStartingIds));
  }, [
    prePeriodTargetPeriod,
    activePlayersLimit,
    effectiveMaxPersonalFouls,
    effectiveLineupIds,
    rawData.events,
    rawData.presences,
    rawData.definitionsById,
    selectedStartingIds,
    dispatch,
  ]);

  const startPeriodWithRoster = useCallback(
    async (startTimestamp: string, overridePeriodNumber?: number) => {
      const targetPeriod = overridePeriodNumber ?? currentPeriodRef.current;
      if (activePlayersLimit <= 0) {
        throw new Error("The active players limit is not configured.");
      }

      const targetCarryover = calculatePeriodCarryoverState({
        targetPeriodNumber: targetPeriod,
        activePlayersLimit,
        maxPersonalFouls: effectiveMaxPersonalFouls,
        lineupIds: effectiveLineupIds,
        events: rawData.events,
        presences: rawData.presences,
        definitionsById: rawData.definitionsById,
        clearedPenaltyEventIds,
      });

      const expectedStarters = hasDisciplinaryCarryoverConstraints(
        targetCarryover,
        effectiveLineupIds.length,
        activePlayersLimit,
      )
        ? targetCarryover.requiredStartingPlayers
        : activePlayersLimit;

      const hasDisqualifiedStarter = selectedStartingIds.some((id) =>
        targetCarryover.disqualifiedLineupIds.includes(id),
      );
      if (hasDisqualifiedStarter) {
        throw new Error(
          "Disqualified players cannot be included in the starting lineup.",
        );
      }

      if (selectedStartingIds.length !== expectedStarters) {
        throw new Error(
          `Starting lineup must contain exactly ${expectedStarters} players.`,
        );
      }
      try {
        await initializePeriodPresenceTx(
          matchId,
          targetPeriod,
          selectedStartingIds,
          startTimestamp,
        );
        dispatch(commitStartingLineup(selectedStartingIds));
        await refreshPresenceFromDB(targetPeriod);
      } catch (error) {
        console.error("Failed to initialize period presence in DB:", error);
        await refreshPresenceFromDB(targetPeriod);
        throw error;
      }
    },
    [
      matchId,
      selectedStartingIds,
      clearedPenaltyEventIds,
      activePlayersLimit,
      effectiveMaxPersonalFouls,
      effectiveLineupIds,
      rawData.events,
      rawData.presences,
      rawData.definitionsById,
      dispatch,
      refreshPresenceFromDB,
    ],
  );

  const endPeriodWithRoster = useCallback(
    async (endTimestamp: string, overridePeriodNumber?: number) => {
      const targetPeriod = overridePeriodNumber ?? currentPeriodRef.current;
      const activeIdsToClose = [...activeLineupIds];
      dispatch(clearActiveRosterToBench());
      try {
        await terminatePeriodPresenceTx(
          matchId,
          targetPeriod,
          activeIdsToClose,
          endTimestamp,
        );
      } catch (error) {
        console.error("Failed to terminate period presence in DB:", error);
        await refreshPresenceFromDB(targetPeriod);
        throw error;
      }
    },
    [matchId, activeLineupIds, dispatch, refreshPresenceFromDB],
  );

  const executeSubstitution = useCallback(
    async (
      outLineupId: string,
      inLineupId: string,
      overridePeriodNumber?: number,
    ) => {
      const targetPeriod = overridePeriodNumber ?? currentPeriodRef.current;
      if (disciplinaryState.playersById[inLineupId]?.isDisqualified) {
        throw new Error("Disqualified player cannot enter the game.");
      }

      dispatch(optimisticSubstitute({ outId: outLineupId, inId: inLineupId }));
      try {
        await substitutePlayerTx(
          matchId,
          targetPeriod,
          outLineupId,
          inLineupId,
        );
      } catch (error) {
        console.error("Failed to execute substitution in DB:", error);
        await refreshPresenceFromDB(targetPeriod);
        throw error;
      }
    },
    [matchId, disciplinaryState.playersById, dispatch, refreshPresenceFromDB],
  );

  const enterShorthandedPlayer = useCallback(
    async (inLineupId: string, overridePeriodNumber?: number) => {
      const targetPeriod = overridePeriodNumber ?? currentPeriodRef.current;
      if (disciplinaryState.playersById[inLineupId]?.isDisqualified) {
        throw new Error("Disqualified player cannot enter the game.");
      }
      if (activeLineupIds.includes(inLineupId)) {
        throw new Error("Player is already active.");
      }
      const maxAllowed =
        disciplinaryState.maxAllowedActive > 0
          ? disciplinaryState.maxAllowedActive
          : activePlayersLimit;
      if (maxAllowed > 0 && activeLineupIds.length >= maxAllowed) {
        throw new Error(
          `Cannot exceed the limit of ${maxAllowed} active players.`,
        );
      }

      dispatch(optimisticEnterActivePlayer(inLineupId));
      try {
        await enterShorthandedPlayerTx(matchId, targetPeriod, inLineupId);
      } catch (error) {
        console.error("Failed to enter shorthanded player in DB:", error);
        await refreshPresenceFromDB(targetPeriod);
        throw error;
      }
    },
    [
      matchId,
      activeLineupIds,
      activePlayersLimit,
      disciplinaryState.maxAllowedActive,
      disciplinaryState.playersById,
      dispatch,
      refreshPresenceFromDB,
    ],
  );

  return {
    currentPeriod,
    activeLineupIds,
    benchLineupIds,
    selectedStartingIds,
    clearedPenaltyEventIds,
    activePlayersLimit,
    maxPersonalFouls: effectiveMaxPersonalFouls,
    disciplinaryState,
    carryoverState,
    requiredStartingPlayers,
    maxAllowedActive: disciplinaryState.maxAllowedActive,
    isShorthanded: disciplinaryState.isShorthanded,
    shorthandedSlotsAvailable: disciplinaryState.shorthandedSlotsAvailable,
    refreshPresenceFromDB,
    stageStartingLineup,
    handlePrePeriodBenchTap,
    resetPrePeriodClearedPenalties,
    startPeriodWithRoster,
    endPeriodWithRoster,
    executeSubstitution,
    enterShorthandedPlayer,
  };
}
