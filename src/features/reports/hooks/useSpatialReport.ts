import { useState, useEffect, useMemo, useCallback } from "react";
import {
  reportService,
  type GameEventResponse,
  type MatchLineupResponse,
} from "../../../services/reportService";
import {
  db,
  type MatchLineupLookup,
  type EventDefinitionLookup,
  type TournamentLookup,
} from "../../../db/ttaDatabase";
import { sportService } from "../../../services/sportService";
import { apiClient } from "../../../api/client";

export interface SpatialReportFilters {
  periodNumber: number | null; // null = All
  selectedLineupIds: string[];
  selectedPositiveDefIds: string[];
  selectedNegativeDefIds: string[];
  activeTab: "all" | "positive" | "negative";
  displayMode: "scatter" | "heatmap";
  showGoalLeadVectors: boolean;
  mapMode: "field" | "shot";
}

export interface UseSpatialReportProps {
  matchId: string;
  teamId?: string;
  playground?: string | null;
  shotMap?: string | null;
}

// Helper to load and normalize team lineups with fallbacks
async function loadLineups(
  matchId: string,
  teamId?: string,
  teamEvents: GameEventResponse[] = [],
): Promise<MatchLineupLookup[]> {
  let lineups: MatchLineupLookup[] = [];

  if (teamId) {
    try {
      const response = await reportService.getTeamLineup(matchId, teamId);
      lineups = response.flatMap((lineup: MatchLineupResponse) => {
        if (!lineup.id || lineup.number == null) return [];
        return [
          {
            id: lineup.id,
            matchId,
            playerRosterId: lineup.playerRosterId ?? null,
            number: lineup.number,
            positionId: lineup.positionId ?? null,
          },
        ];
      });
    } catch {
      lineups = [];
    }
  }

  if (!teamId && lineups.length === 0) {
    try {
      lineups = await db.matchlineups
        .where("matchId")
        .equals(matchId)
        .toArray();
    } catch {
      lineups = [];
    }
  }

  if (lineups.length === 0 && teamEvents.length > 0) {
    const lineupMap = new Map<string, MatchLineupLookup>();
    teamEvents.forEach((ev) => {
      if (ev.matchLineupId && !lineupMap.has(ev.matchLineupId)) {
        lineupMap.set(ev.matchLineupId, {
          id: ev.matchLineupId,
          matchId: matchId,
          playerRosterId: ev.matchLineupId,
          number: ev.playerNumber ?? 0,
          positionId: null,
        });
      }
    });
    lineups = Array.from(lineupMap.values()).sort(
      (a, b) => a.number - b.number,
    );
  }

  return lineups;
}

// Helper to fetch and enrich event definitions map with uncached shot detection fallback
async function loadDefinitionsMap(
  fetchedEvents: GameEventResponse[],
): Promise<Map<string, EventDefinitionLookup>> {
  const defs: EventDefinitionLookup[] = await db.eventdefinitions
    .toArray()
    .catch(() => []);

  const dbDefsMap = new Map<string, EventDefinitionLookup>();
  defs.forEach((d) => dbDefsMap.set(d.id, d));

  const definitionsMap = new Map<string, EventDefinitionLookup>();
  defs.forEach((d) => definitionsMap.set(d.id, d));

  fetchedEvents.forEach((ev) => {
    if (ev.eventDefinitionId) {
      const cachedInDb = dbDefsMap.get(ev.eventDefinitionId);
      const currentInMap = definitionsMap.get(ev.eventDefinitionId);
      const hasShotCoordinates =
        ev.shotLocationX != null && ev.shotLocationY != null;

      if (cachedInDb) {
        // Strictly honor authoritative cached definition (isShot is guaranteed boolean)
        definitionsMap.set(ev.eventDefinitionId, cachedInDb);
      } else {
        // Aggregate coordinate evidence strictly across events for uncached definitions
        definitionsMap.set(ev.eventDefinitionId, {
          id: ev.eventDefinitionId,
          sportId: "",
          name: ev.eventName || currentInMap?.name || "Action",
          shortName: ev.eventName
            ? ev.eventName.substring(0, 4).toUpperCase()
            : currentInMap?.shortName || "ACT",
          isPositive: ev.isPositive ?? currentInMap?.isPositive ?? true,
          isShot: Boolean(currentInMap?.isShot || hasShotCoordinates),
        });
      }
    }
  });

  return definitionsMap;
}

