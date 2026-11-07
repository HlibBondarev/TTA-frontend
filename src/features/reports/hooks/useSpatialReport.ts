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

// Helper to fetch and enrich event definitions map
async function loadDefinitionsMap(
  fetchedEvents: GameEventResponse[],
): Promise<Map<string, EventDefinitionLookup>> {
  const defs: EventDefinitionLookup[] = await db.eventdefinitions
    .toArray()
    .catch(() => []);

  const definitionsMap = new Map<string, EventDefinitionLookup>();
  defs.forEach((d) => definitionsMap.set(d.id, d));

  fetchedEvents.forEach((ev) => {
    if (ev.eventDefinitionId) {
      const existing = definitionsMap.get(ev.eventDefinitionId);
      definitionsMap.set(ev.eventDefinitionId, {
        id: ev.eventDefinitionId,
        sportId: existing?.sportId ?? "",
        name: ev.eventName || existing?.name || "Action",
        shortName: ev.eventName
          ? ev.eventName.substring(0, 4).toUpperCase()
          : existing?.shortName || "ACT",
        isPositive: ev.isPositive ?? existing?.isPositive ?? true,
        isShot: existing?.isShot ?? false,
      });
    }
  });

  return definitionsMap;
}

// Helper to resolve missing playground and shot map SVGs from IndexedDB or Backend API
async function resolveSportSvgs(
  matchId: string,
  initialPlayground?: string | null,
  initialShotMap?: string | null,
): Promise<{ playground: string | null; shotMap: string | null }> {
  let pg = initialPlayground ?? null;
  let sm = initialShotMap ?? null;

  if (pg && sm) {
    return { playground: pg, shotMap: sm };
  }

  try {
    const matchDb = await db.matches.get(matchId);
    const tournamentId = matchDb?.tournamentId;

    if (tournamentId) {
      let tournament = await db.tournaments.get(tournamentId);

      if (!tournament) {
        try {
          tournament = await apiClient.get<TournamentLookup>(
            `/Tournaments/${tournamentId}`,
          );
          if (tournament) {
            await db.tournaments.put(tournament);
          }
        } catch {
          // Ignore API fetch errors for missing tournament
        }
      }

      if (tournament?.configurationId && tournament?.sportId) {
        let config = await db.sportconfigurations.get(
          tournament.configurationId,
        );

        if (!config) {
          try {
            const configs = await sportService.getSportConfigurations(
              tournament.sportId,
            );
            config = configs.find((c) => c.id === tournament.configurationId);
            if (config) {
              await db.sportconfigurations.put(config);
            }
          } catch {
            // Ignore API fetch errors for sport configurations
          }
        }

        if (config) {
          if (!pg) pg = config.playground ?? null;
          if (!sm) sm = config.shotMap ?? null;
        }
      }
    }
  } catch (err) {
    console.error("Failed to load sport configuration SVGs in hook:", err);
  }

  return { playground: pg, shotMap: sm };
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
    playground ?? null,
  );
  const [effectiveShotMap, setEffectiveShotMap] = useState<string | null>(
    shotMap ?? null,
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
      const svgs = await resolveSportSvgs(matchId, playground, shotMap);
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
    return events.filter((ev) => {
      if (filters.mapMode === "shot") {
        if (ev.shotLocationX == null || ev.shotLocationY == null) {
          return false;
        }
        const def = ev.eventDefinitionId
          ? eventDefinitionsMap.get(ev.eventDefinitionId)
          : undefined;
        if (def?.isShot !== true) {
          return false;
        }
      }

      if (
        filters.periodNumber !== null &&
        ev.periodNumber !== filters.periodNumber
      ) {
        return false;
      }

      if (
        filters.selectedLineupIds.length > 0 &&
        (!ev.matchLineupId ||
          !filters.selectedLineupIds.includes(ev.matchLineupId))
      ) {
        return false;
      }

      if (filters.activeTab === "positive" && !ev.isPositive) return false;
      if (filters.activeTab === "negative" && ev.isPositive) return false;

      if (
        filters.selectedPositiveDefIds.length > 0 &&
        ev.isPositive &&
        ev.eventDefinitionId &&
        !filters.selectedPositiveDefIds.includes(ev.eventDefinitionId)
      ) {
        return false;
      }

      if (
        filters.selectedNegativeDefIds.length > 0 &&
        !ev.isPositive &&
        ev.eventDefinitionId &&
        !filters.selectedNegativeDefIds.includes(ev.eventDefinitionId)
      ) {
        return false;
      }

      return true;
    });
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