async function fetchMatch(
  matchId: string,
): Promise<{ id: string; tournamentId?: string } | null> {
  const localMatch = await db.matches.get(matchId).catch(() => undefined);
  if (localMatch?.tournamentId) return localMatch;

  try {
    const remoteMatch = await apiClient.get<{
      id: string;
      tournamentId?: string;
    }>(`/Matches/${matchId}`);
    if (remoteMatch) {
      return remoteMatch;
    }
  } catch {
    // Ignore API fetch errors for missing match metadata
  }
  return localMatch ?? null;
}

async function fetchTournament(
  tournamentId: string,
): Promise<TournamentLookup | null> {
  const localTournament = await db.tournaments
    .get(tournamentId)
    .catch(() => undefined);

  if (localTournament?.sportId && localTournament?.configurationId) {
    return localTournament;
  }

  try {
    const remoteTournament = await apiClient.get<TournamentLookup>(
      `/Tournaments/${tournamentId}`,
    );
    if (remoteTournament) {
      const mergedTournament: TournamentLookup = {
        ...localTournament,
        ...remoteTournament,
        id: remoteTournament.id ?? localTournament?.id ?? tournamentId,
      };
      if (mergedTournament.sportId && mergedTournament.configurationId) {
        await Promise.resolve(db.tournaments.put(mergedTournament)).catch(
          () => undefined,
        );
      }
      return mergedTournament;
    }
  } catch {
    // Ignore API fetch errors for missing tournament
  }
  return localTournament ?? null;
}

async function fetchSportConfiguration(
  configId: string,
  sportId: string,
  onLocalFound?: (config: {
    playground?: string | null;
    shotMap?: string | null;
  }) => void,
) {
  const localConfig = await db.sportconfigurations
    .get(configId)
    .catch(() => undefined);

  // Preserve immediate return if local cache contains both playground and shotMap SVGs
  if (localConfig?.playground && localConfig?.shotMap) {
    return localConfig;
  }

  // Publish cached playground / partial assets immediately even when shotMap is missing
  if (localConfig && (localConfig.playground || localConfig.shotMap)) {
    onLocalFound?.(localConfig);
  }

  try {
    const configs = await sportService.getSportConfigurations(sportId);
    const remoteConfig = Array.isArray(configs)
      ? configs.find((c) => c.id === configId)
      : undefined;

    if (remoteConfig) {
      let updatedConfig = {
        ...remoteConfig,
        ...localConfig,
        playground: remoteConfig.playground || localConfig?.playground || null,
        shotMap: remoteConfig.shotMap || localConfig?.shotMap || null,
      };

      const performWrite = async () => {
        const latestLocal = await db.sportconfigurations
          .get(configId)
          .catch(() => undefined);

        updatedConfig = {
          ...remoteConfig,
          ...latestLocal,
          playground:
            remoteConfig.playground ||
            latestLocal?.playground ||
            localConfig?.playground ||
            null,
          shotMap:
            remoteConfig.shotMap ||
            latestLocal?.shotMap ||
            localConfig?.shotMap ||
            null,
        };

        await db.sportconfigurations.put(updatedConfig);
      };

      try {
        if (typeof db.transaction === "function") {
          await db.transaction("rw", db.sportconfigurations, performWrite);
        } else {
          await performWrite();
        }
      } catch {
        // Ignore cache write or transaction failures; safely return updatedConfig with fetched remote SVGs
      }

      return updatedConfig;
    }
  } catch {
    // Retain and return available local data on network failure
  }

  return localConfig ?? null;
}

// Helper to resolve missing playground and shot map SVGs from IndexedDB or Backend API
async function resolveSportSvgs(
  matchId: string,
  initialPlayground: string | null = null,
  initialShotMap: string | null = null,
  onPartialResolve?: (partial: {
    playground: string | null;
    shotMap: string | null;
  }) => void,
): Promise<{ playground: string | null; shotMap: string | null }> {
  let pg = initialPlayground;
  let sm = initialShotMap;

  if (pg && sm) {
    return { playground: pg, shotMap: sm };
  }

  try {
    const match = await fetchMatch(matchId);
    if (!match?.tournamentId)
      return { playground: pg || null, shotMap: sm || null };

    const tournament = await fetchTournament(match.tournamentId);
    if (!tournament?.configurationId || !tournament.sportId) {
      return { playground: pg || null, shotMap: sm || null };
    }

    const config = await fetchSportConfiguration(
      tournament.configurationId,
      tournament.sportId,
      (localConfig) => {
        const partialPg = pg || localConfig.playground || null;
        const partialSm = sm || localConfig.shotMap || null;
        if (partialPg || partialSm) {
          onPartialResolve?.({ playground: partialPg, shotMap: partialSm });
        }
      },
    );
    if (config) {
      pg = pg || config.playground || null;
      sm = sm || config.shotMap || null;
    }
  } catch (err) {
    console.error("Failed to load sport configuration SVGs in hook:", err);
  }

  return { playground: pg || null, shotMap: sm || null };
}

function matchesShotMode(
  ev: GameEventResponse,
  mapMode: "field" | "shot",
  eventDefinitionsMap: Map<string, EventDefinitionLookup>,
): boolean {
  if (mapMode !== "shot") return true;
  if (ev.shotLocationX == null || ev.shotLocationY == null) return false;
  const def = ev.eventDefinitionId
    ? eventDefinitionsMap.get(ev.eventDefinitionId)
    : undefined;
  return def ? def.isShot === true : true;
}

function matchesDefinitionFilter(
  ev: GameEventResponse,
  positiveDefIds: string[],
  negativeDefIds: string[],
): boolean {
  if (!ev.eventDefinitionId) return true;
  if (ev.isPositive && positiveDefIds.length > 0) {
    return positiveDefIds.includes(ev.eventDefinitionId);
  }
  if (!ev.isPositive && negativeDefIds.length > 0) {
    return negativeDefIds.includes(ev.eventDefinitionId);
  }
  return true;
}

function isEventMatchingFilters(
  ev: GameEventResponse,
  filters: SpatialReportFilters,
  eventDefinitionsMap: Map<string, EventDefinitionLookup>,
): boolean {
  if (!matchesShotMode(ev, filters.mapMode, eventDefinitionsMap)) return false;

  if (
    filters.periodNumber !== null &&
    ev.periodNumber !== filters.periodNumber
  ) {
    return false;
  }

  if (
    filters.selectedLineupIds.length > 0 &&
    (!ev.matchLineupId || !filters.selectedLineupIds.includes(ev.matchLineupId))
  ) {
    return false;
  }

  if (filters.activeTab === "positive" && !ev.isPositive) return false;
  if (filters.activeTab === "negative" && ev.isPositive) return false;

  return matchesDefinitionFilter(
    ev,
    filters.selectedPositiveDefIds,
    filters.selectedNegativeDefIds,
  );
}

export function useSpatialReport({
  matchId,
  teamId,
  playground,
  shotMap,
}: UseSpatialReportProps) {
  const [events, setEvents] = useState<GameEventResponse[]>([]);
  const [teamLineups, setTeamLineups] = useState<MatchLineupLookup[]>([]);
  const [eventDefinitionsMap, setEventDefinitionsMap] = useState<
    Map<string, EventDefinitionLookup>
  >(new Map());

  const [effectivePlayground, setEffectivePlayground] = useState<string | null>(
    playground || null,
  );
  const [effectiveShotMap, setEffectiveShotMap] = useState<string | null>(
    shotMap || null,
  );

  const [filters, setFilters] = useState<SpatialReportFilters>({
    periodNumber: null,
    selectedLineupIds: [],
    selectedPositiveDefIds: [],
    selectedNegativeDefIds: [],
    activeTab: "all",
    displayMode: "scatter",
    showGoalLeadVectors: true,
    mapMode: "field",
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Dedicated effect for resolving SVGs independently without triggering event re-fetches
  useEffect(() => {
    if (!matchId) return;

    let isMounted = true;

    const resolveSvgs = async () => {
      const svgs = await resolveSportSvgs(
        matchId,
        playground,
        shotMap,
        (partial) => {
          if (isMounted) {
            if (partial.playground) setEffectivePlayground(partial.playground);
            if (partial.shotMap) setEffectiveShotMap(partial.shotMap);
          }
        },
      );
      if (isMounted) {
        setEffectivePlayground(svgs.playground);
        setEffectiveShotMap(svgs.shotMap);
      }
    };

    void resolveSvgs();

    return () => {
      isMounted = false;
    };
  }, [matchId, playground, shotMap]);

  // Main effect for fetching match events, team lineups, and definitions
  useEffect(() => {
    if (!matchId) return;

    let isMounted = true;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const fetchedEvents = await reportService.getMatchEvents(matchId);

        if (!isMounted) return;

        const teamEvents = teamId
          ? fetchedEvents.filter((ev) => ev.teamId === teamId)
          : fetchedEvents;

        const [lineups, definitionsMap] = await Promise.all([
          loadLineups(matchId, teamId, teamEvents),
          loadDefinitionsMap(fetchedEvents),
        ]);

        if (isMounted) {
          setEvents(teamEvents);
          setTeamLineups(lineups);
          setEventDefinitionsMap(definitionsMap);
          setFilters((prev) => ({
            ...prev,
            selectedLineupIds: [],
            selectedPositiveDefIds: [],
            selectedNegativeDefIds: [],
          }));
        }
      } catch (err) {
        if (isMounted) {
          console.error("Failed to load match spatial analytics data:", err);
          setError("Failed to load spatial analytics data.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void fetchData();

    return () => {
      isMounted = false;
    };
  }, [matchId, teamId]);

  const filteredEvents = useMemo(() => {
    return events.filter((ev) =>
      isEventMatchingFilters(ev, filters, eventDefinitionsMap),
    );
  }, [events, filters, eventDefinitionsMap]);

  const togglePeriodFilter = useCallback((period: number | null) => {
    setFilters((prev) => ({
      ...prev,
      periodNumber: prev.periodNumber === period ? null : period,
    }));
  }, []);

  const togglePlayerSelection = useCallback((lineupId: string) => {
    setFilters((prev) => {
      const exists = prev.selectedLineupIds.includes(lineupId);
      return {
        ...prev,
        selectedLineupIds: exists
          ? prev.selectedLineupIds.filter((id) => id !== lineupId)
          : [...prev.selectedLineupIds, lineupId],
      };
    });
  }, []);

  const handleSelectAllPlayers = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      selectedLineupIds: [],
    }));
  }, []);

  const toggleActiveTab = useCallback(
    (tab: "all" | "positive" | "negative") => {
      setFilters((prev) => ({
        ...prev,
        activeTab: tab,
      }));
    },
    [],
  );

  const togglePositiveDefSelection = useCallback((defId: string) => {
    setFilters((prev) => {
      const exists = prev.selectedPositiveDefIds.includes(defId);
      return {
        ...prev,
        selectedPositiveDefIds: exists
          ? prev.selectedPositiveDefIds.filter((id) => id !== defId)
          : [...prev.selectedPositiveDefIds, defId],
      };
    });
  }, []);

  const toggleNegativeDefSelection = useCallback((defId: string) => {
    setFilters((prev) => {
      const exists = prev.selectedNegativeDefIds.includes(defId);
      return {
        ...prev,
        selectedNegativeDefIds: exists
          ? prev.selectedNegativeDefIds.filter((id) => id !== defId)
          : [...prev.selectedNegativeDefIds, defId],
      };
    });
  }, []);

  const toggleGoalLeadVectors = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      showGoalLeadVectors: !prev.showGoalLeadVectors,
    }));
  }, []);

  const toggleMapMode = useCallback((mode?: "field" | "shot") => {
    setFilters((prev) => ({
      ...prev,
      mapMode: mode ?? (prev.mapMode === "field" ? "shot" : "field"),
    }));
  }, []);

  return {
    events,
    filteredEvents,
    teamLineups,
    eventDefinitionsMap,
    playground: effectivePlayground,
    shotMap: effectiveShotMap,
    filters,
    isLoading,
    error,
    togglePeriodFilter,
    togglePlayerSelection,
    handleSelectAllPlayers,
    toggleActiveTab,
    togglePositiveDefSelection,
    toggleNegativeDefSelection,
    toggleGoalLeadVectors,
    toggleMapMode,
  };
}
